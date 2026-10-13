/**
 * CSS that an old TV engine (Chromium 79 on webOS 6) silently ignores, made
 * to work.
 *
 * Two features matter most on these sites, because without them dialogs and
 * overlays end up in the wrong place and whole rules disappear:
 *   - `inset` (and inset-block/-inline), Chromium 87: overlays like age gates
 *     are positioned with `position: fixed; inset: 0`; without it they drop to
 *     the bottom of the page (xHamster's age gate did, leaving the site blurred);
 *   - `:is()` / `:where()` in selectors, Chromium 88: a rule with one is
 *     dropped entirely.
 *
 * Each stylesheet's text is read (fetched for <link>, which these sites'
 * CDNs allow), the affected rules are rewritten (inset -> top/right/bottom/
 * left; :is(a, b) X -> a X, b X) and added in one extra <style> at the end of
 * the document. Rules that need no change are not duplicated.
 *
 * Not handled: flex `gap`, `aspect-ratio`, `:has()` (no faithful rewrite).
 */
const SIDES = ['top', 'right', 'bottom', 'left'];
/** At most this many selectors from expanding one :is()/:where() list. */
const MAX_EXPANSION = 64;

let out = null;
const seen = new WeakSet();
const seenUrls = Object.create(null);

/** True when this engine already understands what we would rewrite. */
function engineIsModern() {
  try {
    return window.CSS && CSS.supports('inset', '0') && CSS.supports('selector(:is(a))');
  } catch (e) {
    return false;
  }
}

/** Splits `text` at top-level occurrences of `sep` (outside (), [] and strings). */
function splitTop(text, sep) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote) { if (c === quote && text.charAt(i - 1) !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (sep === ' ' ? /\s/.test(c) : c === sep)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/** One selector with every :is()/:where()/:any() expanded into plain selectors. */
function expandSelector(sel) {
  const m = /:(is|where|matches|-webkit-any)\(/i.exec(sel);
  if (!m) return [sel];
  const open = m.index + m[0].length;
  let depth = 1;
  let i = open;
  for (; i < sel.length && depth; i++) {
    if (sel.charAt(i) === '(') depth++;
    else if (sel.charAt(i) === ')') depth--;
  }
  const inner = sel.slice(open, i - 1);
  const before = sel.slice(0, m.index);
  const after = sel.slice(i);
  const out2 = [];
  splitTop(inner, ',').forEach((alt) => {
    expandSelector(before + alt + after).forEach((s) => { if (out2.length < MAX_EXPANSION) out2.push(s); });
  });
  return out2;
}

function fixSelectorList(prelude) {
  if (!/:(is|where|matches)\(/i.test(prelude)) return null;
  const all = [];
  splitTop(prelude, ',').forEach((s) => expandSelector(s).forEach((x) => all.push(x)));
  return all.join(',\n');
}

/** top/right/bottom/left declarations for an inset-family property. */
function insetDecls(prop, value) {
  let important = '';
  value = value.replace(/!\s*important\s*$/i, () => { important = ' !important'; return ''; }).trim();
  const v = splitTop(value, ' ');
  let sides;
  switch (prop) {
    case 'inset': {
      const [t, r = t, b = t, l = r] = v;
      sides = { top: t, right: r, bottom: b, left: l };
      break;
    }
    case 'inset-block': sides = { top: v[0], bottom: v[1] || v[0] }; break;
    case 'inset-inline': sides = { left: v[0], right: v[1] || v[0] }; break;
    case 'inset-block-start': sides = { top: v[0] }; break;
    case 'inset-block-end': sides = { bottom: v[0] }; break;
    case 'inset-inline-start': sides = { left: v[0] }; break;
    case 'inset-inline-end': sides = { right: v[0] }; break;
    default: return '';
  }
  return SIDES.filter((s) => sides[s]).map((s) => s + ':' + sides[s] + important).join(';');
}

/**
 * Rewrites a declaration block. Returns { all, changed }: the full block with
 * inset replaced, and only the replacement declarations.
 */
function fixDeclarations(body) {
  const changed = [];
  const all = splitTop(body, ';').map((d) => {
    const colon = d.indexOf(':');
    if (colon === -1) return d;
    const prop = d.slice(0, colon).trim().toLowerCase();
    if (prop.indexOf('inset') !== 0) return d;
    const rep = insetDecls(prop, d.slice(colon + 1));
    if (rep) changed.push(rep);
    return rep || d;
  });
  return { all: all.join(';'), changed: changed.join(';') };
}

/** Rewritten rules of a stylesheet's text, or '' when nothing needs it. */
export function fixCss(css) {
  if (!/inset|:is\(|:where\(|:matches\(/i.test(css)) return '';
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let pos = 0;

  function block() {
    let result = '';
    while (pos < css.length) {
      const open = css.indexOf('{', pos);
      const close = css.indexOf('}', pos);
      if (close !== -1 && (open === -1 || close < open)) { pos = close + 1; return result; }
      if (open === -1) { pos = css.length; return result; }
      const prelude = css.slice(pos, open).replace(/^[\s;]+/, '').trim();
      pos = open + 1;
      if (prelude.charAt(0) === '@') {
        if (/^@(media|supports|layer|document)/i.test(prelude)) {
          const innerFixed = block();
          if (innerFixed) result += prelude + '{' + innerFixed + '}\n';
        } else {
          skipBlock();
        }
        continue;
      }
      const bodyEnd = findClose();
      const body = css.slice(pos, bodyEnd);
      pos = bodyEnd + 1;
      const sel = fixSelectorList(prelude);
      if (sel) {
        result += sel + '{' + fixDeclarations(body).all + '}\n';
      } else if (/inset/i.test(body)) {
        const fixed = fixDeclarations(body).changed;
        if (fixed) result += prelude + '{' + fixed + '}\n';
      }
    }
    return result;
  }

  /** Index of the `}` closing the block that starts at pos (strings respected). */
  function findClose() {
    let depth = 1;
    let quote = '';
    for (let i = pos; i < css.length; i++) {
      const c = css.charAt(i);
      if (quote) { if (c === quote && css.charAt(i - 1) !== '\\') quote = ''; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return i;
    }
    return css.length;
  }

  function skipBlock() {
    pos = findClose() + 1;
  }

  return block();
}

function append(text) {
  if (!text) return;
  if (!out) {
    out = document.createElement('style');
    out.id = 'mlg-css-compat';
  }
  out.textContent += text;
  // Keep it last so it wins over the rules it repairs.
  const parent = document.head || document.documentElement;
  if (parent && (out.parentNode !== parent || parent.lastChild !== out)) parent.appendChild(out);
}

function handle(el) {
  if (seen.has(el) || el === out) return;
  if (el.tagName === 'STYLE') {
    // The parser may still be adding text: read page styles once it's done.
    if (document.readyState === 'loading') return;
    seen.add(el);
    append(fixCss(el.textContent || ''));
  } else if (el.tagName === 'LINK' && /(^|\s)stylesheet(\s|$)/i.test(el.rel) && el.href) {
    seen.add(el);
    const url = el.href;
    if (seenUrls[url]) return;
    seenUrls[url] = true;
    fetch(url, { credentials: 'omit' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => append(fixCss(text)))
      .catch(() => { /* not readable cross-origin: nothing to do */ });
  }
}

function scan(root) {
  const list = root.querySelectorAll ? root.querySelectorAll('style, link[rel~="stylesheet"]') : [];
  for (let i = 0; i < list.length; i++) handle(list[i]);
}

/** Starts the CSS repairs, if this engine needs them. */
export function startCssCompat() {
  if (engineIsModern()) return false;
  const obs = new MutationObserver((records) => {
    for (let i = 0; i < records.length; i++) {
      const added = records[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        const n = added[j];
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'STYLE' || n.tagName === 'LINK') handle(n);
        else if (n.firstElementChild) scan(n);
      }
    }
  });
  obs.observe(document, { childList: true, subtree: true });
  // The page's own <style> elements, once their text is complete.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan(document));
  else scan(document);
  return true;
}
