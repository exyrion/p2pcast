/**
 * Channel.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */

var _ = require('lodash');

var Channel = {
  attributes: {
    name: {
      type: 'string',
      required: true,
      unique: true,
      minLength: 4,
      maxLength: 80
    },

    description: {
      type: 'text',
      maxLength: 2000
    },

    owner: {
      model: 'user',
      required: true
    },

    peers: {
      collection: 'peer',
      via: 'id',
      dominant: true
    },

    isLive: function isLive() {
      return _.some(this.peers, 'broadcaster');
    }
  }
};

module.exports = Channel;
