/**
 * AuthController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

var _ = require('lodash');
var Promise = require('bluebird');
var bcrypt = Promise.promisifyAll(require('bcrypt-nodejs'));

var AuthController = {
  login: function(req, res) {
    var email = req.param('email');
    var challenge = req.param('password');

    User.findOneByEmail(email)
      .then(function(user) {
        if (!user) {
          sails.log.warn('AuthController#login: Received invalid login, no user', email);
          return res.badRequest('Invalid email or password', 'back');
        }

        return bcrypt.compareAsync(challenge, user.password)
          .then(function(match) {
            if (match) {
              // passwords match, set session
              req.session.user = { id: user.id, name: user.name, email: user.email };
              req.session.save();

              return res.redirect('back');
            }

            // handle invalid password
            // if they're already logged in (?!), log them out
            if (req.session.user) {
              req.session.user = null;
              delete req.session.user;

              req.session.save();
            }

            sails.log.warn('AuthController#login: Received invalid password attempt for', email);
            return res.badRequest('Invalid email or password', 'back');
          })
          .error(function(err) {
            return res.serverError(err);
          });
      })
      .error(function(err) {
        if (err.code === 'E_VALIDATION')
          return res.badRequest(err, 'back');
        else
          return res.serverError(err);
      });
  },

  logout: function(req, res) {
    if (req.session.user) {
      req.session.user = null;
      delete req.session.user;
    }

    res.redirect('back');
  }
};

module.exports = AuthController;
