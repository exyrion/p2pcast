var _ = require('lodash');
var Promise = require('bluebird');
var EventEmitter = require('events').EventEmitter;

/*
 * TODO
 * shim out sails-specific way of communication?
 * large assumptions that socket is a sails.io.js hacked up socket.io
 * and that communication is largely done via the pubsub way through the server
 * how to handle failures? emits could fail.
 * we should probably do it the node.js way of emitting an error but those are fraught with danger
*/
function PeerSocket(socket, id, localId, remoteId) {
  // underlying socket, non-exclusive to this peer socket
  this._socket = socket;

  // id of the connection
  this._id = id;

  // unique peer identifiers
  this._localId = localId;
  this._remoteId = remoteId;

  // our proxy event emitter
  // we let it handle on and emit to it when we get something on the socket really destined for us
  this._emitter = new EventEmitter();

  var bindLower = _.bind(function bindLower(lower, methods) {
    var that = this;

    if (!_.isArray(methods)) {
      methods = [methods];
    }

    _.forEach(methods, function(name) {
      that[name] = _.bind(lower[name], lower);
    });
  }, this);

  bindLower(this._emitter, [
    'on', 'addListener', 'once',
    'removeListener', 'removeAllListeners',
    'setMaxListeners', 'listeners'
  ]);

  this._onBinding = _.bind(this._on, this);
  this._socket.on('peerconnection', this._onBinding);
}

PeerSocket.prototype._close = function PeerSocket_Close(reason) {
  var that = this;

  // let's emit a destroy to the other side
  this.emit('close', reason);

  // now let's destroy on the server
  /*
  this._socket.post('/peerconnection/destroy', { id: this._id }, function(peerDestruction) {
    if (peerDestruction.status !== 200) {
      console.error('Could not destroy peer connection', that._id, 'for reason "' + reason + '"');
    }
  });
  */

  // remove listener on socket after a small delay
  // TODO - good reason to do this? rtc/reset does, but why?
  setTimeout(function() {
    that._socket.removeListener('peerconnection', that._onBinding);
  }, 250);

  return this;
};

PeerSocket.prototype._emit = function PeerSocket_Emit(event, data) {
  var that = this;

  this._socket.post('/peerconnection/message',
    {
      id: this._id,
      data: { type: event, payload: data }
    },
    function gotPeerMessage(peerMessage) {
      if (peerMessage.status !== 200) {
        console.error('Could not message', { type: event, payload: data }, 'via peer connection', that._id);
      }
    });

  return this;
};

PeerSocket.prototype._on = function PeerSocket_On(message) {
  if (message.verb === 'messaged'
      && message.id === this._id
      && message.data && message.data.type && message.data.payload) {
    this._emitter.emit('data', message.data);
    this._emitter.emit(message.data.type, message.data.payload);
  } else if (message.id === this._id && message.verb && message.data) {
    this._emitter.emit('data', message.data);
    this._emitter.emit(message.verb, message.data);
  }
};

PeerSocket.prototype.close = function PeerSocketClose(reason) {
  // underlying close
  return this._close(reason);
};

PeerSocket.prototype.emit = function PeerSocketEmit(event, data) {
  return this._emit(event, data);
};

module.exports = PeerSocket;
