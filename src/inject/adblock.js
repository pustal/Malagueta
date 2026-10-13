/**
 * Ad blocking inside the page, for what the proxy can't see: elements the
 * site's scripts add after loading, and ad slots the built-in lists miss.
 *
 *  - Removes frames, scripts, images and links that point at ad hosts as
 *    soon as they are added.
 *  - "Hide an element": the user points at an ad (Magic Remote pointer, or
 *    the D-pad focus) and Malagueta remembers a CSS selector for it, per site.
 */
import { C, store } from './config.js';
import { resolve, isAdUrl } from './urls.js';

const HIDDEN_KEY = 'hidden';
let userStyle = null;

/** The user's own hidden-element selectors for this site. */
export function hiddenSelectors() {
  return store.get(HIDDEN_KEY, []);
}

function applyUserStyle() {
  const list = hiddenSelectors();
  if (!userStyle) {
    userStyle = document.createElement('style');
    userStyle.id = 'mlg-user-hidden';
    (document.head || document.documentElement).appendChild(userStyle);
  }
  userStyle.textContent = list.map((s) => s + '{display:none!important}').join('\n');
}

export function addHiddenSelector(sel) {
  const list = hiddenSelectors();
  if (list.indexOf(sel) === -1) list.push(sel);
  store.set(HIDDEN_KEY, list);
  applyUserStyle();
}

export function clearHiddenSelectors() {
  store.set(HIDDEN_KEY, []);
  applyUserStyle();
}

function urlOf(el) {
  return el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('href') || '';
}

/** Removes `el` if it loads something from an ad host. */
function check(el) {
  if (el.nodeType !== 1) return;
  const tag = el.tagName;
  if (tag === 'IFRAME' || tag === 'SCRIPT' || tag === 'IMG' || tag === 'EMBED' || tag === 'OBJECT' || tag === 'A') {
    const raw = urlOf(el);
    if (raw && isAdUrl(resolve(raw))) {
      el.remove();
      return;
    }
  }
  if (el.querySelectorAll && el.childElementCount) {
    const inner = el.querySelectorAll('iframe[src],iframe[data-src],img[src],a[href],embed[src]');
    for (let i = 0; i < inner.length; i++) {
      const raw = urlOf(inner[i]);
      if (raw && isAdUrl(resolve(raw))) inner[i].remove();
    }
  }
}

export function startAdblock() {
  applyUserStyle(); // the user's own hidden elements apply even with ad blocking off
  if (!C.adblock) return;
  const obs = new MutationObserver((records) => {
    for (let i = 0; i < records.length; i++) {
      const added = records[i].addedNodes;
      for (let j = 0; j < added.length; j++) check(added[j]);
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

/* ------------------------------------------------------------------------ */
/* Element picker                                                            */
/* ------------------------------------------------------------------------ */

/** A selector for `el` that is specific but survives page reloads. */
export function selectorFor(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== document.body && parts.length < 4) {
    if (node.id && !/\d{3,}/.test(node.id)) {
      parts.unshift('#' + CSS_escape(node.id));
      break;
    }
    let part = node.tagName.toLowerCase();
    const classes = Array.prototype.filter.call(node.classList, (c) => !/\d{3,}|^mlg-/.test(c)).slice(0, 2);
    if (classes.length) part += '.' + classes.map(CSS_escape).join('.');
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

function CSS_escape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/**
 * Starts picking. The element under the pointer (or the focused one when
 * using the D-pad) is outlined; Up selects its parent, Down goes back to
 * the child, OK hides it, Back cancels.
 *
 * @param {function(string|null)} done  called with the hidden selector, or null
 */
export function startPicker(done) {
  const box = document.createElement('div');
  box.className = 'mlg-picker-box';
  const label = document.createElement('div');
  label.className = 'mlg-picker-label';
  document.documentElement.appendChild(box);
  document.documentElement.appendChild(label);
  let target = null;
  const trail = [];

  function show(el) {
    target = el;
    if (!el) { box.style.display = 'none'; label.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    box.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    label.style.display = 'block';
    label.textContent = selectorFor(el) + '   —   OK: hide · ▲: bigger · ▼: smaller · Back: cancel';
  }

  function pick(x, y) {
    box.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    box.style.display = 'block';
    if (el && el !== box && el !== label) { trail.length = 0; show(el); }
  }

  function finish(sel) {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
    box.remove();
    label.remove();
    done(sel);
  }

  function onMove(e) { pick(e.clientX, e.clientY); }
  function onClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (target) { const sel = selectorFor(target); addHiddenSelector(sel); finish(sel); }
  }
  function onKey(e) {
    const k = e.keyCode;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (k === 461 || k === 27 || k === 8) return finish(null);
    if (k === 13 && target) { const sel = selectorFor(target); addHiddenSelector(sel); return finish(sel); }
    if (k === 38 && target && target.parentElement && target.parentElement !== document.body) {
      trail.push(target);
      show(target.parentElement);
    } else if (k === 40 && trail.length) {
      show(trail.pop());
    }
  }

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey, true);
  const a = document.activeElement;
  if (a && a !== document.body) show(a);
  else pick(window.innerWidth / 2, window.innerHeight / 2);
}
