/**
 * Build script for Malagueta.
 *
 * Produces the two parts of the webOS package:
 *
 *   dist/app/       the web app: index.html (launcher), launcher.js, icons
 *   dist/service/   the JS service: the proxy (services/proxy/*.js), its data
 *                   (sites.json, blocklist.json) and public/, the files the
 *                   proxy serves: the home screen and the page script
 *                   injected into sites (inject.js)
 *
 * Browser code is transpiled to Chromium 53 so it runs on webOS 4.x (2018)
 * TVs and newer. The service code is plain Node 8-compatible JavaScript and
 * is copied as is.
 *
 * Usage:
 *   node build.mjs                 production build (minified)
 *   node build.mjs --dev           unminified, with inline source maps
 *   node build.mjs --dev --watch   rebuild on every change
 */
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

/** Oldest browser engine supported: webOS 4.x ships Chromium 53. */
const TARGET = ['chrome53'];

const appinfo = JSON.parse(readFileSync('appinfo.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const servicePkg = JSON.parse(readFileSync('services/proxy/package.json', 'utf8'));
for (const [name, v] of [['package.json', pkg.version], ['services/proxy/package.json', servicePkg.version]]) {
  if (v !== appinfo.version) console.warn(`! appinfo.json version (${appinfo.version}) differs from ${name} (${v})`);
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/app', { recursive: true });
mkdirSync('dist/service/public', { recursive: true });
mkdirSync('dist/service/data', { recursive: true });

/** Copies everything that doesn't need bundling. */
function copyStatic() {
  // App
  cpSync('index.html', 'dist/app/index.html');
  cpSync('appinfo.json', 'dist/app/appinfo.json');
  // assets/icons/source holds the SVG original; only the generated PNGs ship.
  cpSync('assets/icons', 'dist/app/icons', { recursive: true, filter: (src) => !/[\\/]source([\\/]|$)/.test(src) });

  // Service: the proxy code, minus tests, plus the shared data.
  for (const f of readdirSync('services/proxy')) {
    if (/\.(js|json)$/.test(f)) cpSync(`services/proxy/${f}`, `dist/service/${f}`);
  }
  // Keep the service's version in step with the app's.
  writeFileSync('dist/service/package.json', `${JSON.stringify({ ...servicePkg, version: appinfo.version }, null, 2)}\n`);
  cpSync('src/shared/sites.json', 'dist/service/data/sites.json');
  cpSync('src/shared/blocklist.json', 'dist/service/data/blocklist.json');
  cpSync('src/home/home.html', 'dist/service/public/home.html');
  writeFileSync('dist/service/public/icon.svg', readSvg('assets/icons/source/malagueta.svg'));
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

/** esbuild plugin that re-copies static files after every (re)build. */
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
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  loader: { '.woff2': 'file', '.woff': 'file' },
  plugins: [svgPlugin],
  define: {
    __APP_VERSION__: JSON.stringify(appinfo.version),
    __DEV__: String(dev),
  },
  logLevel: 'warning',
};

const builds = [
  { ...common, entryPoints: { launcher: 'src/launcher/main.js' }, outdir: 'dist/app' },
  // home.js imports home.css, so esbuild writes home.css next to it.
  { ...common, entryPoints: { home: 'src/home/main.js' }, outdir: 'dist/service/public', assetNames: 'fonts/[name]-[hash]' },
  // The page script runs inside third-party sites: never inline source maps
  // there, the files are big and the sites' own tools would trip over them.
  { ...common, sourcemap: false, entryPoints: { inject: 'src/inject/main.js' }, outdir: 'dist/service/public', plugins: [svgPlugin, staticPlugin] },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
  console.log('watching for changes…');
} else {
  for (const b of builds) await esbuild.build(b);
}
