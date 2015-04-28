var util = require('util');

var _ = require('lodash');
var Promise = require('bluebird');
var EventEmitter = require('events').EventEmitter;
var RTCConnection = require('rtcpeerconnection');

var PeerSocket = require('./PeerSocket');

Promise.promisifyAll(RTCConnection.prototype);

const PeerConnectionStates = [ 'reserved', 'connecting',
                               'init_established', 'recv_established',
                               'established' ];

function getRTCConfig(cb) {
  var config = {
    debug: false,
    iceServers: [
      { url: 'stun:stun.l.google.com:19302' },
      { url: 'stun:stun1.l.google.com:19302' },
      { url: 'stun:stun2.l.google.com:19302' },
      { url: 'stun:stun3.l.google.com:19302' },
      { url: 'stun:stun4.l.google.com:19302' }
    ]
  };

  if (_.isFunction(window.turnserversDotComAPI.iceServers)) {
    window.turnserversDotComAPI.iceServers(function(data) {
      Array.prototype.push.apply(config.iceServers, data);

      setTimeout(cb, 1, null, config);
    });
  } else {
    setTimeout(cb, 1, null, config);
  }
}

var getRTCConfigAsync = Promise.promisify(getRTCConfig);

const rtcConstraints = {
  mandatory: {
    OfferToReceiveAudio: false,
    OfferToReceiveVideo: true
  },
  optional: [
    { RtpDataChannels: true },
    { DtlsSrtpKeyAgreement: true }
  ]
};

function PeerConnection(socket, init) {
  EventEmitter.call(this);

  // underlying rtc peer connection
  this.pc = null;

  // underlying socket(s)
  this._socket = socket;
  this._peerSocket = null;

  this._beenSetup = false;

  this._rtcConfig = null;

  // reference to old state
  this._oldState = null;

  // so we can keep track of offer timeouts
  this._offerTimeout = null;

  // queued up ice candidates
  this._queuedIce = [];

  // streams and data channels
  this._streams = [];
  this._dataChannels = [];

  // wildemitter group nastiness
  this._group = null;

  _.defaults(this, init, {
    id: null,    // id of peer connection on server
    type: null,  // initiator or receiver?
    state: null, // current state
    model: null  // model from server, if given
  });
}

util.inherits(PeerConnection, EventEmitter);

PeerConnection.createLocal = function createLocal(socket, init) {
  var newPc = new PeerConnection(socket, _.defaults({}, init, {
    type: 'initiator',
    state: 'reserved'
  }));

  return Promise.join(newPc._create(), getRTCConfigAsync())
    .spread(function(newPc, rtcConfig) {
      newPc._rtcConfig = rtcConfig;
      newPc.pc = new RTCConnection(newPc._rtcConfig, rtcConstraints);
      return newPc;
    });
};

PeerConnection.createRemote = function createRemote(socket, id, init) {
  var newPc = new PeerConnection(socket, _.defaults({}, init, {
    id: id,
    type: 'receiver',
    state: 'reserved'
  }));

  newPc._group = 'pc-' + newPc.id;
  newPc._peerSocket = new PeerSocket(newPc._socket, newPc.id);

  return Promise.join(Promise.cast(newPc), getRTCConfigAsync())
    .spread(function(newPc, rtcConfig) {
      newPc._rtcConfig = rtcConfig;
      newPc.pc = new RTCConnection(newPc._rtcConfig, rtcConstraints);
      return newPc;
    });
};

PeerConnection.prototype._create = function create() {
  var that = this;

  // TODO associate a peer connection with a specific peer
  // which will allow for multiple peers per socket
  // now let's create a peer connection
  return new Promise(function(resolve, reject) {
    that._socket.post('/peerconnection/create', function gotPeerConnectionCreate(peerConnection) {
      if (peerConnection.status !== 200) {
        return reject(new Error('Could not create peer connection'));
      }

      that.id = peerConnection.connection.id;
      that.type = 'initiator';
      that.state = 'reserved';
      that._group = 'pc-' + that.id;
      that._peerSocket = new PeerSocket(that._socket, that.id);

      return resolve(that);
    });
  });
};

PeerConnection.prototype.destroy = function destroy(reason) {
  var that = this;

  // abandon events
  this.pc.releaseGroup(this._group);

  // don't bother with offer anymore
  if (this._offerTimeout) clearTimeout(this._offerTimeout);

  // notify other peer
  this._peerSocket.emit('close', reason);

  // close underlying peer connection
  this.pc.close();

  return new Promise(function(resolve, reject) {
    socket.post('/peerconnection/destroy', { id: that.id }, function gotPeerConnectionDestroy(peerConnection) {
      // it's okay if it's not there to destroy
      if (peerConnection.status !== 200 && peerConnection.status !== 404) {
        return reject(new Error('Could not destroy peer connection'));
      }

      return resolve(that);
    });
  });
};

PeerConnection.prototype.startConnection = function startConnection() {
  console.info('Starting peer connection', this.id, 'isInitiator?', this.isInitiator());

  this.setupConnectionBasics();

  if (!this.isInitiator()) {
    this.createReceiverConnection();
  } else {
    this.createInitiatorConnection();
  }
};

PeerConnection.prototype.setupConnectionBasics = function setupConnectionBasics() {
  if (this._beenSetup) return;
  this._beenSetup = true;

  var that = this;

  //this.pc = new RTCConnection(this._rtcConfig, rtcConstraints);

  //this.pc.on('*', function(event, data) { console.debug('debug', event, data); });

  if (!this.isInitiator()) {
    this._heartbeat = this.createDataConnection('heartbeat');
  }

  // things that may trigger processing the ice queue
  // may also put us in a connected state
  this.pc.on('iceConnectionStateChange', this._group, _.bind(this._onStateChange, this));
  this.pc.on('signalingStateChange', this._group, _.bind(this._onStateChange, this));

  // send ice when available
  this.pc.on('ice', this._group, function(candidate) {
    that._peerSocket.emit('ice', candidate);
  });

  // detect renegotations
  this.pc.on('negotiationNeeded', this._group, _.bind(this._negotiate, this));

  // streams and channels
  this.pc.on('addStream', this._group, _.bind(this._onGotAddStream, this));
  this.pc.on('addChannel', this._group, _.bind(this._onAddChannel, this));

  // process ice when available
  this._peerSocket.on('ice', _.bind(this._onGotIce, this));

  // handle offers and answers
  this._peerSocket.on('offer', _.bind(this._onGotOffer, this));
  this._peerSocket.on('answer', _.bind(this._onGotAnswer, this));

  // other events
  this._peerSocket.on('close', _.bind(this._onGotClose, this));
};

PeerConnection.prototype.createInitiatorConnection = function createInitiatorConnection() {
  return;
};

PeerConnection.prototype.createReceiverConnection = function createReceiverConnection() {
  return;
};

PeerConnection.prototype.createDataConnection = function createDataConnection(name, onopen, onmessage, onerror) {
  var that = this;

  var dataChannel = this.pc.createDataChannel(name);

  console.info('creating data channel (as ' + that.type + ')', dataChannel);

  dataChannel.onopen = onopen || function() {
    dataChannel.send('HELLO FROM ' + that.type + ' PEER CONN ' + that.id);
  };

  dataChannel.onmessage = onmessage || function(event) {
    console.log('data channel for peer connection', that.id, 'got message', event);
  };

  dataChannel.onerror = onerror || function(error) {
    console.error('data channel for peer connection', that.id, 'had error', error);
  };

  return dataChannel;
};

PeerConnection.prototype.isInitiator = function isInitiator() {
  return this.type === 'initiator';
};

// http://dev.w3.org/2011/webrtc/editor/webrtc.html#state-definitions
// https://github.com/rtc-io/rtc/issues/12
PeerConnection.prototype._isStable = function _isStable() {
  // http://dev.w3.org/2011/webrtc/editor/webrtc.html#idl-def-RTCSignalingState
  return this.pc.signalingState === 'stable';
};

PeerConnection.prototype._isConnected = function _isConnected() {
  // http://dev.w3.org/2011/webrtc/editor/webrtc.html#idl-def-RTCIceConnectionState
  return this.pc.iceConnectionState === 'connected' || this.pc.signallingState === 'completed';
};

PeerConnection.prototype._canProcessIce = function _canProcessIce() {
  return this._isStable() && this.pc.remoteDescription;
};

PeerConnection.prototype._onStateChange = function _onStateChange(change) {
  // try to process ice
  this._processIceQueue();

  // create the new state
  var newState = {
    signalingState: this.pc.signalingState,
    iceConnectionState: this.pc.iceConnectionState
  };

  // is it different?
  if (!_.isEqual(this._oldState, newState)) {
    // awesome, keep it and emit event
    this._oldState = newState;

    this.emit('change', newState);

    // now... are we connected?
    // TODO should this be fired potentially more than once?
    if (this._isStable() && this._isConnected()) {
      this.emit('connected', this);
    }
  }
};

PeerConnection.prototype._processIceQueue = function _processIceQueue() {
  if (this._canProcessIce() && !_.isEmpty(this._queuedIce)) return _.defer(_.bind(this._processIceAsStable, this));
  return false;
};

PeerConnection.prototype._processIceAsStable = function _processIceAsStable() {
  var that = this;

  if (this._canProcessIce()) {
    this._queuedIce = _.filter(this._queuedIce, function(candidate) {
      try {
        console.info('processing *queued* ice (as ' + that.type + ')', candidate, 'from peer connection', that.id);
        that.pc.processIce(candidate);
        return false;
      } catch(err) {
        console.warn('unable to apply ice candidate', candidate, 'for peer connection', that.id, 'failed with error', err);
        return true;
      }
    });
  }
};

PeerConnection.prototype._onGotIce = function _onGotIce(candidate) {
  // if we can't process it now, add it to queue
  if (!this._canProcessIce()) {
    console.info('queuing ice (as ' + this.type + ')', candidate, 'for peer connection', this.id);
    this._queuedIce.push(candidate);

    return;
  }

  try {
    console.info('processing ice *immediately* (as ' + this.type + ')', candidate, 'from peer connection', this.id);
    this.pc.processIce(candidate);
  } catch(err) {
    console.warn('unable to apply ice candidate', candidate, 'for peer connection', this.id, 'failed with error', err);
  }
};

PeerConnection.prototype._onGotOffer = function _onGotOffer(offer) {
  var that = this;

  console.info('receiving offer (as ' + this.type + ')', offer, 'from peer connection', this.id);

  this.pc.handleOfferAsync(offer)
    .then(function() {
      return that.pc.answerAsync(rtcConstraints);
    })
    .then(function(answer) {
      console.info('sending answer (as ' + that.type + ')', answer, 'to peer connection', that.id);
      that._peerSocket.emit('answer', answer);
    });

  /*
  // TODO we should only finalize after things are more... stringently good
  // like only after we are considered stable
  return that.finalize()
    .then(function(peerFinalization) {
      that.state = peerFinalization.state;
      console.info('setting state (as ' + that.type + ') to', that.state, 'for peer connection', that.id);
    });
  */
};

PeerConnection.prototype._onGotAnswer = function _onGotAnswer(answer) {
  var that = this;

  console.info('receiving answer (as ' + this.type + ')', answer, 'from peer connection', this.id);

  return this.pc.handleAnswerAsync(answer);

  /*
  // TODO fix up finalization process here too
  return that.finalize()
    .then(function(peerFinalization) {
      that.state = peerFinalization.state;
      console.info('setting state (as ' + that.type + ') to', that.state, 'for peer connection', that.id);
    });
  */
};

PeerConnection.prototype._onGotClose = function _onGotClose(reason) {
  // let someone else handle it
  this.emit('close', reason);
};

PeerConnection.prototype._negotiateAsStable = function _negotiateAsStable() {
  var that = this;

  console.info('negotiationg as stable for peer connection', this.id, 'as', this.type, 'with previous stable after timeout', this._offerTimeout);

  if (!this._isStable()) {
    console.warn('trying to negotiate, but peer connection', this.id, 'as', this.type, 'is not stable after timeout', this._offerTimeout,
                 '- will attempt to negotiate again');
    return this._negotiate();
  }

  return this.pc.offerAsync(rtcConstraints)
    .then(function(offer) {
      console.info('sending offer (as ' + that.type + ')', offer, 'to peer connection', that.id);
      console.info(that.pc);
      that._peerSocket.emit('offer', offer);
    });
};

PeerConnection.prototype._negotiate = function _negotiate() {
  console.info('renegotiating (as ' + this.type + ') for peer connection', this.id, 'existing offer timeout was', this._offerTimeout);

  // clear any existing offer
  clearTimeout(this._offerTimeout);
  this._offerTimeout = null;

  // now setup a new timeout to negotiate
  this._offerTimeout = setTimeout(_.bind(this._negotiateAsStable, this), 50);
};

PeerConnection.prototype._onAddChannel = function(newChannel, onopen, onmessage, onerror) {
  var that = this;

  this._dataChannels.push(newChannel);

  console.info('got new data channel (as ' + this.type + ')', newChannel);

  newChannel.onopen = onopen || function() {
    newChannel.send('HELLO FROM ' + that.type + ' PEER CONN ' + that.id);
  };

  newChannel.onmessage = onmessage || function(event) {
    console.log('data channel for peer connection', that.id, 'got message', event);
  };

  newChannel.onerror = onerror || function(error) {
    console.error('data channel for peer connection', that.id, 'had error', error);
  };
};

PeerConnection.prototype._onGotAddStream = function _onGotAddStream(newStream) {
  this._streams.push(newStream);

  // let someone else handle it
  this.emit('newStream', newStream);
};

PeerConnection.prototype.finalize = function finalize() {
  var that = this;

  return new Promise(function(resolve, reject) {
    socket.post('/peerconnection/finalize', { id: that.id }, function gotPeerFinalize(peerFinalization) {
      if (peerFinalization.status !== 200) {
        return reject(new Error('Could not finalize peer connection'));
      }

      return resolve(peerFinalization);
    });
 });
};

module.exports = PeerConnection;
