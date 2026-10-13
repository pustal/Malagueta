/**
 * Tests for the proxy (services/proxy), run against the built copy in
 * dist/service so the data files are in place:
 *
 *   npm run build:dev && npm test
 *
 * The end-to-end test runs a fake "site" on a local port and browses it
 * through the proxy as a custom site, checking the parts that make real
 * sites work: URL rewriting, cookie translation, ad removal, injection.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rewrite = require('../dist/service/rewrite.js');
const cookies = require('../dist/service/cookies.js');
const adblock = require('../dist/service/adblock.js');
const proxy = require('../dist/service/proxy.js');

const site = proxy._internal.prepareSite({
  id: 't', name: 'Test', slot: 1, url: 'https://www.example.com/', domains: ['example.com'], search: '/s?q={q}', space: '+',
});
const ctx = { site, origin: 'http://127.77.0.2:47101', host: 'www.example.com', mode: 'site' };

test('rewriteText maps the site\'s own URLs, leaves others', () => {
  const out = rewrite.rewriteText(ctx, [
    '<a href="https://www.example.com/a?b=1">',
    '<img src="//img.example.com/x.jpg">',
    '{"u":"https:\\/\\/api.example.com\\/v1"}',
    '<script src="https://cdn.other.net/x.js">',
    'https://www.example.com.evil.net/',
  ].join('\n'));
  assert.match(out, /href="http:\/\/127\.77\.0\.2:47101\/a\?b=1"/);
  assert.match(out, /src="http:\/\/127\.77\.0\.2:47101\/__h\/img\.example\.com\/x\.jpg"/);
  assert.match(out, /"http:\\\/\\\/127\.77\.0\.2:47101\\\/__h\\\/api\.example\.com\\\/v1"/);
  assert.match(out, /https:\/\/cdn\.other\.net\/x\.js/);
  assert.match(out, /https:\/\/www\.example\.com\.evil\.net\//);
});

test('unrewriteText restores real URLs, plain and encoded', () => {
  const back = rewrite.unrewriteText(ctx,
    'next=http%3A%2F%2F127.77.0.2%3A47101%2Fhome&r=http://127.77.0.2:47101/__h/api.example.com/x');
  assert.equal(back, 'next=https%3A%2F%2Fwww.example.com%2Fhome&r=https://api.example.com/x');
});

test('parseTarget splits /__h/ paths', () => {
  assert.deepEqual(rewrite.parseTarget(site, '/__h/img.example.com/a/b?c'), { host: 'img.example.com', path: '/a/b?c' });
  assert.deepEqual(rewrite.parseTarget(site, '/x'), { host: 'www.example.com', path: '/x' });
  assert.equal(rewrite.parseTarget(site, '/__h/bad host/x'), null);
});

test('cookies lose Domain/Secure and keep working on http', () => {
  const c = cookies.toBrowser('__Secure-sid=abc; Domain=.example.com; Path=/; Secure; HttpOnly; SameSite=None', ctx);
  assert.equal(c, 'MLG_Secure-sid=abc; Path=/; HttpOnly; SameSite=Lax');
  const sub = cookies.toBrowser('k=v; Path=/x', Object.assign({}, ctx, { host: 'login.example.com' }));
  assert.equal(sub, 'k=v; Path=/__h/login.example.com/x');
  assert.equal(cookies.toUpstream('mlg_adblock=0; MLG_Secure-sid=abc; a=1'), '__Secure-sid=abc; a=1');
});

test('adblock removes ad tags but keeps the site\'s own', () => {
  const own = (h) => rewrite.isOwnHost(site, h);
  const html = adblock.cleanHtml([
    '<script src="https://ads.trafficjunky.net/x.js"></script>',
    '<script src="/app.js"></script>',
    '<script>var popMagic = {};</script>',
    '<script>window.app = 1;</script>',
    '<iframe src="https://syndication.exosrv.com/frame"></iframe>',
    '<a href="https://www.exoclick.com/click"><img src="b.jpg"></a>',
    '<img src="https://img.example.com/banner/1.jpg">',
  ].join('\n'), own);
  assert.doesNotMatch(html, /trafficjunky|popMagic|exosrv|exoclick/);
  assert.match(html, /app\.js/);
  assert.match(html, /window\.app = 1/);
  assert.match(html, /img\.example\.com\/banner/); // own host: path patterns don't apply
});

test('search paths encode the query', () => {
  assert.equal(proxy._internal.searchPath(site, 'red hot'), '/s?q=red+hot');
  assert.equal(proxy._internal.searchPath({ search: '/search/{q}/', space: '-' }, 'a b'), '/search/a-b/');
});

/* ------------------------------------------------------------------------ */
/* End to end                                                                */
/* ------------------------------------------------------------------------ */

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

const upstream = http.createServer((req, res) => {
  const self = `http://127.0.0.1:${upstream.address().port}`;
  if (req.url === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Content-Security-Policy': "default-src 'self'",
      'X-Frame-Options': 'DENY',
      'Set-Cookie': ['sid=42; Domain=127.0.0.1; Secure; SameSite=None; Path=/'],
    });
    res.end(`<html><head><title>t</title></head><body>
      <a id="l" href="${self}/video/1">v</a>
      <script src="https://a.exoclick.com/ad.js"></script>
      <script integrity="sha384-x" src="/app.js"></script></body></html>`);
  } else if (req.url === '/echo') {
    // Not a text type, so the proxy passes it through without rewriting URLs.
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(JSON.stringify({ cookie: req.headers.cookie || '', referer: req.headers.referer || '', ua: req.headers['user-agent'] }));
  } else if (req.url === '/go') {
    res.writeHead(302, { Location: `${self}/landed` });
    res.end();
  } else {
    res.writeHead(404);
    res.end();
  }
});

after(() => { proxy.stop(); upstream.close(); });

test('browses a site through the proxy', async () => {
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const port = upstream.address().port;
  const home = await new Promise((resolve, reject) => {
    proxy.start({ version: 'test', publicDir: new URL('../dist/service/public', import.meta.url).pathname }, (err, o) => (err ? reject(err) : resolve(o)));
  });

  proxy._internal.setCustomSites([{ id: 'c100', name: 'Local', url: `http://127.0.0.1:${port}/`, slot: 100 }]);
  const open = await get(`${home}/api/open?site=c100`);
  assert.equal(open.status, 302);
  const origin = open.headers.location.replace(/\/$/, '');

  const page = await get(origin + '/', { 'User-Agent': 'Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/87.0.4280.88' });
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-security-policy'], undefined);
  assert.equal(page.headers['x-frame-options'], undefined);
  assert.deepEqual(page.headers['set-cookie'], ['sid=42; Path=/; SameSite=Lax']);
  assert.match(page.body, /window\.__MLG__=/);
  assert.match(page.body, /<script src="\/__mlg\/inject\.js">/);
  assert.match(page.body, new RegExp(`href="${origin}/video/1"`));
  assert.doesNotMatch(page.body, /exoclick/);
  assert.doesNotMatch(page.body, /integrity=/);

  const echo = JSON.parse((await get(origin + '/echo', {
    Cookie: 'sid=42; mlg_ua=desktop', Referer: origin + '/video/1', 'User-Agent': 'Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/87.0.4280.88',
  })).body);
  assert.equal(echo.cookie, 'sid=42');
  assert.equal(echo.referer, `http://127.0.0.1:${port}/video/1`);
  assert.match(echo.ua, /X11; Linux x86_64.*Chrome\/87\.0\.4280\.88/);

  const redir = await get(origin + '/go');
  assert.equal(redir.status, 302);
  assert.equal(redir.headers.location, origin + '/landed');

  const inject = await get(origin + '/__mlg/inject.js');
  assert.equal(inject.status, 200);
});
