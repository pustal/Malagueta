/**
 * Tests for the syntax lowering that lets today's sites run on the webOS 6
 * browser engine (src/userscript/lower.js). Each snippet runs twice in Node,
 * as written and lowered, and must give the same result; the lowered text
 * must also be free of the syntax Chromium 79 can't parse.
 *
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lowerSyntax } from '../src/userscript/lower.js';

/** Syntax Chromium 79 rejects (rough text check, after lowering). */
const MODERN = /\?\.(?!\d)|\?\?|\|\|=|&&=|#[A-Za-z_$]|static\s*\{|\d_\d/;

const run = (code) => new Function(code)();

const cases = {
  'optional member, computed and call': `
    const o = { a: { b: [1, 2], f() { return this.b.length; } } }, n = null, k = 'b';
    return [o?.a?.b?.[1], n?.a.b.c, o.a?.[k]?.[0], o.a.f?.(), n?.f(), o.a.g?.(), o?.a.f()];`,
  'optional call keeps this': `
    const o = { v: 7, m() { return this && this.v; } };
    return [o.m?.(), o?.m(), o?.['m']?.()];`,
  'chains inside arguments and templates': `
    const o = { x: { y: 2 }, f(a, b) { return a + b; } };
    return [o.f?.(o?.x?.y, ...[o.x?.y ?? 0]), \`v=\${o?.x?.y}\`];`,
  'nullish keeps 0, empty and false': `
    const z = 0, e = '', f = false, n = null, u = undefined;
    return [z ?? 1, e ?? 1, f ?? 1, n ?? 1, u ?? (n ?? 3)];`,
  'logical assignment on variables and members': `
    let a = 0, b = 1, c = null; const o = { p: null, q: 1, r: { s: '' } };
    a ||= 5; b &&= 6; c ??= 7; o.p ??= 8; o.q &&= 9; o.r.s ||= 'x'; o['t'] ??= 10;
    return [a, b, c, o.p, o.q, o.r.s, o.t];`,
  'private fields, methods, accessors, brand checks, inheritance': `
    class A { #f = 2; static #count = 0; #m() { return this.#f; } get #g() { return 3; } set #g(v) { this.#f = v; }
      constructor() { A.#count++; } static count() { return A.#count; }
      bump() { this.#g = 10; return this.#m() + this.#g; } has(o) { return #f in o; } }
    class B extends A { #m() { return 100; } both() { return this.#m() + this.bump(); } }
    const b = new B();
    return [b.both(), new A().has(b), new A().has({}), A.count()];`,
  'static blocks see the class as this': `
    class C { static x = 1; static { this.y = this.x + 1; } static { C.z = this.y * 2; } }
    return [C.x, C.y, C.z];`,
  'numeric separators and shorthand properties': `
    const big = 1_000_000, a = 1, o = { a, b: a?.toString() };
    const { a: aa = 2, b = 'd' } = o;
    return [big, 0x_f === undefined, o, aa, b];`.replace('0x_f === undefined, ', ''),
  'parenthesised bases and keywords before a chain': `
    const o = { a: { b: 3 } }, f = () => { return(o)?.a?.b; }, g = () => { return(0, o)?.a.b ?? 1; };
    return [f(), g(), typeof(o)?.a, void(o)?.a];`,
  'await, yield and arguments inside ?? and ?.': `
    const o = { f: async (x) => x * 2 }, n = null;
    const run = async function () { return [n ?? await o.f(2), o?.f(await o.f(1)), arguments[0] ?? 'none']; };
    function* gen() { const v = null; yield v ?? (yield 5); }
    return [run(9) instanceof Promise, [...gen()]];`,
  'chain short-circuits the whole rest': `
    let calls = 0; const f = () => { calls++; return 1; }; const n = null, o = { a: null, m() { return this; } };
    const r = [n?.a.b.c(f()), o.a?.[f()].x, o.m?.().m?.() === o, o.x?.(f()), o?.m?.call];
    return [r, calls];`,
  'nothing modern: unchanged text': `return [1, 2, 'a?.b', "x ?? y", /a?.b/.source];`,
};

for (const [name, code] of Object.entries(cases)) {
  test(name, () => {
    const lowered = lowerSyntax(code);
    const body = lowered.split('\nfunction _mlgNt')[0];
    // Strings and regexes in the snippets may contain the patterns on purpose.
    const stripped = body.replace(/'[^']*'|"[^"]*"|\/a\?\.b\//g, '');
    assert.doesNotMatch(stripped, MODERN, 'modern syntax left in:\n' + body);
    assert.deepEqual(run(lowered), run(code));
  });
}

test('code without modern syntax is returned as is', () => {
  const code = 'var a = 1; function f(x) { return x ? .5 : a; }';
  assert.equal(lowerSyntax(code), code);
});
