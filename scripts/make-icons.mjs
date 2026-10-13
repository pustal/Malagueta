#!/usr/bin/env node
/**
 * Generates the webOS launcher icons and the splash screen in assets/icons/
 * from the hand-drawn pepper, assets/icons/source/malagueta.svg.
 *
 *   npm run icons
 *
 * Outputs (committed, so building doesn't need this step):
 *   icon.png       80x80    launcher icon
 *   largeIcon.png  130x130  launcher icon, large
 *   splash.png     1920x1080 shown while the app starts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const SRC = 'assets/icons/source/malagueta.svg';
const OUT = 'assets/icons';
// <metadata> (e.g. provenance data some tools add) isn't needed to draw it.
const svg = readFileSync(SRC, 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/g, '');

function render(source, width) {
  return new Resvg(source, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

writeFileSync(`${OUT}/icon.png`, render(svg, 80));
writeFileSync(`${OUT}/largeIcon.png`, render(svg, 130));

// Splash: the icon's background stretched to 1920x1080 with the peppers in
// the middle. Built by wrapping the icon's content in a wider SVG.
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const defs = /<defs>[\s\S]*?<\/defs>/.exec(inner)[0];
const art = inner.replace(defs, '').replace(/<rect width="512" height="512" fill="url\(#bg\)"\/>/, '');
const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  ${defs}
  <radialGradient id="splashBg" cx="50%" cy="45%" r="75%">
    <stop offset="0" stop-color="#3a1210"/><stop offset="0.5" stop-color="#1a0809"/><stop offset="1" stop-color="#120a0b"/>
  </radialGradient>
  <rect width="1920" height="1080" fill="url(#splashBg)"/>
  <g transform="translate(704 284) scale(1)">${art}</g>
</svg>`;
writeFileSync(`${OUT}/splash.png`, render(splash, 1920));

console.log(`icons written to ${OUT}/`);
