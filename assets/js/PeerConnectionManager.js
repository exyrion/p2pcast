var _ = require('lodash');

function PeerConnectionManager() {
  // all peer connections
  this._peerconns = Object.create(null);
}

PeerConnectionManager.prototype.get = function get(key) {
  key = _.isObject(key) ? key.id : key;
  return this._peerconns[key];
};

PeerConnectionManager.prototype.exists = function exists(key) {
  return _.isObject(this.get(key));
};

PeerConnectionManager.prototype.set = function set(key, peerConn) {
  if (_.isUndefined(peerConn)) {
    // set all rolled into one
    peerConn = key;
  }

  if (!this.exists(peerConn)) {
    key = _.isObject(key) ? key.id : key;
    this._peerconns[key] = peerConn;
  }

  return this.get(peerConn);
};

PeerConnectionManager.prototype.remove = function remove(key) {
  if (this.exists(key)) {
    key = _.isObject(key) ? key.id : key;
    this._peerconns[key] = null;
    delete this._peerconns[key];
  }

  return this.get(key);
};

PeerConnectionManager.prototype.getChildren = PeerConnectionManager.prototype.getLocals = function getRemotes() {
  return _.where(this._peerconns, { type: 'receiver' });
};

PeerConnectionManager.prototype.getParents = PeerConnectionManager.prototype.getRemotes = function getRemotes() {
  return _.where(this._peerconns, { type: 'initiator' });
};

module.exports = PeerConnectionManager;
