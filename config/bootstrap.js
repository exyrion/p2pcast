/**
 * Bootstrap
 *
 * An asynchronous bootstrap function that runs before your Sails app gets lifted.
 * This gives you an opportunity to set up your data model, run jobs, or perform some special logic.
 *
 * For more information on bootstrapping your app, check out:
 * http://sailsjs.org/#documentation
 */

var _ = require('lodash');
var Promise = require('bluebird');

module.exports.bootstrap = function (cb) {
  // let's promisify everything
  _.forOwn(sails.models, function(model) {
    Promise.promisifyAll(model);
  });

  // let's be evil and replace waterline's toPromise with bluebird
  require('sails/node_modules/waterline/lib/waterline/query/deferred').prototype.toPromise = function() {
    var deferred = Promise.defer();
    this.exec(deferred.callback);
    return deferred.promise;
  };

  require('sails/node_modules/waterline/lib/waterline/query/deferred').prototype.fail = function(cb) {
    return this.toPromise().error(cb);
  };

  // https://github.com/petkaantonov/bluebird/blob/master/API.md#filterfunction-filterer---promise
  Promise.prototype.settledWithFulfill = function settledWithFulfill() {
    return this.settle()
      .filter(function(inspection){
        return inspection.isFulfilled();
      })
      .map(function(inspection){
        return inspection.value();
      });
  };

  // https://gist.github.com/victorquinn/8030190
  Promise.promiseWhile = function promiseWhile(condition, action) {
    return new Promise(function(resolve, reject) {
      var loop = function() {
        if (!condition()) return resolve();
        return Promise.cast(action())
          .then(loop)
          .catch(reject);
      };

      process.nextTick(loop);
    });
  };

  // It's very important to trigger this callack method when you are finished
  // with the bootstrap!  (otherwise your server will never lift, since it's waiting on the bootstrap)
  cb();
};
