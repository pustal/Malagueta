/**
 * Runs today's websites on an old TV browser engine.
 *
 * webOS 6 TVs browse with Chromium 79 (webOS 5: 68). Current sites ship
 * JavaScript with syntax that engine can't even parse, mainly optional
 * chaining (a?.b) and nullish coalescing (a ?? b): one such file and the
 * whole page breaks (Pornhub shows a black screen, FapHouse's buttons do
 * nothing). Nothing can be polyfilled for syntax, so this rewrites those
 * scripts into older JavaScript, in the TV, just before they run:
 *
 *  - a script is fetched (from the browser's cache, normally) and test-
 *    compiled; only if the engine rejects it is it rewritten (lower.js:
 *    acorn for private methods, logical assignment and static blocks,
 *    then Sucrase for ?. and ??);
 *  - the rewritten code takes the original's place as an inline script at
 *    the same point, so scripts still run in their original order;
 *  - scripts known to be fine are remembered per site (by URL), so they are
 *    not fetched twice on later visits.
 *
 * Covers scripts in the page's HTML (parser-inserted, caught by a
 * MutationObserver before they run), scripts added from JavaScript (caught
 * when they are inserted) and inline scripts. Not covered: ES modules and
 * document.write'd scripts, which sites in sites.json don't depend on.
 *
 * On engines that already understand the new syntax this does nothing.
 */
import { lowerSyntax } from './lower.js';
import { isAdUrl } from './block.js';

/** Remembered "this URL needs no rewriting" entries per site, at most this many. */
const MAX_OK_ENTRIES = 400;
const OK_KEY = 'mlg:compat-ok';
/** Bigger scripts are left alone: rewriting them would stall the TV too long. */
const MAX_SCRIPT_CHARS = 6 * 1024 * 1024;

/** Elements this module created or already dealt with. */
const handled = new WeakSet();

/** True when the engine parses modern syntax itself (Chromium 85+). */
function engineIsModern() {
  try {
    // eslint-disable-next-line no-new-func
    new Function('var a, b; a?.b; a ?? b; a ||= b; a &&= b; a ??= b;');
    return true;
  } catch (e) {
    return false;
  }
}

/** True when `code` can't be compiled by this engine. */
function rejected(code) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
    return false;
  } catch (e) {
    // EvalError means the site's CSP forbids eval: we can't tell, leave it.
    return e instanceof SyntaxError;
  }
}

/**
 * Older-syntax version of `code`, or null if it can't be made to compile.
 * @param {string} code
 * @param {string} [name]  for the debugger: shows the original URL
 */
export function lower(code, name) {
  try {
    const out = lowerSyntax(code);
    if (rejected(out)) return null;
    return name ? out + '\n//# sourceURL=' + name : out;
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* "Known fine" cache                                                        */
/* ------------------------------------------------------------------------ */

let okList = null;

function loadOk() {
  if (okList) return okList;
  try { okList = JSON.parse(localStorage.getItem(OK_KEY) || '[]'); } catch (e) { okList = []; }
  if (!Array.isArray(okList)) okList = [];
  return okList;
}

function isKnownOk(url) {
  return loadOk().indexOf(url) !== -1;
}

function rememberOk(url) {
  const list = loadOk();
  if (list.indexOf(url) !== -1) return;
  list.push(url);
  if (list.length > MAX_OK_ENTRIES) list.splice(0, list.length - MAX_OK_ENTRIES);
  try { localStorage.setItem(OK_KEY, JSON.stringify(list)); } catch (e) { /* full: fine */ }
}

/* ------------------------------------------------------------------------ */
/* Scripts                                                                   */
/* ------------------------------------------------------------------------ */

/** Synchronous GET; null when it fails (network, CORS, error status). */
function fetchSync(url) {
  try {
    const x = new XMLHttpRequest();
    x.open('GET', url, false);
    x.send();
    return x.status >= 200 && x.status < 300 ? x.responseText : null;
  } catch (e) {
    return null;
  }
}

function isClassic(el) {
  const t = (el.getAttribute('type') || '').trim().toLowerCase();
  return !t || t === 'text/javascript' || t === 'application/javascript' || t === 'application/x-javascript'
    || t === 'text/ecmascript' || t === 'application/ecmascript';
}

/**
 * Rewritten code for an external script, or null when it can run as is
 * (or can't be fetched, in which case the browser loads it normally).
 */
/** URLs that couldn't be read this session (no CORS, offline): don't block on them again. */
const unreadable = Object.create(null);

function lowerExternal(url) {
  if (!url || /^(data|blob):/i.test(url) || isAdUrl(url) || isKnownOk(url) || unreadable[url]) return null;
  const code = fetchSync(url);
  if (code == null) {
    unreadable[url] = true;
    return null;
  }
  if (code.length > MAX_SCRIPT_CHARS) return null;
  if (!rejected(code)) {
    rememberOk(url);
    return null;
  }
  return lower(code, url);
}

/** Fires `load` on a script we turned inline, for code waiting on it. */
function fireLoad(el) {
  setTimeout(() => {
    try { el.dispatchEvent(new Event('load')); } catch (e) { /* ignore */ }
  }, 0);
}

/** Deferred scripts we rewrote, run in order when the document is parsed. */
const deferred = [];

function runDeferred() {
  while (deferred.length) {
    const { code, original } = deferred.shift();
    const s = document.createElement('script');
    handled.add(s);
    s.text = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
    fireLoad(original);
  }
}

/**
 * A script the HTML parser added, seen before it runs. External ones are
 * swapped for their rewritten text in place; inline ones get their text
 * rewritten. (The parser may still be appending text to an inline script
 * when we first see it: then the partial code fails to rewrite and we try
 * again on the next batch, until the complete script is there.)
 */
function handleParserScript(el) {
  if (handled.has(el) || !isClassic(el)) return;
  const src = el.getAttribute('src');
  if (src) {
    handled.add(el);
    const url = el.src;
    const code = lowerExternal(url);
    if (code == null) return;
    if (el.hasAttribute('defer') && !el.hasAttribute('async')) {
      // Keep "after the document is parsed" timing: run it from our queue.
      el.type = 'javascript/malagueta-deferred';
      deferred.push({ code, original: el });
      return;
    }
    el.removeAttribute('src');
    el.text = code;
    fireLoad(el);
    return;
  }
  const text = el.text;
  if (text && rejected(text)) {
    const code = lower(text);
    if (code != null) el.text = code;
  }
}

/**
 * Hooks the DOM insertion methods, so scripts added from JavaScript are
 * rewritten (if needed) before the browser starts loading them.
 */
function hookInsertion() {
  const prepare = (node) => {
    if (!node || node.nodeName !== 'SCRIPT' || handled.has(node) || document.contains(node) || !isClassic(node)) return;
    handled.add(node);
    if (node.src) {
      const code = lowerExternal(node.src);
      if (code == null) return;
      node.removeAttribute('src');
      node.text = code;
      fireLoad(node);
    } else if (node.text && rejected(node.text)) {
      const code = lower(node.text);
      if (code != null) node.text = code;
    }
  };
  const prepareAll = (args) => {
    for (let i = 0; i < args.length; i++) {
      const n = args[i];
      if (n && n.nodeType === 1) {
        prepare(n);
        if (n.nodeName !== 'SCRIPT' && n.querySelectorAll && !document.contains(n)) {
          const inner = n.querySelectorAll('script');
          for (let j = 0; j < inner.length; j++) prepare(inner[j]);
        }
      } else if (n && n.nodeType === 11 && n.querySelectorAll) { // DocumentFragment
        const inner = n.querySelectorAll('script');
        for (let j = 0; j < inner.length; j++) prepare(inner[j]);
      }
    }
  };
  const wrap = (proto, name, argIndexes) => {
    const orig = proto[name];
    if (!orig) return;
    proto[name] = function () {
      prepareAll(argIndexes ? argIndexes.map((i) => arguments[i]) : arguments);
      return orig.apply(this, arguments);
    };
  };
  wrap(Node.prototype, 'appendChild', [0]);
  wrap(Node.prototype, 'insertBefore', [0]);
  wrap(Node.prototype, 'replaceChild', [0]);
  wrap(Element.prototype, 'append');
  wrap(Element.prototype, 'prepend');
  wrap(Element.prototype, 'after');
  wrap(Element.prototype, 'before');
  wrap(Element.prototype, 'replaceWith');
}

function watchParser() {
  const obs = new MutationObserver((records) => {
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.target.nodeName === 'SCRIPT') handleParserScript(r.target); // more text for an inline script
      const added = r.addedNodes;
      for (let j = 0; j < added.length; j++) {
        const n = added[j];
        if (n.nodeName === 'SCRIPT') handleParserScript(n);
        else if (n.nodeType === 1 && n.firstElementChild) {
          const inner = n.querySelectorAll('script');
          for (let k = 0; k < inner.length; k++) handleParserScript(inner[k]);
        }
      }
    }
  });
  obs.observe(document, { childList: true, subtree: true });
  // Deferred scripts run when parsing ends, before DOMContentLoaded, as they would.
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'loading') runDeferred();
  }, true);
}

/** Starts the compatibility layer, if this engine needs it. Returns whether it did. */
export function startCompat() {
  if (engineIsModern()) return false;
  hookInsertion();
  watchParser();
  return true;
}
