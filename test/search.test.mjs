/**
 * Tests for the shared, browser-independent pieces:
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchUrl } from '../src/shared/search.js';

const sites = JSON.parse(readFileSync(new URL('../src/shared/sites.json', import.meta.url), 'utf8'));
const byId = (id) => sites.find((s) => s.id === id);

test('search URLs use each site\'s template and space style', () => {
  assert.equal(searchUrl(byId('pornhub'), 'red hot'), 'https://www.pornhub.com/video/search?search=red+hot');
  assert.equal(searchUrl(byId('eporner'), 'red hot'), 'https://www.eporner.com/search/red-hot/');
  assert.equal(searchUrl(byId('faphouse'), 'red hot'), 'https://faphouse.com/search/videos?q=red%20hot');
  assert.equal(searchUrl(byId('xvideos'), 'a&b'), 'https://www.xvideos.com/?k=a%26b');
});

test('search on the page\'s own origin when given one', () => {
  assert.equal(searchUrl(byId('xhamster'), 'x', 'https://xhamster.desi/videos/1'), 'https://xhamster.desi/search/x');
});

test('no search URL without a query or a template', () => {
  assert.equal(searchUrl(byId('pornhub'), '   '), null);
  assert.equal(searchUrl({ url: 'https://example.com/', search: '' }, 'x'), null);
});

test('every built-in site is complete', () => {
  for (const s of sites) {
    assert.ok(s.id && s.name && /^https:\/\//.test(s.url) && s.domains.length, s.id);
    assert.ok(s.domains.some((d) => new URL(s.url).hostname.endsWith(d)), `${s.id}: url not on its domains`);
  }
});
