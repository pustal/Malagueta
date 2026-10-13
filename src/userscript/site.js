/**
 * Which site this page belongs to, and Malagueta's per-site settings.
 *
 * The user script runs on every page the app shows, at the site's real
 * address. Built-in sites are recognised by their domains (sites.json), so
 * they get their own ad-hiding selectors and search; any other page (a site
 * the user added, a sign-in page on another domain) gets the generic
 * behaviour.
 */
import sites from '../shared/sites.json';

/** True for `host` being `domain` or one of its subdomains. */
export function onDomain(host, domain) {
  host = String(host || '').toLowerCase();
  return host === domain || host.slice(-domain.length - 1) === '.' + domain;
}

/**
 * The built-in site for a host name, or null.
 * @param {string} host
 */
export function siteFor(host) {
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    for (let j = 0; j < s.domains.length; j++) {
      if (onDomain(host, s.domains[j])) return s;
    }
  }
  return null;
}

/**
 * The registrable part of a host, roughly: "www.example.co.uk" isn't handled
 * perfectly, but "img.example.com" -> "example.com" is all this needs (to tell
 * the page's own hosts from third parties on sites that aren't built in).
 */
export function baseDomain(host) {
  const parts = String(host || '').toLowerCase().split('.');
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

/** The site of the current page: a built-in one, or a generic stand-in. */
export const SITE = siteFor(location.hostname) || {
  id: '',
  name: location.hostname.replace(/^www\./, ''),
  url: location.origin + '/',
  domains: [baseDomain(location.hostname)],
  search: '',
  space: '+',
  cosmetic: [],
};

/** localStorage of this site that never throws (it can when full or blocked). */
export const store = {
  get(name, fallback) {
    try {
      const v = window.localStorage.getItem('mlg:' + name);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(name, value) {
    try { window.localStorage.setItem('mlg:' + name, JSON.stringify(value)); } catch (e) { /* ignore */ }
  },
};

/** Ad blocking on for this site (the menu can turn it off per site). */
export function adblockOn() {
  return store.get('adblock', true) !== false;
}
