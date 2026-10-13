/**
 * Malagueta home screen: the grid of sites, a search box, user-added sites,
 * an optional PIN lock and the exit prompt.
 *
 * Served by the proxy from the home origin; opening a site goes to
 * /api/open?site=<id>[&q=<search>], which starts that site's local origin and
 * redirects there. Going Back from a site's first page lands here again.
 */
import builtinSites from '../shared/sites.json';
import { createSpatialNav, DIRS } from '../shared/spatial.js';
import { load, save, nextSlot, hashPin } from './settings.js';
import iconSvg from '../../assets/icons/source/malagueta.svg';
import './home.css';

const KEY = { OK: 13, BACK: 461, ESC: 27, BACKSPACE: 8, RED: 403 };
const app = document.getElementById('app');
let settings = load();
let editMode = false;
/** The open dialog element, or null. Focus stays inside it while open. */
let dialog = null;

const nav = createSpatialNav({ root: () => dialog || app, focusClass: 'focus', reach: 3 });

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

function h(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach((k) => {
    const v = attrs[k];
    if (v == null || v === false) return;
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach((p) => e.style.setProperty(p, v[p]));
    else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  });
  (children || []).forEach((c) => { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
}

/** All sites: built-in first, then the user's own. */
function allSites() {
  return builtinSites.concat(settings.custom.map((c) => Object.assign({ custom: true, color: '#7d6a66', domains: [] }, c)));
}

function hostLabel(site) {
  try { return new URL(site.url).hostname.replace(/^www\./, ''); } catch (e) { return site.url; }
}

/** Sends the custom sites to the proxy (it doesn't store them). */
function syncCustom() {
  return fetch('/api/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings.custom),
  }).catch(() => {});
}

function persist() {
  save(settings);
}

function openSite(site, q) {
  const go = () => {
    location.href = '/api/open?site=' + encodeURIComponent(site.id) + (q ? '&q=' + encodeURIComponent(q) : '');
  };
  if (site.custom) syncCustom().then(go);
  else go();
}

/* ------------------------------------------------------------------------ */
/* Main screen                                                               */
/* ------------------------------------------------------------------------ */

function render() {
  const focusedId = nav.current && nav.current.getAttribute('data-id');
  app.innerHTML = '';
  const sites = allSites();
  const visible = sites.filter((s) => editMode || settings.hidden.indexOf(s.id) === -1);
  const searchable = sites.filter((s) => s.search && settings.hidden.indexOf(s.id) === -1);
  if (!searchable.some((s) => s.id === settings.searchSite) && searchable[0]) settings.searchSite = searchable[0].id;
  const searchSite = searchable.filter((s) => s.id === settings.searchSite)[0];

  // Header
  app.appendChild(h('header', { class: 'top' }, [
    h('div', { class: 'brand' }, [
      h('div', { class: 'logo', html: iconSvg }),
      h('h1', { text: 'Malagueta' }),
    ]),
    h('div', { class: 'actions' }, [
      h('button', { class: 'btn ghost', 'data-id': 'edit', onclick: toggleEdit, text: editMode ? 'Done' : 'Edit sites' }),
      h('button', { class: 'btn ghost', 'data-id': 'settings', onclick: openSettings, text: 'Settings' }),
    ]),
  ]));

  // Search
  if (searchSite && !editMode) {
    const input = h('input', {
      class: 'search-input', type: 'search', 'data-id': 'search', enterkeyhint: 'search',
      placeholder: 'Search ' + searchSite.name + '…',
    });
    input.addEventListener('keydown', (e) => {
      if (e.keyCode === KEY.OK && input.value.trim()) {
        e.preventDefault();
        openSite(searchSite, input.value.trim());
      }
    });
    app.appendChild(h('section', { class: 'search' }, [
      input,
      h('div', { class: 'chips' }, searchable.map((s) => h('button', {
        class: 'chip' + (s.id === settings.searchSite ? ' on' : ''),
        'data-id': 'chip:' + s.id,
        style: { '--c': s.color },
        text: s.name,
        onclick: () => { settings.searchSite = s.id; persist(); render(); },
      }))),
    ]));
  }

  // Grid
  const grid = h('section', { class: 'grid' + (editMode ? ' editing' : '') });
  visible.forEach((s) => {
    const hidden = settings.hidden.indexOf(s.id) !== -1;
    grid.appendChild(h('button', {
      class: 'tile' + (hidden ? ' hidden' : ''),
      'data-id': 'site:' + s.id,
      style: { '--c': s.color || '#e8341c' },
      onclick: () => onTile(s),
    }, [
      h('span', { class: 'tile-name', text: s.name }),
      h('span', { class: 'tile-host', text: hostLabel(s) }),
      editMode ? h('span', { class: 'tile-badge', text: s.custom ? 'Edit' : (hidden ? 'Hidden' : 'Shown') }) : null,
    ]));
  });
  grid.appendChild(h('button', { class: 'tile add', 'data-id': 'add', onclick: () => editSite(null) }, [
    h('span', { class: 'tile-name', text: '+ Add a site' }),
    h('span', { class: 'tile-host', text: 'any website address' }),
  ]));
  app.appendChild(grid);

  app.appendChild(h('footer', { class: 'hint', html: editMode
    ? 'OK on a site hides or shows it · your own sites can be edited or removed'
    : 'In a site: <b class="k red"></b> menu · <b class="k green"></b> search · <b class="k yellow"></b> full screen · <b class="k blue"></b> hide an ad · <b>Back</b> returns here' }));

  const again = focusedId && app.querySelector('[data-id="' + focusedId + '"]');
  nav.focus(again || app.querySelector('.tile'));
}

function onTile(site) {
  if (!editMode) return openSite(site);
  if (site.custom) return editSite(site);
  const i = settings.hidden.indexOf(site.id);
  if (i === -1) settings.hidden.push(site.id);
  else settings.hidden.splice(i, 1);
  persist();
  render();
}

function toggleEdit() {
  editMode = !editMode;
  render();
}

/* ------------------------------------------------------------------------ */
/* Dialogs                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Shows a modal dialog. Focus moves into it and stays there until closed.
 * @param {string} title
 * @param {Node[]} body
 * @param {Array<{label:string, action:function, cls?:string}>} buttons
 */
function showDialog(title, body, buttons) {
  closeDialog();
  const box = h('div', { class: 'dialog' }, [
    h('h2', { text: title }),
    h('div', { class: 'dialog-body' }, body),
    h('div', { class: 'dialog-buttons' }, buttons.map((b) => h('button', {
      class: 'btn ' + (b.cls || ''), onclick: b.action, text: b.label,
    }))),
  ]);
  const layer = h('div', { class: 'layer' }, [box]);
  document.body.appendChild(layer);
  dialog = layer;
  nav.focus(box.querySelector('input, .btn'));
  return box;
}

function closeDialog() {
  if (!dialog) return;
  dialog.remove();
  dialog = null;
  nav.clear();
  const first = app.querySelector('.tile');
  if (first) nav.focus(first);
}

function field(label, attrs) {
  const input = h('input', Object.assign({ class: 'field-input' }, attrs));
  return { row: h('label', { class: 'field' }, [h('span', { text: label }), input]), input };
}

/** Add (site = null) or edit a custom site. */
function editSite(site) {
  const name = field('Name', { value: site ? site.name : '', placeholder: 'My site' });
  const url = field('Address', { value: site ? site.url : 'https://', type: 'url', placeholder: 'https://example.com/' });
  const search = field('Search address (optional, {q} = what you type)', {
    value: site ? site.search || '' : '', placeholder: 'https://example.com/search?q={q}',
  });
  const error = h('p', { class: 'error' });

  const buttons = [
    { label: 'Save', cls: 'primary', action: () => {
      let u;
      try { u = new URL(url.input.value.trim()); } catch (e) { u = null; }
      if (!u || !/^https?:$/.test(u.protocol)) { error.textContent = 'Enter a full address starting with https://'; return; }
      const entry = {
        id: site ? site.id : 'c' + nextSlot(settings),
        slot: site ? site.slot : nextSlot(settings),
        name: name.input.value.trim() || u.hostname,
        url: u.href,
        search: search.input.value.trim(),
      };
      settings.custom = settings.custom.filter((c) => c.id !== entry.id).concat([entry]);
      persist();
      syncCustom();
      closeDialog();
      render();
    } },
    { label: 'Cancel', action: closeDialog },
  ];
  if (site) {
    buttons.splice(1, 0, { label: 'Remove', cls: 'danger', action: () => {
      settings.custom = settings.custom.filter((c) => c.id !== site.id);
      persist();
      syncCustom();
      closeDialog();
      render();
    } });
  }
  showDialog(site ? 'Edit ' + site.name : 'Add a site', [name.row, url.row, search.row, error], buttons);
}

function openSettings() {
  const pinOn = !!settings.pin;
  showDialog('Settings', [
    h('p', { text: 'PIN lock: ' + (pinOn ? 'on' : 'off') + '. A PIN asked when Malagueta opens keeps it out of casual sight on a shared TV.' }),
    h('p', { class: 'muted', html:
      'How it works: sites open through a small proxy that runs inside the app on this TV. ' +
      'It removes ads and pop-ups and adds remote control navigation. Nothing is sent anywhere else. ' +
      'Each site keeps its own sign-in; use <b>Sign out &amp; clear site data</b> in a site\'s menu to sign out.' }),
    h('p', { class: 'muted', text: 'Malagueta ' + __APP_VERSION__ }),
  ], [
    { label: pinOn ? 'Remove PIN' : 'Set a PIN', cls: 'primary', action: () => (pinOn ? removePin() : setPin()) },
    { label: 'Close', action: closeDialog },
  ]);
}

/* ------------------------------------------------------------------------ */
/* PIN                                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Shows a 4-digit PIN pad. Digits come from the pad or the remote's number keys.
 * @param {string} title
 * @param {function(string)} onDone  called with the 4 digits
 * @param {{cancel?: boolean, message?: string}} [opts]
 */
function pinPad(title, onDone, opts = {}) {
  let digits = '';
  const dots = h('div', { class: 'pin-dots' });
  const msg = h('p', { class: 'muted', text: opts.message || 'Use the number keys or the pad.' });
  const update = () => {
    dots.innerHTML = '';
    for (let i = 0; i < 4; i++) dots.appendChild(h('span', { class: i < digits.length ? 'on' : '' }));
    if (digits.length === 4) {
      const d = digits;
      digits = '';
      setTimeout(() => { update(); onDone(d); }, 120);
    }
  };
  const press = (d) => { if (digits.length < 4) { digits += d; update(); } };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0'];
  const pad = h('div', { class: 'pin-pad' }, keys.map((k) => h('button', {
    class: 'btn pin-key', text: k,
    onclick: () => { if (k === '⌫') { digits = digits.slice(0, -1); update(); } else press(k); },
  })));
  const buttons = opts.cancel === false ? [] : [{ label: 'Cancel', action: closeDialog }];
  const box = showDialog(title, [dots, pad, msg], buttons);
  box.classList.add('pin');
  box.__digit = press;
  box.__message = (t) => { msg.textContent = t; };
  update();
  nav.focus(pad.querySelector('.pin-key'));
  return box;
}

/** Asks for a new PIN twice and saves it. */
function setPin(message) {
  pinPad('Choose a PIN', (first) => {
    pinPad('Enter it again', (second) => {
      if (first !== second) { setPin('The PINs didn\'t match. Try again.'); return; }
      settings.pin = hashPin(first);
      persist();
      closeDialog();
      openSettings();
    });
  }, { message });
}

function removePin() {
  pinPad('Enter your PIN', (pin) => {
    if (hashPin(pin) !== settings.pin) {
      dialog.querySelector('.dialog').__message('Wrong PIN.');
      return;
    }
    settings.pin = '';
    persist();
    closeDialog();
    openSettings();
  });
}

/** Locks the home screen until the PIN is entered (once per app session). */
function lockScreen(then) {
  const box = pinPad('Malagueta is locked', (pin) => {
    if (hashPin(pin) === settings.pin) {
      try { sessionStorage.setItem('malagueta:unlocked', '1'); } catch (e) { /* ignore */ }
      closeDialog();
      then();
    } else {
      box.__message('Wrong PIN. Try again.');
    }
  }, { cancel: false, message: 'Enter your PIN.' });
}

function isUnlocked() {
  if (!settings.pin) return true;
  try { return sessionStorage.getItem('malagueta:unlocked') === '1'; } catch (e) { return false; }
}

/* ------------------------------------------------------------------------ */
/* Keys                                                                      */
/* ------------------------------------------------------------------------ */

function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

function confirmExit() {
  showDialog('Exit Malagueta?', [], [
    { label: 'Exit', cls: 'primary', action: () => window.close() },
    { label: 'Stay', action: closeDialog },
  ]);
}

window.addEventListener('keydown', (e) => {
  const k = e.keyCode;
  const active = dialog ? dialog.querySelector('.focus') || document.activeElement : document.activeElement;
  const typing = isTyping(active);
  document.documentElement.classList.remove('pointer');

  // Number keys on the PIN pad.
  const pinBox = dialog && dialog.querySelector('.dialog.pin');
  if (pinBox && ((k >= 48 && k <= 57) || (k >= 96 && k <= 105))) {
    pinBox.__digit(String(k >= 96 ? k - 96 : k - 48));
    e.preventDefault();
    return;
  }

  if (k === KEY.BACK || k === KEY.ESC || (k === KEY.BACKSPACE && !typing)) {
    e.preventDefault();
    if (typing && active.value) { active.blur(); nav.focus(active); return; }
    if (pinBox && !isUnlocked()) { window.close(); return; } // locked: Back leaves the app
    if (dialog) { closeDialog(); return; }
    if (editMode) { toggleEdit(); return; }
    confirmExit();
    return;
  }

  const dir = DIRS[k];
  if (dir) {
    if (typing && (dir === 'left' || dir === 'right') && active.value) return;
    if (nav.move(dir)) e.preventDefault();
  }
}, true);

window.addEventListener('mousemove', () => document.documentElement.classList.add('pointer'), true);

/* ------------------------------------------------------------------------ */
/* Start                                                                     */
/* ------------------------------------------------------------------------ */

syncCustom();
setInterval(() => { fetch('/api/ping', { cache: 'no-store' }).catch(() => {}); }, 20000);

if (isUnlocked()) render();
else lockScreen(render);
