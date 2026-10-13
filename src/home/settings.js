/**
 * Home screen settings, kept in the home origin's localStorage.
 *
 * Custom sites live here too; the proxy only holds them in memory, so the
 * home screen sends the list to it every time it loads (see main.js).
 *
 * @typedef {object} CustomSite
 * @property {string} id      "c<slot>"
 * @property {string} name
 * @property {string} url     start page, http(s)
 * @property {number} slot    unique number, used to make the id
 * @property {string} search  optional search URL with {q}
 *
 * @typedef {object} Settings
 * @property {CustomSite[]} custom
 * @property {string[]}     hidden       ids of sites hidden from the grid
 * @property {string}       searchSite   id of the site the search box uses
 * @property {string}       pin          hash of the PIN, '' for no lock
 */

const KEY = 'malagueta:settings';

/** @type {Settings} */
const DEFAULTS = { custom: [], hidden: [], searchSite: 'pornhub', pin: '' };

/** @returns {Settings} */
export function load() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const s = raw ? JSON.parse(raw) : {};
    return Object.assign({}, DEFAULTS, s);
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

/** @param {Settings} s */
export function save(s) {
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage full or blocked */ }
}

/** Next free number for a custom site id. */
export function nextSlot(s) {
  let slot = 100;
  s.custom.forEach((c) => { if (c.slot >= slot) slot = c.slot + 1; });
  return Math.min(slot, 999);
}

/**
 * Hash for the PIN. This lock only keeps the app out of casual sight on a
 * shared TV; it is not encryption, so a simple string hash is enough.
 */
export function hashPin(pin) {
  let h = 5381;
  const s = 'malagueta:' + pin;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
