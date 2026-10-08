#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Fetches the x2t WebAssembly build that upstream/onlyoffice.json pins
// (the "x2t" entry: today CryptPad's onlyoffice-x2t-wasm v9.3.2+3), checks
// the release's SHA-512 - the same check CryptPad's install-office.sh makes
// - and each of the two files' SHA-256, and puts them in dist/x2t/:
//
//   x2t.js  x2t.wasm  .version (the release)
//
// The pre-compressed copies in the release (.br) are left out: filex
// compresses what it serves. A second run with the files in place and
// matching does nothing.
//
//   node scripts/fetch-x2t.mjs                 download (GitHub) and check
//   node scripts/fetch-x2t.mjs --from x2t.zip  use a zip already here (still checked)
//   node scripts/fetch-x2t.mjs --out DIR       somewhere other than dist/x2t

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readZip } from './lib/zip.mjs';
import { PIN_FILE } from './upstream-watch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const X2T_DEFAULT_DIR = path.join(here, '..', 'dist', 'x2t');
export const X2T_FILES = ['x2t.js', 'x2t.wasm'];
// CryptPad's x2t.zip is 17 MB; anything far larger is not it.
const MAX_ZIP = 64 * 1024 * 1024;

const hash = (alg, b) => createHash(alg).update(b).digest('hex');

/** Checks the "x2t" entry of upstream/onlyoffice.json and returns it. */
export function validateX2tPin(x2t) {
  const problems = [];
  if (!x2t || typeof x2t !== 'object') throw new Error('upstream/onlyoffice.json: no "x2t" entry');
  if (!/^v\d+\.\d+\.\d+(\+\d+)?$/.test(String(x2t.release ?? ''))) problems.push('x2t.release must be vX.Y.Z or vX.Y.Z+N');
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/x2t\.zip$/.test(String(x2t.url ?? ''))) {
    problems.push('x2t.url must be a GitHub release asset named x2t.zip');
  }
  if (!/^[0-9a-f]{128}$/.test(String(x2t.sha512 ?? ''))) problems.push('x2t.sha512 must be 128 hex digits');
  if (!/^[0-9a-f]{40}$/.test(String(x2t.commit ?? ''))) problems.push('x2t.commit must be a full commit hash');
  for (const f of X2T_FILES) {
    if (!/^[0-9a-f]{64}$/.test(String(x2t.files?.[f] ?? ''))) problems.push(`x2t.files["${f}"] must be a SHA-256`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x2t.pinned ?? ''))) problems.push('x2t.pinned must be YYYY-MM-DD');
  if (problems.length) throw new Error(`upstream/onlyoffice.json: ${problems.join('; ')}`);
  return x2t;
}

export function readX2tPin(file = PIN_FILE) {
  return validateX2tPin(JSON.parse(readFileSync(file, 'utf8')).x2t);
}

/** The two files out of the release zip, each checked against the pin. */
export function extractX2t(zip, x2t) {
  const got = hash('sha512', zip);
  if (got !== x2t.sha512) throw new Error(`x2t.zip: SHA-512 ${got.slice(0, 16)}... is not the pinned ${x2t.sha512.slice(0, 16)}...`);
  const entries = readZip(zip);
  const out = {};
  for (const name of X2T_FILES) {
    const e = entries.find((x) => x.name === name);
    if (!e) throw new Error(`x2t.zip has no ${name}`);
    const data = e.read();
    const sum = hash('sha256', data);
    if (sum !== x2t.files[name]) throw new Error(`${name}: SHA-256 ${sum.slice(0, 16)}... is not the pinned ${x2t.files[name].slice(0, 16)}...`);
    out[name] = data;
  }
  return out;
}

/** Whether dir already holds the pinned build. */
export function x2tInPlace(dir, x2t) {
  try {
    if (readFileSync(path.join(dir, '.version'), 'utf8').trim() !== x2t.release) return false;
    return X2T_FILES.every((f) => hash('sha256', readFileSync(path.join(dir, f))) === x2t.files[f]);
  } catch {
    return false;
  }
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_ZIP) throw new Error(`${url}: ${len} bytes, more than an x2t build`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_ZIP) throw new Error(`${url}: ${buf.length} bytes, more than an x2t build`);
  return buf;
}

async function main() {
  const argv = process.argv.slice(2);
  let from = null;
  let dir = X2T_DEFAULT_DIR;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') from = argv[++i];
    else if (argv[i] === '--out') dir = path.resolve(argv[++i]);
    else throw new Error(`usage: node scripts/fetch-x2t.mjs [--from x2t.zip] [--out DIR]`);
  }
  const x2t = readX2tPin();
  if (!from && x2tInPlace(dir, x2t)) {
    console.log(`x2t ${x2t.release}: already in ${path.relative(process.cwd(), dir) || '.'}`);
    return;
  }
  const zip = from ? readFileSync(from) : await download(x2t.url);
  const files = extractX2t(zip, x2t);
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    const tmp = path.join(dir, `.${name}.tmp`);
    writeFileSync(tmp, data);
    renameSync(tmp, path.join(dir, name));
  }
  writeFileSync(path.join(dir, '.version'), `${x2t.release}\n`);
  const sizes = X2T_FILES.map((f) => `${f} ${files[f].length} bytes`).join(', ');
  console.log(`x2t ${x2t.release}: zip SHA-512 and both files' SHA-256 match the pin; ${sizes} -> ${path.relative(process.cwd(), dir) || '.'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}

