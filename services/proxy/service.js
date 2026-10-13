/**
 * webOS JS service entry point for Malagueta.
 *
 * Exposes on the luna bus:
 *   luna://org.malagueta.app.service/start
 *     Starts the local proxy (proxy.js) if needed.
 *     Response: { returnValue: true, url: "http://127.77.0.1:47100/" }
 *   luna://org.malagueta.app.service/stop
 *     Stops it. Response: { returnValue: true }
 *
 * The launcher page (src/launcher) calls `start` and then moves the app to
 * the returned home URL.
 *
 * webOS stops a JS service a few seconds after its last luna call, which
 * would take the proxy down with it, so `start` holds a "keepAlive" activity.
 * The proxy releases it after IDLE_MS without any request from the app
 * (pages ping every 20 s while open), letting the service exit.
 *
 * Runs on the TV's Node.js (v8 on webOS 4), so: ES2017 at most.
 */
'use strict';

var path = require('path');
var Service = require('webos-service');
var pkg = require('./package.json');
var proxy = require('./proxy');

/**
 * How long the proxy keeps running with no requests. Long enough to survive
 * the app sitting in the background for a while; the service uses no CPU
 * while idle.
 */
var IDLE_MS = 30 * 60 * 1000;

var service = new Service(pkg.name);
var keepAlive = null;

function log() {
  var args = Array.prototype.slice.call(arguments);
  console.log('[malagueta] ' + args.join(' '));
}

function holdKeepAlive() {
  if (keepAlive) return;
  service.activityManager.create('keepAlive', function (activity) {
    keepAlive = activity;
  });
}

function releaseKeepAlive() {
  if (!keepAlive) return;
  var a = keepAlive;
  keepAlive = null;
  service.activityManager.complete(a, function () {});
}

service.register('start', function (message) {
  holdKeepAlive();
  proxy.start({
    version: pkg.version,
    idleMs: IDLE_MS,
    onIdle: releaseKeepAlive,
    log: log,
    publicDir: path.join(__dirname, 'public'),
  }, function (err, origin) {
    if (err) {
      log('start failed', err.code || err.message);
      message.respond({ returnValue: false, errorCode: err.code || 'error', errorText: err.message });
      return;
    }
    message.respond({ returnValue: true, url: origin + '/' });
  });
});

service.register('stop', function (message) {
  proxy.stop();
  releaseKeepAlive();
  message.respond({ returnValue: true });
});
