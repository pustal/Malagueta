/**
 * The Malagueta menu shown over every site (red button, F9 on a computer, or
 * the pepper button that appears when the Magic Remote pointer moves).
 *
 * Lives in a closed shadow root so the site's CSS can't restyle it and the
 * site's scripts can't find it.
 */
import { C, store, setSetting } from './config.js';
import { upstreamFor } from './urls.js';
import { hiddenSelectors, clearHiddenSelectors, startPicker } from './adblock.js';
import { createSpatialNav } from '../shared/spatial.js';
import iconSvg from '../../assets/icons/source/malagueta.svg';

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.fab {
  position: fixed; right: 28px; bottom: 28px; width: 72px; height: 72px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.18); background: rgba(18,10,11,.82); padding: 10px;
  cursor: pointer; opacity: 0; transition: opacity .3s; pointer-events: none;
  box-shadow: 0 6px 24px rgba(0,0,0,.5); z-index: 2;
}
.fab.show { opacity: 1; pointer-events: auto; }
.fab svg, .head svg { width: 100%; height: 100%; border-radius: 50%; display: block; }
.scrim { position: fixed; top: 0; right: 0; bottom: 0; left: 0; background: rgba(0,0,0,.45); display: none; }
.panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: 600px; padding: 40px 40px 28px;
  background: linear-gradient(160deg, #24110f 0%, #140909 60%); color: #f6ece6;
  font: 500 26px/1.3 "Figtree", "LG Smart UI", "Segoe UI", Roboto, sans-serif;
  box-shadow: -20px 0 60px rgba(0,0,0,.6); display: none; flex-direction: column; overflow-y: auto;
  border-left: 1px solid rgba(255,255,255,.08);
}
.open .panel { display: flex; }
.open .scrim { display: block; }
.head { display: flex; align-items: center; gap: 18px; margin-bottom: 8px; }
.head .logo { width: 64px; height: 64px; flex: none; }
.head h1 { margin: 0; font-size: 36px; font-weight: 700; letter-spacing: -.01em; }
.url { color: #b49a93; font-size: 18px; word-break: break-all; margin: 0 0 24px; max-height: 3.9em; overflow: hidden; }
.row { display: flex; gap: 12px; margin-bottom: 12px; }
button, input {
  font: inherit; color: inherit; border: 2px solid transparent; border-radius: 14px;
  background: rgba(255,255,255,.06); padding: 14px 20px; text-align: left; outline: none;
}
button { flex: 1; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
button .val { color: #b49a93; font-size: 22px; }
button.on .val { color: #8fd16a; }
button.sm { flex: 0 0 auto; min-width: 72px; justify-content: center; }
.zoomval { flex: 1; display: flex; align-items: center; justify-content: center; color: #b49a93; }
button:focus, button.sn-focus, input:focus { border-color: #e8341c; background: rgba(232,52,28,.18); }
button.danger .lbl { color: #ff9a85; }
input { width: 100%; background: rgba(0,0,0,.35); }
.search { display: none; }
.search.show { display: flex; }
.foot { margin-top: auto; padding-top: 18px; color: #8d7670; font-size: 17px; line-height: 1.5; }
.keys span { display: inline-block; width: 14px; height: 14px; border-radius: 3px; margin: 0 6px 0 2px; vertical-align: -1px; }
.toast {
  position: fixed; left: 50%; bottom: 60px; transform: translateX(-50%); padding: 16px 28px; border-radius: 14px;
  background: rgba(18,10,11,.92); color: #f6ece6; font: 500 24px/1.3 "Figtree", sans-serif;
  border: 1px solid rgba(255,255,255,.12); opacity: 0; transition: opacity .25s; pointer-events: none;
}
.toast.show { opacity: 1; }
`;

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach((k) => {
    if (k === 'text') e.textContent = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  });
  (children || []).forEach((c) => c && e.appendChild(c));
  return e;
}

function button(label, onclick, opts = {}) {
  const b = el('button', { class: opts.cls || '', onclick });
  b.appendChild(el('span', { class: 'lbl', text: label }));
  if (opts.val != null) b.appendChild(el('span', { class: 'val', text: opts.val }));
  return b;
}

/** Current page zoom for this site (a factor, 1 = 100%). */
export function currentZoom() {
  return store.get('zoom', 1);
}

export function applyZoom(z) {
  document.documentElement.style.zoom = z === 1 ? '' : String(z);
}

/** Search URL on this site for `q`, or null when the site has no search. */
export function searchUrl(q) {
  if (!C.search || !q) return null;
  let enc = encodeURIComponent(q.trim());
  if (C.space !== '%20') enc = enc.replace(/%20/g, C.space);
  const p = C.search.replace('{q}', enc);
  if (/^https?:/i.test(p)) {
    const u = new URL(p);
    return location.origin + u.pathname + u.search;
  }
  return location.origin + (p.charAt(0) === '/' ? '' : '/') + p;
}

export function createMenu() {
  const host = document.createElement('mlg-menu');
  host.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;display:block';
  const root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
  root.appendChild(el('style', { text: CSS }));

  const wrap = el('div', { class: 'wrap', style: 'pointer-events:none' });
  const scrim = el('div', { class: 'scrim', onclick: () => close() });
  const panel = el('div', { class: 'panel' });
  const fab = el('div', { class: 'fab', html: iconSvg, onclick: () => open(), title: 'Malagueta' });
  const toastEl = el('div', { class: 'toast' });
  [scrim, panel, fab, toastEl].forEach((n) => wrap.appendChild(n)); // no append() on Chromium 53
  root.appendChild(wrap);

  const nav = createSpatialNav({ root: () => root, selector: 'button,input', reach: 3 });
  let isOpen = false;
  let confirmClear = false;
  let searchRow;
  let searchInput;

  function render() {
    panel.innerHTML = '';
    confirmClear = false;
    const zoom = currentZoom();
    const hidden = hiddenSelectors().length;

    panel.appendChild(el('div', { class: 'head' }, [
      el('div', { class: 'logo', html: iconSvg }),
      el('h1', { text: C.name || 'Malagueta' }),
    ]));
    panel.appendChild(el('p', { class: 'url', text: upstreamFor(location.href) }));

    panel.appendChild(el('div', { class: 'row' }, [button('Home', () => { location.href = C.home; })]));
    panel.appendChild(el('div', { class: 'row' }, [
      button('◀ Back', () => { close(); history.back(); }, { cls: 'sm' }),
      button('Forward ▶', () => { close(); history.forward(); }, { cls: 'sm' }),
      button('⟳ Reload', () => location.reload()),
    ]));

    if (C.search) {
      panel.appendChild(el('div', { class: 'row' }, [button('Search ' + C.name, () => showSearch())]));
      searchInput = el('input', { type: 'search', placeholder: 'Search ' + C.name + '…', enterkeyhint: 'search' });
      searchInput.addEventListener('keydown', (e) => {
        if (e.keyCode === 13) {
          e.preventDefault();
          const url = searchUrl(searchInput.value);
          if (url) location.href = url;
        }
      });
      searchRow = el('div', { class: 'row search' }, [searchInput]);
      panel.appendChild(searchRow);
    }

    const zoomLabel = el('div', { class: 'zoomval', text: 'Zoom ' + Math.round(zoom * 100) + '%' });
    panel.appendChild(el('div', { class: 'row' }, [
      button('−', () => stepZoom(-1), { cls: 'sm' }), zoomLabel, button('+', () => stepZoom(1), { cls: 'sm' }),
    ]));

    panel.appendChild(el('div', { class: 'row' }, [button('Block ads', () => {
      setSetting('adblock', C.adblock ? '0' : '1');
      location.reload();
    }, { val: C.adblock ? 'On' : 'Off', cls: C.adblock ? 'on' : '' })]));

    panel.appendChild(el('div', { class: 'row' }, [button('Show site as', () => {
      setSetting('ua', C.uaMode === 'desktop' ? 'tv' : 'desktop');
      location.reload();
    }, { val: C.uaMode === 'desktop' ? 'Computer' : 'TV' })]));

    panel.appendChild(el('div', { class: 'row' }, [button('Hide an element…', () => {
      close();
      toast('Point at what to hide, or use ▲▼ — OK hides it');
      startPicker((sel) => { if (sel) toast('Hidden. Undo it from the menu.'); });
    })]));

    if (hidden) {
      panel.appendChild(el('div', { class: 'row' }, [button('Show hidden elements again', () => {
        clearHiddenSelectors();
        render();
        focusFirst();
      }, { val: String(hidden) })]));
    }

    const clearBtn = button('Sign out & clear site data', () => {
      if (!confirmClear) {
        confirmClear = true;
        clearBtn.querySelector('.lbl').textContent = 'Press OK again to sign out';
        return;
      }
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* ignore */ }
      location.href = '/__mlg/clear';
    }, { cls: 'danger' });
    panel.appendChild(el('div', { class: 'row' }, [clearBtn]));

    panel.appendChild(el('div', { class: 'row' }, [button('Exit Malagueta', () => window.close())]));

    panel.appendChild(el('div', { class: 'foot', html:
      'Malagueta ' + C.version + '<br><span class="keys">' +
      '<span style="background:#e53935"></span>menu ' +
      '<span style="background:#43a047"></span>search ' +
      '<span style="background:#fdd835"></span>full screen ' +
      '<span style="background:#1e88e5"></span>hide element</span>' }));
  }

  function stepZoom(dir) {
    const z = currentZoom();
    let i = ZOOM_STEPS.indexOf(z);
    if (i === -1) i = ZOOM_STEPS.indexOf(1);
    i = Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir));
    store.set('zoom', ZOOM_STEPS[i]);
    applyZoom(ZOOM_STEPS[i]);
    host.style.zoom = String(1 / ZOOM_STEPS[i]); // keep the menu itself at 100%
    const focusedIdx = Array.prototype.indexOf.call(panel.querySelectorAll('button'), nav.current);
    render();
    const btns = panel.querySelectorAll('button');
    nav.focus(btns[focusedIdx] || btns[0]);
  }

  function showSearch() {
    if (!searchRow) return;
    searchRow.classList.add('show');
    nav.focus(searchInput);
  }

  function focusFirst() {
    nav.focus(panel.querySelector('button'));
  }

  function open(opts = {}) {
    if (isOpen) return;
    isOpen = true;
    render();
    host.style.pointerEvents = 'auto';
    wrap.style.pointerEvents = 'auto';
    wrap.classList.add('open');
    fab.classList.remove('show');
    if (opts.search && searchRow) showSearch();
    else focusFirst();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    wrap.classList.remove('open');
    host.style.pointerEvents = 'none';
    wrap.style.pointerEvents = 'none';
    nav.clear();
  }

  /**
   * Keys while the menu is open. Returns true when the key was used.
   * @param {KeyboardEvent} e
   */
  function handleKey(e) {
    if (!isOpen) return false;
    const k = e.keyCode;
    const inInput = nav.current === searchInput && searchInput;
    if (k === 461 || k === 27 || (k === 8 && !inInput)) { close(); return true; }
    if (k === 403 || k === 120) { close(); return true; }
    if (k >= 37 && k <= 40) {
      if (inInput && (k === 37 || k === 39)) return false; // move the caret
      nav.move({ 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[k]);
      return true;
    }
    if (k === 13 && !inInput) {
      const b = nav.current;
      if (b && b.click) b.click();
      return true;
    }
    return false;
  }

  let fabTimer = 0;
  function onPointer() {
    if (isOpen) return;
    fab.classList.add('show');
    clearTimeout(fabTimer);
    fabTimer = setTimeout(() => fab.classList.remove('show'), 3000);
  }

  let toastTimer = 0;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
  }

  function mount() {
    (document.body || document.documentElement).appendChild(host);
    const z = currentZoom();
    if (z !== 1) host.style.zoom = String(1 / z);
  }

  return {
    mount, open, close, handleKey, onPointer, toast,
    get isOpen() { return isOpen; },
  };
}
