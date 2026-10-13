/**
 * Page loader for old TV engines when the user script arrives too late.
 *
 * webOS runs an app's user script only once a page has finished loading
 * (WebAppManager's DocumentLoadFinished). By then a site's scripts have
 * already run, and on webOS 6 (Chromium 79) the ones written in newer
 * JavaScript have already failed: compat.js can only help with scripts
 * added later. So pages are loaded through this loader instead:
 *
 *  1. Navigate to the site's /robots.txt with the wanted page in the hash
 *     (#mlg=/path). It is a plain-text page on the right origin with no
 *     scripts, so the user script gets a clean, fresh page to work in.
 *  2. Fetch the real page's HTML (same origin, so with the site's cookies),
 *     and every script it loads (the sites' CDNs allow it). Scripts the
 *     engine can't compile are rewritten (lower.js) and put inline at the
 *     same place; scripts that are fine stay as they are. Ad scripts, frames
 *     and links are dropped.
 *  3. Switch the address to the real page (history.replaceState) and write
 *     the rewritten HTML into the document (document.open/write/close). The
 *     browser then builds the page exactly as if it had loaded it, scripts in
 *     order, with the user script already in place.
 *
 * Links to the same site are sent through the loader; anything else that
 * lands on a site page directly (Back, a form POST, a script setting
 * location) is checked once loaded and, if some of its scripts can't run on
 * this engine, reloaded through the loader.
 */
import { lower, rejected, isKnownOk, rememberOk } from './compat.js';
import { isAdUrl, htmlHasAds } from './block.js';

/** Static, script-free page every supported site has. */
const LOADER_PATH = '/robots.txt';
const MARK = '#mlg=';
/** sessionStorage key guarding against reload loops. */
const RELOADS_KEY = 'mlg:loader-reloads';

/** Address of the loader for a page on this or another origin. */
export function loaderUrl(target) {
  const u = new URL(target, location.href);
  return u.origin + LOADER_PATH + MARK + encodeURIComponent(u.pathname + u.search + u.hash);
}

/** True on a loader page (robots.txt#mlg=…). */
export function isLoaderPage() {
  // Some sites redirect /robots.txt to /robots.txt/ (YouPorn); the hash survives.
  return location.pathname.replace(/\/$/, '') === LOADER_PATH && location.hash.indexOf(MARK) === 0;
}

/* ------------------------------------------------------------------------ */
/* Loading screen                                                            */
/* ------------------------------------------------------------------------ */

function showLoading(text) {
  let el = document.getElementById('mlg-loading');
  if (!el) {
    const style = document.createElement('style');
    style.textContent = 'html,body{background:#120a0b!important;margin:0}body>*:not(#mlg-loading){display:none!important}'
      + '#mlg-loading{position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;'
      + 'color:#b49a93;font:500 28px/1.4 sans-serif;background:#120a0b}';
    (document.head || document.documentElement).appendChild(style);
    el = document.createElement('div');
    el.id = 'mlg-loading';
    (document.body || document.documentElement).appendChild(el);
  }
  el.textContent = text;
}

/* ------------------------------------------------------------------------ */
/* HTML rewriting                                                            */
/* ------------------------------------------------------------------------ */

/** Value of attribute `name` in a tag's attribute text, or null. */
function attr(attrs, name) {
  const m = new RegExp('\\s' + name + '(?:\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+)))?(?=[\\s/>]|$)', 'i').exec(attrs);
  if (!m) return null;
  return m[1] != null ? m[1] : m[2] != null ? m[2] : m[3] != null ? m[3] : '';
}

/** Attribute text without the named attributes. */
function dropAttrs(attrs, names) {
  return attrs.replace(new RegExp('\\s(?:' + names.join('|') + ')(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s>]+))?(?=[\\s/>]|$)', 'gi'), '');
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function isClassicType(type) {
  const t = (type || '').trim().toLowerCase();
  return !t || /^(text|application)\/(x-)?(java|ecma)script$/.test(t);
}

/** Script text that can't end the inline <script> element early. */
function safeInline(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

/** Fetches a script's text, or null (no CORS, network error). */
function fetchText(url) {
  return fetch(url, { credentials: 'omit' })
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null);
}

/**
 * Rewrites a page's HTML for this engine. Resolves to the new HTML.
 * @param {string} html
 * @param {string} pageUrl  final URL of the page (for relative script URLs)
 */
export async function rewriteHtml(html, pageUrl) {
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  const jobs = [];
  let m;
  while ((m = scriptRe.exec(html))) {
    const attrs = m[1];
    const src = attr(attrs, 'src');
    const job = { start: m.index, end: m.index + m[0].length, attrs, body: m[2], src: null, code: null, action: 'keep' };
    if (!isClassicType(attr(attrs, 'type'))) { jobs.push(job); continue; }
    if (src != null && src !== '') {
      let url;
      try { url = new URL(decodeEntities(src), pageUrl).href; } catch (e) { url = null; }
      job.src = url;
      if (url && isAdUrl(url)) job.action = 'drop';
      else if (url && /^https?:/.test(url) && !isKnownOk(url)) job.fetch = fetchText(url);
    } else if (job.body.trim() && rejected(job.body)) {
      job.code = lower(job.body);
      if (job.code != null) job.action = 'inline';
    }
    jobs.push(job);
  }

  // Wait for the external scripts (fetched in parallel), then decide.
  await Promise.all(jobs.filter((j) => j.fetch).map((j) => j.fetch.then((text) => {
    if (text == null) return;
    if (!rejected(text)) { rememberOk(j.src); return; }
    const code = lower(text, j.src);
    if (code != null) {
      j.code = code;
      j.action = attr(j.attrs, 'defer') != null && attr(j.attrs, 'async') == null ? 'defer' : 'inline';
    }
  })));

  let out = '';
  let pos = 0;
  const deferred = [];
  jobs.forEach((j) => {
    out += html.slice(pos, j.start);
    pos = j.end;
    const attrs = dropAttrs(j.attrs, ['src', 'integrity', 'defer', 'async', 'crossorigin']);
    if (j.action === 'drop') out += '<!--mlg:ad-->';
    else if (j.action === 'inline') out += '<script' + attrs + '>' + safeInline(j.code) + '</script>';
    else if (j.action === 'defer') deferred.push('<script' + attrs + '>' + safeInline(j.code) + '</script>');
    else out += html.slice(j.start, j.end);
  });
  out += html.slice(pos);

  // Rewritten deferred scripts: at the end of the body, in order, like defer.
  if (deferred.length) {
    const at = out.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
    out = at === -1 ? out + deferred.join('') : out.slice(0, at) + deferred.join('') + out.slice(at);
  }

  // Ad frames and links, and CSP meta tags (the rewritten scripts are inline).
  out = out.replace(/<iframe\b([^>]*)>[\s\S]*?<\/iframe\s*>/gi, (tag, attrs) => {
    const src = attr(attrs, 'src') || attr(attrs, 'data-src');
    const doc = attr(attrs, 'srcdoc');
    return (src && isAdUrl(decodeEntities(src))) || (doc && htmlHasAds(decodeEntities(doc))) ? '<!--mlg:ad-->' : tag;
  });
  out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, '');
  return out;
}

/* ------------------------------------------------------------------------ */
/* Loading a page                                                            */
/* ------------------------------------------------------------------------ */

/**
 * On a loader page: fetch, rewrite and show the wanted page. `onOpen` runs
 * right after document.open(), before the page's HTML is written, so the
 * user script can set itself up in the new document first.
 *
 * @param {function} onOpen
 */
export async function renderFromLoader(onOpen) {
  showLoading('Loading…');
  const path = decodeURIComponent(location.hash.slice(MARK.length)) || '/';
  const target = location.origin + (path.charAt(0) === '/' ? path : '/' + path);

  let res;
  try {
    res = await fetch(target, { credentials: 'include', headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
  } catch (e) {
    location.replace(target); // let the browser show its own error
    return;
  }
  const finalUrl = res.url || target;
  const type = res.headers.get('content-type') || '';
  if (new URL(finalUrl).origin !== location.origin || !/html/i.test(type)) {
    location.replace(finalUrl); // another site, or not a page: load it normally
    return;
  }
  const html = await res.text();
  showLoading('Preparing page…');
  let page;
  try {
    page = await rewriteHtml(html, finalUrl);
  } catch (e) {
    page = html;
  }
  history.replaceState(null, '', finalUrl);
  window.__MLG_RENDERED__ = true;
  document.open();
  onOpen();
  document.write(page);
  document.close();
}

/* ------------------------------------------------------------------------ */
/* Pages loaded directly                                                     */
/* ------------------------------------------------------------------------ */

/**
 * For a page the browser loaded itself: if any of its scripts can't run on
 * this engine, load it again through the loader. Guarded so the same page
 * isn't reloaded over and over.
 */
export async function reloadIfBroken() {
  const list = Array.prototype.slice.call(document.scripts);
  let broken = false;
  const checks = [];
  list.forEach((s) => {
    if (broken || !isClassicType(s.getAttribute('type'))) return;
    if (s.src) {
      if (!/^https?:/.test(s.src) || isAdUrl(s.src) || isKnownOk(s.src)) return;
      checks.push(fetchText(s.src).then((t) => {
        if (t == null) return;
        if (rejected(t)) broken = true;
        else rememberOk(s.src);
      }));
    } else if (s.text.trim() && rejected(s.text)) {
      broken = true;
    }
  });
  await Promise.all(checks);
  if (!broken) return;

  let log = {};
  try { log = JSON.parse(sessionStorage.getItem(RELOADS_KEY) || '{}'); } catch (e) { /* ignore */ }
  const key = location.pathname + location.search;
  if (log[key] && Date.now() - log[key] < 15000) return; // just did: don't loop
  log[key] = Date.now();
  try { sessionStorage.setItem(RELOADS_KEY, JSON.stringify(log)); } catch (e) { /* ignore */ }
  location.replace(loaderUrl(location.href));
}

/**
 * Sends same-site link clicks and GET form submissions through the loader,
 * unless the site handles them itself (single-page navigation).
 */
export function routeNavigation() {
  window.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    let a = e.target;
    while (a && a.tagName !== 'A') a = a.parentElement;
    if (!a || !a.href || a.hasAttribute('download')) return;
    const href = a.getAttribute('href') || '';
    if (/^(#|javascript:)/i.test(href)) return;
    let u;
    try { u = new URL(a.href); } catch (err) { return; }
    if (u.origin !== location.origin) return;
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return; // in-page anchor
    e.preventDefault();
    location.href = loaderUrl(u.href);
  });
  window.addEventListener('submit', (e) => {
    const f = e.target;
    if (e.defaultPrevented || !f || (f.method || 'get').toLowerCase() !== 'get') return;
    let u;
    try { u = new URL(f.action || location.href); } catch (err) { return; }
    if (u.origin !== location.origin) return;
    const params = [];
    const data = f.elements;
    for (let i = 0; i < data.length; i++) {
      const el = data[i];
      if (!el.name || el.disabled) continue;
      if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
      if (el.type === 'submit' || el.type === 'button' || el.type === 'file') continue;
      params.push(encodeURIComponent(el.name) + '=' + encodeURIComponent(el.value));
    }
    u.search = params.length ? '?' + params.join('&') : '';
    e.preventDefault();
    location.href = loaderUrl(u.href);
  });
}
