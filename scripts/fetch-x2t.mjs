#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Puts the x2t WebAssembly build that upstream/onlyoffice.json pins (the
// "x2t" entry) in dist/x2t/, after checking each of its two files against
// the pinned SHA-256:
//
//   x2t.js  x2t.wasm  .version (the build's release)
//
// The build is this project's own, from ONLYOFFICE core at the editor's tag:
// bash scripts/x2t/build.sh makes it (about 20 minutes; README.md, "x2t, the
// converter") and puts it in dist/x2t itself. This script takes a build made
// elsewhere: a directory holding the two files (--dir), a zip of them
// (--from), or, once a release publishes one, the zip the pin names (its
// "url", checked against its "sha512" first). A second run with the files in
// place and matching does nothing.
//
//   node scripts/fetch-x2t.mjs                  the pinned zip, if one is published
//   node scripts/fetch-x2t.mjs --dir DIR        x2t.js and x2t.wasm from DIR (still checked)
//   node scripts/fetch-x2t.mjs --from x2t.zip   a zip already here (still checked)
//   node scripts/fetch-x2t.mjs --out DIR        somewhere other than dist/x2t

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readZip } from './lib/zip.mjs';
import { PIN_FILE } from './upstream-watch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const X2T_DEFAULT_DIR = path.join(here, '..', 'dist', 'x2t');
export const X2T_FILES = ['x2t.js', 'x2t.wasm'];
// x2t zipped is about 17 MB; anything far larger is not it.
const MAX_ZIP = 64 * 1024 * 1024;

const hash = (alg, b) => createHash(alg).update(b).digest('hex');
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Checks the "x2t" entry of upstream/onlyoffice.json and returns it. */
export function validateX2tPin(x2t) {
  const problems = [];
  if (!x2t || typeof x2t !== 'object') throw new Error('upstream/onlyoffice.json: no "x2t" entry');
  if (!/^v\d+(\.\d+){2,3}(\+\d+)?$/.test(String(x2t.release ?? ''))) problems.push('x2t.release must be vX.Y.Z[.N] or vX.Y.Z[.N]+B');
  for (const f of X2T_FILES) {
    if (!HEX64.test(String(x2t.files?.[f] ?? ''))) problems.push(`x2t.files["${f}"] must be a SHA-256`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x2t.pinned ?? ''))) problems.push('x2t.pinned must be YYYY-MM-DD');
  // How it is built (scripts/x2t/): the toolchain by digest, every source by commit.
  const b = x2t.build;
  if (!b || typeof b !== 'object') problems.push('x2t.build is missing');
  else {
    if (!/^sha256:[0-9a-f]{64}$/.test(String(b.toolchain?.digest ?? ''))) problems.push('x2t.build.toolchain.digest must be sha256:<64 hex>');
    if (!/^\d+\.\d+\.\d+$/.test(String(b.toolchain?.emsdk ?? ''))) problems.push('x2t.build.toolchain.emsdk must be X.Y.Z');
    if (!/^\d{8}T\d{6}Z$/.test(String(b.toolchain?.apt_snapshot ?? ''))) problems.push('x2t.build.toolchain.apt_snapshot must be YYYYMMDDTHHMMSSZ');
    for (const name of ['core', 'build_tools', 'hyphen', 'openssl']) {
      const s = b.sources?.[name];
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\.git$/.test(String(s?.repository ?? ''))) problems.push(`x2t.build.sources.${name}.repository must be a GitHub repository`);
      if (!HEX40.test(String(s?.commit ?? ''))) problems.push(`x2t.build.sources.${name}.commit must be a full commit hash`);
    }
    if (!/^https:\/\/\S+\.tar\.bz2$/.test(String(b.sources?.boost?.url ?? ''))) problems.push('x2t.build.sources.boost.url must be a .tar.bz2');
    if (!HEX64.test(String(b.sources?.boost?.sha256 ?? ''))) problems.push('x2t.build.sources.boost.sha256 must be a SHA-256');
  }
  // A published zip of the build is optional; if there is one, it is pinned whole.
  if (x2t.url !== undefined || x2t.sha512 !== undefined) {
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+\.zip$/.test(String(x2t.url ?? ''))) {
      problems.push('x2t.url must be a GitHub release asset (.zip)');
    }
    if (!/^[0-9a-f]{128}$/.test(String(x2t.sha512 ?? ''))) problems.push('x2t.sha512 must be 128 hex digits');
  }
  if (problems.length) throw new Error(`upstream/onlyoffice.json: ${problems.join('; ')}`);
  return x2t;
}

export function readX2tPin(file = PIN_FILE) {
  return validateX2tPin(JSON.parse(readFileSync(file, 'utf8')).x2t);
}

/** The two files, each checked against the pin. */
export function checkX2tFiles(files, x2t) {
  for (const name of X2T_FILES) {
    const data = files[name];
    if (!data) throw new Error(`no ${name}`);
    const sum = hash('sha256', data);
    if (sum !== x2t.files[name]) throw new Error(`${name}: SHA-256 ${sum.slice(0, 16)}... is not the pinned ${x2t.files[name].slice(0, 16)}...`);
  }
  return files;
}

/** The two files out of a zip of the build, the zip checked first if the pin names one. */
export function extractX2t(zip, x2t) {
  if (x2t.sha512) {
    const got = hash('sha512', zip);
    if (got !== x2t.sha512) throw new Error(`x2t zip: SHA-512 ${got.slice(0, 16)}... is not the pinned ${x2t.sha512.slice(0, 16)}...`);
  }
  const entries = readZip(zip);
  const out = {};
  for (const name of X2T_FILES) {
    const e = entries.find((x) => x.name === name);
    if (!e) throw new Error(`the zip has no ${name}`);
    out[name] = e.read();
  }
  return checkX2tFiles(out, x2t);
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
  let fromDir = null;
  let dir = X2T_DEFAULT_DIR;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') from = argv[++i];
    else if (argv[i] === '--dir') fromDir = path.resolve(argv[++i]);
    else if (argv[i] === '--out') dir = path.resolve(argv[++i]);
    else throw new Error(`usage: node scripts/fetch-x2t.mjs [--dir DIR | --from x2t.zip] [--out DIR]`);
  }
  const x2t = readX2tPin();
  if (!from && !fromDir && x2tInPlace(dir, x2t)) {
    console.log(`x2t ${x2t.release}: already in ${path.relative(process.cwd(), dir) || '.'}`);
    return;
  }
  let files;
  if (fromDir) files = checkX2tFiles(Object.fromEntries(X2T_FILES.map((f) => [f, readFileSync(path.join(fromDir, f))])), x2t);
  else if (from) files = extractX2t(readFileSync(from), x2t);
  else if (x2t.url) files = extractX2t(await download(x2t.url), x2t);
  else {
    throw new Error(
      `x2t ${x2t.release} is not in ${path.relative(process.cwd(), dir) || '.'} and no zip of it is published yet: ` +
        'build it with "bash scripts/x2t/build.sh" (docker, about 20 minutes), or give one with --dir DIR or --from x2t.zip',
    );
  }
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    const tmp = path.join(dir, `.${name}.tmp`);
    writeFileSync(tmp, data);
    renameSync(tmp, path.join(dir, name));
  }
  writeFileSync(path.join(dir, '.version'), `${x2t.release}\n`);
  const sizes = X2T_FILES.map((f) => `${f} ${files[f].length} bytes`).join(', ');
  console.log(`x2t ${x2t.release}: both files' SHA-256 match the pin; ${sizes} -> ${path.relative(process.cwd(), dir) || '.'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
