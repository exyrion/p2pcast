/**
 * PeerConnection.js
 *
 * @description :: Represents a single connection between two peers
 * @docs	:: http://sailsjs.org/#!documentation/models
 */

var _ = require('lodash');

const PeerConnectionStates = [ 'reserved', 'connecting',
			       'init_established', 'recv_established',
			       'established' ];

var PeerConnection = {
  adapter: 'memory',

  types: {
    state: function(state) {
      return _.contains(PeerConnectionStates, state);
    }
  },

  attributes: {
    state: {
      type: 'string',
      state: true,
      required: true
    },

    endpoint: {
      model: 'peer',
      via: 'id',
      required: true
    },

    initiator: {
      model: 'peer',
      via: 'id',
      required: true
    }

  },

  getOppositePeer: function getOppositePeer(peerConnection, localPeer) {
    var oppositePeer = peerConnection.endpoint;

    if (oppositePeer === localPeer.id) {
      oppositePeer = peerConnection.initiator;
    }

    return Peer.findOneById(oppositePeer)
      .populate('connections');
  },

  checkEstablished: function checkPeerConnectionEstablished(id, lastUpdate, numChecks) {
    // we're checking again
    numChecks += 1;

    sails.log.info('checkEstablished before', id, lastUpdate.getTime(), numChecks);

    sails.models.peerconnection.findOne({ id: id })
      .populate('initiator')
      .populate('endpoint')
      .then(function(peerConn) {
        // may be gone by the time we check
        if (!peerConn) return null;

        sails.log.info('checkEstablished', peerConn);
        sails.log.info('isEqual', peerConn.updatedAt.getTime() === lastUpdate.getTime());

        // in case this connection is stuck and not updating (continuously rescheduling)
        if (numChecks > 3) {
          sails.log.warn('PeerConnection#checkEstablished: connection', peerConn.id,
                         'not established after', numChecks, 'checks, likely stuck - destroying it');
          return sails.models.peerconnection.destroy({ id: peerConn.id });
        }

        // if there was no change, schedule another update instead
         if (peerConn.updatedAt.getTime() === lastUpdate.getTime()) {
          // check somewhere between 4s and 5s
          sails.log.warn('PeerConnection#checkEstablished: connection', peerConn.id,
                         'not updated since', lastUpdate, 'retrying...');

          var checkTimeout = _.random(9000, 10000);
          setTimeout(PeerConnection.checkEstablished, checkTimeout, peerConn.id, peerConn.updatedAt, numChecks);
          return null;
        }

        // now we finally check that the connection is established
        if (peerConn.state !== 'established') {
          sails.log.warn('PeerConnection#checkEstablished: connection', peerConn.id, 'not established after', numChecks, 'checks - destroying it');
          return sails.models.peerconnection.destroy({ id: peerConn.id });
        }

        sails.log.info('PeerConnection#checkEstablished: connection', peerConn.id, 'verified to be established!');
        return null;
      })
      .then(function(peerConn) {
        if (!peerConn || peerConn.length === 0) return;

        peerConn = peerConn[0];
        sails.models.peerconnection.publishDestroy(peerConn.id, null, { previous: peerConn });
      })
      .error(function(err) {
        sails.log.error('PeerConnection#checkEstablished: error', err);
      })
      .catch(function(err) {
        sails.log.error('PeerConnection#checkEstablished: catch', err);
      });
  },

  afterCreate: function afterPeerConnectionCreate(values, cb) {
    sails.log.info('PeerConnection#create: values', values);

    // check somewhere between 4s and 5s
    var checkTimeout = _.random(9000, 10000);
    setTimeout(PeerConnection.checkEstablished, checkTimeout, values.id, values.createdAt, 0);

    cb();
  },

  afterUpdate: function afterPeerConnectionUpdate(values, cb) {
    sails.log.verbose('PeerConnection#afterUpdate: values', values);
    cb();
  },

  afterDestroy: function afterPeerConnectionDestroy(values, cb) {
    sails.log.verbose('PeerConnection#afterDestroy: values', values);
    cb();
  },

  // this callback is executed when a peer is removed
  // this can happen when either the socket associated with the peer is destroyed
  // or for some reason they are removed from this peer connection
  afterPublishRemove: function afterPeerConnectionPublishRemove(id, alias, idRemoved, req) {
    sails.log.verbose('PeerConnection#afterPublishRemove: id', id, /*'attribute', attribute,*/ 'alias', alias/*, 'req', req*/);
  },

  afterPublishDestroy: function afterPeerConnectionPublishDestroy(id, req, options) {
    sails.log.verbose('PeerConnection#afterPublishDestroy: id', id, /*'attribute', attribute,*/ 'options', options/*, 'req', req*/);
  }
};

module.exports = PeerConnection;
