/**
 * Hooks into the browser APIs the site's own scripts use, so that requests
 * and navigations built at runtime still go through the proxy, ad requests
 * are dropped, and pop-ups/pop-unders never open.
 *
 * This runs before any of the site's scripts (it is injected at the top of
 * <head>), so the site only ever sees the patched versions.
 */
import { C } from './config.js';
import { route, resolve, isOwnHost } from './urls.js';

const BLOCKED = {
  xhr: '/__mlg/blocked',
  script: '/__mlg/blocked.js',
  img: '/__mlg/blocked.gif',
  frame: 'about:blank',
};

/** Replaces a property's setter on a prototype, keeping the getter. */
function wrapSetter(proto, prop, mapValue) {
  const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
  if (!d || !d.set || !d.configurable) return;
  Object.defineProperty(proto, prop, {
    configurable: true,
    enumerable: d.enumerable,
    get: d.get,
    set(v) { d.set.call(this, mapValue(this, v)); },
  });
}

/** What a resource URL should become on a given element. */
function mapElementUrl(el, value) {
  const tag = el.tagName;
  const kind = tag === 'A' || tag === 'FORM' ? 'nav' : 'res';
  const r = route(value, kind);
  if (r !== null) return r;
  if (tag === 'SCRIPT') return BLOCKED.script;
  if (tag === 'IFRAME' || tag === 'FRAME') return BLOCKED.frame;
  if (tag === 'IMG') return BLOCKED.img;
  return 'about:blank';
}

/** A stand-in window for blocked pop-ups, so the site's code doesn't crash on null. */
function fakeWindow() {
  const noop = () => {};
  return {
    closed: true, close: noop, focus: noop, blur: noop, postMessage: noop,
    location: { href: '', assign: noop, replace: noop }, document: null,
  };
}

function patchNetwork() {
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url);
      const r = route(url, 'xhr');
      if (r === null) return Promise.resolve(new Response('', { status: 200 }));
      if (r !== url) input = typeof input === 'string' ? r : new Request(r, input);
      return origFetch.call(this, input, init);
    };
  }

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    const r = route(url, 'xhr');
    const args = Array.prototype.slice.call(arguments);
    args[1] = r === null ? BLOCKED.xhr : r;
    return open.apply(this, args);
  };

  if (navigator.sendBeacon) {
    const beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      const r = route(url, 'xhr');
      return r === null ? true : beacon(r, data);
    };
  }

  // Site service workers would cache and serve pages behind the proxy's back.
  if (navigator.serviceWorker) {
    try {
      navigator.serviceWorker.register = () => Promise.reject(new Error('Service workers are disabled in Malagueta'));
      navigator.serviceWorker.getRegistrations().then((list) => list.forEach((r) => r.unregister()));
    } catch (e) { /* not available */ }
  }
}

function patchElements() {
  wrapSetter(window.HTMLScriptElement && HTMLScriptElement.prototype, 'src', mapElementUrl);
  wrapSetter(window.HTMLIFrameElement && HTMLIFrameElement.prototype, 'src', mapElementUrl);
  wrapSetter(window.HTMLImageElement && HTMLImageElement.prototype, 'src', mapElementUrl);
  wrapSetter(window.HTMLSourceElement && HTMLSourceElement.prototype, 'src', mapElementUrl);
  wrapSetter(window.HTMLMediaElement && HTMLMediaElement.prototype, 'src', mapElementUrl);
  wrapSetter(window.HTMLAnchorElement && HTMLAnchorElement.prototype, 'href', mapElementUrl);
  wrapSetter(window.HTMLFormElement && HTMLFormElement.prototype, 'action', mapElementUrl);

  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const n = String(name).toLowerCase();
    if ((n === 'src' || n === 'href' || n === 'action') && this.tagName !== 'LINK') {
      value = mapElementUrl(this, value);
    }
    return setAttribute.call(this, name, value);
  };

  const submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    const action = this.getAttribute('action');
    if (action) {
      const r = route(action, 'nav');
      if (r === null) return undefined;
      if (r !== action) setAttribute.call(this, 'action', r);
    }
    return submit.call(this);
  };
}

function patchWindows() {
  // Only the site's own pages may open, and they open in this window: no
  // pop-ups, pop-unders or new tabs (the TV has a single window anyway).
  window.open = function (url) {
    if (!url) return fakeWindow();
    const u = resolve(url);
    if (u && (u.origin === location.origin || isOwnHost(u.hostname))) {
      const r = route(url, 'nav');
      if (r) location.href = r;
    }
    return fakeWindow();
  };

  // Ad scripts often fake a click on a detached <a target=_blank>.
  const click = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () {
    if (this.tagName === 'A' && (!document.contains(this) || this.target === '_blank')) {
      const u = resolve(this.getAttribute('href'));
      if (!u || (u.origin !== location.origin && !isOwnHost(u.hostname))) return undefined;
    }
    return click.call(this);
  };

  // pushState with a full URL on the real domain would throw on this origin.
  ['pushState', 'replaceState'].forEach((name) => {
    const orig = history[name];
    history[name] = function (state, title, url) {
      if (url != null) {
        const r = route(url, 'nav');
        if (r) url = r;
      }
      return orig.call(this, state, title, url);
    };
  });

  // Some sites set document.domain to share cookies between subdomains;
  // on the local origin that throws and stops the script.
  try {
    Object.defineProperty(document, 'domain', {
      configurable: true,
      get: () => C.host.replace(/:\d+$/, ''),
      set: () => {},
    });
  } catch (e) { /* ignore */ }
}

function patchNavigator() {
  if (!C.ua) return;
  const props = {
    userAgent: C.ua,
    appVersion: C.ua.replace(/^Mozilla\//, ''),
    platform: 'Linux x86_64',
  };
  Object.keys(props).forEach((k) => {
    try { Object.defineProperty(navigator, k, { configurable: true, get: () => props[k] }); } catch (e) { /* ignore */ }
  });
}

/**
 * Link clicks and form submits to absolute URLs the proxy didn't rewrite:
 * keep them in this window and on the proxy. Links to ad hosts do nothing.
 */
function guardNavigation() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    let a = e.target;
    while (a && a.tagName !== 'A') a = a.parentElement;
    if (!a || !a.getAttribute('href')) return;
    const href = a.getAttribute('href');
    if (/^(#|javascript:)/i.test(href)) return;
    const r = route(href, 'nav');
    if (r === null) { e.preventDefault(); e.stopPropagation(); return; }
    // Fix the link in place and let the click carry on, so the site's own
    // handlers (single-page routing, players) still see it as normal.
    if (r !== href) a.setAttribute('href', r);
    if (a.target && a.target !== '_self') a.removeAttribute('target');
  }, true);

  document.addEventListener('submit', (e) => {
    const f = e.target;
    const action = f.getAttribute && f.getAttribute('action');
    if (!action) return;
    const r = route(action, 'nav');
    if (r === null) { e.preventDefault(); return; }
    if (r !== action) f.setAttribute('action', r);
    if (f.target === '_blank') f.removeAttribute('target');
  }, true);
}

export function installPatches() {
  patchNetwork();
  patchElements();
  patchWindows();
  patchNavigator();
  guardNavigation();
}
