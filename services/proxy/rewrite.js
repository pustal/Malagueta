/**
 * URL rewriting between the real site and its local proxy address.
 *
 * Every site is served from its own local origin, e.g.
 *   https://www.xvideos.com/foo      ->  http://127.77.0.7:47106/foo
 *   https://img.xvideos.com/bar.jpg  ->  http://127.77.0.7:47106/__h/img.xvideos.com/bar.jpg
 *
 * The site's main host maps to the origin root; any other host is reached
 * through the "/__h/<host>" prefix so it shares the site's cookies.
 *
 * Text responses (HTML, JS, CSS, JSON, HLS playlists) have absolute URLs on the
 * site's own domains rewritten to the local form, so the browser keeps talking
 * to the proxy. Request URLs, bodies and headers get the reverse treatment
 * before they go upstream. URLs on other hosts (video CDNs, image CDNs) are
 * left alone and load directly from the TV.
 *
 * Runs on the TV's Node.js (v8 on webOS 4), so: ES2017 at most, no `?.`/`??`.
 */
'use strict';

var URL = require('url').URL;
var escapeRe = require('./adblock').escapeRe;

/** Path prefix for hosts other than the site's main one. */
var HOST_PREFIX = '/__h/';

/** Valid host[:port] in a /__h/ path. */
var HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

/**
 * Precompiles the matchers for one site. The result is cached on the site.
 *
 * @param {{host:string, domains:string[]}} site
 */
function compile(site) {
  if (site._rw) return site._rw;
  var domains = site.domains.map(function (d) { return d.toLowerCase(); });
  // Optional :port so custom sites on a non-standard port map correctly.
  var hostAlt = '(?:[a-z0-9-]+\\.)*(?:' + domains.map(escapeRe).join('|') + ')(?::\\d{1,5})?';
  site._rw = {
    domains: domains,
    // scheme? + "//" or JSON-escaped "\/\/" + one of the site's hosts, not
    // followed by more host characters (so "xvideos.com.evil" doesn't match).
    textRe: new RegExp('((?:https?|wss?):)?(\\\\?\\/\\\\?\\/)(' + hostAlt + ')(?![a-z0-9.:-])', 'gi'),
  };
  return site._rw;
}

/** True when `host` is one of the site's own domains (or a subdomain). */
function isOwnHost(site, host) {
  if (!host) return false;
  host = host.toLowerCase().replace(/:\d+$/, '');
  var domains = compile(site).domains;
  for (var i = 0; i < domains.length; i++) {
    var d = domains[i];
    if (host === d || host.slice(-d.length - 1) === '.' + d) return true;
  }
  return false;
}

/**
 * Splits a request path into the upstream host and path.
 *   "/foo?x"                -> { host: site.host, path: "/foo?x" }
 *   "/__h/cdn.x.com/a/b"    -> { host: "cdn.x.com", path: "/a/b" }
 * Returns null for a malformed /__h/ path.
 */
function parseTarget(site, reqPath) {
  if (reqPath.indexOf(HOST_PREFIX) !== 0) return { host: site.host, path: reqPath || '/' };
  var rest = reqPath.slice(HOST_PREFIX.length);
  var cut = rest.search(/[\/?#]/);
  var host = cut === -1 ? rest : rest.slice(0, cut);
  var path = cut === -1 ? '/' : rest.slice(cut);
  if (path.charAt(0) !== '/') path = '/' + path;
  if (!HOST_RE.test(host)) return null;
  return { host: host.toLowerCase(), path: path };
}

/**
 * Local URL for an absolute upstream URL, for navigation and same-site
 * requests: main host -> origin root, other hosts -> /__h/<host>.
 *
 * @param {object} ctx  { site, origin }
 * @param {string} absUrl
 */
function toLocal(ctx, absUrl) {
  var u;
  try { u = new URL(absUrl); } catch (e) { return absUrl; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return absUrl;
  var rest = u.pathname + u.search + u.hash;
  if (u.host === ctx.site.host) return ctx.origin + rest;
  return ctx.origin + HOST_PREFIX + u.host + rest;
}

/**
 * Upstream URL for a local one (the reverse of toLocal), or null when the URL
 * isn't on this proxy origin.
 */
function toUpstream(ctx, localUrl) {
  if (!localUrl || localUrl.indexOf(ctx.origin) !== 0) return null;
  var t = parseTarget(ctx.site, localUrl.slice(ctx.origin.length) || '/');
  return t ? ctx.site.protocol + '//' + t.host + t.path : null;
}

/**
 * Rewrites absolute URLs on the site's own domains inside a text body.
 * Handles https://, protocol-relative // and JSON-escaped https:\/\/ forms.
 *
 * @param {object} ctx  { site, origin }
 * @param {string} text
 */
function rewriteText(ctx, text) {
  var rw = compile(ctx.site);
  var origin = ctx.origin;
  return text.replace(rw.textRe, function (m, scheme, slashes, host) {
    var base = host.toLowerCase() === ctx.site.host ? origin : origin + HOST_PREFIX + host;
    if (scheme && /^ws/i.test(scheme)) base = base.replace(/^http/, 'ws');
    if (slashes.length > 2) base = base.replace(/\//g, '\\/'); // keep JSON escaping
    return base;
  });
}

/**
 * For pages served from another host (/__h/<host>/...), root-relative links
 * like href="/login" would resolve to the main host. Point them at the right
 * host prefix instead.
 */
function fixRootRelative(ctx, html) {
  if (ctx.host === ctx.site.host) return html;
  var prefix = HOST_PREFIX + ctx.host + '/';
  return html.replace(/(\s(?:href|src|action|poster|data-src)\s*=\s*["']?)\/(?![\/_])/gi, '$1' + prefix);
}

/**
 * Reverse rewrite for data going upstream (query strings, form and JSON
 * bodies): local origin URLs become the real site URLs again, in plain and
 * URL-encoded form.
 */
function unrewriteText(ctx, text) {
  if (!text) return text;
  var site = ctx.site;
  var origin = ctx.origin;
  var real = site.protocol + '//';
  var encOrigin = encodeURIComponent(origin);
  var encReal = encodeURIComponent(real);
  var hostEsc = escapeRe(HOST_PREFIX);
  text = text.replace(new RegExp(escapeRe(origin) + hostEsc, 'g'), real);
  text = text.split(origin).join(real + site.host);
  text = text.replace(new RegExp(escapeRe(encOrigin) + escapeRe(encodeURIComponent(HOST_PREFIX)), 'gi'), encReal);
  text = text.split(encOrigin).join(encReal + site.host);
  return text;
}

module.exports = {
  HOST_PREFIX: HOST_PREFIX,
  compile: compile,
  isOwnHost: isOwnHost,
  parseTarget: parseTarget,
  toLocal: toLocal,
  toUpstream: toUpstream,
  rewriteText: rewriteText,
  fixRootRelative: fixRootRelative,
  unrewriteText: unrewriteText,
};
