#!/usr/bin/env node
/**
 * Writes the Homebrew Channel manifest for the package built by
 * `npm run package`: out/org.malagueta.app.manifest.json.
 *
 * The webOS Homebrew Channel reads this file to find the current version and
 * its .ipk, e.g. from a repository like your own webos-repo. Upload both
 * files to the same GitHub release:
 *
 *   out/org.malagueta.app_<version>_all.ipk
 *   out/org.malagueta.app.manifest.json
 *
 * `ipkUrl` is relative to the manifest, so it always points at the .ipk of
 * the same release. `ipkHash` is the SHA-256 of that exact file: rebuild the
 * package and the manifest must be written again (`npm run package` does both).
 *
 * Usage: node scripts/manifest.mjs   (or: npm run manifest)
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the project lives; also the source the store links to. */
const SOURCE_URL = 'https://github.com/pustal/Malagueta';
/** Direct link to the icon image (not a github.com ".../blob/..." page). */
const ICON_URI = 'https://raw.githubusercontent.com/pustal/Malagueta/main/assets/icons/largeIcon.png';
/** One line shown in the Homebrew Channel's list. */
const DESCRIPTION = 'Adult website viewer with ad and pop-up blocking, made for the remote';

const appinfo = JSON.parse(readFileSync(join(root, 'appinfo.json'), 'utf8'));
const ipkName = `${appinfo.id}_${appinfo.version}_all.ipk`;
const ipkPath = join(root, 'out', ipkName);
if (!existsSync(ipkPath)) {
  console.error(`${ipkName} not found in out/. Run "npm run package" first.`);
  process.exit(1);
}

const sha256 = createHash('sha256').update(readFileSync(ipkPath)).digest('hex');

// Same fields, in the same order, as the Homebrew Channel's own manifest.
const manifest = {
  id: appinfo.id,
  version: appinfo.version,
  type: appinfo.type,
  title: appinfo.title,
  appDescription: DESCRIPTION,
  iconUri: ICON_URI,
  sourceUrl: SOURCE_URL,
  // A plain web app: no root, no services.
  rootRequired: false,
  ipkUrl: ipkName,
  ipkHash: { sha256 },
};

const outPath = join(root, 'out', `${appinfo.id}.manifest.json`);
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote out/${appinfo.id}.manifest.json for ${ipkName} (sha256 ${sha256.slice(0, 12)}…)`);
