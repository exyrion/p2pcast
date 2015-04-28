var _ = require('lodash');
var Promise = require('bluebird');
var io = require('sails.io.js')(require('socket.io-client'));

var getUserMedia = require('getusermedia');
var getUserMediaAsync = Promise.promisify(getUserMedia);

var PeerConnectionManager = require('./PeerConnectionManager');
var PeerConnection = require('./PeerConnection');

global._enableFirehose = false;

// start connecting immediately
var socket = io.connect();
global.socket = socket;

// and promisify...
Promise.promisifyAll(socket);

const getUserMediaConfig = {
  audio: false,

  video: {
    mandatory: {
      minFrameRate: 15,
      maxFrameRate: 30,
      minWidth: 1280,
      minHeight: 720,
      maxWidth: 1280,
      maxHeight: 720
    },

    optional: []
  }
};

console.log('Connecting Socket.io to Sails.js...');

var _setupCallbacks = false;

var _channelId = null;
//var _isBroadcaster = false;
var _canBroadcast = false;
var _isLive = undefined;
var _isSourceBroadcaster = false;
var _reconnectTimeout = null;

// object of your local peer and peer connection from server
var _localPeerModel = null;
global._localPeerModel = _localPeerModel;

function resetGlobalState() {
  _canBroadcast = false;
  _isLive = undefined;
  _isSourceBroadcaster = false;
  _localPeerModel = null;
  URL.revokeObjectURL($('#localVideo')[0].src);
}

// stores all peer connections
var _pcManager = new PeerConnectionManager();
global._pcManager = _pcManager;

var _upstream = null;
global._upstream = _upstream;

function setUpstream(stream) {
  console.info('SETTING UPSTREAM', stream);
  _upstream = stream;
}

function getUpstream() {
  return _upstream;

  console.info('SELECTING UPSTREAM', _pcManager.getRemotes());

  return _.shuffle(_.where(_pcManager.getParents(), { 'state': 'established' }))[0].stream;
}

function addRemotePeerConnection(addedPeerConn) {
  if (_pcManager.exists(addedPeerConn)) return;

  PeerConnection.createRemote(socket, addedPeerConn)
    .then(function(newPc) {
      _pcManager.set(newPc);

      var upstream = getUpstream();
      console.info('got upstream', upstream, 'for remote peer connection', newPc.id);
      newPc.pc.addStream(upstream);

      setTimeout(_.bind(newPc.startConnection, newPc), 100);
      setTimeout(_.bind(newPc.finalize, newPc), 200);
    });
}

function removeRemotePeerConnection(removedPeerConn) {
  console.info('removing remote peer conn', removedPeerConn);

  if (_pcManager.exists(removedPeerConn)) {
    var pc = _pcManager.get(removedPeerConn);
    pc.destroy();

    _pcManager.remove(removedPeerConn);
  }

  // we have no more upstream!
  if (_pcManager.getParents().length === 0 && !_isSourceBroadcaster && _localPeerModel && !_reconnectTimeout) {
    URL.revokeObjectURL($('#localVideo')[0].src);

    var reconnectTimeout = _.random(0, 50);
    console.info('reconnect required detected, executing in random backoff of ' + reconnectTimeout + 'ms');

    _reconnectTimeout = setTimeout(function(socket, _pcManager, _localPeerModel) {
      _reconnectTimeout = null;

      if (_isLive) {
        console.info('reconnect going...');

        var thatPeerConn;

        return createLocalPeerConnection(socket, _pcManager, _localPeerModel)
          .then(function(peerConn) {
            thatPeerConn = peerConn;

            peerConn.pc.on('addStream', function(event) {
              setUpstream(event.stream);
              $('#localVideo')[0].src = URL.createObjectURL(event.stream);

              $('#addVideo').hide();
              $('#localVideo').fadeIn(800);

              peerConn.finalize()
                .error(function(err) {
                  console.error('error in finalization bootstrap, removing peer connection', err);
                  removeRemotePeerConnection(thatPeerConn);
                });
            });
          })
          .error(function(err) {
            console.error('error in bootstrapping, removing peer connection', err);
            removeRemotePeerConnection(thatPeerConn);
          })
          .catch(function(err) {
            console.error('throw in bootstrapping, removing peer connection', err);
            removeRemotePeerConnection(thatPeerConn);
          });
      } else {
        console.info('reconnect was scheduled, but channel offline');
      }
    }, reconnectTimeout, socket, _pcManager, _localPeerModel);
  }
}

function handleChannelMessage(data) {
  if (data.type === 'status') {
    console.info('got channel status', data);

    // update number of peers
    if (data.numPeers) $('#peers').text(data.numPeers);

    // do we got live data?
    if (_.has(data, 'live')) {
      //var livenessChanged = _isLive !== data.live;

      // if we were previously not live (like at start)
      // or was offline, we should figure out how to deal with it
      if (!_isLive) {
        // so if we are now live, awesome
        // we'll become a peer right away
        // we only want to do this if we are not the source broadcaster
        if (data.live && !_isSourceBroadcaster) {
          $('#addVideo').attr('disabled', 'disabled');

          var thatPeerConn;

          createOrGetPeer(_channelId, false)
            .then(function(peerModel) {
              _localPeerModel = peerModel;

              $('#peerId').text(_localPeerModel.id);

              return createLocalPeerConnection(socket, _pcManager, peerModel);
            })
            .then(function(peerConn) {
              thatPeerConn = peerConn;

              peerConn.pc.on('addStream', function(event) {
                setUpstream(event.stream);

                $('#localVideo')[0].src = URL.createObjectURL(event.stream);

                $('#addVideo').hide();
                $('#localVideo').fadeIn(800);

                peerConn.finalize()
                  .error(function(err) {
                    console.error('error in finalization bootstrap, removing peer connection', err);
                    removeRemotePeerConnection(thatPeerConn);
                  });
              });
            })
            .error(function(err) {
              console.error('error in bootstrapping, removing peer connection', err);
              //resetGlobalState();
              removeRemotePeerConnection(thatPeerConn);
            })
            .catch(function(err) {
              console.error('throw in bootstrapping, removing peer connection', err);
              //resetGlobalState();
              removeRemotePeerConnection(thatPeerConn);
            });
        } else if (_canBroadcast && !data.live) {
          // so if we are not live and are a broadcaster, give the user a chance to become one
          // we'll do this by disabling the addVideo button and handling a click
          $('#addVideo').removeAttr('disabled');
        }
      }

      // channel was live but went offline
      if (_isLive && !data.live) {
        $('#addVideo').removeAttr('disabled');
        $('#localVideo').hide();

        if (_canBroadcast) {
          $('#addVideo').fadeIn(800);
        }
      }

      // update indicator
      if (data.live) {
        $('#liveness-indicator')
          .text('live')
          .removeClass('palette-asbestos')
          .addClass('palette-alizarin');
      } else {
        $('#liveness-indicator')
          .text('offline')
          .removeClass('palette-alizarin')
          .addClass('palette-asbestos');
      }

      // finally update our global live tracker
      _isLive = data.live;
    }
  } else {
    console.info('unknown channel message', data);
  }
}

function setupCallbacks() {
  if (_setupCallbacks) return;
  _setupCallbacks = true;

  socket.post('/channel/subscribe', { id: _channelId }, function gotChannelSubscribe(resp) {
    console.info('got channel subscription', resp);
  });

  socket.on('channel', function gotChannelPub(message) {
    console.info('channel pubsub', message);

    switch (message.verb) {
    case 'messaged':
      handleChannelMessage(message.data);
      break;

    default:
      console.info('unhandled channel pubsub', message.verb);
      break;
    }
  });

  socket.on('peer', function gotPeerPub(message) {
    console.info('peer pubsub', message);

    if (!_localPeerModel) return;

    switch (message.verb) {
    case 'addedTo':
      if (message.id === _localPeerModel.id
          && message.attribute === 'connections') {
        addRemotePeerConnection(message.addedId);
      }
      break;

    case 'removedFrom':
      if (message.id === _localPeerModel.id
          && message.attribute === 'connections') {
        removeRemotePeerConnection(message.removedId);
      }
      break;

    default:
      console.info('unhandled peer pubsub', message.verb);
      break;
    }
  });

  socket.on('peerconnection', function gotPeerConnectionPub(message) {
    console.info('peerconnection pubsub', message);

    switch (message.verb) {
    case 'message':
      //handlePeerConnectionMessage(message);
      break;

    case 'updated':
      if (_pcManager.exists(message) && message.data.state) {
        _pcManager.get(message).state = message.data.state;
        //handlePeerConnectionUpdated(message);
      }
      break;

    default:
      console.info('unhandled peerconnection pubsub', message.verb);
      break;
    }
  });

  if (_canBroadcast) {
    $('#addVideo').on('click', function(e) {
      if (_isLive || _isSourceBroadcaster) {
        console.warn('broadcaster tried to add video, but channel already online');
        return false;
      }

      getUserMediaAsync(getUserMediaConfig)
        .then(function(stream) {
          //_isLive = true; // very important
          _isSourceBroadcaster = true;
          return [createOrGetPeer(_channelId, _canBroadcast), stream];
        })
        .spread(function(peerModel, stream) {
          _localPeerModel = peerModel;
          _localPeerModel.stream = stream;
          setUpstream(stream);

          $('#peerId').text(_localPeerModel.id);
          $('#localVideo')[0].src = URL.createObjectURL(stream);

          $('#addVideo').hide();
          $('#localVideo').fadeIn(800);
        })
        .error(function(err) {
          console.error('error in bootstrapping', err);
          _isSourceBroadcaster = false;
          //resetGlobalState();
        })
        .catch(function(err) {
          console.error('throw in bootstrapping', err);
          _isSourceBroadcaster = false;
          //resetGlobalState();
        });
    });
  }
}

function createOrGetPeer(channelId, isBroadcaster) {
  return new Promise(function(resolve, reject) {
    socket.post('/peer/create', { channel: channelId, broadcaster: isBroadcaster }, function gotPeerCreate(peerModel) {
      if (!peerModel.id) {
        return reject(new Error('Could not create peer model'));
      }

      return resolve(peerModel);
    });
  });
}

function createLocalPeerConnection(socket, manager, peerModel) {
  return PeerConnection.createLocal(socket, { model: peerModel })
    .then(function(peerConn) {
      manager.set(peerConn);
      peerConn.startConnection();
      return peerConn;
    });
}

// Attach a listener which fires when a connection is established:
socket.on('connect', function socketConnected() {
  console.log(
    'Socket is now connected and globally accessible as `socket`.\n' +
      'e.g. to send a GET request to Sails via Socket.io, try: \n' +
      '`socket.get("/foo", function (response) { console.log(response); })`'
  );

  // Sends a request to a built-in, development-only route which which
  // subscribes this socket to the firehose, a channel which reports
  // all messages published on your Sails models on the backend, i.e.
  // publishUpdate(), publishDestroy(), publishAdd(), publishRemove(),
  // and publishCreate().
  //
  // Note that these messages are received WHETHER OR
  // NOT the current socket is actually subscribed to them.  The firehose
  // is useful for debugging your app's pubsub workflow-- it should never be
  // used in your actual app.
  socket.get('/firehose', function nowListeningToFirehose () {
    // Attach a listener which fires every time Sails publishes
    // message to the firehose.
    socket.on('firehose', function newMessageFromSails ( message ) {
      if (_enableFirehose) console.log('FIREHOSE (debug): Sails published a message ::\n', message);
    });
  });

  if ($('#currentChannelId').length) {
    _channelId = parseInt($('#currentChannelId').text());
  }

  // we're only interested if we're on a channel
  if (!_channelId) return;

  // we're a broadcaster if this is here
  if ($('#addVideo').length) _canBroadcast = true;

  // if we're a broadcaster we're not interested in continuing at this point
  // we'll come back later to add video
  setupCallbacks();
});
