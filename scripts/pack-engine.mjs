#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Writes engine.zip, the office engine a release attaches beside ui.zip:
// what filex runs on the server, without a browser, for the conversions apps
// ask for and office thumbnails (filex's engines.office, 0.57; docs/SERVER.md
// "How filex runs it"):
//
//   x2t-server.wasm            scripts/x2t/build.sh --server (dist/x2t/), checked
//                              against upstream/onlyoffice.json x2t.files
//   layout-host.wasm           server/layout/host/build.sh (dist/layout/), checked
//                              against engine.files
//   layout/worker.js           server/layout/worker.js, this repository's
//   layout/fonts_ie.js         scripts/engine-ds-files.sh (dist/layout/), from the
//   layout/xregexp-all-min.js  pinned Document Server image, checked against
//                              engine.files
//
//   node scripts/pack-engine.mjs [--out dist/engine.zip] [--x2t DIR] [--layout DIR] [--manifest]
//
//   --manifest  also writes the zip's SHA-256 into filex-app.json
//               (engines.office.sha256), as a release commit does
//
// The zip is written the way the app's bundle is (scripts/lib/zip.mjs:
// sorted, one date, deflate level 9), so in the pinned Node image (README.md,
// "Building a release") it comes out byte for byte the same.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeZip } from './lib/zip.mjs';
import { PIN_FILE } from './upstream-watch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
export const MANIFEST_FILE = path.join(ROOT, 'filex-app.json');
/** The entries of engine.zip, in the order filex's contract lists them. */
export const ENGINE_ENTRIES = ['x2t-server.wasm', 'layout-host.wasm', 'layout/worker.js', 'layout/fonts_ie.js', 'layout/xregexp-all-min.js'];
/** The entries pinned in upstream/onlyoffice.json "engine" (x2t-server.wasm is x2t's, worker.js is this repository's). */
export const ENGINE_PINNED = ['layout-host.wasm', 'layout/fonts_ie.js', 'layout/xregexp-all-min.js'];

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;

/** The "engine" entry of upstream/onlyoffice.json, checked. */
export function validateEnginePin(pin) {
  const problems = [];
  const e = pin?.engine;
  if (!e || typeof e !== 'object') throw new Error('upstream/onlyoffice.json: no "engine" entry');
  for (const f of ENGINE_PINNED) if (!HEX64.test(String(e.files?.[f] ?? ''))) problems.push(`engine.files["${f}"] must be a SHA-256`);
  if (!HEX64.test(String(pin?.x2t?.files?.['x2t-server.wasm'] ?? ''))) problems.push('x2t.files["x2t-server.wasm"] must be a SHA-256');
  if (problems.length) throw new Error(`upstream/onlyoffice.json: ${problems.join('; ')}`);
  return { ...e.files, 'x2t-server.wasm': pin.x2t.files['x2t-server.wasm'] };
}

/** engine.zip from its files (by entry name), each pinned one checked first. */
export function packEngine(files, pinned) {
  for (const name of ENGINE_ENTRIES) {
    const data = files[name];
    if (!data) throw new Error(`engine.zip: no ${name}`);
    if (pinned[name] && sha256(data) !== pinned[name]) {
      throw new Error(`${name}: SHA-256 ${sha256(data).slice(0, 16)}... is not the pinned ${pinned[name].slice(0, 16)}...`);
    }
  }
  return writeZip(ENGINE_ENTRIES.map((name) => ({ name, data: files[name] })));
}

/** filex-app.json with engines.office naming this zip (url by the release's tag). */
export function withEngine(manifest, zipSha256) {
  return {
    ...manifest,
    engines: {
      office: {
        url: 'https://github.com/BRF-Tech/filex-office-editor/releases/download/{tag}/engine.zip',
        sha256: zipSha256,
        editor: 'editor',
      },
    },
  };
}

function main() {
  const argv = process.argv.slice(2);
  let out = path.join(ROOT, 'dist', 'engine.zip');
  let x2tDir = path.join(ROOT, 'dist', 'x2t');
  let layoutDir = path.join(ROOT, 'dist', 'layout');
  let manifest = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = path.resolve(argv[++i]);
    else if (argv[i] === '--x2t') x2tDir = path.resolve(argv[++i]);
    else if (argv[i] === '--layout') layoutDir = path.resolve(argv[++i]);
    else if (argv[i] === '--manifest') manifest = true;
    else throw new Error('usage: node scripts/pack-engine.mjs [--out dist/engine.zip] [--x2t DIR] [--layout DIR] [--manifest]');
  }
  const pinned = validateEnginePin(JSON.parse(readFileSync(PIN_FILE, 'utf8')));
  const files = {
    'x2t-server.wasm': readFileSync(path.join(x2tDir, 'x2t-server.wasm')),
    'layout-host.wasm': readFileSync(path.join(layoutDir, 'layout-host.wasm')),
    'layout/worker.js': readFileSync(path.join(ROOT, 'server', 'layout', 'worker.js')),
    'layout/fonts_ie.js': readFileSync(path.join(layoutDir, 'fonts_ie.js')),
    'layout/xregexp-all-min.js': readFileSync(path.join(layoutDir, 'xregexp-all-min.js')),
  };
  const zip = packEngine(files, pinned);
  writeFileSync(out, zip);
  const sum = sha256(zip);
  console.log(`engine.zip: ${path.relative(process.cwd(), out) || out}, ${zip.length} bytes, SHA-256 ${sum}`);
  if (manifest) {
    const m = withEngine(JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')), sum);
    writeFileSync(MANIFEST_FILE, `${JSON.stringify(m, null, 2)}\n`);
    console.log('filex-app.json: engines.office.sha256 written');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}
