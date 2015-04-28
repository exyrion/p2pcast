// requires
var assert = require('chai').assert;
var should = require('chai').should();
var expect = require('chai').expect;
var Sails = require('sails');
var barrels = require('barrels');
var Promise = require('bluebird');
var fixtures;

// globals
global.assert = assert;
global.expect = expect;
global.fixtures = fixtures;
global.Promise = Promise;

// global before hook
before(function beforeAll(done) {
  Sails.lift({
    log: {
      level: 'error'
    },
    port: 9999,
    adapters: {
      default: 'test'
    }
  }, function(err, sails) {
    if (err) return done(err);

    // load fixtures
    barrels.populate(function(err) {
      done(err, sails);
    });

    // save originals in fixtures
    fixtures = barrels.objects;

    // promisfy things
    _.forOwn(sails.models, function(model) {
      Promise.promisifyAll(model);
    });
  });
});

// global after hook
after(function afterAll(done) {
  sails.lower(done);
});
