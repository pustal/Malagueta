/**
 * Malagueta's local proxy.
 *
 * Why a proxy: a webOS web app can't put another website in a frame (the
 * sites forbid it) and can't inject scripts into the TV's browser. So the app
 * browses every site through this proxy instead, which runs as the app's JS
 * service on the TV. It:
 *
 *  - serves each site from its own loopback origin (127.77.0.<n>:<port>), so
 *    each site keeps its own cookies and storage and sign-ins stay separate;
 *  - strips the headers that stop the page working from a local origin
 *    (CSP, X-Frame-Options, HSTS, ...) and translates cookies (cookies.js);
 *  - rewrites absolute URLs on the site's own domains to the local origin
 *    (rewrite.js) so navigation and API calls keep going through the proxy;
 *  - removes ad scripts, frames and links from pages (adblock.js) and refuses
 *    requests to ad hosts;
 *  - injects the page script (public/inject.js) and the ad-hiding CSS into
 *    every page.
 *
 * Origins:
 *   slot 0 -> the home screen (public/home.html) and its small API
 *   slot n -> site n (data/sites.json), custom sites from slot 100 up
 * Address = 127.77.<n/250>.<n%250+1>, port = BASE_PORT + n. When the system
 * won't bind 127.77.x.x (macOS during development), everything falls back to
 * 127.0.0.1 with the same ports; storage stays per site but cookies are then
 * shared, which is fine for testing.
 *
 * Runs on the TV's Node.js (v8 on webOS 4), so: ES2017 at most, no `?.`/`??`,
 * no global URL/fetch. Started by service.js on the TV and by dev.js on a
 * computer.
 */
'use strict';

var http = require('http');
var https = require('https');
var zlib = require('zlib');
var fs = require('fs');
var path = require('path');
var URL = require('url').URL;

var builtinSites = require('./data/sites.json');
var adblock = require('./adblock');
var rewrite = require('./rewrite');
var cookies = require('./cookies');
var ua = require('./ua');

var BASE_PORT = 47100;
/** First slot for user-added sites; built-in sites use 1..99. */
var CUSTOM_SLOT_MIN = 100;
var CUSTOM_SLOT_MAX = 999;
/** Text bodies bigger than this are passed through without rewriting. */
var MAX_REWRITE_BYTES = 12 * 1024 * 1024;
/** Request bodies smaller than this are checked for local URLs. */
var MAX_BODY_REWRITE_BYTES = 1024 * 1024;
var UPSTREAM_TIMEOUT_MS = 30000;
/** The 1x1 transparent GIF answered for blocked images. */
var BLANK_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Response headers that would break the page on the local origin, or leak the real one. */
var STRIP_RESPONSE = {
  'content-security-policy': 1,
  'content-security-policy-report-only': 1,
  'x-frame-options': 1,
  'strict-transport-security': 1,
  'public-key-pins': 1,
  'alt-svc': 1,
  'report-to': 1,
  'nel': 1,
  'expect-ct': 1,
  'cross-origin-opener-policy': 1,
  'cross-origin-embedder-policy': 1,
  'cross-origin-resource-policy': 1,
  'origin-agent-cluster': 1,
  'clear-site-data': 1,
  'connection': 1,
  'keep-alive': 1,
  'transfer-encoding': 1,
};

/** Request headers not copied upstream (hop-by-hop, or rebuilt below). */
var STRIP_REQUEST = {
  'host': 1,
  'connection': 1,
  'proxy-connection': 1,
  'keep-alive': 1,
  'upgrade': 1,
  'te': 1,
  'trailer': 1,
  'accept-encoding': 1,
  'cookie': 1,
  'referer': 1,
  'origin': 1,
  'user-agent': 1,
  'content-length': 1,
  'transfer-encoding': 1,
  'x-forwarded-for': 1,
  'x-forwarded-host': 1,
  'x-forwarded-proto': 1,
};

var agents = {
  'https:': new https.Agent({ keepAlive: true, maxSockets: 24 }),
  'http:': new http.Agent({ keepAlive: true, maxSockets: 24 }),
};

var state = {
  publicDir: path.join(__dirname, 'public'),
  version: '0.0.0',
  /** false once binding 127.77.x.x failed; then everything is on 127.0.0.1. */
  loopbackRange: true,
  /** slot -> { server, origin } */
  servers: {},
  /** id -> site, for user-added sites (sent by the home screen). */
  custom: {},
  lastSeen: Date.now(),
  idleTimer: null,
  log: function () {},
};

/* ------------------------------------------------------------------------ */
/* Sites and origins                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Fills in derived fields (host, protocol) of a site definition.
 * @param {object} def  entry from sites.json or a custom site
 */
function prepareSite(def) {
  var u = new URL(def.url);
  def.host = u.host.toLowerCase();
  def.protocol = u.protocol;
  if (!def.domains || !def.domains.length) {
    // Custom sites: the registrable part of the host, e.g. "www.example.com" -> "example.com".
    def.domains = [u.hostname.replace(/^www\d*\./i, '').toLowerCase()];
  }
  return def;
}

builtinSites.forEach(prepareSite);

function findSite(id) {
  for (var i = 0; i < builtinSites.length; i++) {
    if (builtinSites[i].id === id) return builtinSites[i];
  }
  return state.custom[id] || null;
}

function addressFor(slot) {
  if (!state.loopbackRange) return '127.0.0.1';
  return '127.77.' + Math.floor(slot / 250) + '.' + (slot % 250 + 1);
}

function originFor(slot) {
  return 'http://' + addressFor(slot) + ':' + (BASE_PORT + slot);
}

/**
 * Starts listening for `slot` (once) and calls back with its origin.
 * The first listen also decides whether 127.77.x.x is usable.
 */
function listen(slot, handler, cb) {
  var existing = state.servers[slot];
  if (existing) return cb(null, existing.origin);

  var server = http.createServer(handler);
  // No WebSocket support: refuse upgrades instead of leaving them hanging.
  server.on('upgrade', function (req, socket) { socket.destroy(); });
  server.on('clientError', function (err, socket) { socket.destroy(); });

  var tryListen = function (allowFallback) {
    var address = addressFor(slot);
    var onError = function (err) {
      server.removeListener('listening', onListening);
      if (allowFallback && state.loopbackRange && (err.code === 'EADDRNOTAVAIL' || err.code === 'EINVAL')) {
        state.log('127.77.x.x not available (' + err.code + '), using 127.0.0.1');
        state.loopbackRange = false;
        return tryListen(false);
      }
      cb(err);
    };
    var onListening = function () {
      server.removeListener('error', onError);
      state.servers[slot] = { server: server, origin: originFor(slot) };
      cb(null, state.servers[slot].origin);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(BASE_PORT + slot, address);
  };
  tryListen(true);
}

/** Starts (or reuses) the listener for a site. */
function ensureSite(site, cb) {
  listen(site.slot, function (req, res) { handleSite(site, req, res); }, cb);
}

/* ------------------------------------------------------------------------ */
/* Small HTTP helpers                                                        */
/* ------------------------------------------------------------------------ */

function touch() { state.lastSeen = Date.now(); }

function send(res, status, type, body, headers) {
  var h = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  if (headers) Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
  res.writeHead(status, h);
  res.end(body);
}

function redirect(res, location, extraHeaders) {
  var h = { Location: location, 'Cache-Control': 'no-store' };
  if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { h[k] = extraHeaders[k]; });
  res.writeHead(302, h);
  res.end();
}

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** Serves a file from public/, refusing anything that escapes the folder. */
function serveStatic(res, relPath) {
  var file = path.normalize(path.join(state.publicDir, relPath));
  if (file.indexOf(state.publicDir) !== 0) return send(res, 403, 'text/plain', 'Forbidden');
  fs.readFile(file, function (err, data) {
    if (err) return send(res, 404, 'text/plain', 'Not found');
    var cache = /\/fonts\//.test(file) ? 'max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
}

function readBody(req, limit, cb) {
  var chunks = [];
  var size = 0;
  req.on('data', function (c) {
    size += c.length;
    if (size > limit) { req.destroy(); return cb(new Error('Body too large')); }
    chunks.push(c);
  });
  req.on('end', function () { cb(null, Buffer.concat(chunks)); });
  req.on('error', cb);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Small self-contained error page with a way back home. */
function errorPage(res, status, title, detail) {
  var home = originFor(0);
  send(res, status, 'text/html; charset=utf-8',
    '<!doctype html><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>' +
    '<body style="background:#120a0b;color:#f6ece6;font:28px/1.4 sans-serif;padding:80px 120px">' +
    '<h1 style="color:#e8341c;font-size:48px">' + escapeHtml(title) + '</h1>' +
    '<p>' + escapeHtml(detail) + '</p>' +
    '<p><a href="javascript:history.back()" style="color:#f6ece6">Back</a> &nbsp; · &nbsp; ' +
    '<a href="' + home + '/" style="color:#f6ece6">Malagueta home</a></p>' +
    '<script>document.querySelector("a").focus();document.addEventListener("keydown",function(e){' +
    'if(e.keyCode===461||e.keyCode===27){history.back();}});</script>');
}

/* ------------------------------------------------------------------------ */
/* Home origin (slot 0)                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Validates the custom sites sent by the home screen and replaces the list.
 * @param {Array<{id,name,url,slot,search?}>} list
 */
function setCustomSites(list) {
  var next = {};
  (Array.isArray(list) ? list : []).forEach(function (s) {
    if (!s || typeof s.id !== 'string' || typeof s.url !== 'string') return;
    var slot = Number(s.slot);
    if (!(slot >= CUSTOM_SLOT_MIN && slot <= CUSTOM_SLOT_MAX)) return;
    if (!/^https?:\/\//i.test(s.url)) return;
    try {
      next[s.id] = prepareSite({
        id: s.id,
        name: String(s.name || s.url).slice(0, 60),
        slot: slot,
        url: s.url,
        search: typeof s.search === 'string' ? s.search : '',
        space: '+',
        cosmetic: [],
        custom: true,
      });
    } catch (e) { /* bad URL: skip */ }
  });
  state.custom = next;
}

/** Local URL of a site search for `q`, or the site's start page. */
function searchPath(site, q) {
  if (!q || !site.search) return '/';
  var enc = encodeURIComponent(q.trim());
  if (site.space && site.space !== '%20') enc = enc.replace(/%20/g, site.space);
  var p = site.search.replace('{q}', enc);
  if (/^https?:\/\//i.test(p)) {
    var u = new URL(p);
    return u.pathname + u.search;
  }
  return p.charAt(0) === '/' ? p : '/' + p;
}

function handleHome(req, res) {
  touch();
  var u = new URL(req.url, 'http://local');
  var p = u.pathname;

  if (p === '/' || p === '/index.html') return serveStatic(res, 'home.html');
  if (p === '/api/ping') return send(res, 204, 'text/plain', '');
  if (p === '/api/status') {
    return send(res, 200, 'application/json', JSON.stringify({
      version: state.version, loopbackRange: state.loopbackRange,
    }));
  }
  if (p === '/api/custom' && req.method === 'POST') {
    return readBody(req, 256 * 1024, function (err, body) {
      if (err) return send(res, 400, 'text/plain', err.message);
      try { setCustomSites(JSON.parse(body.toString('utf8'))); } catch (e) {
        return send(res, 400, 'text/plain', 'Bad JSON');
      }
      send(res, 204, 'text/plain', '');
    });
  }
  if (p === '/api/open') {
    var site = findSite(u.searchParams.get('site') || '');
    if (!site) return redirect(res, '/');
    return ensureSite(site, function (err, origin) {
      if (err) return errorPage(res, 500, 'Could not open ' + site.name, err.message);
      redirect(res, origin + searchPath(site, u.searchParams.get('q')));
    });
  }
  // Static files of the home screen (home.js, home.css, fonts, icon.svg).
  if (req.method === 'GET') return serveStatic(res, p.slice(1));
  send(res, 405, 'text/plain', 'Method not allowed');
}

/* ------------------------------------------------------------------------ */
/* Site origins                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Malagueta's per-site settings, kept as mlg_* cookies on the site's origin
 * so they persist with the site and reach the proxy on every request.
 */
function siteSettings(site, jar) {
  return {
    adblock: jar.mlg_adblock !== '0',
    uaMode: jar.mlg_ua === 'tv' || jar.mlg_ua === 'desktop' ? jar.mlg_ua : (site.ua || 'desktop'),
  };
}

function handleSite(site, req, res) {
  touch();
  var origin = state.servers[site.slot] ? state.servers[site.slot].origin : originFor(site.slot);
  var url = req.url || '/';

  if (url.indexOf('/__mlg/') === 0) return handleInternal(site, origin, req, res);

  var target = rewrite.parseTarget(site, url);
  if (!target) return errorPage(res, 400, 'Bad address', url);
  forward({ site: site, origin: origin, req: req, res: res, protocol: site.protocol, host: target.host, path: target.path, mode: 'site' });
}

/** Endpoints under /__mlg/ on every site origin. */
function handleInternal(site, origin, req, res) {
  var u = new URL(req.url, 'http://local');
  switch (u.pathname) {
    case '/__mlg/inject.js': return serveStatic(res, 'inject.js');
    case '/__mlg/icon.svg': return serveStatic(res, 'icon.svg');
    case '/__mlg/ping': return send(res, 204, 'text/plain', '');
    case '/__mlg/home': return redirect(res, originFor(0) + '/');
    // Stand-ins for blocked requests: an empty script still fires onload, so
    // ad loaders don't fall back to "please disable your ad blocker".
    case '/__mlg/blocked': return send(res, 204, 'text/plain', '');
    case '/__mlg/blocked.js': return send(res, 200, 'text/javascript', '/* blocked by Malagueta */');
    case '/__mlg/blocked.gif': return send(res, 200, 'image/gif', BLANK_GIF);
    case '/__mlg/clear': {
      // Sign out: expire every cookie the browser sent (HttpOnly ones too).
      // Cookies scoped to a /__h/<host>/ path aren't sent here; Clear-Site-Data
      // removes those on TVs that support it (webOS 5+).
      var expired = cookies.expireAll(req.headers.cookie);
      return redirect(res, '/', {
        'Set-Cookie': expired,
        'Clear-Site-Data': '"cookies", "storage", "cache"',
      });
    }
    case '/__mlg/x': {
      // Pass-through for requests the page makes to other hosts (video and
      // API CDNs). Going through here gives them the real site's Referer and
      // lets the page read the response despite CORS.
      var target;
      try { target = new URL(u.searchParams.get('u') || ''); } catch (e) { target = null; }
      if (!target || (target.protocol !== 'https:' && target.protocol !== 'http:')) {
        return send(res, 400, 'text/plain', 'Bad URL');
      }
      return forward({
        site: site, origin: origin, req: req, res: res,
        protocol: target.protocol, host: target.host, path: target.pathname + target.search, mode: 'x',
      });
    }
    default: return send(res, 404, 'text/plain', 'Not found');
  }
}

/**
 * Upstream URL for a Referer the browser sent (a local URL), or the site's
 * home page when there is none.
 */
function upstreamReferer(ctx, referer) {
  return rewrite.toUpstream(ctx, referer) || (ctx.site.protocol + '//' + ctx.site.host + '/');
}

/**
 * Proxies one request upstream and the response back.
 *
 * @param {object} o
 * @param {object} o.site, o.req, o.res
 * @param {string} o.origin    local origin of the site
 * @param {string} o.protocol  'https:' or 'http:'
 * @param {string} o.host      upstream host[:port]
 * @param {string} o.path      upstream path + query
 * @param {'site'|'x'} o.mode  'site': the site's own hosts (cookies, rewriting)
 *                             'x':    other hosts via /__mlg/x (no cookies, no rewriting)
 */
function forward(o) {
  var req = o.req;
  var res = o.res;
  var ctx = { site: o.site, origin: o.origin, host: o.host, mode: o.mode };
  var jar = cookies.parse(req.headers.cookie);
  var settings = siteSettings(o.site, jar);
  var hostname = o.host.replace(/:\d+$/, '');

  if (settings.adblock && adblock.isBlockedHost(hostname)) {
    return respondBlocked(req, res, o.path);
  }

  // Headers for upstream.
  var headers = {};
  Object.keys(req.headers).forEach(function (k) {
    if (!STRIP_REQUEST[k]) headers[k] = req.headers[k];
  });
  headers.host = o.host;
  headers['accept-encoding'] = 'gzip, deflate';
  var userAgent = settings.uaMode === 'desktop' ? ua.desktop(req.headers['user-agent']) : req.headers['user-agent'];
  if (userAgent) headers['user-agent'] = userAgent;
  ctx.userAgent = userAgent;
  headers.referer = upstreamReferer(ctx, req.headers.referer);
  if (req.headers.origin) headers.origin = o.site.protocol + '//' + o.site.host;
  if (o.mode === 'site') {
    var c = cookies.toUpstream(req.headers.cookie);
    if (c) headers.cookie = c;
  }

  var upPath = o.mode === 'site' ? rewrite.unrewriteText(ctx, o.path) : o.path;
  var method = req.method || 'GET';
  var type = String(req.headers['content-type'] || '').toLowerCase();
  var hasBody = method !== 'GET' && method !== 'HEAD';
  var rewriteBody = hasBody && o.mode === 'site' &&
    /x-www-form-urlencoded|json|text\/plain/.test(type) &&
    Number(req.headers['content-length'] || 0) <= MAX_BODY_REWRITE_BYTES;

  var start = function (body) {
    if (body) headers['content-length'] = String(body.length);
    else if (hasBody && req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
    else if (hasBody && req.headers['transfer-encoding']) headers['transfer-encoding'] = req.headers['transfer-encoding'];

    var lib = o.protocol === 'http:' ? http : https;
    var portMatch = /:(\d+)$/.exec(o.host);
    var upReq = lib.request({
      protocol: o.protocol,
      hostname: hostname,
      port: portMatch ? Number(portMatch[1]) : (o.protocol === 'http:' ? 80 : 443),
      servername: hostname,
      method: method,
      path: upPath,
      headers: headers,
      agent: agents[o.protocol],
    }, function (up) { handleResponse(ctx, settings, req, res, up); });

    upReq.setTimeout(UPSTREAM_TIMEOUT_MS, function () { upReq.abort(); });
    upReq.on('error', function (err) {
      state.log('upstream error', o.host + upPath, err.code || err.message);
      if (res.headersSent) return res.destroy();
      if (o.mode === 'x' || !/text\/html/.test(String(req.headers.accept || ''))) {
        return send(res, 502, 'text/plain', 'Upstream error: ' + (err.code || err.message));
      }
      errorPage(res, 502, 'Can\'t reach ' + hostname, 'The site didn\'t answer (' + (err.code || err.message) + '). Check the TV\'s connection and try again.');
    });

    if (body) upReq.end(body);
    else if (hasBody) req.pipe(upReq);
    else upReq.end();
  };

  if (rewriteBody) {
    readBody(req, MAX_BODY_REWRITE_BYTES, function (err, buf) {
      if (err) return send(res, 413, 'text/plain', err.message);
      start(Buffer.from(rewrite.unrewriteText(ctx, buf.toString('utf8')), 'utf8'));
    });
  } else {
    start(null);
  }
}

/** Answers a request to an ad host with something harmless of the right kind. */
function respondBlocked(req, res, upPath) {
  var accept = String(req.headers.accept || '');
  if (/\.js(\?|$)/.test(upPath) || /javascript/.test(accept)) return send(res, 200, 'text/javascript', '/* blocked */');
  if (/image\//.test(accept)) return send(res, 200, 'image/gif', BLANK_GIF);
  if (/text\/html/.test(accept)) return send(res, 200, 'text/html', '<!doctype html><title>Blocked</title>');
  send(res, 204, 'text/plain', '');
}

function isHtmlType(ct) { return /text\/html|application\/xhtml\+xml/.test(ct); }
function isTextType(ct) {
  return /javascript|ecmascript|text\/css|json|mpegurl|text\/plain|text\/xml|application\/xml/.test(ct);
}

/** Translates upstream response headers for the local origin. */
function responseHeaders(ctx, up) {
  var out = {};
  Object.keys(up.headers).forEach(function (k) {
    if (STRIP_RESPONSE[k]) return;
    var v = up.headers[k];
    if (k === 'set-cookie') {
      if (ctx.mode === 'site') out[k] = [].concat(v).map(function (c) { return cookies.toBrowser(c, ctx); });
      return;
    }
    if (k === 'location') {
      var base = ctx.site.protocol + '//' + ctx.host + '/';
      var abs;
      try { abs = new URL(v, base).href; } catch (e) { abs = v; }
      out[k] = ctx.mode === 'x' ? ctx.origin + '/__mlg/x?u=' + encodeURIComponent(abs) : rewrite.toLocal(ctx, abs);
      return;
    }
    if (k === 'access-control-allow-origin') {
      out[k] = v === '*' ? '*' : ctx.origin;
      return;
    }
    out[k] = v;
  });
  if (ctx.mode === 'x') {
    out['access-control-allow-origin'] = ctx.origin;
    out['access-control-allow-credentials'] = 'true';
  }
  return out;
}

function handleResponse(ctx, settings, req, res, up) {
  var headers = responseHeaders(ctx, up);
  var ct = String(up.headers['content-type'] || '').toLowerCase();
  var kind = null;
  if (ctx.mode === 'site') {
    if (isHtmlType(ct)) kind = 'html';
    else if (isTextType(ct)) kind = 'text';
  }
  var encoding = String(up.headers['content-encoding'] || '').toLowerCase();
  var length = Number(up.headers['content-length'] || 0);
  var noBody = req.method === 'HEAD' || up.statusCode === 204 || up.statusCode === 304;
  var decodable = !encoding || encoding === 'identity' || encoding === 'gzip' || encoding === 'deflate';

  if (!kind || noBody || !decodable || length > MAX_REWRITE_BYTES) {
    res.writeHead(up.statusCode, headers);
    up.pipe(res);
    return;
  }

  var chunks = [];
  var size = 0;
  up.on('data', function (c) { size += c.length; chunks.push(c); });
  up.on('error', function () { res.destroy(); });
  up.on('end', function () {
    decode(Buffer.concat(chunks), encoding, function (err, buf) {
      if (err || buf.length > MAX_REWRITE_BYTES) {
        // Couldn't decode: send it as it came.
        res.writeHead(up.statusCode, headers);
        return res.end(Buffer.concat(chunks));
      }
      var text = buf.toString('utf8');
      text = kind === 'html' ? processHtml(ctx, settings, text) : rewrite.rewriteText(ctx, text);
      var out = Buffer.from(text, 'utf8');
      delete headers['content-encoding'];
      delete headers['content-length'];
      delete headers['etag']; // the body changed
      if (kind === 'html' && !/charset=/.test(ct)) headers['content-type'] = 'text/html; charset=utf-8';
      headers['content-length'] = String(out.length);
      res.writeHead(up.statusCode, headers);
      res.end(out);
    });
  });
}

function decode(buf, encoding, cb) {
  if (encoding === 'gzip') return zlib.gunzip(buf, cb);
  if (encoding === 'deflate') {
    return zlib.inflate(buf, function (err, out) {
      if (!err) return cb(null, out);
      zlib.inflateRaw(buf, cb); // some servers send raw deflate
    });
  }
  cb(null, buf);
}

/**
 * Prepares a page for the local origin: ad elements out, URLs rewritten,
 * SRI hashes and CSP meta tags removed (the rewritten files no longer match),
 * and Malagueta's settings, CSS and script injected at the top of <head> so
 * they run before any of the site's scripts.
 */
function processHtml(ctx, settings, html) {
  var site = ctx.site;
  var isOwn = function (h) { return rewrite.isOwnHost(site, h); };

  if (settings.adblock) html = adblock.cleanHtml(html, isOwn);
  html = rewrite.rewriteText(ctx, html);
  html = rewrite.fixRootRelative(ctx, html);
  html = html.replace(/\sintegrity\s*=\s*("[^"]*"|'[^']*')/gi, '');
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(content-security-policy|x-frame-options)[^>]*>/gi, '');

  var config = {
    version: state.version,
    siteId: site.id,
    name: site.name,
    host: site.host,
    pageHost: ctx.host,
    protocol: site.protocol,
    domains: site.domains,
    search: site.search || '',
    space: site.space || '+',
    home: originFor(0) + '/',
    adblock: settings.adblock,
    uaMode: settings.uaMode,
    // The page script makes navigator.userAgent match what the site was sent.
    ua: settings.uaMode === 'desktop' ? ctx.userAgent : null,
  };
  // "</" can't appear inside the inline script, or it would end the tag.
  var json = JSON.stringify(config).replace(/</g, '\\u003c');
  var head =
    '<meta name="referrer" content="same-origin">' +
    (settings.adblock ? '<style id="mlg-cosmetic">' + adblock.cosmeticCss(site) + '</style>' : '') +
    '<script>window.__MLG__=' + json + ';</script>' +
    '<script src="/__mlg/inject.js"></script>';

  var headTag = /<head\b[^>]*>/i.exec(html);
  if (headTag) {
    var at = headTag.index + headTag[0].length;
    return html.slice(0, at) + head + html.slice(at);
  }
  var htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag) {
    var at2 = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at2) + '<head>' + head + '</head>' + html.slice(at2);
  }
  // A fragment (some sites load partial HTML with XHR): leave it as is.
  return html;
}

/* ------------------------------------------------------------------------ */
/* Lifecycle                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Starts the home origin (idempotent).
 *
 * @param {object}   opts
 * @param {string}   opts.version       app version, shown in the menu
 * @param {number}  [opts.idleMs]       stop after this long without requests (0 = never)
 * @param {function}[opts.onIdle]       called after stopping for idleness
 * @param {function}[opts.log]          console.log-like logger
 * @param {string}  [opts.publicDir]    folder with home.html, inject.js, ...
 * @param {function} cb                 (err, homeOrigin)
 */
function start(opts, cb) {
  opts = opts || {};
  if (opts.version) state.version = opts.version;
  if (opts.log) state.log = opts.log;
  if (opts.publicDir) state.publicDir = opts.publicDir;
  touch();

  if (opts.idleMs && !state.idleTimer) {
    state.idleTimer = setInterval(function () {
      if (Date.now() - state.lastSeen < opts.idleMs) return;
      state.log('idle, stopping');
      stop();
      if (opts.onIdle) opts.onIdle();
    }, Math.min(opts.idleMs, 60000));
  }
  listen(0, handleHome, cb);
}

/** Closes every listener. */
function stop() {
  if (state.idleTimer) { clearInterval(state.idleTimer); state.idleTimer = null; }
  Object.keys(state.servers).forEach(function (slot) {
    try { state.servers[slot].server.close(); } catch (e) { /* already closed */ }
  });
  state.servers = {};
}

function isRunning() { return !!state.servers[0]; }

module.exports = {
  start: start,
  stop: stop,
  isRunning: isRunning,
  BASE_PORT: BASE_PORT,
  // exported for tests
  _internal: { processHtml: processHtml, searchPath: searchPath, prepareSite: prepareSite, state: state, setCustomSites: setCustomSites },
};
