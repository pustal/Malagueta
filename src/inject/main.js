/**
 * Malagueta page script, injected by the proxy at the top of every page it
 * serves (as /__mlg/inject.js, built from this folder).
 *
 * Order matters: the API patches go in first, before any of the site's own
 * scripts run; the menu and remote handling are added once the body exists.
 *
 * Remote keys (keyboard equivalents for testing on a computer):
 *   arrows / OK       move between links and buttons, open them
 *   Back (Esc)        close menu → leave full screen → previous page → home
 *   Red (F9)          Malagueta menu
 *   Green (F10)       search this site
 *   Yellow (F11)      full screen for the video on the page
 *   Blue (F12)        hide an element
 *   Play/Pause, ◀◀ ▶▶ control the video; CH+/CH- scroll a page
 */
import { C } from './config.js';
import { installPatches } from './patches.js';
import { startAdblock, startPicker } from './adblock.js';
import { createMenu, applyZoom, currentZoom } from './menu.js';
import { createSpatialNav, DIRS } from '../shared/spatial.js';

const KEY = {
  OK: 13, BACK: 461, ESC: 27, BACKSPACE: 8,
  RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
  PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, REW: 412, FF: 417,
  CH_UP: 33, CH_DOWN: 34,
  F9: 120, F10: 121, F11: 122, F12: 123,
};

/** Styles that must live in the page itself (focus ring, picker outline). */
const PAGE_CSS = `
.mlg-focus { outline: 4px solid #e8341c !important; outline-offset: 2px !important; box-shadow: 0 0 0 8px rgba(232,52,28,.25) !important; }
html.mlg-pointer .mlg-focus { outline: none !important; box-shadow: none !important; }
.mlg-picker-box { position: fixed; z-index: 2147483646; pointer-events: none; border: 3px solid #e8341c; background: rgba(232,52,28,.18); }
.mlg-picker-label { position: fixed; z-index: 2147483646; left: 24px; right: 24px; bottom: 24px; padding: 12px 18px; pointer-events: none;
  background: rgba(18,10,11,.92); color: #f6ece6; font: 500 20px/1.3 sans-serif; border-radius: 10px; }
`;

function addPageCss() {
  const s = document.createElement('style');
  s.id = 'mlg-page';
  s.textContent = PAGE_CSS;
  (document.head || document.documentElement).appendChild(s);
}

/* ------------------------------------------------------------------------ */
/* Video                                                                     */
/* ------------------------------------------------------------------------ */

/** The page's main video: the biggest one that is visible. */
function mainVideo() {
  const list = document.querySelectorAll('video');
  let best = null;
  let bestArea = 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i].getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) { bestArea = area; best = list[i]; }
  }
  return best;
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function exitFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  return undefined;
}

function toggleFullscreen() {
  if (fullscreenElement()) return exitFullscreen();
  const v = mainVideo();
  if (!v) return undefined;
  // Prefer the player's own container so its controls stay visible.
  const box = v.closest('[class*="player"], [id*="player"]') || v;
  const req = box.requestFullscreen || box.webkitRequestFullscreen;
  return req ? req.call(box) : undefined;
}

function seek(seconds) {
  const v = mainVideo();
  if (!v || !isFinite(v.duration)) return false;
  v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + seconds));
  return true;
}

/** Media keys. Returns true when used. */
function handleMediaKey(k) {
  const v = mainVideo();
  if (!v) return false;
  switch (k) {
    case KEY.PLAY: v.play(); return true;
    case KEY.PAUSE: v.pause(); return true;
    case KEY.PLAYPAUSE: if (v.paused) v.play(); else v.pause(); return true;
    case KEY.STOP: v.pause(); return true;
    case KEY.REW: return seek(-30);
    case KEY.FF: return seek(30);
    default: return false;
  }
}

/* ------------------------------------------------------------------------ */
/* Keys                                                                      */
/* ------------------------------------------------------------------------ */

function isTyping(el) {
  if (!el) return false;
  const t = el.tagName;
  if (t === 'TEXTAREA' || el.isContentEditable) return true;
  if (t !== 'INPUT') return false;
  return !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type || '');
}

function goBack() {
  // The home screen is the entry before the first page of a site, so going
  // back from the first page returns home.
  if (history.length > 1) history.back();
  else location.href = C.home;
}

function setupKeys(menu) {
  const nav = createSpatialNav({
    focusClass: 'mlg-focus',
    onEdge: (dir) => {
      // Nothing more that way: scroll instead, so long pages stay reachable.
      if (dir === 'down' || dir === 'up') {
        window.scrollBy(0, (dir === 'down' ? 1 : -1) * window.innerHeight * 0.4);
        return true;
      }
      return false;
    },
  });

  window.addEventListener('keydown', (e) => {
    const k = e.keyCode;
    const used = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    document.documentElement.classList.remove('mlg-pointer');

    // The element picker has its own key handling.
    if (document.querySelector('.mlg-picker-box')) return undefined;
    if (menu.handleKey(e)) return used();

    if (k === KEY.RED || k === KEY.F9) { menu.open(); return used(); }
    if (k === KEY.GREEN || k === KEY.F10) { menu.open({ search: true }); return used(); }
    if (k === KEY.YELLOW || k === KEY.F11) { toggleFullscreen(); return used(); }
    if (k === KEY.BLUE || k === KEY.F12) {
      menu.toast('Point at what to hide, or use ▲▼ — OK hides it');
      startPicker((sel) => { if (sel) menu.toast('Hidden. Undo it from the menu.'); });
      return used();
    }
    if (handleMediaKey(k)) return used();

    const active = document.activeElement;
    const typing = isTyping(active);

    if (k === KEY.BACK || k === KEY.ESC || (k === KEY.BACKSPACE && !typing)) {
      if (fullscreenElement()) { exitFullscreen(); return used(); }
      if (typing) { active.blur(); return used(); }
      goBack();
      return used();
    }

    // In full screen the arrows seek and OK pauses, like a TV player.
    const fs = fullscreenElement();
    if (fs && mainVideo() && (fs === mainVideo() || fs.contains(mainVideo()))) {
      if (k === 37 && seek(-10)) return used();
      if (k === 39 && seek(10)) return used();
      if (k === KEY.OK) { const v = mainVideo(); if (v.paused) v.play(); else v.pause(); return used(); }
    }

    if (k === KEY.CH_UP || k === KEY.CH_DOWN) {
      window.scrollBy(0, (k === KEY.CH_DOWN ? 1 : -1) * window.innerHeight * 0.85);
      return used();
    }

    const dir = DIRS[k];
    if (dir) {
      // Left/right move the caret inside text fields; up/down leave them.
      if (typing && (dir === 'left' || dir === 'right')) return undefined;
      if (nav.move(dir)) return used();
      return undefined;
    }

    if (k === KEY.OK && active && active !== document.body) {
      // Links, buttons and fields handle OK themselves; other clickable
      // things (divs with click handlers) need a click.
      if (!/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(active.tagName)) {
        active.click();
        return used();
      }
    }
    return undefined;
  }, true);

  // Magic Remote pointer: hide the D-pad focus ring and show the pepper button.
  window.addEventListener('mousemove', () => {
    document.documentElement.classList.add('mlg-pointer');
    menu.onPointer();
  }, true);
}

/* ------------------------------------------------------------------------ */
/* Keeping the proxy alive                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Pings the proxy while the page is open (it stops after a long idle).
 * If it has stopped (the TV slept with the app in the background), restart
 * it through the luna bus when this page can reach it, or explain.
 */
function keepAlive(menu) {
  let failures = 0;
  const ping = () => {
    fetch('/__mlg/ping', { cache: 'no-store' }).then(() => { failures = 0; }, () => {
      failures++;
      if (failures < 2) return;
      if (window.PalmServiceBridge) {
        const bridge = new window.PalmServiceBridge();
        bridge.onservicecallback = () => location.reload();
        bridge.call('luna://org.malagueta.app.service/start', '{}');
      } else {
        menu.toast('Malagueta stopped in the background. Close the app and open it again.');
      }
    });
  };
  setInterval(ping, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
}

/* ------------------------------------------------------------------------ */
/* Start                                                                     */
/* ------------------------------------------------------------------------ */

function onBody(fn) {
  if (document.body) fn();
  else document.addEventListener('DOMContentLoaded', fn);
}

// Already injected (a page that loads its own HTML twice): do nothing.
if (!window.__MLG_LOADED__) {
  window.__MLG_LOADED__ = true;
  installPatches();
  addPageCss();
  applyZoom(currentZoom());
  startAdblock();

  const menu = createMenu();
  setupKeys(menu);
  onBody(() => {
    menu.mount();
    keepAlive(menu);
  });
}
