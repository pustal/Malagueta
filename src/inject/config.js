/**
 * Settings the proxy writes into every page as window.__MLG__ before this
 * script loads (see processHtml in services/proxy/proxy.js).
 *
 * @typedef {object} MlgConfig
 * @property {string}   version
 * @property {string}   siteId
 * @property {string}   name       site name, e.g. "XVideos"
 * @property {string}   host       the site's main host, e.g. "www.xvideos.com"
 * @property {string}   pageHost   upstream host of this page (differs for /__h/ pages)
 * @property {string}   protocol   "https:" (or "http:" for some custom sites)
 * @property {string[]} domains    the site's own domains
 * @property {string}   search     search path template with {q}, or ''
 * @property {string}   space      how spaces are written in searches ("+", "-", "%20")
 * @property {string}   home       URL of the Malagueta home screen
 * @property {boolean}  adblock    ad blocking on for this site
 * @property {'desktop'|'tv'} uaMode
 * @property {string|null} ua      User-Agent the proxy sent upstream (desktop mode)
 */

/** @type {MlgConfig} */
export const C = window.__MLG__ || {
  version: '?', siteId: '', name: '', host: location.host, pageHost: location.host, protocol: 'https:',
  domains: [], search: '', space: '+', home: '/', adblock: true, uaMode: 'tv', ua: null,
};

/** Per-site key for this origin's localStorage. */
export function storeKey(name) {
  return 'mlg:' + name;
}

/** localStorage that never throws (it can, in private modes or when full). */
export const store = {
  get(name, fallback) {
    try {
      const v = window.localStorage.getItem(storeKey(name));
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(name, value) {
    try { window.localStorage.setItem(storeKey(name), JSON.stringify(value)); } catch (e) { /* ignore */ }
  },
};

/** Sets one of Malagueta's per-site cookies (read by the proxy), for ~10 years. */
export function setSetting(name, value) {
  document.cookie = 'mlg_' + name + '=' + value + '; Path=/; Max-Age=315360000; SameSite=Lax';
}
