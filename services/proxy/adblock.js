/**
 * Ad blocking on the proxy side.
 *
 * Works on the raw HTML before the browser sees it, so ad scripts that are
 * written straight into the page never run. The injected page script
 * (src/inject/adblock.js) covers what pages add later from JavaScript.
 *
 * The data (ad hosts, URL patterns, inline-script markers, element selectors)
 * is in data/blocklist.json, shared with the page script; per-site selectors
 * are in data/sites.json.
 *
 * Runs on the TV's Node.js (v8 on webOS 4), so: ES2017 at most, no `?.`/`??`.
 */
'use strict';

var blocklist = require('./data/blocklist.json');

/** Lower-cased ad hosts; a host matches itself and all its subdomains. */
var HOSTS = blocklist.hosts.map(function (h) { return h.toLowerCase(); });

/** Inline scripts at most this long are checked for ad markers; bigger ones are app code. */
var INLINE_SCRIPT_LIMIT = 20000;

/** /(popMagic|popunder|…)/i built from blocklist.inlineMarkers. */
var INLINE_RE = new RegExp(blocklist.inlineMarkers.map(escapeRe).join('|'), 'i');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

/**
 * True when `host` is an ad/tracking host or a subdomain of one.
 * @param {string} host  bare host name, no port
 */
function isBlockedHost(host) {
  if (!host) return false;
  host = host.toLowerCase();
  for (var i = 0; i < HOSTS.length; i++) {
    var h = HOSTS[i];
    if (host === h || host.slice(-h.length - 1) === '.' + h) return true;
  }
  return false;
}

/**
 * Host part of an absolute or protocol-relative URL, or '' for relative URLs.
 * @param {string} url
 */
function hostOf(url) {
  var m = /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\/([^\/?#:\s]+)/i.exec(url || '');
  return m ? m[1].toLowerCase() : '';
}

/**
 * True when `url` should not load: its host is an ad host, or it is on a
 * third-party host (not one of the site's own domains) and its path looks
 * like an ad (blocklist.paths). Relative URLs are always the site's own.
 *
 * @param {string} url
 * @param {function(string):boolean} isOwnHost  the site's own-domain test
 */
function isBlockedUrl(url, isOwnHost) {
  var host = hostOf(url);
  if (!host) return false;
  if (isBlockedHost(host)) return true;
  if (isOwnHost(host)) return false;
  var lower = url.toLowerCase();
  for (var i = 0; i < blocklist.paths.length; i++) {
    if (lower.indexOf(blocklist.paths[i]) !== -1) return true;
  }
  return false;
}

/** Value of attribute `name` in a tag's attribute string, or ''. */
function attr(attrs, name) {
  var re = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  var m = re.exec(attrs);
  return m ? (m[1] || m[2] || m[3] || '') : '';
}

/**
 * Removes ad elements from an HTML document:
 *  - <script src> from ad hosts, and small inline scripts with ad markers
 *  - <iframe>, <img>, <link> and <a> pointing at ad hosts
 *
 * Regex-based on purpose: a real parser is too heavy for the TV's Node, and
 * the tags we look for are simple.
 *
 * @param {string} html
 * @param {function(string):boolean} isOwnHost
 * @returns {string}
 */
function cleanHtml(html, isOwnHost) {
  var blocked = function (url) { return isBlockedUrl(url, isOwnHost); };

  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, function (m, attrs, body) {
    var src = attr(attrs, 'src');
    if (src) return blocked(src) ? '<!--mlg:script-->' : m;
    var type = attr(attrs, 'type').toLowerCase();
    if (type && type.indexOf('javascript') === -1 && type !== 'module') return m; // JSON, templates
    if (body.length <= INLINE_SCRIPT_LIMIT && INLINE_RE.test(body)) return '<!--mlg:inline-->';
    return m;
  });

  html = html.replace(/<iframe\b([^>]*)>[\s\S]*?<\/iframe\s*>/gi, function (m, attrs) {
    var src = attr(attrs, 'src') || attr(attrs, 'data-src');
    return src && blocked(src) ? '<!--mlg:iframe-->' : m;
  });

  html = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, function (m, attrs) {
    var href = attr(attrs, 'href');
    return href && blocked(href) ? '<!--mlg:a-->' : m;
  });

  html = html.replace(/<(?:img|link|source)\b([^>]*)>/gi, function (m, attrs) {
    var url = attr(attrs, 'src') || attr(attrs, 'href') || attr(attrs, 'data-src');
    return url && blocked(url) ? '' : m;
  });

  return html;
}

/**
 * CSS that hides known ad slots: the shared selectors plus the site's own.
 * Each selector gets its own rule so one the browser doesn't understand
 * (old Chromium) can't invalidate the rest.
 *
 * @param {{cosmetic?: string[]}} site
 */
function cosmeticCss(site) {
  var list = blocklist.selectors.concat(site.cosmetic || []);
  return list.map(function (sel) {
    return sel + '{display:none!important}';
  }).join('\n');
}

module.exports = {
  isBlockedHost: isBlockedHost,
  isBlockedUrl: isBlockedUrl,
  hostOf: hostOf,
  cleanHtml: cleanHtml,
  cosmeticCss: cosmeticCss,
  escapeRe: escapeRe,
};
