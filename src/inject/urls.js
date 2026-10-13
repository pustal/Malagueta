/**
 * Maps URLs the page uses to where they should go through the proxy. Mirrors
 * services/proxy/rewrite.js, for URLs the page builds at runtime (the proxy
 * can only rewrite the ones written literally in its responses).
 *
 *   own domain, main host  -> this origin
 *   own domain, other host -> this origin + /__h/<host>
 *   ad host                -> null (block)
 *   other host             -> unchanged, or via /__mlg/x for fetch/XHR
 */
import blocklist from '../shared/blocklist.json';
import { C } from './config.js';

const HOST_PREFIX = '/__h/';
const AD_HOSTS = blocklist.hosts.map((h) => h.toLowerCase());
const AD_PATHS = blocklist.paths;

/** True for `host` or its subdomains being in `list`. */
function inList(host, list) {
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (host === d || host.slice(-d.length - 1) === '.' + d) return true;
  }
  return false;
}

export function isOwnHost(hostname) {
  return !!hostname && inList(hostname.toLowerCase(), C.domains);
}

export function isAdHost(hostname) {
  return !!hostname && inList(hostname.toLowerCase(), AD_HOSTS);
}

/**
 * Resolves `url` as the page means it. On /__h/<host>/ pages, root-relative
 * URLs belong to that host, not the main one.
 * @returns {URL|null}
 */
export function resolve(url) {
  if (url == null) return null;
  let s = String(url);
  if (C.pageHost !== C.host && s.charAt(0) === '/' && s.charAt(1) !== '/' && s.indexOf('/__') !== 0) {
    s = HOST_PREFIX + C.pageHost + s;
  }
  try { return new URL(s, location.href); } catch (e) { return null; }
}

/** True when an absolute URL is an ad: ad host, or ad-looking path on a third-party host. */
export function isAdUrl(u) {
  if (!C.adblock || !u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return false;
  if (u.origin === location.origin) return false;
  if (isAdHost(u.hostname)) return true;
  if (isOwnHost(u.hostname)) return false;
  const lower = u.href.toLowerCase();
  for (let i = 0; i < AD_PATHS.length; i++) if (lower.indexOf(AD_PATHS[i]) !== -1) return true;
  return false;
}

/** Local URL on this origin for a URL on the site's own domains. */
export function localFor(u) {
  const rest = u.pathname + u.search + u.hash;
  if (u.host === C.host) return location.origin + rest;
  return location.origin + HOST_PREFIX + u.host + rest;
}

/** Real URL for a URL on this origin (for showing or sharing). */
export function upstreamFor(href) {
  const u = resolve(href);
  if (!u || u.origin !== location.origin) return href;
  let p = u.pathname + u.search + u.hash;
  let host = C.host;
  if (p.indexOf(HOST_PREFIX) === 0) {
    const rest = p.slice(HOST_PREFIX.length);
    const cut = rest.indexOf('/');
    host = cut === -1 ? rest : rest.slice(0, cut);
    p = cut === -1 ? '/' : rest.slice(cut);
  }
  return C.protocol + '//' + host + p;
}

/**
 * Where a URL should go.
 * @param {*} url
 * @param {'xhr'|'nav'|'res'} kind
 *   xhr: fetch/XHR/beacon. Other hosts go via /__mlg/x (CORS, Referer).
 *   nav: page navigation. Other hosts are opened through /__h/ too.
 *   res: scripts, frames, images, media. Other hosts load directly.
 * @returns {string|null} the URL to use, or null to block it
 */
export function route(url, kind) {
  if (url == null || url === '') return url;
  const s = String(url);
  if (/^(data|blob|about|javascript|mailto|tel):/i.test(s)) return s;
  const u = resolve(s);
  if (!u) return s;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return s;
  if (isAdUrl(u)) return null;
  if (u.origin === location.origin) return u.href === s ? s : u.href;
  if (isOwnHost(u.hostname)) return localFor(u);
  if (kind === 'xhr') return location.origin + '/__mlg/x?u=' + encodeURIComponent(u.href);
  if (kind === 'nav') return localFor(u);
  return s;
}
