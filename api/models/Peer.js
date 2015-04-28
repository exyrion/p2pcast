/**
 * Peer.js
 *
 * @description :: Represents a peer, which is an individual node in the peer to peer network
 * @docs        :: http://sailsjs.org/#!documentation/models
 */

var _ = require('lodash');
var t = require('t');
var Promise = require('bluebird');

var Peer = {
  adapter: 'memory',

  attributes: {
    socketId: {
      type: 'string',
      unique: true,
      required: true
    },

    user: {
      model: 'user'
    },

    channel: {
      model: 'channel',
      required: true
    },

    broadcaster: {
      type: 'boolean',
      required: true
    },

    connections: {
      collection: 'peerconnection',
      via: 'id',
      dominant: true
    },

    canRebroadcast: function canRebroadcast() {
      // broadcasters can always rebroadcast
      // TODO is this really true? should broadcaster have a parent peerconnection to itself?
      // this would mean that if their camera goes down their self peerconnection goes down too
      if (this.broadcaster) return true;

      // we only want established connections
      var upstreamConnections = _.filter(this.connections, { state: 'established' });

      // TODO make this function do double duty, say return connections that can be used
      return upstreamConnections.length > 0;
    },

    getChildrenConnections: function getChildren(connectionCriteria) {
      return _.filter(this.connections, _.extend({ endpoint: this.id }, connectionCriteria));
    },

    getParentConnections: function getParents(connectionCriteria) {
      return _.filter(this.connections, _.extend({ initiator: this.id }, connectionCriteria));
    },

    buildTree: function buildTree(connectionCriteria, transform) {
      // someone only passed in a transform
      // make all right with the world
      if (_.isFunction(connectionCriteria)) {
        transform = connectionCriteria;
        connectionCriteria = void 0;
      }

      connectionCriteria = connectionCriteria || { state: 'established' };

      // this is the root
      var root = this.toObject();
      var rootChannelId = _.isObject(root.channel) ? root.channel.id : root.channel;
      root._seen = true;
      root.children = [];
      root._shadowConnections = _.filter(root.connections, { endpoint: root.id });

      var Q = [root];
      var V = Object.create(null);
      V[root.id] = true;

      // get all peers in this channel
      return sails.models.peer.find()
        .populate('connections')
        .then(function(peers) {
          // TODO filter out peers not in this channel
          // also convert to object, will maybe save lookup time when building tree

          // also TODO, use kruskal's with peer connections - will allow disconnected trees
          // also mess with _seen
          return _.map(peers, function(peer) {
            peer = peer.toObject();
            peer._seen = false;
            peer.children = [];
            return peer;
          });
        })
        .then(function(peers) {
          while (Q.length !== 0) {
            var parent = Q.shift();

            sails.log.silly('Peer#buildTree: got parent', parent);

            var children = _.filter(peers, function(peer) {
              sails.log.silly('Peer#buildTree checking peer', peer, 'for childship of parent');

              var peerChannelId = _.isObject(peer.channel) ? peer.channel.id : peer.channel;

              if (peer._seen || peer.id === root.id || peerChannelId !== rootChannelId) return false;

              peer._shadowConnections = _.filter(peer.connections, { endpoint: parent.id });
              if (_.some(peer.connections, _.extend({ endpoint: parent.id }, connectionCriteria))) {
                peer._seen = true;
                return true;
              }

              return false;
            });

            _.forEach(children, function(child) {
              sails.log.silly('Peer#buildTree: adding child to parent');
              Q.push(child);
              parent.children.push(child);
            });
          }
        })
        .then(function() {
          sails.log.verbose('Peer#buildTree: built tree', root);
          return root;
        });
    },

    chooseUpstream: function chooseUpstream(root) {
      // given a root peer in a tree, let's figure out which peer to connect to
      // currently a very simple algorithm - attempt to fill each peer up with two children

      var self = this;

      // we'll make up a list of candidates
      var candidates = [];

      // do a breadth-first search to find ourselves a spot
      t.bfs(root, function(node, par) {
        console.info('chooseUpstream checking', node);
        if (self.id !== node.id && node.children.length <= 1 && node._shadowConnections.length <= 3) {
          sails.log.silly('Peer#chooseUpstream: found potential upstream', node);
          candidates.push(node);
        }
      });

      // we'll just choose some random candidate for now
      //var candidate = _.shuffle(candidates)[0];
      var candidate = candidates[0];

      sails.log.info('Peer#chooseUpstream: chose', candidate, 'as the upstream for', this);

      return candidate;
    }
  },

  findConnectionsByPeerId: function findConnectionsByPeerId(peerId, connectionCriteria) {
    return sails.models.peer.findOne({ id: peerId })
      .populate('connections')
      .then(function(peer) {
        return _.filter(peer.connections, connectionCriteria);
      });
  },

  findChildrenConnectionsByPeerId: function findChildrenConnectionsByPeerId(peerId, extraCriteria) {
    return Peer.findConnectionsByPeerId(peerId, _.defaults({ endpoint: peerId }, extraCriteria));
  },

  findParentConnectionsByPeerId: function findParentConnectionsByPeerId(peerId, extraCriteria) {
    return Peer.findConnectionsByPeerId(peerId, _.defaults({ initiator: peerId }, extraCriteria));
  },

  beforeUpdate: function beforePeerUpdate(values, cb) {
    sails.log.verbose('Peer#beforeUpdate: values', values);
    cb();
  },

  beforeDestroy: function beforePeerDestroy(criteria, cb) {
    sails.log.verbose('Peer#beforeDestroy: criteria', criteria);

    sails.models.peer.findOneById(criteria.where.id)
      .populate('connections')
      .then(function(peer) {
        // let's find what channel they were with so we can take care of that
        // they need to removed from channel's peers and possibly get an update
        return Promise.join(Channel.findOneById(peer.channel).populate('peers'), peer);
      })
      .spread(function(channel, peer) {
        // wtf? everything's mostly fine... we'll just continue
        if (!channel) return peer;

        // remove peer from channel list of peers, if it's there (?!)
        if (_.some(channel.peers, { id: peer.id })) {
          channel.peers.remove(peer.id);
        }

        return Promise.join(Promise.promisify(channel.save, channel)(), peer);
      })
      .spread(function(channel, peer) {
        // send a little status update out and continue on
        Channel.message(channel, { type: 'status', live: channel.isLive(), numPeers: channel.peers.length });

        return peer;
      })
      .then(function(peer) {
        // build tree with one being destroyed as root
        // any state connection will be associated with this tree
        // prevents any issues with peers in the middle of connecting
        return peer.buildTree({});
      })
      .then(function(root) {
        // TODO use ES6 sets?
        // also be more efficient about how connections are added - lots of duplicates (one at each level)
        var connectionIds = [];
        t.dfs(root, function(node) {
          // add all connection ids associated with this peer
          var ids = _.pluck(node.connections, 'id');
          sails.log.verbose('Peer#beforeDestroy: adding peer connections', ids);
          connectionIds.push.apply(connectionIds, ids);
        });

        // get rid of dupes
        // TODO probably realllly slow
        connectionIds = _.uniq(connectionIds);

        // seems to be a bug where if you try to delete with an empty array, it empties the whole collection
        // this is obviously a bad thing
        if (connectionIds.length > 0) {
          return PeerConnection.destroy({ id: connectionIds });
        } else {
          return connectionIds;
        }
      })
      .then(function(destroyedPeerConns) {
        sails.log.info('Peer#beforeDestroy: destroyedPeerConns', destroyedPeerConns);

        _.forEach(destroyedPeerConns, function(destroyedPeerConn) {
          PeerConnection.publishDestroy(destroyedPeerConn.id, null, { previous: destroyedPeerConn });
        });
      })
      .error(function(err) {
        return cb(err);
      })
      .catch(function(err) {
        return cb(err);
      })
      .finally(function() {
        return cb();
      });
  },

  afterUpdate: function afterPeerUpdate(values, cb) {
    sails.log.verbose('Peer#afterUpdate: values', values);
    cb();
  },

  afterDestroy: function afterPeerDestroy(values, cb) {
    sails.log.verbose('Peer#afterDestroy: values', values);
    cb();
  },

  afterPublishRemove: function afterPeerPublishRemove(id, alias, idRemoved, req) {
    sails.log.verbose('Peer#afterPublishRemove: id', id, 'alias', alias, 'idRemoved', idRemoved/*, 'req', req*/);
  },

  afterPublishDestroy: function afterPeerPublishDestroy(id, req, options) {
    sails.log.verbose('Peer#afterPublishDestroy: id', id, /*'attribute', attribute,*/ 'options', options /*, 'req', req*/);
  }

};

module.exports = Peer;
