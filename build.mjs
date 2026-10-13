/**
 * Build script for Malagueta.
 *
 * Produces dist/, the web app packaged for the TV:
 *
 *   index.html, home.js, home.css, fonts/   the home screen (src/home)
 *   webOSUserScripts/userScript.js          injected by webOS into every
 *                                           site the app opens (src/userscript)
 *   appinfo.json, icons/
 *
 * Everything is transpiled to Chromium 53 so it runs on webOS 4.x (2018)
 * TVs and newer.
 *
 * Usage:
 *   node build.mjs                 production build (minified)
 *   node build.mjs --dev           unminified, source maps for the home screen, and
 *                                  dist/malagueta.user.js for testing in a desktop browser
 *   node build.mjs --dev --watch   rebuild on every change
 */
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

/** Oldest browser engine supported: webOS 4.x ships Chromium 53. */
const TARGET = ['chrome53'];

const appinfo = JSON.parse(readFileSync('appinfo.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (appinfo.version !== pkg.version) {
  console.warn(`! appinfo.json version (${appinfo.version}) differs from package.json (${pkg.version})`);
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

/** Copies the files that don't need bundling. */
function copyStatic() {
  cpSync('index.html', 'dist/index.html');
  cpSync('appinfo.json', 'dist/appinfo.json');
  // assets/icons/source holds the SVG original; only the generated PNGs ship.
  cpSync('assets/icons', 'dist/icons', { recursive: true, filter: (src) => !/[\\/]source([\\/]|$)/.test(src) });
}

/** An SVG without its <metadata> block (provenance data some tools add), which pages don't need. */
function readSvg(file) {
  return readFileSync(file, 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/g, '');
}

/** Lets the browser code `import svg from '….svg'` as a string, metadata removed. */
const svgPlugin = {
  name: 'svg',
  setup(build) {
    build.onLoad({ filter: /\.svg$/ }, (args) => ({ contents: readSvg(args.path), loader: 'text' }));
  },
};

/**
 * With --dev, also writes dist/malagueta.user.js: the same user script with a
 * header for Tampermonkey/Violentmonkey, to try it on sites in a desktop
 * browser (keys: arrows, Enter, Escape = Back, F9-F12 = coloured buttons).
 */
const userscriptHeaderPlugin = {
  name: 'userscript-header',
  setup(build) {
    build.onEnd((result) => {
      if (!dev || result.errors.length) return;
      const header = [
        '// ==UserScript==',
        '// @name         Malagueta (dev)',
        `// @version      ${appinfo.version}`,
        '// @description  Malagueta user script, for testing in a desktop browser',
        '// @match        *://*/*',
        '// @run-at       document-start',
        '// @grant        none',
        '// ==/UserScript==',
        '',
      ].join('\n');
      writeFileSync('dist/malagueta.user.js', header + readFileSync('dist/webOSUserScripts/userScript.js', 'utf8'));
    });
  },
};

/** Re-copies static files after every (re)build. */
const staticPlugin = {
  name: 'static',
  setup(build) {
    build.onEnd((result) => {
      copyStatic();
      if (result.errors.length === 0) console.log(`[${new Date().toLocaleTimeString()}] built dist/`);
    });
  },
};

const common = {
  bundle: true,
  target: TARGET,
  format: 'iife',
  minify: !dev,
  legalComments: 'none',
  loader: { '.woff2': 'file', '.woff': 'file' },
  define: {
    __APP_VERSION__: JSON.stringify(appinfo.version),
    __DEV__: String(dev),
  },
  logLevel: 'warning',
};

const builds = [
  // home.js imports home.css, so esbuild writes home.css next to it.
  {
    ...common,
    entryPoints: { home: 'src/home/main.js' },
    outdir: 'dist',
    assetNames: 'fonts/[name]-[hash]',
    sourcemap: dev ? 'inline' : false,
    plugins: [svgPlugin],
  },
  // Runs inside third-party sites: no source maps there, the sites' own
  // tooling would trip over them.
  {
    ...common,
    entryPoints: { userScript: 'src/userscript/main.js' },
    outdir: 'dist/webOSUserScripts',
    sourcemap: false,
    plugins: [svgPlugin, staticPlugin, userscriptHeaderPlugin],
  },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
  console.log('watching for changes…');
} else {
  for (const b of builds) await esbuild.build(b);
}
