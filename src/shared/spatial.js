/**
 * Spatial (D-pad) navigation: moves focus to the nearest focusable element in
 * the pressed direction. Shared by the home screen and the injected page
 * script, so websites built for a mouse can be used with the arrow keys.
 *
 * The LG Magic Remote's pointer keeps working as a mouse at the same time;
 * callers hide the focus ring while the pointer is in use.
 */

/** Elements a user can act on. */
export const FOCUSABLE = [
  'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
  'video[controls]', '[tabindex]:not([tabindex="-1"])', '[role=button]', '[role=link]',
  '[role=menuitem]', '[role=tab]', '[onclick]', '[contenteditable=""]', '[contenteditable=true]',
].join(',');

/** Directions by key code: left, up, right, down. */
export const DIRS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

/**
 * Cheap visibility check. Elements with display:none have no box; hidden or
 * covered elements on screen are caught by the hit test in dropCovered, which
 * is far cheaper than getComputedStyle on every link of a big page.
 */
function isVisible(el, r) {
  return r.width >= 2 && r.height >= 2 && !el.disabled;
}

/** Topmost element at a point, looking inside shadow roots we can see into. */
function elementAt(x, y) {
  let el = document.elementFromPoint(x, y);
  while (el && el.shadowRoot && el.shadowRoot.elementFromPoint) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** Malagueta's own overlays (menu button, picker) don't count as covering the page. */
function isOwnUi(el) {
  return el.tagName === 'MLG-MENU' || /(^|\s)mlg-/.test(String(el.className || ''));
}

/**
 * Score of moving from rect `a` to rect `b` in `dir`; lower is better,
 * Infinity when `b` isn't in that direction. Distance along the direction
 * counts once, sideways offset counts more, and overlapping rows/columns are
 * preferred so moving down a grid stays in its column.
 */
function score(a, b, dir) {
  const acx = (a.left + a.right) / 2;
  const acy = (a.top + a.bottom) / 2;
  const bcx = (b.left + b.right) / 2;
  const bcy = (b.top + b.bottom) / 2;
  let main;
  let side;
  let overlap;
  const tol = 2;
  switch (dir) {
    case 'down':
      if (b.top < a.bottom - tol && bcy <= acy + tol) return Infinity;
      if (bcy <= acy) return Infinity;
      main = Math.max(0, b.top - a.bottom);
      side = Math.abs(bcx - acx);
      overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      break;
    case 'up':
      if (b.bottom > a.top + tol && bcy >= acy - tol) return Infinity;
      if (bcy >= acy) return Infinity;
      main = Math.max(0, a.top - b.bottom);
      side = Math.abs(bcx - acx);
      overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      break;
    case 'right':
      if (b.left < a.right - tol && bcx <= acx + tol) return Infinity;
      if (bcx <= acx) return Infinity;
      main = Math.max(0, b.left - a.right);
      side = Math.abs(bcy - acy);
      overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      break;
    default: // left
      if (b.right > a.left + tol && bcx >= acx - tol) return Infinity;
      if (bcx >= acx) return Infinity;
      main = Math.max(0, a.left - b.right);
      side = Math.abs(bcy - acy);
      overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  }
  return main + side * (overlap > 0 ? 0.5 : 3);
}

/**
 * @param {object}   opts
 * @param {function(): Element} [opts.root]     where to look (default: document)
 * @param {string}   [opts.selector]           what can take focus (default: FOCUSABLE)
 * @param {string}   [opts.focusClass]         class put on the current element
 * @param {number}   [opts.reach]              how far off-screen to look, in viewport heights
 * @param {function(string): boolean} [opts.onEdge]  nothing found that way; return true if handled
 * @param {boolean}  [opts.hitTest]          false to skip the covered-element check (inside our own dialogs)
 */
export function createSpatialNav(opts = {}) {
  const getRoot = opts.root || (() => document);
  const selector = opts.selector || FOCUSABLE;
  const focusClass = opts.focusClass || 'sn-focus';
  const reach = opts.reach == null ? 1.5 : opts.reach;
  let current = null;

  function candidates() {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const out = [];
    const list = getRoot().querySelectorAll(selector);
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      const r = el.getBoundingClientRect();
      if (r.bottom < -vh * reach || r.top > vh * (1 + reach)) continue;
      if (r.right < 0 || r.left > vw) continue;
      if (!isVisible(el, r)) continue;
      // Skip containers whose only job is to hold another focusable element.
      if (el.tagName !== 'A' && el.querySelector && el.querySelector('a[href],button') && !el.matches('button,a')) continue;
      out.push({ el, r });
    }
    return opts.hitTest === false ? out : dropCovered(out, vw, vh);
  }

  /**
   * Drops elements hidden behind something else (an age gate, a cookie
   * banner, a dialog), checked by what is actually on screen at their middle.
   * When something covers on-screen elements, an overlay is up: then only
   * the on-screen elements that can be reached are kept, so focus stays in
   * the dialog instead of wandering under it.
   */
  function dropCovered(list, vw, vh) {
    const kept = [];
    let covered = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const r = c.r;
      const x = Math.min(Math.max((r.left + r.right) / 2, 1), vw - 1);
      const y = Math.min(Math.max((r.top + r.bottom) / 2, 1), vh - 1);
      const onScreen = r.bottom > 0 && r.top < vh;
      if (!onScreen) { kept.push(c); continue; }
      const hit = elementAt(x, y);
      if (!hit || hit === c.el || c.el.contains(hit) || hit.contains(c.el)) kept.push(c);
      else if (!isOwnUi(hit)) covered++;
      else kept.push(c);
    }
    if (!covered) return kept;
    return kept.filter((c) => c.r.bottom > 0 && c.r.top < vh);
  }

  function setCurrent(el) {
    if (current && current !== el) current.classList.remove(focusClass);
    current = el;
    if (!el) return;
    el.classList.add(focusClass);
    if (el.tabIndex < 0 && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    ensureVisible(el);
  }

  function ensureVisible(el) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const margin = vh * 0.12;
    if (r.top < margin || r.bottom > vh - margin) {
      if (el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded(true);
      else window.scrollBy(0, r.top - vh / 2 + r.height / 2);
    }
  }

  /** The element to move from: the tracked one, or whatever has focus. */
  function from() {
    const root = getRoot();
    if (current && root.contains(current)) return current;
    // For a shadow root this is the focused element inside it.
    const a = root.activeElement;
    if (a && a !== document.body && root.contains(a)) return a;
    return null;
  }

  /**
   * Moves focus in `dir`. Returns true if focus moved (or onEdge handled it).
   * @param {'left'|'up'|'right'|'down'} dir
   */
  function move(dir) {
    const start = from();
    const list = candidates();
    if (!start) {
      // Nothing focused yet: take the first element on screen.
      const first = list.filter((c) => c.r.top >= 0 && c.r.top < window.innerHeight)
        .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)[0] || list[0];
      if (first) { setCurrent(first.el); return true; }
      return opts.onEdge ? !!opts.onEdge(dir) : false;
    }
    const a = start.getBoundingClientRect();
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.el === start || c.el.contains(start) || start.contains(c.el)) continue;
      const s = score(a, c.r, dir);
      if (s < bestScore) { bestScore = s; best = c.el; }
    }
    if (best) { setCurrent(best); return true; }
    return opts.onEdge ? !!opts.onEdge(dir) : false;
  }

  return {
    move,
    focus: setCurrent,
    get current() { return from(); },
    clear() { if (current) current.classList.remove(focusClass); current = null; },
  };
}
