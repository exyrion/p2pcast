/**
 * UserController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

var _ = require('lodash');
var Promise = require('bluebird');

var UserController = {
  index: function(req, res) {
    if (!req.session.user) {
      return res.redirect('back');
    }

    var ownerId = req.session.user.id;

    Channel.find({ owner: ownerId })
      .then(function(channels) {
        if (!_.isArray(channels)) {
          channels = [];
        }

        if (req.wantsJSON || req.isSocket) {
          return res.json({
            channels: channels
          });
        } else {
          return res.view({
            channels: channels,
            title: 'Profile Page'
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
    var name = req.param('name');
    var email = req.param('email');
    var password = req.param('password');

    // TODO: much unsecure
    User.create({ name: name, email: email, password: password })
      .then(function(user) {
        if (!user) {
          sails.log.error('User#create: User already exists', email);
          return res.badRequest('User already exists', 'back');
        }

        req.session.user = { id: user.id, name: user.name, email: user.email };
        req.session.save();

        return res.redirect('back');
      })
      .error(function(err) {
        // TODO probably shouldn't redirect back
        // but it is an error to display to user... wtf do we do
        sails.log.error('UserController#create: Internal server error', err);
        req.flash('registerMsg', 'Internal server error');
        res.redirect('back');
      });
  },

  update: function(req, res) {
    var id = req.session.user.id;
    var name = req.param('name');
    var email = req.param('email');
    var password = req.param('password');

    var update = { name: name, email: email, password: password };
    update = _.omit(update, _.isUndefined); // no undefined!

    // TODO same email address *will* be a validation error
    User.update({ id: id }, update)
      .then(function(users) {
        if (!users || users.length === 0) {
          return res.notFound('User not found');
        }

        var user = users[0];

        req.session.user.name = user.name;
        req.session.user.email = user.email;
        req.session.save();

        req.flash('msg', 'Updated successfully');

        return res.redirect('/user');
      })
      .error(function(err) {
        if (err.code === 'E_VALIDATION')
          return res.badRequest(err, 'back');
        else
          return res.serverError(err);
      });
  }

};

module.exports = UserController;
