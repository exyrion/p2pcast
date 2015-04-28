/**
 * ChannelController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

var _ = require('lodash');
var Promise = require('bluebird');

var ChannelController = {
  index: function(req, res) {
    Channel.find()
      .populate('owner')
      .then(function(channels) {
        if (req.wantsJSON || req.isSocket) {
          return res.json({
            channels: channels
          });
        } else {
          return res.view({
            channels: channels,
            title: "Channels"
          });
        }
      })
      .error(function(err) {
        return res.serverError(err);
      });
  },

  show: function(req, res) {
    var criteria = { id: req.param('id') };
    if (!criteria.id) criteria = { name: req.param('name') };

    Channel.findOne(criteria)
      .populate('owner')
      .then(function(channel) {
        if (!channel) {
          return res.notFound('Channel not found');
        }

        if (req.wantsJSON || req.isSocket) {
          return res.json({
            channel: channel
          });
        } else {
          return res.view({
            channel: channel,
            title: channel.name
          });
        }
      })
      .error(function(err) {
        if (err.code === 'E_VALIDATION')
          return res.badRequest(err);
        else
          return res.serverError(err);
      });
  },

  create: function(req, res) {
    if (!req.session.user) {
      return res.forbidden('Not logged in');
    }

    var name = req.param('name');
    var owner = req.session.user.id;

    Channel.create({ name: name, owner: owner })
      .then(function(channel) {
        if (!channel) {
          return res.serverError('ChannelController#create: Could not create channel', name, 'with owner', owner);
        }

        return res.redirect('/channel/' + channel.id);
      })
      .error(function(err) {
        if (err.code === 'E_VALIDATION')
          return res.badRequest(err);
        else
          return res.serverError(err);
      });
  },

  update: function(req, res) {
    var name = req.param('name');
    var description = req.param('description');
    var id = req.param('id');

    if (_.isUndefined(id)){
      return res.badRequest('Channel ID is required', 'back');
    }

    Channel.update({ id: id },
                   { name: name, description: description })
      .then(function(channel) {
        req.flash('msg', 'Channel updated successfully');
        return res.redirect('back');
      })
      .error(function(err) {
        if (err.code === 'E_VALIDATION')
          return res.badRequest(err, 'back');
        else
          return res.serverError(err);
      });
  },

  destroy: function(req, res) {
    var channelId = req.param('id');

    Channel.findOneById(channelId)
      .populate('owner')
      .populate('peers')
      .then(function(channel) {
        if (!channel) {
          return res.notFound('Channel not found');
        }

        return [channel, Channel.destroy({ id: channelId })];
      })
      .spread(function(channel) {
        Channel.publishDestroy(channelId, req, { previous: channel });

        req.flash('msg', 'Channel deleted');
        return res.redirect('back');
      })
      .error(function(err) {
        if (err.code === 'E_VALIDATION')
          return res.badRequest(err, 'back');
        else
          return res.serverError(err);
      });
  },

  tree: function(req, res) {
    var channelId = req.param('id');

    var getChannel = Promise.method(function(channelId) {
      return Channel.findOneById(channelId)
        .then(function(channel) {
          if (!channel) {
            return res.notFound('Channel not found');
          }
          return channel;
        });
    });

    Channel.findOneById(channelId)
      .then(function(channel) {
        if (!channel) {
          return res.notFound('Channel not found');
        }

        // TODO which broadcaster is best as root?
        var findOnePeer = Peer.findOne({ channel: channelId, broadcaster: true }).populate('connections');
        return [channel, findOnePeer];
      })
      .spread(function(channel, broadcaster) {
        if (!broadcaster) {
          return res.notFound('No broadcasters found');
        }

        return Promise.join(channel, broadcaster, broadcaster.buildTree());
      })
      .spread(function(channel, peer, treeJSON) {
        if (req.wantsJSON || req.isSocket) {
          return res.json(treeJSON, 200);
        } else {
          return res.view({
            channel: channel,
            title: channel.name,
            treeJSON: treeJSON
          });
        }
      })
      .error(function(err) {
        if (err.code === 'E_VALIDATION')
          return res.badRequest(err, 'back');
        else
          return res.serverError(err);
      });
  },

  /*
   * Subscribe to a specific channel for events on that channel
   * These updates include viewer counts, new trees, etc
   */
  subscribe: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Channel subscriptions only supported with sockets');
    }

    var channelId = req.param('id');
    var context = req.param('context') || 'message'; // default context is message

    Channel.findOneById(channelId)
      .populate('peers')
      .then(function(channel) {
        if (!channel) {
          return res.notFound('Channel not found');
        }

        Channel.subscribe(req.socket, channel, context);

        // we'll bootstrap them with some info
        Channel.message(channel, { type: 'status', live: channel.isLive(), numPeers: channel.peers.length });

        return res.ok();
      });
  }

};

module.exports = ChannelController;
