#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// What a release's files are held to (scripts/release.sh): the pins in
// filex-app.json (ui.bundle, engines.office, ui.extras' dictionaries catalog)
// and upstream/onlyoffice.json ("x2t": url, sha512), and the release's
// assets.
//
//   node scripts/release-pins.mjs write  VERSION [--dist DIR]
//       pin the files in DIR (default dist/) for VERSION: ui.bundle's url
//       and SHA-256, x2t's url and SHA-512 (engines.office and the catalog
//       are written by pack-engine.mjs and pack-dictionaries.mjs --manifest)
//   node scripts/release-pins.mjs check  VERSION [--dist DIR]
//       every file in DIR against the pins; exit 1 and every mismatch said
//   node scripts/release-pins.mjs assets VERSION [--dist DIR]
//       the release's assets, one a line: name, path (from the
//       repository's root), SHA-256
//   node scripts/release-pins.mjs notes  VERSION
//       the release's notes: VERSION's section of CHANGELOG.md
//
// Nothing here touches the network; release.sh does the uploading.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
export const REPO = 'BRF-Tech/filex-office-editor';

const sha = (alg, data) => createHash(alg).update(data).digest('hex');

/** An asset's address in VERSION's release. */
export function releaseUrl(version, name, repo = REPO) {
  return `https://github.com/${repo}/releases/download/v${version}/${name}`;
}

/** X.Y.Z, nothing else. */
export function isVersion(v) {
  return /^\d+\.\d+\.\d+$/.test(String(v ?? ''));
}

/** filex-app.json and upstream/onlyoffice.json with VERSION's ui.zip and x2t.zip pinned. */
export function withReleasePins(manifest, pin, { version, uiSha256, x2tSha512 }) {
  if (!isVersion(version)) throw new Error(`not a version: ${version}`);
  return {
    manifest: { ...manifest, ui: { ...manifest.ui, bundle: { ...manifest.ui?.bundle, url: releaseUrl(version, 'ui.zip'), sha256: uiSha256 } } },
    pin: { ...pin, x2t: { ...pin.x2t, url: releaseUrl(version, 'x2t.zip'), sha512: x2tSha512 } },
  };
}

/** VERSION's section of CHANGELOG.md, without its heading; null when there is none. */
export function changelogSection(text, version) {
  const lines = String(text).split('\n');
  const head = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

/**
 * Every problem between a release's files and the pins: `files` holds what
 * was built - the zips' sums, the catalog as text, and each dictionary
 * file's size and SHA-256 by its name. An empty list: they agree.
 */
export function releaseProblems({ version, manifest, pin, files }) {
  const p = [];
  if (manifest.version !== version) p.push(`filex-app.json version is ${manifest.version}, not ${version}`);
  const bundle = manifest.ui?.bundle ?? {};
  if (bundle.url !== releaseUrl(version, 'ui.zip')) p.push(`filex-app.json ui.bundle.url is ${bundle.url}, not ${releaseUrl(version, 'ui.zip')}`);
  if (bundle.sha256 !== files.uiSha256) p.push(`ui.zip: SHA-256 ${files.uiSha256}, filex-app.json pins ${bundle.sha256}`);
  const engine = manifest.engines?.office ?? {};
  if (engine.sha256 !== files.engineSha256) p.push(`engine.zip: SHA-256 ${files.engineSha256}, filex-app.json pins ${engine.sha256}`);
  if (pin.x2t?.url !== releaseUrl(version, 'x2t.zip')) p.push(`upstream/onlyoffice.json x2t.url is ${pin.x2t?.url}, not ${releaseUrl(version, 'x2t.zip')}`);
  if (pin.x2t?.sha512 !== files.x2tSha512) p.push(`x2t.zip: SHA-512 ${files.x2tSha512}, upstream/onlyoffice.json pins ${pin.x2t?.sha512}`);
  const cat = manifest.ui?.extras?.dictionaries?.catalog;
  if (cat) {
    if (cat.sha256 !== files.catalogSha256) p.push(`dictionaries.json: SHA-256 ${files.catalogSha256}, filex-app.json pins ${cat.sha256}`);
    let catalog = null;
    try {
      catalog = JSON.parse(files.catalog);
    } catch {
      p.push('dictionaries.json: not JSON');
    }
    for (const item of catalog?.items ?? []) {
      for (const f of [...(item.files ?? []), ...(item.license_file ? [item.license_file] : [])]) {
        const got = files.dictionaries[f.url];
        if (!got) p.push(`${f.url}: in the catalog, not built`);
        else if (got.size !== f.size || got.sha256 !== f.sha256) p.push(`${f.url}: ${got.size} bytes ${got.sha256}, the catalog says ${f.size} ${f.sha256}`);
      }
    }
  }
  return p;
}

/** The release's assets: [name, path], ui.zip, engine.zip, x2t.zip, then the catalog and its files. */
export function releaseAssets(dist, manifest) {
  const out = [
    ['ui.zip', path.join(dist, 'ui.zip')],
    ['engine.zip', path.join(dist, 'engine.zip')],
    ['x2t.zip', path.join(dist, 'x2t.zip')],
  ];
  if (manifest.ui?.extras?.dictionaries) {
    const dir = path.join(dist, 'dictionaries');
    for (const n of readdirSync(dir).sort()) out.push([n, path.join(dir, n)]);
  }
  return out;
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}
function writeJson(p, v) {
  writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
}

function builtFiles(dist) {
  const read = (n) => readFileSync(path.join(dist, n));
  const dictDir = path.join(dist, 'dictionaries');
  const dictionaries = {};
  if (existsSync(dictDir)) {
    for (const n of readdirSync(dictDir)) {
      if (n === 'dictionaries.json') continue;
      const b = readFileSync(path.join(dictDir, n));
      dictionaries[n] = { size: statSync(path.join(dictDir, n)).size, sha256: sha('sha256', b) };
    }
  }
  const catalogPath = path.join(dictDir, 'dictionaries.json');
  const catalog = existsSync(catalogPath) ? readFileSync(catalogPath) : Buffer.alloc(0);
  return {
    uiSha256: sha('sha256', read('ui.zip')),
    engineSha256: sha('sha256', read('engine.zip')),
    x2tSha512: sha('sha512', read('x2t.zip')),
    catalogSha256: sha('sha256', catalog),
    catalog: catalog.toString('utf8'),
    dictionaries,
  };
}

function main() {
  const [cmd, version, ...rest] = process.argv.slice(2);
  let dist = path.join(ROOT, 'dist');
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--dist') dist = path.resolve(rest[++i]);
    else throw new Error('usage: node scripts/release-pins.mjs write|check|assets|notes VERSION [--dist DIR]');
  }
  if (!isVersion(version)) throw new Error(`usage: node scripts/release-pins.mjs ${cmd ?? 'check'} X.Y.Z [--dist DIR] (got ${version})`);
  const manifestPath = path.join(ROOT, 'filex-app.json');
  const pinPath = path.join(ROOT, 'upstream', 'onlyoffice.json');
  if (cmd === 'notes') {
    const s = changelogSection(readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
    if (!s) throw new Error(`CHANGELOG.md has no "## [${version}] - <date>" section`);
    process.stdout.write(`${s}\n`);
    return;
  }
  const manifest = readJson(manifestPath);
  const pin = readJson(pinPath);
  if (cmd === 'write') {
    const f = builtFiles(dist);
    const next = withReleasePins(manifest, pin, { version, uiSha256: f.uiSha256, x2tSha512: f.x2tSha512 });
    writeJson(manifestPath, next.manifest);
    writeJson(pinPath, next.pin);
    console.log(`pinned for ${version}: ui.zip ${f.uiSha256}, x2t.zip ${f.x2tSha512.slice(0, 16)}...`);
    return;
  }
  if (cmd === 'check') {
    const problems = releaseProblems({ version, manifest, pin, files: builtFiles(dist) });
    if (problems.length) {
      for (const p of problems) console.error(`MISMATCH ${p}`);
      process.exit(1);
    }
    console.log(`every release file of ${version} matches its pin`);
    return;
  }
  if (cmd === 'assets') {
    for (const [name, p] of releaseAssets(dist, manifest)) console.log(`${name}\t${path.relative(ROOT, p)}\t${sha('sha256', readFileSync(p))}`);
    return;
  }
  throw new Error('usage: node scripts/release-pins.mjs write|check|assets|notes VERSION [--dist DIR]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}
