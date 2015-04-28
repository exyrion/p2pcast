/**
 * PeerConnectionController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

var _ = require('lodash');
var Promise = require('bluebird');

var PeerConnectionController = {
  create: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var socketId = req.socket.id;

    // first, we get the id of the one requesting a new peer connection
    // to do this, we find them in the peer table
    var getPeerBySocketId = Promise.method(function(socketId) {
      return Peer.findOneBySocketId(socketId)
        .populate('channel')
        .populate('connections')
        .then(function(peer) {
          if (!peer) {
            return Promise.reject(res.notFound('Can not get a peer connection unless you are a peer'));
          }

          return peer;
        });
    });

    var getPeerMatch = function(initiatorPeer) {
      sails.log.silly('PeerConnectionController#create: getPeerMatch - initiatorPeer', initiatorPeer);

      // first, build a tree
      // we'll find some broadcaster to be the root
      return Peer.findOne({ channel: initiatorPeer.channel.id, broadcaster: true })
        .populate('channel')
        .populate('connections')
        .then(function(broadcaster) {
          if (!broadcaster) {
            throw new Error('No broadcasters available to create peer connection');
          }

          // dirty hack to prevent validation errors later
          initiatorPeer.channel = initiatorPeer.channel.id;

          return broadcaster.buildTree();
        })
        .then(function(root) {
          // now that we have a root, we can call chooseUpstream on initiator with the root passed in
          return initiatorPeer.chooseUpstream(root);
        })
        .then(function(receiverMatch) {
          if (!receiverMatch) {
            throw new Error('No peer connection matches could be made');
          }

          sails.log.info('PeerConnectionController#create: candidate peer is', receiverMatch);

          // found a match, but we need to get the "real" model to pass onto later steps
          return [initiatorPeer, Peer.findOneById(receiverMatch.id).populate('connections')];
        });
    };

    // finally, we will use that to hook them up together
    var hookupPeerConnection = function(initiatorPeer, receiverPeer) {
      sails.log.silly('PeerConnectionController#create: hookupPeerConnection - initiatorPeer', initiatorPeer, 'receiverPeer', receiverPeer);

      var makePc = Promise.method(function(initiatorPeer, receiverPeer) {
        return PeerConnection.create({ state: 'reserved', endpoint: receiverPeer.id, initiator: initiatorPeer.id })
          .then(function(peerConn) {
            if (!peerConn) {
              throw new Error('Unable to create peer connection');
            }

            // subscribe peer connection to socket
            PeerConnection.subscribe(req.socket, peerConn);

            return peerConn;
          });
      });

      // TODO terrible terrible race condition possible
      // it is possible to overwrite connections with an old value
      var saveInitiator = function saveInitiator(peerConn, initiatorPeer) {
        return new Promise(function(resolve, reject) {
          initiatorPeer.connections.add(peerConn.id);

          return Promise.promisify(initiatorPeer.save, initiatorPeer)()
            .then(function(upd) {
              if (!upd) {
                return reject(new Error('DB error, hit race condition updating peer', initiatorPeer.id, 'with outbound conn', peerConn.id));
              }

              return resolve(upd);
            });
        });
      };

      var saveReceiver = function saveReceiver(peerConn, receiverPeer) {
        return new Promise(function(resolve, reject) {
          receiverPeer.connections.add(peerConn.id);

          return Promise.promisify(receiverPeer.save, receiverPeer)()
            .then(function(upd) {
              if (!upd) {
                return reject(new Error('DB error, hit race condition updating peer', receiverPeer.id, 'with inbound conn', peerConn.id));
              }

              return resolve(upd);
            });
        });
      };

      return makePc(initiatorPeer, receiverPeer)
        .then(function(peerConn) {
          return Promise.join(peerConn, saveInitiator(peerConn, initiatorPeer), saveReceiver(peerConn, receiverPeer));
        })
        .error(function(err) {
          sails.log.error('PeerConnectionController#create: makePc error', err);
        })
        .catch(function(err) {
          sails.log.error('PeerConnectionController#create: makePc catch', err);
        });
    };

    getPeerBySocketId(socketId)
      .then(getPeerMatch)
      .spread(hookupPeerConnection)
      .spread(function(peerConn, initiatorPeer, receiverPeer) {
        sails.log.info('PeerConnection#create: final - peerConn', peerConn,
                       'initiatorPeer', initiatorPeer,
                       'receiverPeer', receiverPeer);

        // subscribe peer connection to socket
        //PeerConnection.subscribe(req.socket, peerConn);
        PeerConnection.subscribe([req.socket, receiverPeer.socketId], peerConn);

        //Peer.publishAdd(initiatorPeer.id, 'connections', peerConn.id, null, { noReverse: true });
        //Peer.publishAdd(receiverPeer.id, 'connections', peerConn.id, null, { noReverse: true });

        // TODO maybe leave in?
        Peer.subscribe(req.socket, initiatorPeer);
        //Peer.subscribe(req.socket, receiverPeer);

        PeerConnection.publishCreate(peerConn, req.socket);

        return res.json({ status: 200, connection: peerConn });
      })
      .error(function(err) {
        sails.log.error('PeerConnectionController#create: DB error', err);
        return res.serverError('DB error', err);
      })
      .catch(Error, function(err) {
        sails.log.error('PeerConnectionController#create: Internal server error', err);
        return res.serverError('Internal server error', err);
      })
      .catch(function(err) {
        sails.log.error('PeerConnectionController#create: Other internal server error', err);
        return res.serverError('Other internal server error', err);
      });

  },

  message: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var peerConnectionId = req.param('id');
    var data = req.param('data');
    var socketId = req.socket.id;

    var getPeerConnectionById = Promise.method(function(peerConnectionId) {
      return PeerConnection.findOneById(peerConnectionId)
        .populate('initiator')
        .populate('endpoint')
        .then(function(peerConn) {
          if (!peerConn) {
            return Promise.reject(res.serverError('Can not message a nonexistent peer connection'));
          }

          return peerConn;
        });
    });

    // update reserved state to connecting state as required
    var updateState = function(peerConn) {
      if (peerConn.state === 'reserved') {
        var previousPeerConn = peerConn.toObject();

        return PeerConnection.update({ id: peerConn.id },
                                     { state: 'connecting' })
          .then(function(updated) {
            if (!updated || updated.length === 0) {
              return Promise.reject(res.serverError('Could not change nonexistent peer connection state'));
            }

            updated = updated[0];

            // publish update if needed
            sails.log.verbose('PeerConnection#message: updateState for peer connection id', updated.id,
                              'new state', updated.state, 'previous', peerConn);

            PeerConnection.publishUpdate(updated.id, { state: updated.state }, null, { previous: peerConn });

            return peerConn;
          });
      }

      // some other state
      return peerConn;
    };

    getPeerConnectionById(peerConnectionId)
      .then(updateState)
      .then(function(peerConn) {
        // we'll subscribe them to the peer connection
        // this is *especially* needed after a peer connection is first initiated
        // the remote peer knows they they were added as one of their children, but can't be subscribed
        // it is the remote peer's responsibility to make an offer using message
        // this will, in effect, subscribe them to the future of the channel

        sails.log.verbose('PeerConnection#message: Subscribing socket', socketId,
                          'to peer connection', peerConn.id);
        PeerConnection.subscribe(req.socket, peerConn);

        // now we'll forward the message on, exclude the sender
        PeerConnection.message(peerConn, data, req.socket);

        // let our guy know all is well
        return res.json({ status: 200 });
      })
      .error(function(err) {
        sails.log.error('PeerConnectionController#message: DB error', e);
        return res.serverError('DB error');
      })
      .catch(Error, function(e) {
        sails.log.error('PeerConnectionController#message: Internal server error', e);
        return res.serverError('Internal server error');
      })
      .catch(function(e) {
        return res.serverError('Other internal server error');
      });

  },

  destroy: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var socketId = req.socket.id;
    var peerConnectionId = req.param('id');

    var getPeerConnectionById = Promise.method(function(peerConnectionId) {
      return PeerConnection.findOneById(peerConnectionId)
        .populate('initiator')
        .populate('endpoint')
        .then(function(peerConn) {
          if (!peerConn) {
            return Promise.reject(res.notFound('Can not destroy nonexistent peer connection'));
          }

          return peerConn;
        });
    });

    var destroyPeerConnection = function(peerConn) {
      return PeerConnection.destroy({ id: peerConn.id })
        .then(function() {
          return peerConn;
        });
    };

    getPeerConnectionById(peerConnectionId)
      .then(destroyPeerConnection)
      .then(function(peerConn) {
        sails.log.info('PeerConnection#destroy: Destroying peer connection',
                       peerConn.id, 'by request of socket', socketId);

        // publish the destroy
        PeerConnection.publishDestroy(peerConn.id, null, { previous: peerConn });

        return res.json({ status: 200 });
      })
      .error(function(err) {
        sails.log.error('PeerConnectionController#destroy: DB error', e);
        return res.serverError('DB error');
      })
      .catch(Error, function(e) {
        sails.log.error('PeerConnectionController#destroy: Internal server error', e);
        return res.serverError('Internal server error');
      })
      .catch(function(e) {
        return res.serverError('Other internal server error');
      });

  },

  finalize: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var peerConnectionId = req.param('id');
    var socketId = req.socket.id;

    var getPeerConnectionById = Promise.method(function(peerConnectionId) {
      return PeerConnection.findOneById(peerConnectionId)
        .populate('initiator')
        .populate('endpoint')
        .then(function(peerConn) {
          if (!peerConn) {
            return Promise.reject(res.serverError('Can not finalize a nonexistent peer connection'));
          }

          return peerConn;
        });
    });

    // update reserved state to connecting state as required
    var updateState = Promise.method(function(peerConn) {
      sails.log.silly('PeerConnection#finalize: updateState - peerConn', peerConn);

      if (peerConn.state !== 'established') {
        var newState = 'established';

        if (peerConn.endpoint.socketId === socketId) {
          if (peerConn.state !== 'init_established') newState = 'recv_' + newState;
        } else if (peerConn.initiator.socketId === socketId) {
          if (peerConn.state !== 'recv_established') newState = 'init_' + newState;
        } else {
          // WTF?
          throw new Error('Neither the receiver or initiator peer were responsible for finalizing the peer connection');
        }

        sails.log.verbose('PeerConnection#finalize: updateState - updating peer connection', peerConn.id,
                          'with new state', newState, 'from old state', peerConn.state);

        return PeerConnection.update({ id: peerConn.id }, { state: newState })
          .then(function(updated) {
            if (!updated || updated.length === 0) {
              return res.serverError('Could not change nonexistent peer connection state');
            }

            updated = updated[0];

            // publish update
            sails.log.verbose('PeerConnection#finalize: updateState - publishing for peer connection id', updated.id,
                              'new state', updated.state, 'previous', peerConn);

            PeerConnection.publishUpdate(updated.id, { state: updated.state }, null, { previous: peerConn });

            return updated;
          });
      } else {
        // already in established state
        return peerConn;
      }
    });

    getPeerConnectionById(peerConnectionId)
      .then(updateState)
      .then(function(peerConn) {
        sails.log.info('PeerConnection#message: Finalizing peer connection', peerConn.id,
                       'into state', peerConn.state, 'by request of socket', socketId);

        return res.json({ status: 200, state: peerConn.state });
      })
      .error(function(err) {
        sails.log.error('PeerConnectionController#finalize: DB error', e);
        return res.serverError('DB error');
      })
      .catch(Error, function(e) {
        sails.log.error('PeerConnectionController#finalize: Internal server error', e);
        return res.serverError('Internal server error');
      })
      .catch(function(e) {
        return res.serverError('Other internal server error');
      });

  }

};

module.exports = PeerConnectionController;
