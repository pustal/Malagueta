/**
 * Cookie translation between the real site (https, real domain) and its
 * local proxy origin (plain http on a loopback address).
 *
 * The browser keeps the cookies, one jar per site because every site has its
 * own loopback address, so sign-ins survive restarts just like in a browser.
 * To be accepted on the local origin a Set-Cookie must lose:
 *   - Domain   (the real domain doesn't match 127.77.x.x)
 *   - Secure   (the local origin is http)
 *   - SameSite=None (not allowed without Secure; becomes Lax)
 * and "__Secure-"/"__Host-" names, which browsers only accept with Secure,
 * are renamed to "MLG_Secure-"/"MLG_Host-" and renamed back on the way up.
 *
 * Cookies named "mlg_*" are Malagueta's own per-site settings (ad blocking,
 * browser mode). They are read by the proxy and never sent upstream.
 *
 * Runs on the TV's Node.js (v8 on webOS 4), so: ES2017 at most, no `?.`/`??`.
 */
'use strict';

var HOST_PREFIX = require('./rewrite').HOST_PREFIX;

var RENAMES = [
  ['__Secure-', 'MLG_Secure-'],
  ['__Host-', 'MLG_Host-'],
];

function renameDown(name) {
  for (var i = 0; i < RENAMES.length; i++) {
    if (name.indexOf(RENAMES[i][0]) === 0) return RENAMES[i][1] + name.slice(RENAMES[i][0].length);
  }
  return name;
}

function renameUp(name) {
  for (var i = 0; i < RENAMES.length; i++) {
    if (name.indexOf(RENAMES[i][1]) === 0) return RENAMES[i][0] + name.slice(RENAMES[i][1].length);
  }
  return name;
}

/**
 * Rewrites one upstream Set-Cookie header value for the local origin.
 *
 * Cookies from a secondary host (served under /__h/<host>) that have no
 * Domain attribute belong to that host only, so their Path is moved under
 * the host's prefix. Cookies with a Domain are meant for the whole site and
 * keep their path.
 *
 * @param {string} value   raw Set-Cookie value
 * @param {object} ctx     { site, host } host = upstream host of this response
 */
function toBrowser(value, ctx) {
  var parts = value.split(';');
  var nameValue = parts.shift();
  var eq = nameValue.indexOf('=');
  var name = (eq === -1 ? '' : nameValue.slice(0, eq)).trim();
  var val = eq === -1 ? nameValue : nameValue.slice(eq + 1);

  var hasDomain = false;
  var path = null;
  var out = [];
  parts.forEach(function (p) {
    var a = p.trim();
    var key = a.split('=')[0].trim().toLowerCase();
    if (key === 'domain') { hasDomain = true; return; }
    if (key === 'secure' || key === 'partitioned' || key === 'priority') return;
    if (key === 'samesite') { out.push(/none/i.test(a) ? 'SameSite=Lax' : a); return; }
    if (key === 'path') { path = a.slice(a.indexOf('=') + 1).trim() || '/'; return; }
    if (a) out.push(a);
  });

  if (path === null) path = '/';
  if (ctx.host !== ctx.site.host && !hasDomain) {
    path = HOST_PREFIX + ctx.host + (path.charAt(0) === '/' ? path : '/' + path);
  }
  out.unshift('Path=' + path);
  return renameDown(name) + '=' + val + '; ' + out.join('; ');
}

/**
 * Parses a Cookie request header into { name: value } (first one wins).
 * @param {string|undefined} header
 */
function parse(header) {
  var jar = {};
  (header || '').split(';').forEach(function (pair) {
    var eq = pair.indexOf('=');
    if (eq === -1) return;
    var name = pair.slice(0, eq).trim();
    if (name && !(name in jar)) jar[name] = pair.slice(eq + 1).trim();
  });
  return jar;
}

/**
 * The Cookie header to send upstream: Malagueta's own mlg_* cookies dropped,
 * renamed secure-prefix cookies restored. Returns '' when nothing is left.
 * @param {string|undefined} header
 */
function toUpstream(header) {
  if (!header) return '';
  return header.split(';').map(function (s) { return s.trim(); }).filter(function (pair) {
    return pair && pair.indexOf('mlg_') !== 0;
  }).map(function (pair) {
    var eq = pair.indexOf('=');
    return eq === -1 ? pair : renameUp(pair.slice(0, eq)) + pair.slice(eq);
  }).join('; ');
}

/**
 * Set-Cookie values that delete every cookie named in `header`, on the root
 * path and on the request's own path. Used by "Sign out & clear site data".
 * (Clear-Site-Data does the same on newer TVs; this covers the older ones.)
 */
function expireAll(header, extraPaths) {
  var names = Object.keys(parse(header)).filter(function (n) { return n.indexOf('mlg_') !== 0; });
  var paths = ['/'].concat(extraPaths || []);
  var out = [];
  names.forEach(function (n) {
    paths.forEach(function (p) {
      out.push(n + '=; Path=' + p + '; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0');
    });
  });
  return out;
}

module.exports = {
  toBrowser: toBrowser,
  toUpstream: toUpstream,
  parse: parse,
  expireAll: expireAll,
};
