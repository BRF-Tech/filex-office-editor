// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor (see README.md and NOTICE).
//
// The browser measurement of the app (plan step A3): the built bundle
// (dist/ui), served the way filex 0.55 serves an app's interface
// (e2e/harness), opened in Chromium, Firefox and WebKit, headless:
//
//   - every document opens: a blank docx/xlsx/pptx (what filex's New menu
//     makes) and the Turkish documents of the x2t smoke test;
//   - text typed in the editor, then the editor's own Save (Ctrl+S in the
//     editor) and filex's Save (the host asks the app) each write a new
//     version, and the written file holds the text - and, for the Turkish
//     documents, what they held before;
//   - filex is told "unsaved changes" while there are, and not after;
//   - the network: nothing but the package (and blob:/data: addresses the
//     pages made) - no request to anywhere else, no package file missing;
//   - the storage stand-in (editor/filex/storage.js): whether the browser
//     gave the sandboxed pages storage, and whether the editor's settings
//     land in the stand-in;
//   - screenshots at 1280 and 390 px, light and dark (--shots).
//
// Needs playwright-core and its browsers (npx playwright-core install
// chromium firefox webkit), node scripts/build-app.mjs and
// node e2e/make-docs.mjs. Writes dist/e2e-report.json; exit 1 on a failure.
//
//   node e2e/run.mjs [--engines chromium,firefox,webkit] [--docs blank.docx,...] [--shots] [--keep]

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as pw from 'playwright-core';

import { readZip } from '../scripts/lib/zip.mjs';
import { startServer, APP_PATH } from './harness/server.mjs';
import { makeDocs } from './make-docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const DIST = path.join(ROOT, 'dist');
const TYPED = 'Merhaba dünya: ğüşıöç İĞÜŞÖÇ';
const OPEN_MS = 120_000;

function args(argv) {
  const o = {
    engines: ['chromium', 'firefox', 'webkit'],
    docs: ['blank.docx', 'blank.xlsx', 'blank.pptx', 'tr.docx', 'tr.xlsx', 'tr.pptx'],
    shots: false,
    keep: false,
    frameAncestors: process.env.FX_FRAME_ANCESTORS === 'star',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--engines') o.engines = argv[++i].split(',').filter(Boolean);
    else if (a === '--docs') o.docs = argv[++i].split(',').filter(Boolean);
    else if (a === '--shots') o.shots = true;
    else if (a === '--keep') o.keep = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, ms) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(250);
  }
  throw new Error(`timed out (${ms / 1000} s) waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}

const appFrame = (page) => page.frames().find((f) => f.url().includes(APP_PATH) && /\/index\.html$/.test(new URL(f.url()).pathname) && !f.url().includes('/editor/'));
const editorFrame = (page) => page.frames().find((f) => f.url().includes('/editor/web-apps/apps/') && f.url().includes('/main/index.html'));

/** The words of an office file, from the XML parts that carry them. */
function documentText(bytes, ext) {
  const parts = new Map(readZip(bytes).filter((e) => !e.isDir).map((e) => [e.name, e]));
  const pick = ext === 'docx' ? /^word\/document\.xml$/ : ext === 'xlsx' ? /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/ : /^ppt\/slides\/slide\d+\.xml$/;
  let out = '';
  for (const [name, e] of parts) {
    if (!pick.test(name)) continue;
    const xml = e.read().toString('utf8');
    // A paragraph's text is its runs' text put together: an editor may split
    // a typed line into many runs (Firefox: one per letter outside ASCII).
    const paras = xml.split(ext === 'docx' ? '</w:p>' : ext === 'pptx' ? '</a:p>' : '</si>');
    for (const p of paras) {
      const texts = [...p.matchAll(/<(?:w:t|a:t|t)(?:\s[^>]*)?>([^<]*)<\/(?:w:t|a:t|t)>/g)].map((m) => m[1]);
      out += `${texts.join('')}\n`;
    }
    out += `${xml}\n`;
  }
  return out;
}

/** Click where the kind of document takes text, and type. */
async function typeInto(page, ext) {
  const ed = editorFrame(page);
  const frame = page.frameLocator(`iframe[title]`).frameLocator('iframe[name="frameEditor"]');
  if (ext === 'docx') {
    const box = await frame.locator('#editor_sdk').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 120);
    await sleep(800);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await sleep(500);
    await page.keyboard.type(TYPED, { delay: 30 });
  } else if (ext === 'xlsx') {
    const box = await frame.locator('#ws-canvas-outer, #editor_sdk').first().boundingBox();
    // A cell well inside the sheet: below and right of the headers.
    await page.mouse.click(box.x + 260, box.y + 140);
    await sleep(800);
    await page.keyboard.type(TYPED, { delay: 30 });
    await page.keyboard.press('Enter');
  } else {
    const box = await frame.locator('#id_main_view, #editor_sdk').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.42);
    await sleep(800);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(TYPED, { delay: 30 });
    await page.mouse.click(box.x + 8, box.y + box.height - 8);
  }
  return ed;
}

async function storageReport(frame) {
  return frame.evaluate(() => {
    const out = {};
    for (const name of ['localStorage', 'sessionStorage']) {
      const d = Object.getOwnPropertyDescriptor(window, name);
      let works = false;
      let keys = -1;
      let error = '';
      try {
        const s = window[name];
        s.setItem('__fx_probe', 'ğ');
        works = s.getItem('__fx_probe') === 'ğ';
        s.removeItem('__fx_probe');
        keys = s.length;
      } catch (e) {
        error = `${e.name}: ${e.message}`.slice(0, 120);
      }
      out[name] = { standIn: !!d && 'value' in d, works, keys, error };
    }
    try {
      out.origin = window.origin;
    } catch {
      out.origin = '?';
    }
    return out;
  });
}

async function runOne(browser, server, engine, doc, o) {
  const ext = doc.slice(doc.lastIndexOf('.') + 1);
  const tag = `${engine}-${doc.replace(/\W/g, '_')}`;
  const r = { engine, doc, ok: false, steps: [], problems: [], notes: [] };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const requests = [];
  const failures = [];
  const consoleErrors = [];
  page.on('request', (q) => requests.push(q.url()));
  page.on('response', (s) => {
    if (s.status() >= 400) failures.push(`${s.status()} ${s.url()}`);
  });
  page.on('requestfailed', (q) => {
    const f = q.failure()?.errorText ?? '';
    // A navigation the page itself aborts on unload is not a failure of the app.
    if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(f)) failures.push(`failed ${q.url()} ${f}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message ?? e).slice(0, 300)}`));
  const t0 = Date.now();
  const step = (name, extra) => r.steps.push({ name, ms: Date.now() - t0, ...(extra ?? {}) });
  try {
    await page.goto(`${server.origin}/?doc=${encodeURIComponent(doc)}&locale=tr&tag=${tag}`);
    await until('the editor to open the document', async () => {
      const a = appFrame(page);
      if (!a) return false;
      const ph = await a.evaluate(() => document.documentElement.dataset.fxPhase || '');
      if (ph === 'failed') throw new Error(await a.evaluate(() => document.getElementById('fx-status-text')?.textContent || 'failed'));
      return ph === 'ready';
    }, OPEN_MS);
    step('opened');
    r.phases = {
      app: await appFrame(page).evaluate(() => window.__fxPhases || []),
      editor: await editorFrame(page).evaluate(() => window.__fxPhases || []),
    };
    r.storage = { app: await storageReport(appFrame(page)), editor: await storageReport(editorFrame(page)) };
    r.storage.editorKeys = await editorFrame(page).evaluate(() => {
      try {
        const s = window.localStorage;
        const out = [];
        for (let i = 0; i < s.length; i++) out.push(s.key(i));
        return out.sort();
      } catch {
        return null;
      }
    });
    if (o.shots) {
      mkdirSync(path.join(DIST, 'e2e-shots'), { recursive: true });
      await page.screenshot({ path: path.join(DIST, 'e2e-shots', `${tag}-1280-light.png`) });
    }

    // Edit, then the editor's Save (Ctrl+S in the editor).
    await sleep(800);
    await typeInto(page, ext);
    step('typed');
    await until('filex to be told there are unsaved changes', () => page.evaluate(() => window.__fx.dirty === true), 20_000);
    step('dirty');
    const before = server.saves.filter((s) => s.tag === tag).length;
    await page.keyboard.press('Control+S');
    const saved1 = await until('the editor Save to write the file', () => server.saves.filter((s) => s.tag === tag)[before], 60_000);
    step('saved (editor)', { bytes: saved1.size });
    await until('"unsaved changes" to clear', () => page.evaluate(() => window.__fx.dirty === false), 20_000);
    step('clean');
    const text1 = documentText(readFileSync(saved1.file), ext);
    if (!text1.includes(TYPED)) r.problems.push(`the saved ${ext} does not hold the typed text`);
    if (doc.startsWith('tr.')) {
      const TR = o.TR;
      const keep = ext === 'docx' ? [TR.title, TR.body, TR.bold, TR.italic] : ext === 'xlsx' ? [TR.cells[0], TR.cells[3]] : [TR.slideBody];
      for (const k of keep) if (!text1.includes(k)) r.problems.push(`the saved ${ext} lost "${k}"`);
    }

    // filex's Save (the host asks the app for its document).
    const before2 = server.saves.filter((s) => s.tag === tag).length;
    const answer = await page.evaluate(() => window.__fx.hostSave());
    if (answer?.error) r.problems.push(`filex's Save: ${JSON.stringify(answer.error)}`);
    const saved2 = await until("filex's Save to write the file", () => server.saves.filter((s) => s.tag === tag)[before2], 60_000);
    step('saved (filex)', { bytes: saved2.size });
    const text2 = documentText(readFileSync(saved2.file), ext);
    if (!text2.includes(TYPED)) r.problems.push(`the second save of the ${ext} does not hold the typed text`);

    if (o.shots && ext === 'docx' && doc.startsWith('tr.')) {
      await page.screenshot({ path: path.join(DIST, 'e2e-shots', `${tag}-1280-light-edited.png`) });
    }
    r.ok = r.problems.length === 0;
  } catch (e) {
    r.problems.push(String(e?.message ?? e).slice(0, 400));
    try {
      mkdirSync(path.join(DIST, 'e2e-shots'), { recursive: true });
      await page.screenshot({ path: path.join(DIST, 'e2e-shots', `${tag}-FAILED.png`) });
    } catch {
      /* the page is gone */
    }
  }
  const pkg = `${server.origin}${APP_PATH}`;
  const host = [`${server.origin}/?`, `${server.origin}/host.js`, `${server.origin}/__doc/`, `${server.origin}/__save`];
  r.requests = requests.length;
  r.outside = [...new Set(requests.filter((u) => !u.startsWith(pkg) && !u.startsWith('blob:') && !u.startsWith('data:') && !host.some((h) => u.startsWith(h))))];
  r.failures = [...new Set(failures)];
  r.consoleErrors = [...new Set(consoleErrors)];
  if (r.outside.length) r.problems.push(`requests outside the package: ${r.outside.slice(0, 5).join(', ')}`);
  if (r.failures.length) r.problems.push(`failed requests: ${r.failures.slice(0, 5).join(', ')}`);
  r.ok = r.problems.length === 0;
  await ctx.close();
  return r;
}

async function shots(browser, server, engine) {
  const out = [];
  for (const [w, h] of [
    [1280, 800],
    [390, 844],
  ]) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
      const page = await ctx.newPage();
      const name = `${engine}-tr.docx-${w}-${theme}.png`;
      try {
        await page.goto(`${server.origin}/?doc=tr.docx&locale=tr&theme=${theme}&tag=shot-${engine}-${w}-${theme}`);
        await until('the editor', async () => (await appFrame(page)?.evaluate(() => document.documentElement.dataset.fxPhase)) === 'ready', OPEN_MS);
        await sleep(1500);
        await page.screenshot({ path: path.join(DIST, 'e2e-shots', name) });
        out.push({ name, ok: true });
      } catch (e) {
        out.push({ name, ok: false, error: String(e?.message ?? e).slice(0, 200) });
      }
      await ctx.close();
    }
  }
  return out;
}

async function main() {
  const o = args(process.argv.slice(2));
  if (!existsSync(path.join(DIST, 'ui', 'index.html'))) throw new Error('dist/ui is not built: node scripts/build-app.mjs');
  o.TR = (await makeDocs()).TR;
  const outDir = path.join(DIST, 'e2e-out');
  rmSync(outDir, { recursive: true, force: true });
  if (o.shots) rmSync(path.join(DIST, 'e2e-shots'), { recursive: true, force: true });
  const server = await startServer({ port: 0, docs: path.join(DIST, 'e2e-docs'), out: outDir });
  const report = { at: new Date().toISOString(), node: process.version, typed: TYPED, engines: {}, results: [] };
  try {
    for (const engine of o.engines) {
      const browser = await pw[engine].launch({ headless: true });
      report.engines[engine] = browser.version();
      for (const doc of o.docs) {
        const r = await runOne(browser, server, engine, doc, o);
        report.results.push(r);
        const open = r.steps.find((s) => s.name === 'opened');
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${engine} ${doc}${open ? ` opened in ${(open.ms / 1000).toFixed(1)} s` : ''}${r.ok ? '' : `: ${r.problems.join('; ')}`}`);
      }
      if (o.shots) report.shots = [...(report.shots ?? []), ...(await shots(browser, server, engine))];
      await browser.close();
    }
  } finally {
    server.server.close();
  }
  writeFileSync(path.join(DIST, 'e2e-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (!o.keep) rmSync(outDir, { recursive: true, force: true });
  const failed = report.results.filter((r) => !r.ok);
  console.log(`${report.results.length - failed.length}/${report.results.length} passed (dist/e2e-report.json)`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
