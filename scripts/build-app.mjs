#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Builds the app's interface bundle - the ui.zip filex installs - from
//
//   dist/editor/   the editor files (scripts/extract-editor.sh), each checked
//                  against upstream/editor.lock.json
//   dist/x2t/      the converter (scripts/fetch-x2t.mjs), checked against
//                  upstream/onlyoffice.json
//   src/, app/     this project's code and the app page
//
// into dist/ui/ (the tree) and dist/ui.zip:
//
//   index.html, filex/app.css, filex/app.js   the app page (src/app)
//   filex/x2t-worker.js                       the converter's worker (src/worker)
//   x2t/x2t.js, x2t/x2t.wasm                  the converter
//   editor/...                                ONLYOFFICE's editor files, as
//                                             locked, but for one:
//   editor/web-apps/vendor/socketio/socket.io.min.js
//                                             the editor page's script
//                                             (src/frame): the bridge in place
//                                             of a Document Server's socket
//   LICENSE, NOTICE                           this project's
//
// The output is reproducible for a given Node (deflate's bytes depend on the
// zlib that makes them; scripts/extract-editor.sh says more): esbuild is
// pinned in package-lock.json, nothing in the output carries a date or a
// path of the machine it was built on.
//
//   node scripts/build-app.mjs [--editor DIR] [--x2t DIR] [--out DIR] [--no-zip]

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { inlineCodeIn } from './editor/html.mjs';
import { LIMITS, checkBundle, isHtml } from './editor/rules.mjs';
import { validateX2tPin, X2T_FILES } from './fetch-x2t.mjs';
import { compareNames, writeZip } from './lib/zip.mjs';
import { validatePin } from './upstream-watch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
/** Where ONLYOFFICE's editor pages load socket.io from (RequireJS module "socketio"). */
export const SOCKET_IO = 'web-apps/vendor/socketio/socket.io.min.js';
export const EDITOR_PREFIX = 'editor/';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const mib = (n) => `${(n / 1048576).toFixed(1)} MiB`;

function args(argv) {
  const out = {
    editor: path.join(ROOT, 'dist', 'editor'),
    x2t: path.join(ROOT, 'dist', 'x2t'),
    out: path.join(ROOT, 'dist'),
    zip: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--editor' || a === '--x2t' || a === '--out') out[a.slice(2)] = path.resolve(argv[++i]);
    else if (a === '--no-zip') out.zip = false;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

/** Every file under dir, as sorted relative paths with forward slashes. Refuses links. */
function walk(dir) {
  const out = [];
  const visit = (rel) => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(path.join(dir, r));
      if (st.isSymbolicLink()) throw new Error(`${r}: a link; the bundle holds only files`);
      if (st.isDirectory()) visit(r);
      else if (st.isFile()) out.push(r);
    }
  };
  visit('');
  return out.sort(compareNames);
}

/** The editor files, each as the lock file says (no file more, none less, none changed). */
export function readEditor(dir, lock) {
  if (!existsSync(dir)) throw new Error(`${dir}: no editor files; run bash scripts/extract-editor.sh`);
  const files = new Map();
  const problems = [];
  const listed = new Set(Object.keys(lock.files));
  for (const p of walk(dir)) {
    const want = lock.files[p];
    if (!want) {
      problems.push(`+ ${p} (not in the lock)`);
      continue;
    }
    listed.delete(p);
    const data = readFileSync(path.join(dir, ...p.split('/')));
    if (`${sha256(data)} ${data.length}` !== want) problems.push(`~ ${p} (differs from the lock)`);
    files.set(p, data);
  }
  for (const p of listed) problems.push(`- ${p} (in the lock, missing here)`);
  if (problems.length) {
    throw new Error(`the editor files are not the locked ones (upstream/editor.lock.json):\n  ${problems.slice(0, 40).join('\n  ')}${problems.length > 40 ? `\n  ... ${problems.length - 40} more` : ''}`);
  }
  return files;
}

/** The converter's two files, each as the pin says. */
export function readX2t(dir, x2t) {
  const files = new Map();
  for (const f of X2T_FILES) {
    const p = path.join(dir, f);
    if (!existsSync(p)) throw new Error(`${p}: missing; run node scripts/fetch-x2t.mjs`);
    const data = readFileSync(p);
    if (sha256(data) !== x2t.files[f]) throw new Error(`${p}: not the pinned ${f} (upstream/onlyoffice.json x2t.files)`);
    files.set(f, data);
  }
  return files;
}

/** The three scripts of this project, bundled. */
export async function bundleScripts({ pin, version }) {
  const number = Number(pin.build.split('.').pop());
  const define = {
    __OO_BUILD__: JSON.stringify({ version: pin.version, number }),
    __OO_SOURCE_TAG__: JSON.stringify(pin.source_tag),
    __APP_VERSION__: JSON.stringify(version),
  };
  const entries = {
    'filex/app.js': 'src/app/main.ts',
    'filex/x2t-worker.js': 'src/worker/x2t-worker.ts',
    [EDITOR_PREFIX + SOCKET_IO]: 'src/frame/main.ts',
  };
  const out = new Map();
  for (const [to, from] of Object.entries(entries)) {
    const r = await build({
      absWorkingDir: ROOT,
      entryPoints: [from],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: ['es2020'],
      charset: 'utf8',
      legalComments: 'inline',
      minify: false,
      sourcemap: false,
      define,
      logLevel: 'silent',
    });
    if (r.errors.length) throw new Error(`${from}: ${r.errors.map((e) => e.text).join('; ')}`);
    const banner =
      `/* filex-office-editor ${version} - ${to}, built from ${from} (scripts/build-app.mjs).\n` +
      ' * SPDX-License-Identifier: AGPL-3.0-or-later. Source: https://github.com/BRF-Tech/filex-office-editor */\n';
    out.set(to, Buffer.from(banner + r.outputFiles[0].text, 'utf8'));
  }
  return out;
}

const CHANGES_APP = (version) =>
  [
    '',
    `Replaced by this project's app build (scripts/build-app.mjs, filex-office-editor ${version}):`,
    `  ${SOCKET_IO}: ONLYOFFICE's copy of the socket.io client (Socket.IO 4.5.3, MIT) is replaced by this`,
    "    project's editor-page script (src/frame/main.ts): the editor's socket is answered in the page,",
    '    by the bridge, instead of by a Document Server. No other editor file is changed by it.',
    '',
    'Added by it:',
    "  themes.json: an empty list of custom themes, which the editor asks a Document Server for on every opening.",
    '  plugins.json: an empty list of plugins, which the phone editors (web-apps/apps/*/mobile) ask a Document Server for.',
    '',
  ].join('\n');

export async function buildApp(o) {
  const pin = validatePin(JSON.parse(readFileSync(path.join(ROOT, 'upstream', 'onlyoffice.json'), 'utf8')));
  const x2tPin = validateX2tPin(pin.x2t);
  const lock = JSON.parse(readFileSync(path.join(ROOT, 'upstream', 'editor.lock.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'filex-app.json'), 'utf8'));
  const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

  const files = new Map();
  const put = (p, data) => {
    if (files.has(p)) throw new Error(`${p}: two files with one name`);
    files.set(p, data);
  };

  for (const [p, data] of readEditor(o.editor, lock)) {
    if (p === SOCKET_IO || p === 'filex/CHANGES.txt') continue;
    put(EDITOR_PREFIX + p, data);
  }
  if (!lock.files[SOCKET_IO]) throw new Error(`the editor files have no ${SOCKET_IO}: the editor pages would not load the bridge`);
  const changes = readFileSync(path.join(o.editor, 'filex', 'CHANGES.txt'), 'utf8');
  put(`${EDITOR_PREFIX}filex/CHANGES.txt`, Buffer.from(changes + CHANGES_APP(version), 'utf8'));
  // The editor asks for a Document Server's list of custom themes on every
  // opening (../../../../themes.json); there are none.
  if (lock.files['themes.json']) throw new Error('the editor files hold a themes.json; the build would replace it');
  put(`${EDITOR_PREFIX}themes.json`, Buffer.from(`${JSON.stringify({ themes: [] })}\n`, 'utf8'));
  // The phone editors (web-apps/apps/*/mobile) load a Document Server's
  // plugin list (../../../../plugins.json) whatever the configuration says;
  // there are none (plugins are off).
  if (lock.files['plugins.json']) throw new Error('the editor files hold a plugins.json; the build would replace it');
  put(`${EDITOR_PREFIX}plugins.json`, Buffer.from(`${JSON.stringify({ pluginsData: [] })}\n`, 'utf8'));

  for (const [p, data] of await bundleScripts({ pin, version })) put(p, data);
  for (const [f, data] of readX2t(o.x2t, x2tPin)) put(`x2t/${f}`, data);
  for (const p of walk(path.join(ROOT, 'app'))) put(p, readFileSync(path.join(ROOT, 'app', ...p.split('/'))));
  put('LICENSE', readFileSync(path.join(ROOT, 'LICENSE')));
  put('NOTICE', readFileSync(path.join(ROOT, 'NOTICE')));

  // What filex will hold the bundle and the manifest to.
  const problems = [];
  for (const [p, data] of files) if (isHtml(p) && !p.startsWith(EDITOR_PREFIX)) problems.push(...inlineCodeIn(data.toString('utf8'), p));
  for (const v of manifest.views ?? []) if (v.ui && !files.has(v.ui)) problems.push(`filex-app.json: view ${v.id} opens ${v.ui}, which the bundle does not hold`);
  for (const n of manifest.new_documents ?? []) {
    if (!files.has(n.template)) problems.push(`filex-app.json: the new ${n.ext} copies ${n.template}, which the bundle does not hold`);
    else if (files.get(n.template).length > 16 * 1024 * 1024) problems.push(`${n.template}: a template over 16 MiB`);
  }
  if (problems.length) throw new Error(`the bundle would not work under filex:\n  ${problems.join('\n  ')}`);
  return { files, version, pin };
}

function main() {
  const o = args(process.argv.slice(2));
  const t0 = Date.now();
  buildApp(o)
    .then(({ files, version }) => {
      const names = [...files.keys()].sort(compareNames);
      const tree = path.join(o.out, 'ui');
      rmSync(tree, { recursive: true, force: true });
      let bytes = 0;
      for (const p of names) {
        const abs = path.join(tree, ...p.split('/'));
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, files.get(p));
        bytes += files.get(p).length;
      }
      let zipBytes = 0;
      let zipSha = '';
      if (o.zip) {
        const zip = writeZip(names.map((name) => ({ name, data: files.get(name) })));
        writeFileSync(path.join(o.out, 'ui.zip'), zip);
        zipBytes = zip.length;
        zipSha = sha256(zip);
      }
      const entries = names.map((name) => ({ name, size: files.get(name).length }));
      const problems = checkBundle(entries, zipBytes);
      console.log(`ui bundle ${version}: ${names.length} files, ${mib(bytes)} unpacked${o.zip ? `, ${mib(zipBytes)} zipped (${zipBytes} bytes), sha256 ${zipSha}` : ''}`);
      console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)} s (node ${process.version}, zlib ${process.versions.zlib}); filex's limit ${mib(LIMITS.zipBytes)} zipped`);
      if (problems.length) {
        console.error(`filex would refuse this bundle:\n  ${problems.join('\n  ')}`);
        process.exit(1);
      }
    })
    .catch((e) => {
      console.error(String(e?.message ?? e));
      process.exit(1);
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
