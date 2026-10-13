#!/usr/bin/env node
/**
 * Runs the Malagueta proxy on a computer, without webOS, for development.
 *
 *   npm run dev        (builds, then runs this from dist/service)
 *
 * Then open the printed address in Chrome. Keys: arrows, Enter, Escape = Back,
 * F9 = Malagueta menu (the red button on the remote).
 *
 * On macOS only 127.0.0.1 is a loopback address by default, so every site
 * shares it (with its own port). To get one address per site like on the TV:
 *   for i in $(seq 1 12); do sudo ifconfig lo0 alias 127.77.0.$i up; done
 */
'use strict';

var path = require('path');
var proxy = require('./proxy');
var pkg = require('./package.json');

proxy.start({
  version: pkg.version + '-dev',
  log: function () { console.log.apply(console, ['[malagueta]'].concat(Array.prototype.slice.call(arguments))); },
  publicDir: path.join(__dirname, 'public'),
}, function (err, origin) {
  if (err) {
    console.error('Could not start:', err.message);
    process.exit(1);
  }
  console.log('Malagueta is running at ' + origin + '/');
});
