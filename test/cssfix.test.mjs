/**
 * Tests for the CSS repairs for old TV engines (src/userscript/cssfix.js).
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixCss } from '../src/userscript/cssfix.js';

const squash = (s) => s.replace(/\s+/g, ' ').trim();

test('inset becomes top/right/bottom/left, other declarations untouched', () => {
  const out = fixCss('.modal{position:fixed;inset:0;color:red}.a{inset:1px 2px}.b{inset:1px 2px 3px 4px !important}.c{color:blue}');
  assert.equal(squash(out), squash(`
    .modal{top:0;right:0;bottom:0;left:0}
    .a{top:1px;right:2px;bottom:1px;left:2px}
    .b{top:1px !important;right:2px !important;bottom:3px !important;left:4px !important}`));
});

test(':is() and :where() rules are expanded and re-emitted whole', () => {
  const out = fixCss('.x :where(a, .b:hover) > span{color:red;inset:0}');
  assert.equal(squash(out), squash('.x a > span,\n.x .b:hover > span{color:red;top:0;right:0;bottom:0;left:0}'));
});

test('media queries are kept, keyframes and untouched rules dropped', () => {
  const out = fixCss('@media (min-width: 10px){.a{inset:0}.b{color:red}}@keyframes k{from{inset:0}to{inset:1px}}.c{x:y}');
  assert.equal(squash(out), squash('@media (min-width: 10px){.a{top:0;right:0;bottom:0;left:0}\n}'));
});

test('nothing to fix gives nothing', () => {
  assert.equal(fixCss('.a{color:red}/* inset */'), '');
  assert.equal(fixCss('.a{box-shadow:inset 0 0 1px red}'), '');
});
