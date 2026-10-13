/**
 * "Hide an element": the user points at an ad the lists miss (Magic Remote
 * pointer, or the D-pad focus) and Malagueta remembers a CSS selector for it,
 * on this site, for good. Undo from the menu.
 */
import { addHiddenSelector } from './block.js';

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
