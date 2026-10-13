/**
 * Rewrites modern JavaScript into syntax Chromium 79 (webOS 6) can run.
 *
 * The code is parsed with acorn and printed back from its own source text,
 * changing only the constructs the old engine can't parse:
 *
 *   a?.b, a?.[k], f?.()      optional chaining (Chromium 80)   -> conditional with helpers
 *   a ?? b                   nullish coalescing (Chromium 80)  -> (_mlgNt(a) ? _mlgNv() : b)
 *   a ||= b, a &&= b, a ??= b logical assignment (Chromium 85) -> a || (a = b) ...
 *   #m() {}, #x in o         private methods, brand checks (84, 91)
 *                            -> all private names of a class become ordinary
 *                               per-class property names (__mlg<N>_m)
 *   static { … }             class static blocks (Chromium 94)
 *                            -> static field set by an arrow function (same this)
 *   1_000                    numeric separators (Chromium 75, for webOS 5)
 *
 * Everything else is copied verbatim, so the result stays close to the
 * original (minified code stays minified). Class fields are left alone:
 * Chromium 72+ supports them.
 *
 * Trade-offs, none of which these sites rely on: renamed private names are
 * visible as normal properties; the left side of a logical assignment is
 * evaluated twice; `delete a?.b` no longer deletes.
 *
 * The two helpers are appended to the script as function declarations, so
 * they are hoisted and don't disturb a leading "use strict".
 */
import { Parser } from 'acorn';

const ACORN_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowReturnOutsideFunction: true,
  allowHashBang: true,
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
};

/** Quick text check: none of these strings means nothing to lower. */
const MAYBE_MODERN = /\?\.|\?\?|#[A-Za-z_$]|\|\|=|&&=|static\s*\{|\d_\d/;

/**
 * Helpers referenced by the rewritten code, appended once per script.
 *   _mlgNt(v)   remembers v and says whether it is neither null nor undefined
 *   _mlgNv()    the value _mlgNt last remembered
 *   _mlgB(o,k)  o[k] bound to o (for o.k?.()), or o[k] itself when null/undefined
 * `x ?? y` becomes `(_mlgNt(x) ? _mlgNv() : y)`: no closures, so `await`,
 * `yield`, `arguments` and `super` inside keep working. The remembered value
 * is read straight after the test, before anything else can run.
 */
const HELPERS = '\nfunction _mlgNt(v){_mlgNt.v=v;return v!=null}'
  + '\nfunction _mlgNv(){return _mlgNt.v}'
  + '\nfunction _mlgB(o,k){var f=o[k];return f==null?f:function(){return f.apply(o,arguments)}}\n';

/** The AST nodes directly under `node`, in source order. */
function childrenOf(node) {
  const out = [];
  for (const key in node) {
    if (key === 'type' || key === 'start' || key === 'end' || key.charAt(0) === '_') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (v[i] && typeof v[i].type === 'string') out.push(v[i]);
    } else if (v && typeof v.type === 'string') {
      out.push(v);
    }
  }
  // Same start: the wider node first (so `{a = 1}` keeps one copy of `a`).
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  return out;
}

/** True for the constructs this module rewrites. */
function needsRewrite(node) {
  switch (node.type) {
    case 'ChainExpression':
    case 'PrivateIdentifier':
    case 'StaticBlock':
      return true;
    case 'LogicalExpression':
      return node.operator === '??';
    case 'AssignmentExpression':
      return node.operator === '||=' || node.operator === '&&=' || node.operator === '??=';
    case 'Literal':
      return typeof node.value === 'number' && /_/.test(node.raw || '');
    default:
      return false;
  }
}

/** Marks every node whose subtree has something to rewrite (node._d). Returns the flag. */
function markDirty(node) {
  let dirty = needsRewrite(node);
  const kids = childrenOf(node);
  node._k = kids;
  for (let i = 0; i < kids.length; i++) if (markDirty(kids[i])) dirty = true;
  node._d = dirty;
  return dirty;
}

/**
 * Older-syntax version of `code` (or `code` itself when nothing needed
 * changing). Throws when acorn can't parse it.
 * @param {string} code
 */
export function lowerSyntax(code) {
  code = code.replace(/^﻿/, '');
  if (!MAYBE_MODERN.test(code)) return code;
  const ast = Parser.parse(code, ACORN_OPTIONS);
  if (!markDirty(ast)) return code;

  const scopes = []; // private-name maps of the enclosing classes
  let classCount = 0;
  let usedHelpers = false;

  const privateName = (name) => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return scopes[i].get(name);
    return '__mlg_' + name;
  };

  /** Source of `node` with its children rendered. */
  function generic(node) {
    let out = '';
    let pos = node.start;
    const kids = node._k;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.start < pos) continue; // shorthand duplicates
      out += code.slice(pos, k.start);
      const r = render(k, node);
      // e.g. `return(a)?.b`: keep a space so it doesn't become `return_mlg...`
      if (/[\w$]$/.test(out) && /^[\w$]/.test(r)) out += ' ';
      out += r;
      pos = k.end;
    }
    return out + code.slice(pos, node.end);
  }

  /**
   * Flattens an optional chain into its base expression and links, left to
   * right: [{ optional, call, text }] where text is ".b", "[k]" or "(args)".
   * A member link followed by a call keeps its key separately (key/keyIsName)
   * so `o.m?.()` can be called with `this` = o.
   */
  function flatten(node, links) {
    if (node.type === 'MemberExpression' || node.type === 'CallExpression') {
      const inner = node.type === 'MemberExpression' ? node.object : node.callee;
      let base = flatten(inner, links);
      if (links.length === 0 && inner.start > node.start) base = '(' + base + ')'; // (a)?.b
      if (node.type === 'MemberExpression') {
        let key;
        let text;
        if (node.computed) {
          key = render(node.property, node);
          text = '[' + key + ']';
        } else {
          const name = node.property.type === 'PrivateIdentifier' ? privateName(node.property.name) : node.property.name;
          key = JSON.stringify(name);
          text = '.' + name;
        }
        links.push({ optional: node.optional, call: false, text, key });
      } else {
        links.push({ optional: node.optional, call: true, text: '(' + node.arguments.map((a) => render(a, node)).join(', ') + ')' });
      }
      return base;
    }
    return render(node, null);
  }

  /**
   * Text for links[i..] applied to `cur`. An optional link tests the value so
   * far and continues on _mlgNv(); anything after a failed test is skipped,
   * like the real short-circuit.
   */
  function buildChain(cur, links, i) {
    if (i >= links.length) return cur;
    const link = links[i];
    const next = links[i + 1];
    if (link.optional && !link.tested) {
      usedHelpers = true;
      const rest = links.slice(i);
      rest[0] = Object.assign({}, link, { tested: true });
      return '(_mlgNt(' + cur + ') ? ' + buildChain('_mlgNv()', rest, 0) + ' : void 0)';
    }
    if (!link.call && next && next.call && next.optional) {
      // o.m?.(): look the method up bound to o, then test it.
      usedHelpers = true;
      return buildChain('_mlgB(' + cur + ', ' + link.key + ')', [next].concat(links.slice(i + 2)), 0);
    }
    return buildChain(cur + link.text, links, i + 1);
  }

  function render(node, parent) {
    if (!node._d) return code.slice(node.start, node.end);
    switch (node.type) {
      case 'ChainExpression': {
        const links = [];
        const base = flatten(node.expression, links);
        return '(' + buildChain(base, links, 0) + ')';
      }
      case 'LogicalExpression':
        if (node.operator === '??') {
          usedHelpers = true;
          return '(_mlgNt(' + render(node.left, node) + ') ? _mlgNv() : ' + render(node.right, node) + ')';
        }
        return generic(node);
      case 'AssignmentExpression': {
        const op = node.operator;
        if (op !== '||=' && op !== '&&=' && op !== '??=') return generic(node);
        const left = render(node.left, node);
        const right = render(node.right, node);
        if (op === '??=') {
          usedHelpers = true;
          return '(_mlgNt(' + left + ') ? _mlgNv() : (' + left + ' = ' + right + '))';
        }
        return '(' + left + ' ' + op.slice(0, 2) + ' (' + left + ' = ' + right + '))';
      }
      case 'PrivateIdentifier': {
        const name = privateName(node.name);
        const brandCheck = parent && parent.type === 'BinaryExpression' && parent.operator === 'in' && parent.left === node;
        return brandCheck ? JSON.stringify(name) : name;
      }
      case 'ClassBody': {
        const id = ++classCount;
        const map = new Map();
        node.body.forEach((m) => {
          if (m.key && m.key.type === 'PrivateIdentifier') map.set(m.key.name, '__mlg' + id + '_' + m.key.name);
        });
        scopes.push(map);
        const out = generic(node);
        scopes.pop();
        return out;
      }
      case 'StaticBlock': {
        const text = generic(node);
        return 'static __mlgStatic' + (++classCount) + ' = (() => ' + text.slice(text.indexOf('{')) + ')();';
      }
      case 'Literal':
        if (typeof node.value === 'number') return node.raw.replace(/_/g, '');
        return generic(node);
      default:
        return generic(node);
    }
  }

  const out = render(ast, null);
  return usedHelpers ? out + HELPERS : out;
}
