/**
 * Ad and pop-up blocking from inside the page.
 *
 * webOS injects the user script before any of the page's own scripts run, so
 * everything here is in place first:
 *
 *  - network: fetch, XHR and sendBeacon calls to ad hosts get an empty answer;
 *    <script>/<iframe>/<img> pointed at ad hosts (from JavaScript or from the
 *    page's HTML) never load;
 *  - pop-ups: window.open only works for the site's own pages, and opens them
 *    in this window; fake clicks on detached links (pop-under trick) do nothing;
 *  - cosmetic: known ad slots are hidden with CSS (shared selectors from
 *    blocklist.json plus the site's own from sites.json), plus whatever the
 *    user hid with the element picker.
 *
 * It deliberately does NOT touch video elements or the site's own scripts:
 * players must keep working exactly as in a browser.
 */
import blocklist from '../shared/blocklist.json';
import { SITE, onDomain, store, adblockOn } from './site.js';

// A site the user opens on purpose is never "an ad host", even if it is on
// the list (e.g. a cam site added as a custom site).
const AD_HOSTS = blocklist.hosts.map((h) => h.toLowerCase()).filter((h) => !onDomain(location.hostname, h));
const AD_PATHS = blocklist.paths;

/** Empty stand-ins for blocked requests, created on first use. */
let emptyScriptUrl = null;
const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function emptyScript() {
  if (!emptyScriptUrl) emptyScriptUrl = URL.createObjectURL(new Blob(['/* blocked by Malagueta */'], { type: 'text/javascript' }));
  return emptyScriptUrl;
}

/** Host of an absolute or protocol-relative URL, '' for relative ones. */
function hostOf(url) {
  const m = /^\s*(?:https?:)?\/\/([^/?#:\s]+)/i.exec(String(url == null ? '' : url));
  return m ? m[1].toLowerCase() : '';
}

function isOwnHost(host) {
  for (let i = 0; i < SITE.domains.length; i++) if (onDomain(host, SITE.domains[i])) return true;
  return onDomain(host, location.hostname);
}

function isAdHost(host) {
  for (let i = 0; i < AD_HOSTS.length; i++) if (onDomain(host, AD_HOSTS[i])) return true;
  return false;
}

/**
 * True when `url` points at an ad: an ad host, or an ad-looking path on a
 * third-party host. Relative URLs are the site's own and never ads.
 */
export function isAdUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  if (isAdHost(host)) return true;
  if (isOwnHost(host)) return false;
  const lower = String(url).toLowerCase();
  for (let i = 0; i < AD_PATHS.length; i++) if (lower.indexOf(AD_PATHS[i]) !== -1) return true;
  return false;
}

/**
 * True when an HTML snippet (an iframe's srcdoc) loads anything from an ad
 * host. Ad networks often build their slot as a srcdoc frame, whose scripts
 * this user script can't reach once it is running.
 */
export function htmlHasAds(html) {
  const re = /(?:src|href)\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi;
  let m;
  while ((m = re.exec(String(html || '')))) if (isAdUrl(m[1])) return true;
  return false;
}

/* ------------------------------------------------------------------------ */
/* Network                                                                   */
/* ------------------------------------------------------------------------ */

function blockNetwork() {
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url);
      if (isAdUrl(url)) return Promise.resolve(new Response('', { status: 200 }));
      return origFetch.apply(this, arguments);
    };
  }

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    const args = Array.prototype.slice.call(arguments);
    if (isAdUrl(url)) args[1] = emptyScript(); // an empty, successful response
    return open.apply(this, args);
  };

  if (navigator.sendBeacon) {
    const beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => (isAdUrl(url) ? true : beacon(url, data));
  }
}

/** What an element's URL becomes when it points at an ad. */
function replacement(el) {
  switch (el.tagName) {
    case 'SCRIPT': return emptyScript();
    case 'IMG': return BLANK_GIF;
    default: return 'about:blank';
  }
}

/** Replaces a property setter on a prototype, keeping the getter. */
function wrapSetter(proto, prop) {
  const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
  if (!d || !d.set || !d.configurable) return;
  Object.defineProperty(proto, prop, {
    configurable: true,
    enumerable: d.enumerable,
    get: d.get,
    set(v) { d.set.call(this, isAdUrl(v) ? replacement(this) : v); },
  });
}

function blockElements() {
  wrapSetter(window.HTMLScriptElement && HTMLScriptElement.prototype, 'src');
  wrapSetter(window.HTMLIFrameElement && HTMLIFrameElement.prototype, 'src');
  wrapSetter(window.HTMLImageElement && HTMLImageElement.prototype, 'src');

  // Ad frames built from inline HTML.
  const srcdoc = window.HTMLIFrameElement && Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
  if (srcdoc && srcdoc.set && srcdoc.configurable) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      configurable: true,
      enumerable: srcdoc.enumerable,
      get: srcdoc.get,
      set(v) { srcdoc.set.call(this, htmlHasAds(v) ? '' : v); },
    });
  }

  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const n = String(name).toLowerCase();
    if (n === 'src' && /^(SCRIPT|IFRAME|IMG)$/.test(this.tagName) && isAdUrl(value)) {
      value = replacement(this);
    } else if (n === 'srcdoc' && this.tagName === 'IFRAME' && htmlHasAds(value)) {
      value = '';
    }
    return setAttribute.call(this, name, value);
  };
}

/* ------------------------------------------------------------------------ */
/* Pop-ups                                                                   */
/* ------------------------------------------------------------------------ */

/** A stand-in window for blocked pop-ups, so the page's code doesn't crash on null. */
function fakeWindow() {
  const noop = () => {};
  return {
    closed: true, close: noop, focus: noop, blur: noop, postMessage: noop,
    location: { href: '', assign: noop, replace: noop }, document: null,
  };
}

function resolve(url) {
  try { return new URL(url, location.href); } catch (e) { return null; }
}

function isOwnUrl(url) {
  const u = resolve(url);
  return !!u && (u.protocol === 'https:' || u.protocol === 'http:') && isOwnHost(u.hostname);
}

function blockPopups() {
  // The TV has one window: the site's own pages open here, anything else
  // (pop-ups, pop-unders, "new tab" ads) doesn't open at all.
  window.open = function (url) {
    if (url && isOwnUrl(url)) location.href = resolve(url).href;
    return fakeWindow();
  };

  // Pop-under scripts fake a click on a detached or target=_blank link.
  const click = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () {
    if (this.tagName === 'A' && (!document.contains(this) || this.target === '_blank') && !isOwnUrl(this.href)) {
      return undefined;
    }
    return click.call(this);
  };

  // Real clicks: links to ad hosts do nothing, new-tab links open here.
  document.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    let a = e.target;
    while (a && a.tagName !== 'A') a = a.parentElement;
    if (!a || !a.getAttribute('href')) return;
    if (adblockOn() && isAdUrl(a.href)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (a.target && a.target !== '_self') a.removeAttribute('target');
  }, true);
}

/* ------------------------------------------------------------------------ */
/* Elements in the page                                                      */
/* ------------------------------------------------------------------------ */

function urlOf(el) {
  return el.getAttribute('src') || el.getAttribute('data-src') || (el.tagName === 'A' ? el.getAttribute('href') : '') || '';
}

/**
 * Stops ad elements the HTML parser or the page adds. For a parser-inserted
 * <script src>, changing its type before it runs keeps it from loading.
 */
function checkNode(el) {
  if (el.nodeType !== 1) return;
  const tag = el.tagName;
  if (tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'IMG' || tag === 'EMBED' || tag === 'OBJECT') {
    if (isAdUrl(urlOf(el)) || (tag === 'IFRAME' && el.hasAttribute('srcdoc') && htmlHasAds(el.getAttribute('srcdoc')))) {
      if (tag === 'SCRIPT') el.type = 'javascript/blocked';
      el.remove();
    }
    return;
  }
  if (tag === 'A' && isAdUrl(el.getAttribute('href'))) {
    el.remove();
    return;
  }
  if (el.firstElementChild) {
    const inner = el.querySelectorAll('script[src],iframe,img[src],a[href],embed');
    for (let i = 0; i < inner.length; i++) checkNode(inner[i]);
  }
}

function watchDom() {
  const obs = new MutationObserver((records) => {
    for (let i = 0; i < records.length; i++) {
      const added = records[i].addedNodes;
      for (let j = 0; j < added.length; j++) checkNode(added[j]);
    }
  });
  obs.observe(document, { childList: true, subtree: true });
}

/* ------------------------------------------------------------------------ */
/* CSS                                                                       */
/* ------------------------------------------------------------------------ */

/** Adds a <style> as soon as the document has a root element. */
export function addStyle(id, css) {
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  const attach = () => (document.head || document.documentElement).appendChild(style);
  if (document.documentElement) attach();
  else {
    const obs = new MutationObserver(() => {
      if (document.documentElement) { obs.disconnect(); attach(); }
    });
    obs.observe(document, { childList: true });
  }
  return style;
}

/** One rule per selector, so one an old browser rejects can't void the rest. */
function hideRules(selectors) {
  return selectors.map((s) => s + '{display:none!important}').join('\n');
}

let userStyle = null;

/** Selectors the user hid on this site with the element picker. */
export function hiddenSelectors() {
  return store.get('hidden', []);
}

function refreshUserStyle() {
  if (!userStyle) userStyle = addStyle('mlg-user-hidden', '');
  userStyle.textContent = hideRules(hiddenSelectors());
}

export function addHiddenSelector(sel) {
  const list = hiddenSelectors();
  if (list.indexOf(sel) === -1) list.push(sel);
  store.set('hidden', list);
  refreshUserStyle();
}

export function clearHiddenSelectors() {
  store.set('hidden', []);
  refreshUserStyle();
}

/* ------------------------------------------------------------------------ */
/* Start                                                                     */
/* ------------------------------------------------------------------------ */

export function startBlocking() {
  refreshUserStyle(); // the user's own hidden elements apply even with ad blocking off
  blockPopups();
  if (!adblockOn()) return;
  addStyle('mlg-cosmetic', hideRules(blocklist.selectors.concat(SITE.cosmetic || [])));
  blockNetwork();
  blockElements();
  watchDom();
}
