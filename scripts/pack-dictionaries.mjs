#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Writes the dictionaries a release publishes beside ui.zip, for filex to
// install with one click (filex 0.57, docs/APP-PLUGINS-API.md in filex,
// "Files an administrator adds to an app"): every language the Document
// Server ships that the app's bundle does not carry (scripts/editor/
// in-image.sh DICTIONARIES), its files unchanged -
//
//   dict-<lang>.aff, dict-<lang>.dic     Hunspell's (spell checking)
//   dict-hyph_<lang>.dic                 the hyphenation patterns, where it has them
//   dict-<lang>.LICENSE.txt              its licence and notice files, one after another
//
// - and their catalog, dictionaries.json (format filex-extras/1): one item a
// language, each file with where it goes (<lang>/<file>.aff.txt, the path
// the editor reads under the package's extra/dictionaries/, src/frame/
// workers.ts dictionaryUrl), its address beside the catalog, its size and
// SHA-256. filex-app.json's ui.extras.dictionaries.catalog pins the catalog
// by its SHA-256 (--manifest writes it); the files hold to their own.
//
//   node scripts/pack-dictionaries.mjs [--from dist/ds-dictionaries] [--out dist/dictionaries] [--manifest]
//
// --from is scripts/ds-dictionaries.sh's folder (its dictionaries/ in it).
// The same image gives the same files and the same catalog: no dates, no
// compression, everything sorted.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PIN_FILE } from './upstream-watch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
export const MANIFEST_FILE = path.join(ROOT, 'filex-app.json');
export const CATALOG_NAME = 'dictionaries.json';
export const CATALOG_URL = `https://github.com/BRF-Tech/filex-office-editor/releases/download/{tag}/${CATALOG_NAME}`;

/** filex's limits for a catalog (filex-extras/1). */
export const LIMITS = { catalogBytes: 1 << 20, items: 500, filesPerItem: 8, fileBytes: 128 << 20 };
/** A language folder and a file's name as filex's dictionaries kind takes them. */
const LANG = /^[A-Za-z_]{2,16}$/;
const FILE = /^[A-Za-z_]{2,32}$/;
/** In a dictionary's folder: what the editor reads, and what is neither that nor a licence or notice. */
const SKIP = /^(th_.*|META-INF|description\.xml|dictionaries\.xcu|.*\.json|.*\.dat|.*\.bak|.*\.idx)$/;

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** The languages the bundle carries: in-image.sh's DICTIONARIES default, the one list. */
export function bundledDictionaries(script = path.join(ROOT, 'scripts', 'editor', 'in-image.sh')) {
  const m = /\$\{DICTIONARIES:-([^}]+)\}/.exec(readFileSync(script, 'utf8'));
  if (!m) throw new Error(`${script}: no DICTIONARIES default`);
  return m[1].trim().split(/\s+/);
}

/**
 * The catalog and the files beside it, from a folder of the image's
 * dictionaries (one folder a language). Pure but for reading `dir`:
 * `files` maps each asset's name to its bytes.
 */
export function buildDictionaries(dir, { bundled, source }) {
  const items = [];
  const files = new Map();
  const langs = readdirSync(dir)
    .filter((n) => statSync(path.join(dir, n)).isDirectory())
    .sort();
  for (const id of langs) {
    if (bundled.includes(id)) continue;
    if (!LANG.test(id)) throw new Error(`dictionaries: a language folder filex does not take: ${id}`);
    const names = readdirSync(path.join(dir, id)).sort();
    const read = (n) => readFileSync(path.join(dir, id, n));
    const item = { id, license: `see dict-${id}.LICENSE.txt`, files: [] };
    for (const n of [`${id}.aff`, `${id}.dic`, `hyph_${id}.dic`]) {
      if (!names.includes(n)) {
        if (n.startsWith('hyph_')) continue;
        throw new Error(`dictionaries: ${id} has no ${n}`);
      }
      const base = n.slice(0, n.lastIndexOf('.'));
      if (!FILE.test(base)) throw new Error(`dictionaries: a file name filex does not take: ${id}/${n}`);
      const data = read(n);
      if (data.length < 1 || data.length > LIMITS.fileBytes) throw new Error(`dictionaries: ${id}/${n} is ${data.length} bytes`);
      const url = `dict-${n}`;
      files.set(url, data);
      item.files.push({ path: `${id}/${n}.txt`, url, size: data.length, sha256: sha256(data) });
    }
    if (item.files.length > LIMITS.filesPerItem) throw new Error(`dictionaries: ${id} has ${item.files.length} files`);
    // Its licence and notice files, as the image has them (their bytes
    // unchanged, whatever their encoding), one after another.
    const notices = names.filter((n) => !/\.(aff|dic)$/.test(n) && !SKIP.test(n) && statSync(path.join(dir, id, n)).isFile());
    const text = (t) => Buffer.from(`${t}\n`, 'utf8');
    const parts = [
      text(`The licence and notice files of the ${id} dictionary, as ${source} ships them, unchanged.`),
      text(`This dictionary's files: ${item.files.map((f) => f.url).join(', ')} (installed as ${item.files.map((f) => f.path).join(', ')}).`),
      text(''),
    ];
    if (notices.length === 0) parts.push(text('The image carries no licence or notice file with this dictionary. Its source: https://github.com/ONLYOFFICE/dictionaries'));
    for (const n of notices) parts.push(text(`===== ${n} =====`), read(n), text(''), text(''));
    const licence = Buffer.concat(parts);
    const licenceName = `dict-${id}.LICENSE.txt`;
    files.set(licenceName, licence);
    item.license_file = { url: licenceName, size: licence.length, sha256: sha256(licence) };
    items.push(item);
  }
  if (items.length > LIMITS.items) throw new Error(`dictionaries: ${items.length} items, more than ${LIMITS.items}`);
  const catalog = { format: 'filex-extras/1', kind: 'dictionaries', source, items };
  const bytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  if (bytes.length > LIMITS.catalogBytes) throw new Error(`dictionaries: the catalog is ${bytes.length} bytes`);
  return { catalog, bytes, files };
}

/** filex-app.json with ui.extras naming this catalog (filex 0.57). */
export function withDictionaries(manifest, catalogSha256) {
  return {
    ...manifest,
    ui: { ...manifest.ui, extras: { ...(manifest.ui?.extras ?? {}), dictionaries: { catalog: { url: CATALOG_URL, sha256: catalogSha256 } } } },
  };
}

function main() {
  const argv = process.argv.slice(2);
  let from = path.join(ROOT, 'dist', 'ds-dictionaries');
  let out = path.join(ROOT, 'dist', 'dictionaries');
  let manifest = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') from = path.resolve(argv[++i]);
    else if (argv[i] === '--out') out = path.resolve(argv[++i]);
    else if (argv[i] === '--manifest') manifest = true;
    else throw new Error('usage: node scripts/pack-dictionaries.mjs [--from DIR] [--out DIR] [--manifest]');
  }
  const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8'));
  const source = `ONLYOFFICE Docs ${pin.build} (${pin.image}@${pin.digest})`;
  const { catalog, bytes, files } = buildDictionaries(path.join(from, 'dictionaries'), { bundled: bundledDictionaries(), source });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let total = 0;
  for (const [name, data] of files) {
    writeFileSync(path.join(out, name), data);
    total += data.length;
  }
  writeFileSync(path.join(out, CATALOG_NAME), bytes);
  const sum = sha256(bytes);
  console.log(`dictionaries: ${catalog.items.length} languages, ${files.size} files (${total} bytes) and ${CATALOG_NAME} (${bytes.length} bytes, SHA-256 ${sum}) -> ${path.relative(process.cwd(), out) || out}`);
  if (manifest) {
    const m = withDictionaries(JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')), sum);
    writeFileSync(MANIFEST_FILE, `${JSON.stringify(m, null, 2)}\n`);
    console.log('filex-app.json: ui.extras.dictionaries.catalog written');
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
