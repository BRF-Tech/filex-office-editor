#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The bundle step of scripts/extract-editor.sh: from the files in-image.sh
// copied out of ONLYOFFICE's image (--raw), it makes the editor part of the
// app's bundle:
//
//   <out>/editor/            the tree (what the zip holds, under editor/)
//   <out>/editor.zip         the same files, reproducible (scripts/lib/zip.mjs)
//   <out>/editor.lock.json   every file with its SHA-256 and size, what was
//                            left out, what was changed and why, the totals
//
// and compares the lock with the committed one (upstream/editor.lock.json):
// the same image and the same rules must give the same files. Exit 0 when
// they agree (or with --update, which only writes), 3 when they differ.
//
// Every rule lives in rules.mjs; the HTML change in html.mjs.
//
//   node scripts/editor/bundle.mjs --raw DIR --out DIR [--lock FILE] [--update]

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePin } from '../upstream-watch.mjs';
import { compareNames, writeZip } from '../lib/zip.mjs';
import { fontNotices } from './fontnames.mjs';
import { inlineCodeIn, transformHtml } from './html.mjs';
import { BUDGET, CHANGES_DATED, FONT_EXCLUDE, LIMITS, checkBundle, classify, isHtml, pathOK, servedType } from './rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const PREFIX = 'editor/';
const STORAGE = 'filex/storage.js';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const mib = (n) => `${(n / 1048576).toFixed(1)} MiB`;

function args(argv) {
  const out = { update: false, lock: path.join(ROOT, 'upstream', 'editor.lock.json'), pin: path.join(ROOT, 'upstream', 'onlyoffice.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--update') out.update = true;
    else if (a === '--raw' || a === '--out' || a === '--lock' || a === '--pin') out[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.raw || !out.out) throw new Error('usage: bundle.mjs --raw DIR --out DIR [--lock FILE] [--pin FILE] [--update]');
  return out;
}

/** Every file under dir, as sorted relative paths with forward slashes. Refuses links. */
function walk(dir) {
  const out = [];
  const visit = (rel) => {
    const abs = path.join(dir, rel);
    for (const name of readdirSync(abs)) {
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(path.join(dir, r));
      if (st.isSymbolicLink()) throw new Error(`${r}: a link in the image's files; the bundle holds only files`);
      if (st.isDirectory()) visit(r);
      else if (st.isFile()) out.push(r);
    }
  };
  visit('');
  return out.sort(compareNames);
}

const posixRelative = (fromDir, to) => path.posix.relative(fromDir, to);

/** core-fonts-licenses/<family>/FONTS.txt: what each font of a family says about itself. */
function fontsNotice(raw, family) {
  const dir = path.join(raw, 'core-fonts-src', family);
  const files = walk(dir).filter((f) => /\.(ttf|otf|ttc)$/i.test(f));
  if (!files.length) return null;
  const lines = [
    `The fonts of the core-fonts family "${family}" (ONLYOFFICE core-fonts, as the`,
    'Document Server image carries them), with the notices each font carries in',
    "its own name table. The editor's fonts/ folder holds them in the encoded",
    'form the Document Server serves; the fonts themselves are unchanged.',
    '',
  ];
  for (const f of files) {
    const notices = fontNotices(readFileSync(path.join(dir, f)));
    for (const n of notices.length ? notices : [{}]) {
      lines.push(`${f}${n.name ? ` - ${n.name}` : ''}`);
      lines.push(`  Copyright: ${n.copyright ?? '(none in the font)'}`);
      lines.push(`  License: ${n.license ?? '(none in the font)'}`);
      if (n.licenseUrl) lines.push(`  License URL: ${n.licenseUrl}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function buildBundle({ raw, pin }) {
  const version = readFileSync(path.join(raw, 'ds-version'), 'utf8').trim();
  const expected = pin.build.replace(/\.(\d+)$/, '-$1');
  if (version !== expected) throw new Error(`the image holds onlyoffice-documentserver ${version}, the pin says build ${pin.build} (${expected})`);

  const files = new Map();
  const changed = {};
  const added = {};
  const dropped = {};
  const put = (p, data) => {
    if (files.has(p)) throw new Error(`${p}: two files with one name`);
    files.set(p, data);
  };

  // ds-version and core-fonts-src/ are in-image.sh's notes to this step,
  // not files of the image's editor.
  for (const rel of walk(raw)) {
    if (rel === 'ds-version' || rel.startsWith('core-fonts-src/')) continue;
    const c = classify(rel);
    if (c.action === 'drop') {
      const d = (dropped[c.why] ??= { files: 0, bytes: 0 });
      d.files++;
      d.bytes += lstatSync(path.join(raw, rel)).size;
      continue;
    }
    const to = c.action === 'rename' ? c.to : rel;
    if (c.action === 'rename') changed[to] = `renamed from ${rel}: ${c.why}`;
    if (!servedType(to)) throw new Error(`${rel}: filex does not serve this extension and no rule says what to do with it (scripts/editor/rules.mjs)`);
    put(to, readFileSync(path.join(raw, rel)));
  }

  // The HTML pages: inline code out, the storage stand-in first.
  const pages = [...files.keys()].filter(isHtml);
  for (const p of pages) {
    const buf = files.get(p);
    const text = buf.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(buf)) throw new Error(`${p}: not UTF-8; the build would change bytes it does not mean to`);
    const dir = path.posix.dirname(p);
    const r = transformHtml(text, { name: path.posix.basename(p), storage: posixRelative(dir, STORAGE) });
    if (!r.changes.length) continue;
    files.set(p, Buffer.from(r.html, 'utf8'));
    changed[p] = `${r.changes.join('; ')} (${CHANGES_DATED})`;
    for (const s of r.scripts) {
      const sp = `${dir}/${s.file}`;
      put(sp, Buffer.from(s.body, 'utf8'));
      added[sp] = `the inline script of ${p}, unchanged, moved to a file (${CHANGES_DATED})`;
    }
  }

  put(STORAGE, readFileSync(path.join(here, 'storage.js')));
  added[STORAGE] = 'this project: an in-memory localStorage for pages the browser gives none (scripts/editor/storage.js)';

  const families = existsSync(path.join(raw, 'core-fonts-src'))
    ? readdirSync(path.join(raw, 'core-fonts-src')).filter((f) => lstatSync(path.join(raw, 'core-fonts-src', f)).isDirectory()).sort(compareNames)
    : [];
  for (const fam of families) {
    const text = fontsNotice(raw, fam);
    if (!text) continue;
    const p = `core-fonts-licenses/${fam}/FONTS.txt`;
    put(p, Buffer.from(text, 'utf8'));
    added[p] = "this project: the notices inside the family's fonts, read from the fonts";
  }

  const notes = [
    `Files of this bundle that are not as ONLYOFFICE ships them (${CHANGES_DATED}, by BRF Tech, filex-office-editor).`,
    'The bundle is based on ONLYOFFICE Docs by Ascensio System SIA; this version has been modified.',
    '',
    'Changed:',
    ...Object.keys(changed).sort(compareNames).map((p) => `  ${p}: ${changed[p]}`),
    '',
    'Added:',
    ...Object.keys(added).sort(compareNames).map((p) => `  ${p}: ${added[p]}`),
    '',
    'Left out of the image:',
    ...Object.keys(dropped).sort().map((w) => `  ${w}: ${dropped[w].files} files`),
    '',
  ].join('\n');
  put('filex/CHANGES.txt', Buffer.from(notes, 'utf8'));
  added['filex/CHANGES.txt'] = 'this project: this list, inside the bundle';

  // What filex will hold the bundle to, before anything is written.
  const problems = [];
  const folded = new Map();
  for (const [p, data] of files) {
    if (!pathOK(PREFIX + p)) problems.push(`${p}: not a clean relative path`);
    const low = p.toLowerCase();
    if (folded.has(low)) problems.push(`${folded.get(low)} and ${p} differ only in case`);
    folded.set(low, p);
    if (isHtml(p)) problems.push(...inlineCodeIn(data.toString('utf8'), p));
  }
  if (problems.length) throw new Error(`the bundle would not run under filex:\n  ${problems.join('\n  ')}`);

  return { files, changed, added, dropped, version };
}

export function lockOf({ files, changed, added, dropped, version }, pin, zip, toolchain) {
  const names = [...files.keys()].sort(compareNames);
  let bytes = 0;
  let largest = { path: '', bytes: 0 };
  const list = {};
  for (const p of names) {
    const d = files.get(p);
    bytes += d.length;
    if (d.length > largest.bytes) largest = { path: p, bytes: d.length };
    list[p] = `${sha256(d)} ${d.length}`;
  }
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort(compareNames).map((k) => [k, o[k]]));
  return {
    about:
      'Written by scripts/extract-editor.sh: the editor files the bundle takes from ONLYOFFICE\'s Document Server image (upstream/onlyoffice.json), each with its SHA-256 and size, under "editor/" in the zip. A build that differs from this file fails; --update writes it.',
    onlyoffice: { version: pin.version, build: pin.build, package: version, image: `${pin.image}@${pin.digest}`, source_tag: pin.source_tag },
    rules: { changes_dated: CHANGES_DATED, font_exclude: FONT_EXCLUDE },
    toolchain,
    bundle: {
      prefix: PREFIX,
      files: names.length,
      bytes,
      zip_bytes: zip.length,
      zip_sha256: sha256(zip),
      largest,
    },
    changed: sorted(changed),
    added: sorted(added),
    dropped: Object.fromEntries(Object.keys(dropped).sort().map((k) => [k, dropped[k]])),
    files: list,
  };
}

/** The differences between two lock files, in words (empty: the same). */
export function diffLocks(a, b) {
  const out = [];
  for (const k of ['onlyoffice', 'rules', 'toolchain', 'bundle']) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out.push(`${k}: ${JSON.stringify(a?.[k])} -> ${JSON.stringify(b?.[k])}`);
  }
  const fa = a?.files ?? {};
  const fb = b?.files ?? {};
  for (const p of Object.keys(fb)) if (!(p in fa)) out.push(`+ ${p}`);
  for (const p of Object.keys(fa)) if (!(p in fb)) out.push(`- ${p}`);
  for (const p of Object.keys(fa)) if (p in fb && fa[p] !== fb[p]) out.push(`~ ${p}`);
  for (const k of ['changed', 'added', 'dropped']) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out.push(`${k} differs`);
  }
  return out;
}

function main() {
  const opt = args(process.argv.slice(2));
  const pin = validatePin(JSON.parse(readFileSync(opt.pin, 'utf8')));
  const t0 = Date.now();
  const built = buildBundle({ raw: opt.raw, pin });

  const outTree = path.join(opt.out, 'editor');
  rmSync(outTree, { recursive: true, force: true });
  for (const [p, data] of built.files) {
    const abs = path.join(outTree, ...p.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  }
  const zip = writeZip([...built.files].map(([p, data]) => ({ name: PREFIX + p, data })));
  writeFileSync(path.join(opt.out, 'editor.zip'), zip);

  const toolchain = {
    node: process.version,
    zlib: process.versions.zlib,
    ...(process.env.NODE_IMAGE ? { node_image: process.env.NODE_IMAGE } : {}),
  };
  const lock = lockOf(built, pin, zip, toolchain);
  const text = `${JSON.stringify(lock, null, 2)}\n`;
  writeFileSync(path.join(opt.out, 'editor.lock.json'), text);

  const entries = [...built.files].map(([p, d]) => ({ name: PREFIX + p, size: d.length }));
  const problems = checkBundle(entries, zip.length);
  const b = lock.bundle;
  console.log(`editor bundle: ${b.files} files, ${mib(b.bytes)} unpacked, ${mib(b.zip_bytes)} zipped (${b.zip_bytes} bytes), sha256 ${b.zip_sha256}`);
  console.log(`largest file: ${b.largest.path} (${mib(b.largest.bytes)}); built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`changed ${Object.keys(lock.changed).length} files, added ${Object.keys(lock.added).length}, left out ${Object.values(lock.dropped).reduce((n, d) => n + d.files, 0)}`);
  if (b.zip_bytes > BUDGET.zipBytes || b.files > BUDGET.files) {
    console.log(`note: more than the editor part aims for (${BUDGET.zipBytes / 1e6} MB zipped, ${BUDGET.files} files); filex's limits are what refuse`);
  }
  if (problems.length) {
    console.error(`filex would refuse this bundle:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  if (opt.update) {
    console.log('lock file written (--update)');
    return;
  }
  if (!existsSync(opt.lock)) {
    console.error(`no committed lock file (${path.relative(ROOT, opt.lock)}); run with --update to write the first one`);
    process.exit(3);
  }
  const committed = JSON.parse(readFileSync(opt.lock, 'utf8'));
  const diff = diffLocks(committed, lock);
  if (diff.length) {
    console.error(`the bundle differs from ${path.relative(ROOT, opt.lock)}:\n  ${diff.slice(0, 60).join('\n  ')}${diff.length > 60 ? `\n  ... ${diff.length - 60} more` : ''}`);
    process.exit(3);
  }
  console.log(`same as ${path.relative(ROOT, opt.lock)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}
