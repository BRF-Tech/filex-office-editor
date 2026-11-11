// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor (see README.md and NOTICE).
//
// The browser measurement of the app (plan steps A3 and after): the built bundle
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
//   - one person counts one: the bridge's keeper is not in the editor's list
//     of people, and no "2" shows in the header;
//   - Download as (the Turkish documents): the File menu offers what x2t
//     writes here (src/formats.ts), the OpenDocument copy and the PDF come
//     to filex (ui.download) holding the typed text / pages and fonts, a
//     txt (the document) and a csv (the workbook) come through the editor's
//     own dialog - which offers only the encodings x2t writes here - in
//     UTF-8 with every Turkish letter, and Print hands filex a PDF to print
//     (the ui.print stand-in);
//   - the settings, once per engine: a "New" hint closed in one opening is
//     kept (state.set) and does not show in the next one; and Print where
//     filex has no print (print=none) hands the PDF over as a download;
//   - a phone, once per engine (390 x 844, a phone's user agent, touch):
//     ONLYOFFICE's phone app opens the document to read, its Download (PDF)
//     and Print reach filex, a format x2t does not write here is refused and
//     said, "Edit" opens the editor folded and its save holds the typed
//     text, "Reading view" goes back (phoneRun);
//   - a formula, once per engine for each kind of odt (formula.odt with the
//     frame style LibreOffice gives a formula, formula-nostyle.odt without):
//     in the editor's own document the formula is in the line where the
//     frame is - at the end of the first sentence, between the words of the
//     second - and no floating shape (formulaRun, #220);
//   - x2t stopping, once per engine: a document x2t stops on (stops.docx, an
//     OFD package under a .docx name) ends the opening with the app's own
//     error, in the person's language and with why, and the page stays
//     "failed" after the editor would have been ready (stopRun, #220);
//   - an encrypted folder, once per engine (encryptedRun, filex 0.56's
//     `encrypted_folders`): the document filex hands over in the clear opens
//     and saves, the server receives only ciphertext (`filexe2e`), and what
//     it holds decrypts with the folder key to a document holding the typed
//     text; on filex 0.55 the app says the document is encrypted instead of
//     asking for it;
//   - two people on one document, once per engine (filex 0.56's coedit.*,
//     through the harness's relay stand-in): both editors join the same
//     session and count two people, what one types reaches the other's
//     bridge (the same changes), both bridges hold the same locks, a save by
//     the one who did not type holds the other's text and is written into
//     the log with how far it reaches (`through`), a third person who may
//     only read follows in ONLYOFFICE's live viewer and sees the typed text
//     before anybody saves (read from her editor's document), neither is told
//     "unsaved changes" while the other may save, and when one leaves the
//     other counts one again; a document x2t stops on, opened together,
//     stays "failed" and its member leaves the session (togetherRun);
//   - "About this editor", the notice ONLYOFFICE's terms ask for (src/app/about.ts):
//     at every opening above, the button in the corner of the editor - shown,
//     named, its colours apart enough, over no control of the editor's (on a
//     phone in the footer, off the frame) - and no line under the editor;
//     once per engine, light and dark, on a computer and a phone (aboutRun):
//     the first Tab reaches it, Enter or a tap opens the notice whole with
//     the source address at this version's tag as plain text - no link, a
//     click on it opens no page and asks filex for nothing, a drag across it
//     selects it - Escape and the close button close it;
//   - screenshots at 1280 and 390 px, light and dark, and on a phone (--shots).
//
// Needs playwright-core and its browsers (npx playwright-core install
// chromium firefox webkit), node scripts/build-app.mjs and
// node e2e/make-docs.mjs. Writes dist/e2e-report.json; exit 1 on a failure.
//
//   node e2e/run.mjs [--engines chromium,firefox,webkit] [--docs blank.docx,...] [--shots] [--keep] [--no-settings] [--no-phone] [--no-formula] [--no-stop] [--no-encrypted] [--no-together] [--no-about]

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
/** What the File menu's Download as offers for each kind (src/formats.ts; DOCM/XLSM/PPTM only for those files). */
const DOWNLOAD_AS = {
  docx: [0x0041, 0x0201, 0x0043, 0x004c, 0x0209, 0x004f, 0x0044, 0x0045],
  xlsx: [0x0101, 0x0103, 0x0104, 0x0201, 0x0106, 0x010a, 0x0209],
  pptx: [0x0081, 0x0084, 0x0201, 0x0083, 0x0087, 0x0209, 0x008a],
};
/** The text each kind is downloaded as too, through the editor's TXT or CSV dialog (src/formats.ts). */
const TEXT_DOWNLOAD = {
  docx: { id: 0x0045, ext: 'txt' },
  xlsx: { id: 0x0104, ext: 'csv' },
};
/**
 * The encodings that dialog offers: the ones x2t writes a txt or a csv in
 * here (src/formats.ts TEXT_ENCODINGS) - for a txt UTF-8 alone, for a csv
 * (from x2t v9.4.0.129+3, which carries ICU's conversion tables) the
 * editor's whole list, in its own order (ONLYOFFICE 10.0.0.169's: 53 code
 * pages, 52 after 27). This list said [46, 48, 49, 50, 51] until 0.5.0:
 * 0.4.0's release was not run in the browsers.
 */
const TEXT_ENCODINGS = { txt: [46], csv: [...Array.from({ length: 28 }, (_, i) => i), 52, ...Array.from({ length: 24 }, (_, i) => 28 + i)] };
/** The OpenDocument kin of each, and its type: the copy the measurement downloads. */
const ODF = {
  docx: { id: 0x0043, ext: 'odt', mime: 'application/vnd.oasis.opendocument.text' },
  xlsx: { id: 0x0103, ext: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
  pptx: { id: 0x0083, ext: 'odp', mime: 'application/vnd.oasis.opendocument.presentation' },
};
const NAMESPACE = { docx: 'DE', xlsx: 'SSE', pptx: 'PE' };

function args(argv) {
  const o = {
    engines: ['chromium', 'firefox', 'webkit'],
    docs: ['blank.docx', 'blank.xlsx', 'blank.pptx', 'tr.docx', 'tr.xlsx', 'tr.pptx'],
    shots: false,
    keep: false,
    settings: true,
    phone: true,
    formula: true,
    stop: true,
    encrypted: true,
    together: true,
    about: true,
    frameAncestors: process.env.FX_FRAME_ANCESTORS === 'star',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--engines') o.engines = argv[++i].split(',').filter(Boolean);
    else if (a === '--docs') o.docs = argv[++i].split(',').filter(Boolean);
    else if (a === '--shots') o.shots = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--no-settings') o.settings = false;
    else if (a === '--no-phone') o.phone = false;
    else if (a === '--no-formula') o.formula = false;
    else if (a === '--no-stop') o.stop = false;
    else if (a === '--no-encrypted') o.encrypted = false;
    else if (a === '--no-together') o.together = false;
    else if (a === '--no-about') o.about = false;
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

/** A PDF's pages and embedded fonts, read from its objects (a check, not a parser). */
function pdfFacts(bytes) {
  const text = bytes.toString('latin1');
  return {
    pdf: text.startsWith('%PDF-'),
    pages: (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length,
    fonts: (text.match(/\/FontFile[23]?\b/g) ?? []).length,
  };
}

/** The words of an OpenDocument file: its content.xml without tags. */
function odfText(bytes) {
  const e = readZip(bytes).find((x) => x.name === 'content.xml');
  return e ? e.read().toString('utf8').replace(/<[^>]+>/g, '') : '';
}

function odfMime(bytes) {
  const e = readZip(bytes).find((x) => x.name === 'mimetype');
  return e ? e.read().toString('utf8') : '';
}

const editorLocator = (page) => page.frameLocator('iframe[title]').frameLocator('iframe[name="frameEditor"]');

/** One person in the editor's list: the keeper is not counted, the header shows no "2". */
async function people(page, ext) {
  return editorFrame(page).evaluate((ns) => {
    const users = window[ns].getCollection('Common.Collections.Users');
    const box = document.querySelector('#tlb-box-users');
    return { visible: users.getVisibleEditingCount(), all: users.length, badge: !!box && !!box.offsetParent };
  }, NAMESPACE[ext]);
}

/**
 * What a document editor shows, read from its own document, and whether it
 * is in view mode and ONLYOFFICE's live viewer. ONLYOFFICE 10.0's sdkjs
 * renames its internals (CDocument, isViewMode, isLiveViewer: src/frame/
 * sdk.ts), so the document is read through its document builder API (the
 * one macros and plugins use, which keeps its names: on the editor's API in
 * 9.4, AscBuilder.Word.Api in 10.0) and the two modes from
 * what web-apps set the editor to (Main's appOptions and its co-editing
 * setting: asc_setViewMode, asc_SetFastCollaborative).
 */
async function viewerFacts(page) {
  return editorFrame(page).evaluate(() => {
    const api = (window.Asc && window.Asc.editor) || window.editor;
    let text = '';
    let error;
    try {
      // The builder API: the editor's own in 9.4, AscBuilder.Word.Api in 10.0.
      const word = window.AscBuilder && window.AscBuilder.Word && window.AscBuilder.Word.Api;
      const builder = word && typeof word.GetDocument === 'function' ? word : api;
      const doc = builder && typeof builder.GetDocument === 'function' ? builder.GetDocument() : null;
      if (doc) text = doc.GetAllParagraphs().map((p) => String(p.GetText())).join('\n');
      else error = 'no builder API';
    } catch (e) {
      text = '';
      error = String(e && e.message ? e.message : e).slice(0, 200);
    }
    const main = window.DE && window.DE.getController('Main');
    const opts = (main && main.appOptions) || {};
    const fast = window.Common && window.Common.Utils.InternalSettings.get('de-settings-coauthmode');
    return {
      text,
      error,
      viewMode: !opts.isEdit && !opts.isRestrictedEdit && !!main,
      liveViewer: !!opts.canLiveView && !!fast,
    };
  });
}

/**
 * Close a page as a person closes the tab: its beforeunload and pagehide
 * handlers run. Playwright 1.59's WebKit leaves the page open after
 * close({ runBeforeUnload: true }) - measured even for a page with no
 * handler at all - so there, after a moment, the page is closed without
 * them (the relay then drops the member whose stream closed, as filex does
 * a member whose page went away). Returns how the page was closed.
 */
async function closeTab(page) {
  await page.close({ runBeforeUnload: true });
  const end = Date.now() + 2000;
  while (!page.isClosed() && Date.now() < end) await sleep(100);
  if (page.isClosed()) return 'closed';
  await page.close();
  return 'closed without beforeunload';
}

/** Wait for the next file the app hands filex (ui.download, or the ui.print stand-in). */
async function nextFile(server, tag, before, what) {
  return until(what, () => server.files.filter((f) => f.tag === tag)[before], 60_000);
}

/** File → Download as: the formats on offer, then one of them chosen. */
async function downloadAs(page, format) {
  const ed = editorLocator(page);
  await ed.locator('[data-tab="file"]').click();
  await ed.locator('#fm-btn-download').click();
  await ed.locator('#panel-saveas .btn-doc-format').first().waitFor({ state: 'visible', timeout: 15_000 });
  const offered = await ed.locator('#panel-saveas .btn-doc-format').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => Number(e.getAttribute('format'))));
  await ed.locator(`#panel-saveas .btn-doc-format[format="${format}"]`).click();
  // The editor's own warning for some formats (an .ods may lose formulas): go on.
  try {
    await ed.locator('.asc-window .footer button[result="ok"]').first().click({ timeout: 2500 });
  } catch {
    /* no warning for this format */
  }
  return offered;
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

/**
 * Content Security Policy violations in the app's pages. filex serves an
 * app's pages without 'unsafe-inline' (backend/internal/wasmplugin/
 * uipolicy.go; the harness serves the same policy): a violation is code the
 * bundle carries that filex refuses - 0.5.0's was api.js's empty inline
 * onmousewheel on the editor's iframe, now left out by the build
 * (scripts/editor/rules.mjs EDITS). Each page of the context reports the
 * securitypolicyviolation events of its frames on the console; cspIn keeps
 * those of the package's own pages.
 */
const CSP_TAG = 'FXCSP ';
async function watchCsp(ctx) {
  await ctx.addInitScript((tag) => {
    document.addEventListener(
      'securitypolicyviolation',
      (e) => {
        let target = '';
        try {
          target = e.target && e.target.outerHTML ? e.target.outerHTML.slice(0, 160) : '';
        } catch {
          target = '';
        }
        console.log(tag + JSON.stringify({ page: String(location.href), directive: e.effectiveDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber, target }));
      },
      true,
    );
  }, CSP_TAG);
}
function collectCsp(page, into) {
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith(CSP_TAG)) into.push(JSON.parse(t.slice(CSP_TAG.length)));
  });
}
function cspIn(list, server) {
  const pkg = `${server.origin}${APP_PATH}`;
  return list.filter((v) => String(v.page).startsWith(pkg)).map((v) => `${v.directive} ${v.blocked} at ${String(v.source).replace(pkg, '')}:${v.line} ${v.target}`.slice(0, 300));
}

/**
 * Waits until the editor page has no Download as or Print waiting for the
 * app page (src/frame/main.ts __fxBridge.exports). The harness has a file as
 * soon as the app page hands it over, a moment before the editor hears the
 * export is over; until then the editor holds its long action, and an
 * asc_Print (or asc_DownloadAs) in that moment returns without a word
 * (sdkjs: isLongAction) - Firefox's tr.xlsx run then waited 60 s for a
 * print that never came (2026-11-08). A person cannot press Print then: the
 * editor's mask is up.
 */
async function exportsSettled(frame) {
  await until("the editor's last export to end", async () => (await frame.evaluate(() => (window.__fxBridge ? window.__fxBridge.exports() : 0))) === 0, 30_000);
}

async function runOne(browser, server, engine, doc, o) {
  const ext = doc.slice(doc.lastIndexOf('.') + 1);
  const tag = `${engine}-${doc.replace(/\W/g, '_')}`;
  const r = { engine, doc, ok: false, steps: [], problems: [], notes: [] };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  await watchCsp(ctx);
  const page = await ctx.newPage();
  const requests = [];
  const failures = [];
  const consoleErrors = [];
  const csp = [];
  collectCsp(page, csp);
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
    const about = await aboutChecks(page, editorFrame(page), { phone: false });
    r.about = about.facts;
    r.problems.push(...about.problems);
    r.phases = {
      app: await appFrame(page).evaluate(() => window.__fxPhases || []),
      editor: await editorFrame(page).evaluate(() => window.__fxPhases || []),
    };
    r.people = await people(page, ext);
    if (r.people.visible !== 1 || r.people.badge) r.problems.push(`the editor counts ${r.people.visible} people (badge shown: ${r.people.badge}); one person should count one`);
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

    if (doc.startsWith('tr.')) {
      // Download as: the OpenDocument copy, then the PDF, from the File menu.
      const odf = ODF[ext];
      let n = server.files.filter((f) => f.tag === tag).length;
      const offered = await downloadAs(page, odf.id);
      r.downloadAs = offered;
      if (JSON.stringify(offered) !== JSON.stringify(DOWNLOAD_AS[ext])) r.problems.push(`Download as offers ${offered.join(',')}, not ${DOWNLOAD_AS[ext].join(',')}`);
      const got = await nextFile(server, tag, n++, `the ${odf.ext} download`);
      const bytes = readFileSync(got.file);
      step(`download ${odf.ext}`, { bytes: got.size });
      if (got.how !== 'download' || !got.name.endsWith(`.${odf.ext}`)) r.problems.push(`the ${odf.ext} came as ${got.how} ${got.name}`);
      if (odfMime(bytes) !== odf.mime) r.problems.push(`the ${odf.ext} is not one (${odfMime(bytes) || 'no mimetype'})`);
      if (!odfText(bytes).includes(TYPED)) r.problems.push(`the ${odf.ext} does not hold the typed text`);

      await downloadAs(page, 0x0201);
      const pdfFile = await nextFile(server, tag, n++, 'the PDF download');
      const facts = pdfFacts(readFileSync(pdfFile.file));
      step('download pdf', { bytes: pdfFile.size, ...facts });
      r.pdf = facts;
      if (!facts.pdf || facts.pages < 1 || facts.fonts < 1) r.problems.push(`the PDF is not right: ${JSON.stringify(facts)}`);

      // A txt or csv: the editor's own dialog (the encoding; a csv's
      // delimiter), with UTF-8 - its default - taken as it is.
      const text = TEXT_DOWNLOAD[ext];
      if (text) {
        await downloadAs(page, text.id);
        const dialog = editorLocator(page).locator('.asc-window:has(#id-codepages-combo)');
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        const encodings = await dialog.locator('#id-codepages-combo li[data-value]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-value'))));
        r.textEncodings = encodings;
        const offeredEnc = TEXT_ENCODINGS[text.ext];
        if (JSON.stringify(encodings) !== JSON.stringify(offeredEnc)) r.problems.push(`the ${text.ext} dialog offers the encodings ${encodings.join(',')}, not ${offeredEnc.join(',')}`);
        await dialog.locator('.footer button[result="ok"]').click();
        const got = await nextFile(server, tag, n++, `the ${text.ext} download`);
        const bytes = readFileSync(got.file);
        const utf8 = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
        const body = utf8 ? bytes.subarray(3).toString('utf8') : '';
        const TR = o.TR;
        const want = ext === 'docx' ? [TYPED, TR.title, TR.body, TR.bold, TR.italic, ...TR.cells] : [TYPED, ...TR.cells];
        const missing = want.filter((t) => !body.includes(t));
        step(`download ${text.ext}`, { bytes: got.size, utf8, encodings, missing: missing.length });
        if (got.how !== 'download' || !got.name.endsWith(`.${text.ext}`)) r.problems.push(`the ${text.ext} came as ${got.how} ${got.name}`);
        if (!utf8) r.problems.push(`the ${text.ext} is not UTF-8 with its BOM`);
        if (missing.length) r.problems.push(`the ${text.ext} does not hold ${JSON.stringify(missing)}`);
      }

      // Print: the editor's own call, as its File menu and Ctrl+P make it,
      // once the last download has ended in the editor.
      await exportsSettled(editorFrame(page));
      await editorFrame(page).evaluate(() => {
        const api = (window.Asc && window.Asc.editor) || window.editor;
        api.asc_Print(new window.Asc.asc_CDownloadOptions(null, true));
      });
      const printed = await nextFile(server, tag, n++, 'the PDF to print');
      step('print', { bytes: printed.size });
      if (printed.how !== 'print' || !pdfFacts(readFileSync(printed.file)).pdf) r.problems.push(`Print gave filex ${printed.how} ${printed.name}`);
      const toasts = await page.evaluate(() => window.__fx.toasts);
      if (toasts.some((t) => t && t.tone === 'error')) r.problems.push(`filex was told: ${JSON.stringify(toasts)}`);
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
  const host = [`${server.origin}/?`, `${server.origin}/host.js`, `${server.origin}/__doc/`, `${server.origin}/__save`, `${server.origin}/__file`];
  r.requests = requests.length;
  r.outside = [...new Set(requests.filter((u) => !u.startsWith(pkg) && !u.startsWith('blob:') && !u.startsWith('data:') && !host.some((h) => u.startsWith(h))))];
  r.failures = [...new Set(failures)];
  r.consoleErrors = [...new Set(consoleErrors)];
  r.csp = [...new Set(cspIn(csp, server))];
  if (r.outside.length) r.problems.push(`requests outside the package: ${r.outside.slice(0, 5).join(', ')}`);
  if (r.failures.length) r.problems.push(`failed requests: ${r.failures.slice(0, 5).join(', ')}`);
  if (r.csp.length) r.problems.push(`Content Security Policy violations in the app's pages: ${r.csp.slice(0, 3).join(' | ')}`);
  r.ok = r.problems.length === 0;
  await ctx.close();
  return r;
}

/**
 * Once per engine, in one browser context (one person): a "New" hint closed
 * in one opening is kept and does not show in the next (ONLYOFFICE 10.0
 * shows one person none: a setting the editor writes is kept, and is there
 * in the next opening); Print where filex
 * has no print (an older filex), and where the app has no ui:print grant,
 * hands the PDF over as a download.
 */
async function settingsRun(browser, server, engine) {
  const r = { engine, doc: 'tr.docx (settings, print fallback)', ok: false, steps: [], problems: [], notes: [] };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  const t0 = Date.now();
  const step = (name, extra) => r.steps.push({ name, ms: Date.now() - t0, ...(extra ?? {}) });
  const tag = `${engine}-settings`;
  const open = async (q) => {
    const page = await ctx.newPage();
    await page.goto(`${server.origin}/?doc=tr.docx&locale=tr&tag=${tag}${q}`);
    await until('the editor', async () => (await appFrame(page)?.evaluate(() => document.documentElement.dataset.fxPhase)) === 'ready', OPEN_MS);
    return page;
  };
  const hint = (page) => editorLocator(page).locator('.asc-synchronizetip .btn-div');
  try {
    const first = await open('&print=none');
    step('opened');
    let hinted = true;
    try {
      await hint(first).first().waitFor({ state: 'visible', timeout: 15_000 });
    } catch {
      hinted = false;
    }
    let keyOf = /help-tip/;
    if (hinted) {
      await hint(first).first().click();
    } else {
      // ONLYOFFICE 10.0 shows no "New" hint when one person opens a text
      // document (its two: following a co-editor, with three or more; the
      // AI tools, with plugins): a setting the editor writes through its
      // own storage stands in for the closed hint.
      r.notes.push(`no "New" hint on this opening: a setting written through the editor's storage is kept in its place`);
      await editorFrame(first).evaluate(() => {
        const store = window.Common && window.Common.localStorage ? window.Common.localStorage : window.localStorage;
        store.setItem('de-settings-fx-e2e', 'kept');
      });
      keyOf = /^de-settings-fx-e2e$/;
    }
    const kept = await until('the closed hint (or the setting) to be kept', async () => {
      const raw = await first.evaluate(() => localStorage.getItem('fx-app-state:office-editor'));
      const values = raw ? JSON.parse(raw)['editor-settings'] : null;
      return values && Object.keys(values).some((k) => keyOf.test(k)) ? values : false;
    }, 20_000);
    r.kept = Object.keys(kept);
    step('hint kept', { keys: r.kept.length });

    const before = server.files.filter((f) => f.tag === tag).length;
    await editorFrame(first).evaluate(() => {
      const api = (window.Asc && window.Asc.editor) || window.editor;
      api.asc_Print(new window.Asc.asc_CDownloadOptions(null, true));
    });
    const got = await nextFile(server, tag, before, 'the PDF handed over in place of a print');
    const toasts = await first.evaluate(() => window.__fx.toasts);
    step('print fallback', { how: got.how, bytes: got.size });
    if (got.how !== 'download' || !pdfFacts(readFileSync(got.file)).pdf) r.problems.push(`Print without filex's print gave ${got.how} ${got.name}`);
    if (!toasts.some((t) => t && t.tone === 'info')) r.problems.push('Print without filex\'s print did not say what it did');
    await first.close();

    // The next opening without the ui:print grant: Print hands the PDF over too.
    const second = await open('&grants=-ui:print');
    step('opened again');
    await sleep(3000);
    const shown = await hint(second).evaluateAll((els) => els.filter((e) => e.offsetParent).length);
    const storage = await editorFrame(second).evaluate(() => {
      const s = window.localStorage;
      const o = {};
      for (let i = 0; i < s.length; i++) o[s.key(i)] = s.getItem(s.key(i));
      return o;
    });
    const missing = r.kept.filter((k) => storage[k] !== kept[k]);
    if (missing.length) r.problems.push(`the next opening lacks the kept ${missing.join(', ')}`);
    if (hinted && shown) r.problems.push(`the closed hint shows again (${shown})`);
    const before2 = server.files.filter((f) => f.tag === tag).length;
    await editorFrame(second).evaluate(() => {
      const api = (window.Asc && window.Asc.editor) || window.editor;
      api.asc_Print(new window.Asc.asc_CDownloadOptions(null, true));
    });
    const got2 = await nextFile(server, tag, before2, 'the PDF handed over without the ui:print grant');
    step('print without ui:print', { how: got2.how, bytes: got2.size });
    if (got2.how !== 'download' || !pdfFacts(readFileSync(got2.file)).pdf) r.problems.push(`Print without the ui:print grant gave ${got2.how} ${got2.name}`);
    await second.close();
  } catch (e) {
    r.problems.push(String(e?.message ?? e).slice(0, 400));
  }
  await ctx.close();
  r.ok = r.problems.length === 0;
  return r;
}

/** A phone's browser for each engine: a phone's user agent, its size, touch (Firefox has no isMobile). */
const PHONES = {
  chromium: {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
    isMobile: true,
  },
  firefox: { userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:148.0) Gecko/148.0 Firefox/148.0' },
  webkit: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
  },
};

async function phoneContext(browser, engine, colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme, ...(PHONES[engine] ?? {}) });
  // A touch screen in every frame, whatever the engine emulates (Firefox
  // has no isMobile): the app page decides "phone" from it (config.ts isPhone).
  await ctx.addInitScript(() => {
    try {
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => 5 });
    } catch {
      /* the engine's own value stays */
    }
  });
  return ctx;
}

const phoneFrame = (page) => page.frames().find((f) => f.url().includes('/editor/web-apps/apps/') && f.url().includes('/mobile/index.html'));

/** Until the app shows `view` ("reader": ONLYOFFICE's phone app; "editor": the editor) with the document open. */
async function viewReady(page, view) {
  return until(`the ${view} to open the document`, async () => {
    const a = appFrame(page);
    if (!a) return false;
    const st = await a.evaluate(() => ({ ph: document.documentElement.dataset.fxPhase || '', view: document.documentElement.dataset.fxView || '' }));
    if (st.ph === 'failed') throw new Error(await a.evaluate(() => document.getElementById('fx-status-text')?.textContent || 'failed'));
    return st.ph === 'ready' && st.view === view;
  }, OPEN_MS);
}

/**
 * Once per engine, on a phone (390 x 844, a phone's user agent, touch): the
 * document opens in ONLYOFFICE's phone app, to read, without the open-source
 * build's "commercial licence" message; its Download (PDF) and Print go
 * through x2t to filex, a format x2t does not write here is refused and the
 * person told; "Edit" opens the editor (folded) with the document, typed
 * text is saved; "Reading view" goes back to the phone app with it. Then
 * the Turkish xlsx and pptx open in their phone apps the same way.
 */
async function phoneRun(browser, server, engine, o) {
  const r = { engine, doc: 'tr.docx (phone)', ok: false, steps: [], problems: [], notes: [] };
  const tag = `${engine}-phone`;
  const ctx = await phoneContext(browser, engine);
  await watchCsp(ctx);
  const page = await ctx.newPage();
  const failures = [];
  const requests = [];
  const consoleErrors = [];
  const csp = [];
  collectCsp(page, csp);
  page.on('request', (q) => requests.push(q.url()));
  page.on('response', (s) => {
    if (s.status() >= 400) failures.push(`${s.status()} ${s.url()}`);
  });
  page.on('requestfailed', (q) => {
    const f = q.failure()?.errorText ?? '';
    // A frame the app replaces ("Edit", "Reading view") aborts what it was loading.
    if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(f)) failures.push(`failed ${q.url()} ${f}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message ?? e).slice(0, 300)}`));
  const t0 = Date.now();
  const step = (name, extra) => r.steps.push({ name, ms: Date.now() - t0, ...(extra ?? {}) });
  const shot = async (name) => {
    if (!o.shots) return;
    mkdirSync(path.join(DIST, 'e2e-shots'), { recursive: true });
    // The phone app's "loading" layer stays a moment after the document is ready.
    await sleep(1500);
    await page.screenshot({ path: path.join(DIST, 'e2e-shots', `${engine}-tr.docx-phone-${name}.png`) });
  };
  try {
    await page.goto(`${server.origin}/?doc=tr.docx&locale=tr&tag=${tag}`);
    await viewReady(page, 'reader');
    step('opened (phone app)');
    const reader = phoneFrame(page);
    if (!reader) throw new Error("the phone app's page is not the editor's frame");
    await sleep(1000);
    const about = await aboutChecks(page, reader, { phone: true });
    r.about = about.facts;
    r.problems.push(...about.problems);
    const words = await reader.evaluate(() => document.body.innerText || '');
    if (/Community version|commercial license/i.test(words)) r.problems.push('the phone app shows its open-source licence message');
    const app = appFrame(page);
    const button = await app.evaluate(() => {
      const b = document.getElementById('fx-switch');
      return b ? { hidden: b.hidden, text: b.textContent, view: b.dataset.view } : null;
    });
    r.button = button;
    if (!button || button.hidden || button.view !== 'reader') r.problems.push(`no "Edit" in the phone app: ${JSON.stringify(button)}`);
    await shot('reader');

    // Download (PDF) and Print from the phone app: x2t, then filex.
    let n = server.files.filter((f) => f.tag === tag).length;
    await reader.evaluate(() => {
      const api = (window.Asc && window.Asc.editor) || window.editor;
      api.asc_DownloadAs(new window.Asc.asc_CDownloadOptions(window.Asc.c_oAscFileType.PDF));
    });
    const pdf = await nextFile(server, tag, n++, 'the PDF from the phone app');
    const facts = pdfFacts(readFileSync(pdf.file));
    step('download pdf (phone app)', { bytes: pdf.size, ...facts });
    if (pdf.how !== 'download' || !facts.pdf || facts.pages < 1 || facts.fonts < 1) r.problems.push(`the phone app's PDF: ${pdf.how} ${JSON.stringify(facts)}`);
    await exportsSettled(reader);
    await reader.evaluate(() => {
      const api = (window.Asc && window.Asc.editor) || window.editor;
      api.asc_Print(new window.Asc.asc_CDownloadOptions(null, true));
    });
    const printed = await nextFile(server, tag, n++, 'the PDF to print from the phone app');
    step('print (phone app)', { bytes: printed.size });
    if (printed.how !== 'print') r.problems.push(`Print in the phone app gave filex ${printed.how} ${printed.name}`);
    // A format the phone app lists that x2t does not write here: refused, and said.
    const toastsBefore = (await page.evaluate(() => window.__fx.toasts)).length;
    await exportsSettled(reader);
    await reader.evaluate(() => {
      const T = window.Asc.c_oAscFileType;
      const api = (window.Asc && window.Asc.editor) || window.editor;
      api.asc_DownloadAs(new window.Asc.asc_CDownloadOptions(T.FB2 ?? T.EPUB ?? T.HTML));
    });
    await until('the person to be told the format is not available', async () => (await page.evaluate(() => window.__fx.toasts)).slice(toastsBefore).some((t) => t && t.tone === 'info'), 20_000);
    if (server.files.filter((f) => f.tag === tag).length !== n) r.problems.push('a format x2t does not write here still gave filex a file');
    step('refused format told');

    // "Edit": the editor, folded, with the document; typed text is saved.
    await app.locator('#fx-switch').click();
    await viewReady(page, 'editor');
    step('opened (editor)');
    if (!editorFrame(page)) r.problems.push('"Edit" did not open the editor');
    await shot('editor');
    await sleep(800);
    await typeInto(page, 'docx');
    await until('filex to be told there are unsaved changes', () => page.evaluate(() => window.__fx.dirty === true), 20_000);
    const before = server.saves.filter((s) => s.tag === tag).length;
    await page.keyboard.press('Control+S');
    const saved = await until('the editor Save to write the file', () => server.saves.filter((s) => s.tag === tag)[before], 60_000);
    step('saved (editor on the phone)', { bytes: saved.size });
    if (!documentText(readFileSync(saved.file), 'docx').includes(TYPED)) r.problems.push('the save on the phone does not hold the typed text');

    // "Reading view": back to the phone app, with what was written.
    const savesBefore = server.saves.filter((s) => s.tag === tag).length;
    await app.locator('#fx-switch').click();
    await viewReady(page, 'reader');
    step('opened (phone app again)');
    if (!phoneFrame(page)) r.problems.push('"Reading view" did not open the phone app');
    if (await page.evaluate(() => window.__fx.dirty)) r.problems.push('filex still says "unsaved changes" in the phone app');
    if (server.saves.filter((s) => s.tag === tag).length !== savesBefore) r.notes.push('going back to reading saved again (there were changes the Save had not covered)');
    await shot('reader-again');

    // The other two phone apps open their documents too, to read, with "Edit".
    for (const doc of ['tr.xlsx', 'tr.pptx']) {
      const other = await ctx.newPage();
      other.on('response', (s) => {
        if (s.status() >= 400) failures.push(`${s.status()} ${s.url()}`);
      });
      other.on('request', (q) => requests.push(q.url()));
      try {
        await other.goto(`${server.origin}/?doc=${doc}&locale=tr&tag=${tag}-${doc.replace(/\W/g, '_')}`);
        await viewReady(other, 'reader');
        step(`opened ${doc} (phone app)`);
        const f = phoneFrame(other);
        if (!f) r.problems.push(`${doc}: not in the phone app`);
        else if (/Community version|commercial license/i.test(await f.evaluate(() => document.body.innerText || ''))) r.problems.push(`${doc}: the phone app shows its open-source licence message`);
        const shown = await appFrame(other).evaluate(() => !document.getElementById('fx-switch')?.hidden);
        if (!shown) r.problems.push(`${doc}: no "Edit"`);
        if (o.shots) await sleep(1500);
        if (o.shots) await other.screenshot({ path: path.join(DIST, 'e2e-shots', `${engine}-${doc}-phone-reader.png`) });
      } catch (e) {
        r.problems.push(`${doc}: ${String(e?.message ?? e).slice(0, 300)}`);
      }
      await other.close();
    }
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
  const host = [`${server.origin}/?`, `${server.origin}/host.js`, `${server.origin}/__doc/`, `${server.origin}/__save`, `${server.origin}/__file`];
  r.outside = [...new Set(requests.filter((u) => !u.startsWith(pkg) && !u.startsWith('blob:') && !u.startsWith('data:') && !u.startsWith('about:') && !host.some((h) => u.startsWith(h))))];
  r.failures = [...new Set(failures)];
  r.consoleErrors = [...new Set(consoleErrors)];
  r.csp = [...new Set(cspIn(csp, server))];
  if (r.outside.length) r.problems.push(`requests outside the package: ${r.outside.slice(0, 5).join(', ')}`);
  if (r.failures.length) r.problems.push(`failed requests: ${r.failures.slice(0, 5).join(', ')}`);
  if (r.csp.length) r.problems.push(`Content Security Policy violations in the app's pages: ${r.csp.slice(0, 3).join(' | ')}`);
  r.ok = r.problems.length === 0;
  await ctx.close();
  return r;
}

// ---------------------------------------------------------------------------
// "About this editor" (src/app/about.ts): the notice ONLYOFFICE's terms ask
// for, behind a button in the corner of the editor, at every opening.
// ---------------------------------------------------------------------------

/** What the notice says in Turkish for this build (src/app/strings.ts tr.legal, the facts from upstream/onlyoffice.json and package.json). */
const LEGAL_TR = (() => {
  const pin = JSON.parse(readFileSync(path.join(ROOT, 'upstream', 'onlyoffice.json'), 'utf8'));
  const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const repo = 'github.com/BRF-Tech/filex-office-editor';
  const source = /^\d+\.\d+\.\d+$/.test(version) && version !== '0.0.0' ? `${repo}/tree/v${version}` : repo;
  const build = Number(String(pin.build).split('.').pop());
  return {
    source,
    text:
      `Ascensio System SIA'nın ONLYOFFICE Docs'una dayanır; bu sürüm değiştirilmiş olabilir (Docs ${pin.version}, yapı ${build}, ONLYOFFICE kaynak etiketi ${pin.source_tag}). ` +
      `GNU AGPL sürüm 3 ile lisanslı özgür yazılımdır; kaynak kodu: ${source}. ` +
      "ONLYOFFICE®, Ascensio System SIA'nın tescilli markasıdır; bu uygulama onunla bağlantılı değildir ve onun tarafından onaylanmamıştır.",
  };
})();
const ABOUT_LABEL_TR = 'Bu düzenleyici hakkında';

/** WCAG's contrast ratio of two CSS colours ("rgb(...)" / "rgba(...)", alpha ignored). */
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = (String(c).match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

/** A CSS colour with alpha ("rgba(...)") laid over an opaque ground: the colour the eye sees, "rgb(...)". */
function over(top, ground) {
  const [r, g, b, a = 1] = (String(top).match(/[\d.]+/g) ?? ['0', '0', '0', '0']).map(Number);
  const [R, G, B] = (String(ground).match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number);
  const mix = (f, s) => Math.round(f * a + s * (1 - a));
  return `rgb(${mix(r, R)}, ${mix(g, G)}, ${mix(b, B)})`;
}

/**
 * The button at this opening: there, never hidden, named in the person's
 * language, inside the page, nothing over it, its colours apart enough
 * (WCAG 1.4.11: 3:1) - and over nothing of the editor's that does
 * something: on a computer the editor frame's elements under five points of
 * it are no control and not the document; on a phone it is beside the frame
 * (the footer). No line under the editor. `editor`: the frame of the editor
 * (or the phone app) on screen.
 */
async function aboutChecks(page, editor, { phone }) {
  const problems = [];
  const a = appFrame(page);
  const f = await a.evaluate(() => {
    const b = document.getElementById('fx-about');
    if (!b) return null;
    const q = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const frame = document.querySelector('#fx-editor-box iframe');
    const fr = frame ? frame.getBoundingClientRect() : null;
    const top = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2);
    const foot = document.getElementById('fx-foot');
    return {
      hidden: b.hidden,
      label: b.getAttribute('aria-label'),
      rect: { x: q.x, y: q.y, w: q.width, h: q.height },
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      color: cs.color,
      background: cs.backgroundColor,
      viewport: { w: innerWidth, h: innerHeight },
      onTop: !!(top && top.closest('#fx-about')),
      line: !!document.getElementById('fx-legal'),
      foot: foot ? getComputedStyle(foot).display : null,
      frame: fr ? { x: fr.x, y: fr.y, w: fr.width, h: fr.height } : null,
    };
  });
  if (!f) return { problems: ['no "About this editor" button'], facts: null };
  const r = f.rect;
  if (f.hidden || f.display === 'none' || f.visibility !== 'visible' || Number(f.opacity) < 1) problems.push(`the About button is not shown: ${JSON.stringify(f)}`);
  if (f.label !== ABOUT_LABEL_TR) problems.push(`the About button is named ${JSON.stringify(f.label)}`);
  if (r.w < 20 || r.h < 20 || r.x < 0 || r.y < 0 || r.x + r.w > f.viewport.w || r.y + r.h > f.viewport.h) problems.push(`the About button is not inside the page: ${JSON.stringify(r)}`);
  if (!f.onTop) problems.push('something of the app page covers the About button');
  if (f.line) problems.push('the line under the editor (#fx-legal) is still there');
  if (f.foot !== (phone ? 'flex' : 'none')) problems.push(`the footer is ${f.foot} ${phone ? 'on a phone' : 'on a computer'}`);
  const ratio = contrast(f.color, f.background);
  if (ratio < 3) problems.push(`the About button's icon and its ground are ${ratio}:1 apart (${f.color} on ${f.background})`);
  let under = [];
  const fr = f.frame;
  const overlaps = fr && r.x < fr.x + fr.w && r.x + r.w > fr.x && r.y < fr.y + fr.h && r.y + r.h > fr.y;
  if (phone) {
    if (overlaps) problems.push(`on a phone the About button is over the editor's frame: ${JSON.stringify({ button: r, frame: fr })}`);
  } else if (!fr || !editor) {
    problems.push("no editor frame to measure the About button's place against");
  } else {
    const pts = [
      [r.x + r.w / 2, r.y + r.h / 2],
      [r.x + 2, r.y + 2],
      [r.x + r.w - 2, r.y + 2],
      [r.x + 2, r.y + r.h - 2],
      [r.x + r.w - 2, r.y + r.h - 2],
    ].map(([x, y]) => ({ x: x - fr.x, y: y - fr.y }));
    under = await editor.evaluate((list) => {
      const name = (e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
      return list.map(({ x, y }) => {
        const e = document.elementFromPoint(x, y);
        if (!e) return { at: [x, y], el: null, control: false };
        const path = [];
        for (let n = e; n && n !== document.body && path.length < 4; n = n.parentElement) path.push(name(n));
        const control = !!e.closest(
          'button, a, input, select, textarea, label, canvas, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [onclick], .btn, .btn-category, #editor_sdk, #ws-canvas-outer, #id_main, #id_viewer',
        );
        return { at: [Math.round(x), Math.round(y)], el: path.join(' < '), control };
      });
    }, pts);
    const hit = under.filter((u) => u.control || !u.el);
    if (hit.length) problems.push(`the About button is over the editor's ${hit.map((u) => u.el ?? 'nothing').join(', ')}`);
  }
  return { problems, facts: { ...f, contrast: ratio, under } };
}

/** The panel as it is now (the notice, the source address in it, any link, where the focus is, what is selected). */
async function aboutPanel(page) {
  return appFrame(page).evaluate(() => {
    const p = document.getElementById('fx-about-panel');
    const b = document.getElementById('fx-about');
    const links = [...p.querySelectorAll('a, [href], [role="link"]')].map((e) => ({ tag: e.tagName.toLowerCase(), href: e.getAttribute('href'), text: e.textContent }));
    const s = document.querySelector('#fx-about-text .fx-about-source');
    let source = null;
    if (s) {
      const ss = getComputedStyle(s);
      // Selectable: user-select is "none" on neither the address nor any element around it.
      const unselectable = [];
      for (let n = s; n && n.nodeType === 1; n = n.parentElement) {
        const c = getComputedStyle(n);
        if ((c.userSelect || c.webkitUserSelect) === 'none' || c.webkitUserSelect === 'none') unselectable.push(n.id || n.tagName.toLowerCase());
      }
      source = {
        tag: s.tagName.toLowerCase(),
        text: s.textContent,
        userSelect: ss.userSelect || ss.webkitUserSelect,
        unselectable,
        cursor: ss.cursor,
        decoration: ss.textDecorationLine || ss.textDecoration,
        font: ss.fontFamily,
        color: ss.color,
        background: ss.backgroundColor,
      };
    }
    const q = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    return {
      open: !p.hidden && cs.display !== 'none',
      expanded: b.getAttribute('aria-expanded'),
      focus: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null,
      title: document.getElementById('fx-about-title').textContent,
      text: document.getElementById('fx-about-text').textContent,
      links,
      source,
      selection: String(getSelection()),
      rect: { x: q.x, y: q.y, w: q.width, h: q.height },
      viewport: { w: innerWidth, h: innerHeight },
      color: cs.color,
      background: cs.backgroundColor,
    };
  });
}

/**
 * Select the text of `selector` in the app page as a person does with a
 * mouse: press on its first character, drag to its last, let go. What the
 * page then has selected, or null when there is no such text.
 */
async function dragAcross(page, selector) {
  const a = appFrame(page);
  const ends = await a.evaluate((sel) => {
    const s = document.querySelector(sel);
    const node = s && s.firstChild;
    if (!node || node.nodeType !== 3 || !node.length) return null;
    getSelection().removeAllRanges();
    const box = s.getBoundingClientRect();
    const glyph = (i) => {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const q = r.getClientRects()[0] ?? r.getBoundingClientRect();
      return { x: q.x - box.x, y: q.y - box.y, w: q.width, h: q.height };
    };
    return { first: glyph(0), last: glyph(node.length - 1) };
  }, selector);
  if (!ends) return null;
  const box = await a.locator(selector).boundingBox();
  if (!box) return null;
  const from = { x: box.x + ends.first.x + 1, y: box.y + ends.first.y + ends.first.h / 2 };
  const to = { x: box.x + ends.last.x + ends.last.w - 1, y: box.y + ends.last.y + ends.last.h / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  return a.evaluate(() => String(getSelection()));
}

/**
 * Once per engine, in four openings of tr.docx - a computer (1280 x 800) and
 * a phone (390 x 844), light and dark - the button (aboutChecks), and its
 * panel: opened from the keyboard on a computer (the first Tab from filex's
 * page reaches the button, Enter opens) and by a tap on a phone; the notice
 * whole, in Turkish, with this build's facts, the source address at this
 * version's tag in it as plain text: no link anywhere in the panel, set
 * apart, nothing about it that says "click", its colours apart enough; a
 * click on it opens no page and asks filex for nothing (filex's sandbox may
 * open no tab: the address is there to be selected and copied); a drag
 * across it selects it, whole. Escape closes and gives the focus back to
 * the button; Space opens it again and its close button closes it. On a
 * phone after "Edit" the button is still in the footer, off the folded
 * editor.
 */
async function aboutRun(browser, server, engine, o) {
  const r = { engine, doc: 'tr.docx (About this editor)', ok: false, steps: [], problems: [], notes: [], views: {} };
  const t0 = Date.now();
  const step = (name, extra) => r.steps.push({ name, ms: Date.now() - t0, ...(extra ?? {}) });
  const views = [
    { name: 'computer-light', phone: false, theme: 'light' },
    { name: 'computer-dark', phone: false, theme: 'dark' },
    { name: 'phone-light', phone: true, theme: 'light' },
    { name: 'phone-dark', phone: true, theme: 'dark' },
  ];
  for (const v of views) {
    const ctx = v.phone ? await phoneContext(browser, engine, v.theme) : await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: v.theme });
    const page = await ctx.newPage();
    const tag = `${engine}-about-${v.name}`;
    const said = (p) => r.problems.push(`${v.name}: ${p}`);
    const shot = async (what) => {
      if (!o.shots) return;
      mkdirSync(path.join(DIST, 'e2e-shots'), { recursive: true });
      await page.screenshot({ path: path.join(DIST, 'e2e-shots', `${engine}-about-${v.name}-${what}.png`) });
    };
    try {
      await page.goto(`${server.origin}/?doc=tr.docx&locale=tr&theme=${v.theme}&tag=${tag}`);
      await viewReady(page, v.phone ? 'reader' : 'editor');
      // The phone app's "loading" layer stays a moment after the document is ready.
      await sleep(v.phone ? 1500 : 500);
      const c = await aboutChecks(page, v.phone ? phoneFrame(page) : editorFrame(page), { phone: v.phone });
      r.views[v.name] = { button: c.facts };
      c.problems.forEach(said);
      await shot('closed');
      const a = appFrame(page);

      // Open it: the keyboard on a computer, a tap on a phone.
      if (v.phone) {
        await a.locator('#fx-about').click();
      } else {
        await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
        await page.keyboard.press('Tab');
        const first = await a.evaluate(() => (document.activeElement ? document.activeElement.id : null));
        r.views[v.name].firstTab = first;
        if (first !== 'fx-about') said(`the first Tab from filex's page reached ${JSON.stringify(first)}, not the About button`);
        await a.locator('#fx-about').focus();
        await page.keyboard.press('Enter');
      }
      await until('the About panel to open', async () => (await aboutPanel(page)).open, 5000);
      const p = await aboutPanel(page);
      r.views[v.name].panel = p;
      step(`${v.name}: panel open`);
      if (p.expanded !== 'true') said(`aria-expanded is ${p.expanded} while the panel is open`);
      if (!v.phone && p.focus !== 'fx-about-panel') said(`the focus is on ${p.focus}, not the panel`);
      if (p.title !== ABOUT_LABEL_TR) said(`the panel is titled ${JSON.stringify(p.title)}`);
      if (p.text !== LEGAL_TR.text) said(`the panel's notice differs from the notice: ${JSON.stringify(p.text)}`);
      const pr = p.rect;
      if (pr.x < 0 || pr.y < 0 || pr.x + pr.w > p.viewport.w + 0.5 || pr.y + pr.h > p.viewport.h + 0.5) said(`the panel is not inside the page: ${JSON.stringify(pr)}`);

      // The source address: plain text in the notice, no link anywhere in the panel, nothing that says "click".
      if (p.links.length) said(`the panel holds a link: ${JSON.stringify(p.links)}`);
      const src = p.source;
      if (!src || src.text !== LEGAL_TR.source) said(`the source address in the notice is ${JSON.stringify(src)}`);
      if (src) {
        if (src.userSelect === 'none' || src.unselectable.length) said(`the address cannot be selected (user-select ${src.userSelect}; none on ${src.unselectable.join(', ')})`);
        if (src.cursor === 'pointer') said('the pointer over the address is a hand, as over a link');
        if (/underline/.test(src.decoration)) said('the address is underlined, as a link');
        if (!/monospace/.test(src.font)) said(`the address is not set apart: its font is ${src.font}`);
      }
      const textRatio = contrast(p.color, p.background);
      const sourceRatio = src ? contrast(src.color, over(src.background, p.background)) : 0;
      r.views[v.name].panelContrast = { text: textRatio, source: sourceRatio };
      if (textRatio < 4.5 || sourceRatio < 4.5) said(`the panel's text is ${textRatio}:1 and its source address ${sourceRatio}:1 from their ground`);
      await shot('open');

      // A click on the address: no page opens, filex is asked for nothing, the panel and the document stay.
      const target = src ? '#fx-about-text .fx-about-source' : p.links.length ? '#fx-about-text a' : null;
      if (target) {
        const pagesBefore = ctx.pages().length;
        const callsBefore = await page.evaluate(() => window.__fx.calls.length);
        await a.locator(target).click();
        await sleep(700);
        const asked = (await page.evaluate((n) => window.__fx.calls.slice(n), callsBefore)).filter((m) => !/^(state\.(set|get)|ui\.(dirty|title)|coedit\.)/.test(m));
        r.views[v.name].afterClick = { asked };
        if (asked.length) said(`a click on the address asked filex for ${asked.join(', ')}`);
        if (ctx.pages().length !== pagesBefore) said('a click on the address opened a page');
        if (!(await aboutPanel(page)).open) said('a click on the address closed the panel');
        if ((await a.evaluate(() => document.documentElement.dataset.fxPhase)) !== 'ready') said('the app page left its document after a click on the address');
      }

      // Selected as a person selects it: a drag across the address takes it, whole, to copy.
      if (src) {
        const selected = await dragAcross(page, '#fx-about-text .fx-about-source');
        r.views[v.name].selected = selected;
        if (selected !== LEGAL_TR.source) said(`a drag across the address selected ${JSON.stringify(selected)}`);
        if (!(await aboutPanel(page)).open) said('selecting the address closed the panel');
        await shot('selected');
        await a.evaluate(() => getSelection().removeAllRanges());
      }

      // Escape closes, the focus is back on the button; Space opens; the close button closes.
      if (!v.phone) {
        await page.keyboard.press('Escape');
        const shut = await aboutPanel(page);
        if (shut.open || shut.expanded !== 'false' || shut.focus !== 'fx-about') said(`after Escape: open ${shut.open}, aria-expanded ${shut.expanded}, focus ${shut.focus}`);
        await page.keyboard.press('Space');
        if (!(await aboutPanel(page)).open) said('Space on the button did not open the panel');
      }
      await a.locator('#fx-about-close').click();
      const closed = await aboutPanel(page);
      if (closed.open || closed.expanded !== 'false') said(`the close button left the panel open ${closed.open}, aria-expanded ${closed.expanded}`);

      if (v.phone) {
        // "Edit": the folded editor; the button stays in the footer, off it.
        await a.locator('#fx-switch').click();
        await viewReady(page, 'editor');
        await sleep(1000);
        const e = await aboutChecks(page, editorFrame(page), { phone: true });
        r.views[v.name].afterEdit = e.facts;
        e.problems.forEach((x) => said(`after Edit: ${x}`));
        await shot('edit');
      }
    } catch (e) {
      said(String(e?.message ?? e).slice(0, 400));
      try {
        mkdirSync(path.join(DIST, 'e2e-shots'), { recursive: true });
        await page.screenshot({ path: path.join(DIST, 'e2e-shots', `${tag}-FAILED.png`) });
      } catch {
        /* the page is gone */
      }
    }
    await ctx.close();
  }
  r.ok = r.problems.length === 0;
  return r;
}

/** What the person reads when x2t stops on the document (src/app/strings.ts, tr: openFailed + x2tStopped). */
const STOPPED_TR = 'Belge açılamadı: dönüştürücü bu belgede durdu (missing function: COFDFile::COFDFile)';
/** Longer than the editor takes to say it is ready (0.7-2.2 s measured): the late phase that used to undo "failed". */
const AFTER_FAILED_MS = 6000;

/**
 * x2t stops on stops.docx (an OFD package: x2t has no OFD reader, and knows a
 * file by what it holds). The opening ends "failed" with the app's error in
 * Turkish, saying why; the page is still "failed" well after the editor
 * would have said it was ready (the phase a late "editor-app-ready" used to
 * overwrite, Chromium and Firefox, #220); the editor is not left loading
 * behind the message.
 */
async function stopRun(browser, server, engine) {
  const r = { engine, doc: 'stops.docx (x2t stops)', ok: false, steps: [], problems: [], notes: [] };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const step = (name, extra) => r.steps.push({ name, ms: Date.now() - t0, ...(extra ?? {}) });
  try {
    await page.goto(`${server.origin}/?doc=stops.docx&locale=tr&tag=${engine}-stops`);
    const phaseOf = async () => (appFrame(page) ? await appFrame(page).evaluate(() => document.documentElement.dataset.fxPhase || '') : '');
    const first = await until('the opening to end', async () => {
      const ph = await phaseOf();
      return ph === 'failed' || ph === 'ready' ? ph : false;
    }, OPEN_MS);
    step(first);
    if (first !== 'failed') throw new Error(`the opening ended "${first}", not "failed"`);
    await sleep(AFTER_FAILED_MS);
    const st = await appFrame(page).evaluate(() => {
      const box = document.getElementById('fx-status');
      return {
        phase: document.documentElement.dataset.fxPhase || '',
        phases: (window.__fxPhases || []).map((x) => x[0]),
        shown: !!box && !box.hidden,
        error: !!box && box.classList.contains('fx-error'),
        text: document.getElementById('fx-status-text')?.textContent || '',
        editorFrames: document.querySelectorAll('#fx-editor-box iframe').length,
      };
    });
    step('after the editor would be ready', { phase: st.phase });
    r.status = st;
    if (st.phase !== 'failed') r.problems.push(`${AFTER_FAILED_MS / 1000} s after it failed the page says "${st.phase}" (${st.phases.join(' > ')})`);
    if (!st.shown || !st.error) r.problems.push('the error is not on the screen');
    if (st.text !== STOPPED_TR) r.problems.push(`the person reads ${JSON.stringify(st.text)}, not ${JSON.stringify(STOPPED_TR)}`);
    if (st.editorFrames !== 0) r.problems.push('the editor is still loading behind the error');
  } catch (e) {
    r.problems.push(String(e?.message ?? e).slice(0, 400));
  }
  try {
    mkdirSync(path.join(DIST, 'e2e-shots'), { recursive: true });
    await page.screenshot({ path: path.join(DIST, 'e2e-shots', `${engine}-stops${r.problems.length ? '-FAILED' : ''}.png`) });
  } catch {
    /* the page is gone */
  }
  r.ok = r.problems.length === 0;
  await ctx.close();
  return r;
}

/** The formula's two sentences (tests/fixtures/office.ts FORMULA), as formulaRun reads them out of the editor. */
const FORMULA_LINES = ['Iğdır: [math]', 'Önce [math] sonra metin.'];

/**
 * An odt with a formula at the end of a sentence and one between two words
 * (formula.odt: the frames styled as LibreOffice writes them;
 * formula-nostyle.odt: no style, which x2t made a floating shape at the top
 * left of the margin before scripts/x2t/patches/05-frame-anchor.patch). In
 * the editor's own document (read through its document builder API, whose
 * names 10.0 keeps: the paragraphs' runs and math) each formula is in the
 * line where its frame is, and there is no shape (these documents have
 * none: a formula in a shape is one that is not in its line).
 */
async function formulaRun(browser, server, engine, doc) {
  const r = { engine, doc: `${doc} (where the formula is)`, ok: false, steps: [], problems: [], notes: [] };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const step = (name, extra) => r.steps.push({ name, ms: Date.now() - t0, ...(extra ?? {}) });
  try {
    await page.goto(`${server.origin}/?doc=${encodeURIComponent(doc)}&locale=tr&tag=${engine}-formula`);
    const end = await until('the opening to end', async () => {
      const a = appFrame(page);
      const ph = a ? await a.evaluate(() => document.documentElement.dataset.fxPhase || '') : '';
      if (ph === 'failed') return `failed: ${await a.evaluate(() => document.getElementById('fx-status-text')?.textContent || '')}`;
      return ph === 'ready' ? ph : false;
    }, OPEN_MS);
    step(end);
    if (end !== 'ready') throw new Error(end);
    const seen = await editorFrame(page).evaluate(() => {
      const api = (window.Asc && window.Asc.editor) || window.editor;
      const word = window.AscBuilder && window.AscBuilder.Word && window.AscBuilder.Word.Api;
      const doc = (word && typeof word.GetDocument === 'function' ? word : api).GetDocument();
      const kinds = new Set();
      const lines = doc
        .GetAllParagraphs()
        .map((para) => {
          let t = '';
          for (let i = 0; i < para.GetElementsCount(); i++) {
            const el = para.GetElement(i);
            const kind = el && typeof el.GetClassType === 'function' ? el.GetClassType() : 'none';
            kinds.add(kind);
            if (kind === 'math') t += '[math]';
            else if (el && typeof el.GetText === 'function') t += String(el.GetText());
          }
          return t
            .replace(/\s*\[/g, ' [')
            .replace(/\]\s*/g, '] ')
            .replace(/\s+/g, ' ')
            .trim();
        })
        .filter((l) => l !== '');
      return { lines, floating: doc.GetAllDrawingObjects().length, kinds: [...kinds] };
    });
    step('read', seen);
    r.formula = seen;
    for (const l of FORMULA_LINES) if (!seen.lines.includes(l)) r.problems.push(`no line ${JSON.stringify(l)} in ${JSON.stringify(seen.lines)} (elements: ${seen.kinds.join(', ')})`);
    if (seen.floating) r.problems.push(`${seen.floating} shape(s): a formula is not in its line (the paragraphs' elements: ${seen.kinds.join(', ')})`);
  } catch (e) {
    r.problems.push(String(e?.message ?? e).slice(0, 400));
  }
  try {
    mkdirSync(path.join(DIST, 'e2e-shots'), { recursive: true });
    await page.screenshot({ path: path.join(DIST, 'e2e-shots', `${engine}-${doc.replace(/\W/g, '_')}${r.problems.length ? '-FAILED' : ''}.png`) });
  } catch {
    /* the page is gone */
  }
  r.ok = r.problems.length === 0;
  await ctx.close();
  return r;
}

/**
 * Once per engine: a document of an encrypted folder. filex 0.56
 * (`enc=folder`): the harness holds the document as filex's explorer
 * encrypts it, hands the app the plaintext, and encrypts what the app saves
 * before it goes to the server. The app opens it, the typed text is saved,
 * the server receives only ciphertext - no request the pages sent carries a
 * document in the clear - and what it holds decrypts, with the folder key,
 * to a document with the typed text and the Turkish document's own. filex
 * 0.55 (`enc=055`): the same file, encrypted and not handed over - the app
 * says so and asks for nothing.
 */
async function encryptedRun(browser, server, engine, o) {
  const r = { engine, doc: 'tr.docx (encrypted folder)', ok: false, steps: [], problems: [], notes: [] };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  const t0 = Date.now();
  const step = (name, extra) => r.steps.push({ name, ms: Date.now() - t0, ...(extra ?? {}) });
  const tag = `${engine}-enc`;
  const sent = [];
  try {
    const page = await ctx.newPage();
    page.on('request', (q) => sent.push(q));
    await page.goto(`${server.origin}/?doc=tr.docx&locale=tr&tag=${tag}&enc=folder`);
    await until('the editor to open the encrypted document', async () => {
      const a = appFrame(page);
      if (!a) return false;
      const ph = await a.evaluate(() => document.documentElement.dataset.fxPhase || '');
      if (ph === 'failed') throw new Error(await a.evaluate(() => document.getElementById('fx-status-text')?.textContent || 'failed'));
      return ph === 'ready';
    }, OPEN_MS);
    step('opened');
    await sleep(800);
    await typeInto(page, 'docx');
    await until('filex to be told there are unsaved changes', () => page.evaluate(() => window.__fx.dirty === true), 20_000);
    const before = server.saves.filter((s) => s.tag === tag).length;
    await page.keyboard.press('Control+S');
    const saved = await until('the save to reach the server', () => server.saves.filter((s) => s.tag === tag)[before], 60_000);
    step('saved', { bytes: saved.size });
    const stored = readFileSync(saved.file);
    if (!saved.enc) r.problems.push('the save did not go through the encrypted folder');
    if (stored.subarray(0, 8).toString('latin1') !== 'filexe2e') r.problems.push(`the server received ${JSON.stringify(stored.subarray(0, 8).toString('latin1'))}, not ciphertext`);
    // A document in the clear is a zip: its local header is "PK\x03\x04".
    for (const q of sent) {
      const b = q.postDataBuffer();
      if (b && b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) r.problems.push(`${q.url()} carried a document in the clear`);
    }
    const held = await page.evaluate(() => window.__fx.heldDocument());
    if (!held || held.head !== 'filexe2e') r.problems.push('the server does not hold ciphertext');
    const text = held ? documentText(Buffer.from(held.plain, 'base64'), 'docx') : '';
    if (!text.includes(TYPED)) r.problems.push('what the server holds, decrypted with the folder key, does not hold the typed text');
    for (const k of [o.TR.title, o.TR.body]) if (!text.includes(k)) r.problems.push(`what the server holds lost "${k}"`);
    step('decrypted');
    await page.close();

    // filex 0.55: encrypted, not handed over - said, not asked for.
    const old = await ctx.newPage();
    await old.goto(`${server.origin}/?doc=tr.docx&locale=tr&tag=${tag}-055&enc=055`);
    const said = await until('the app to say the document is encrypted', async () => {
      const a = appFrame(old);
      if (!a) return false;
      const ph = await a.evaluate(() => document.documentElement.dataset.fxPhase || '');
      return ph === 'failed' ? a.evaluate(() => document.getElementById('fx-status-text')?.textContent || '') : false;
    }, OPEN_MS);
    step('0.55 said', { said });
    if (!/şifreli/.test(said)) r.problems.push(`on filex 0.55 the app said "${said}"`);
    const asked = await old.evaluate(() => window.__fx.calls);
    if (asked.includes('file.read')) r.problems.push('on filex 0.55 the app asked for the encrypted document');
    if (server.saves.some((s) => s.tag === `${tag}-055`)) r.problems.push('on filex 0.55 something was saved');
  } catch (e) {
    r.problems.push(String(e?.message ?? e).slice(0, 400));
  }
  r.ok = r.problems.length === 0;
  await ctx.close();
  return r;
}

/**
 * Once per engine, two people - two browser contexts - on the same document,
 * through the harness's stand-in for filex 0.56's relay (harness/relay.mjs):
 *
 *   - both editors join the one session (the first starts it and puts the
 *     base, the second opens the base) and each counts two people;
 *   - what Ayşe types reaches Mehmet's bridge: both hold the same changes;
 *   - Zeynep, who may only read, follows as a watcher: her bridge holds the
 *     same changes, and her editor - ONLYOFFICE's live viewer, in view mode
 *     (liveViewerSupport) - shows what Ayşe typed before anybody saves, read
 *     from the editor's own document; she writes nothing into the log;
 *   - both bridges hold the same locks (every bridge applies the same lock
 *     requests in the same order);
 *   - Mehmet saves (filex's Save): the file holds Ayşe's text, and the save
 *     is written into the log with how far it reaches (`through`), past the
 *     last change;
 *   - neither is told "unsaved changes" while the other may save;
 *   - Mehmet leaves: the log says so, and Ayşe's editor counts one again;
 *   - a document x2t stops on, opened together: the opening stays "failed"
 *     with the app's error and no editor, and the member leaves the session
 *     it started (#220 with editing together).
 */
async function togetherRun(browser, server, engine, o) {
  const doc = 'tr.docx';
  const room = `room-${engine}`;
  const r = { engine, doc: `${doc} (two people)`, ok: false, steps: [], problems: [], notes: [] };
  const t0 = Date.now();
  const step = (name, extra) => r.steps.push({ name, ms: Date.now() - t0, ...(extra ?? {}) });
  const failures = [];
  const consoleErrors = [];
  const people2 = [];
  const open = async (who, uname, extra = '', coRoom = room) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    page.on('response', (q) => {
      if (q.status() >= 400 && !q.url().includes('/__co/join')) failures.push(`${who}: ${q.status()} ${q.url()}`);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`${who}: ${m.text().slice(0, 300)}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`${who}: pageerror: ${String(e.message ?? e).slice(0, 300)}`));
    await page.goto(`${server.origin}/?doc=${doc}&locale=tr&tag=${engine}-co-${who}&co=${coRoom}&who=${who}&uname=${encodeURIComponent(uname)}${extra}`);
    await until(`${uname}'s editor to open the document`, async () => {
      const a = appFrame(page);
      if (!a) return false;
      const ph = await a.evaluate(() => document.documentElement.dataset.fxPhase || '');
      if (ph === 'failed') throw new Error(await a.evaluate(() => document.getElementById('fx-status-text')?.textContent || 'failed'));
      return ph === 'ready';
    }, OPEN_MS);
    const x = { who, uname, ctx, page };
    people2.push(x);
    return x;
  };
  const bridge = (x, what) => editorFrame(x.page).evaluate((w) => {
    const b = window.__fxBridge;
    return b ? b[w]() : null;
  }, what);
  try {
    const a = await open('a', 'Ayşe Yılmaz');
    step('Ayşe opened');
    const b = await open('b', 'Mehmet Demir');
    step('Mehmet opened');
    for (const x of [a, b]) {
      if ((await bridge(x, 'together')) !== true) r.problems.push(`${x.uname}'s editor is not editing together`);
    }
    const first = server.relay.snapshot(room);
    r.relayAtStart = first;
    if (!first || !first.blobs.includes('base')) r.problems.push('the session has no base');
    if (!first || first.members.length !== 2) r.problems.push(`the session has ${first?.members.length ?? 0} members, not 2`);
    const ids = await Promise.all([a, b].map((x) => bridge(x, 'people')));
    if (new Set(ids[0]).size !== ids[0].length) r.problems.push(`two people share an editor user id: ${JSON.stringify(ids[0])}`);
    await until('each editor to count two people', async () => (await people(a.page, 'docx')).visible === 2 && (await people(b.page, 'docx')).visible === 2, 30_000);
    step('two people');

    // Zeynep may only read the file: she joins as a watcher (filex 0.56).
    const w = await open('w', 'Zeynep Kaya', '&ro=1');
    step('Zeynep opened (watching)');
    if ((await bridge(w, 'together')) !== true) r.problems.push("Zeynep's editor is not following the session");

    // Ayşe types: her changes reach Mehmet's bridge, and the watcher's.
    await typeInto(a.page, 'docx');
    step('Ayşe typed');
    const counts = await until('the three bridges to hold the same changes', async () => {
      const ca = await bridge(a, 'changes');
      const cb = await bridge(b, 'changes');
      const cw = await bridge(w, 'changes');
      return ca > 0 && ca === cb && ca === cw ? { a: ca, b: cb, w: cw } : false;
    }, 30_000);
    step('the same changes', counts);
    // What Zeynep's editor shows, read from its own document (not the
    // bridge's count): ONLYOFFICE's live viewer (liveViewerSupport) puts the
    // changes in as they land, before anybody saves.
    let lastSeen = null;
    const shown = await until("Zeynep's viewer to show what Ayşe typed", async () => {
      const v = await viewerFacts(w.page);
      lastSeen = v;
      return v.text.includes(TYPED) ? v : false;
    }, 30_000).catch(async (e) => {
      const has = async (x) => (await viewerFacts(x.page)).text.includes(TYPED);
      throw new Error(`${e?.message ?? e}; her viewer read ${JSON.stringify(lastSeen).slice(0, 300)} (Ayşe's editor holds the text: ${await has(a)}, Mehmet's: ${await has(b)})`);
    });
    step('Zeynep sees it', { viewMode: shown.viewMode, liveViewer: shown.liveViewer });
    r.watcher = { viewMode: shown.viewMode, liveViewer: shown.liveViewer, afterTypedMs: r.steps.at(-1).ms - r.steps.find((s) => s.name === 'Ayşe typed').ms };
    if (!shown.viewMode) r.problems.push("Zeynep's editor is not in view mode");
    if (!shown.liveViewer) r.problems.push("Zeynep's editor is not ONLYOFFICE's live viewer");
    if (o.shots) {
      mkdirSync(path.join(DIST, 'e2e-shots'), { recursive: true });
      await w.page.screenshot({ path: path.join(DIST, 'e2e-shots', `${engine}-together-watcher.png`) });
    }
    const watcher = server.relay.snapshot(room).members.find((m) => m.name === 'Zeynep Kaya');
    if (!watcher || watcher.canEdit) r.problems.push('the watcher is not a member that may not write');
    else if (server.relay.snapshot(room).log.some((e) => e.client === watcher.client && e.kind !== 'join')) r.problems.push('the watcher wrote into the log');
    const closedW = await closeTab(w.page);
    await until('the log to say Zeynep left', () => server.relay.snapshot(room).log.some((e) => e.kind === 'leave' && e.client === watcher?.client), 20_000);
    step('Zeynep left', { page: closedW, how: server.relay.snapshot(room).departures.find((d) => d.client === watcher?.client)?.how });
    await sleep(1500);
    const la = JSON.stringify(await bridge(a, 'locks'));
    const lb = JSON.stringify(await bridge(b, 'locks'));
    r.locks = { a: la.length, b: lb.length };
    if (la !== lb) r.problems.push('the two bridges hold different locks');
    step('the same locks');

    // Mehmet saves: the file holds Ayşe's text, and the log says how far the save reaches.
    const tagB = `${engine}-co-b`;
    const before = server.saves.filter((x) => x.tag === tagB).length;
    const answer = await b.page.evaluate(() => window.__fx.hostSave());
    if (answer?.error) r.problems.push(`Mehmet's Save: ${JSON.stringify(answer.error)}`);
    const saved = await until("Mehmet's save to write the file", () => server.saves.filter((x) => x.tag === tagB)[before], 60_000);
    step('saved (Mehmet)', { bytes: saved.size, through: saved.through });
    if (!documentText(readFileSync(saved.file), 'docx').includes(TYPED)) r.problems.push("Mehmet's save does not hold what Ayşe typed");
    if (saved.through === null || !saved.together) r.problems.push(`the save was not written into the log (through ${saved.through})`);
    const afterSave = server.relay.snapshot(room);
    const savedEntry = afterSave.log.filter((e) => e.kind === 'saved').pop();
    if (!savedEntry || savedEntry.through < afterSave.changesHead) r.problems.push(`the log's save reaches ${savedEntry?.through ?? 'nothing'}, the last change is ${afterSave.changesHead}`);
    await until('neither to be told "unsaved changes"', async () => !(await a.page.evaluate(() => window.__fx.dirty)) && !(await b.page.evaluate(() => window.__fx.dirty)), 20_000);
    step('nothing unsaved');

    // Mehmet leaves: the log says so, Ayşe counts one again.
    const closedB = await closeTab(b.page);
    await until('the log to say Mehmet left', () => server.relay.snapshot(room).log.filter((e) => e.kind === 'leave').length >= 2, 20_000);
    await until("Ayşe's editor to count one person again", async () => (await people(a.page, 'docx')).visible === 1, 30_000);
    step('Mehmet left', { page: closedB, how: server.relay.snapshot(room).departures.at(-1)?.how });
    r.relayAtEnd = server.relay.snapshot(room).log.map((e) => `${e.seq}:${e.kind}:${e.client}`);

    // A person who may only read a document nobody is editing: nothing to
    // follow, it opens as it is (filex 0.56: a watcher starts no session).
    const alone = await open('v', 'Can Aydın', '&ro=1', `${room}-nobody`);
    if ((await bridge(alone, 'together')) !== false) r.problems.push('a watcher started a session nobody edits');
    step('a reader alone');

    // A document x2t stops on, opened together (#220 with editing together):
    // the person starts its session and puts the base, the conversion
    // stops; the opening ends "failed" and stays so, says why, the editor is
    // ended - and the member leaves the session it joined (the app's leave,
    // not a drop: the page stays open).
    const sRoom = `${room}-stops`;
    const sctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
    try {
      const sp = await sctx.newPage();
      await sp.goto(`${server.origin}/?doc=stops.docx&locale=tr&tag=${engine}-co-s&co=${sRoom}&who=s&uname=${encodeURIComponent('Deniz Kara')}`);
      const phaseOf = async () => (appFrame(sp) ? await appFrame(sp).evaluate(() => document.documentElement.dataset.fxPhase || '') : '');
      const ended = await until('the opening together to end', async () => {
        const ph = await phaseOf();
        return ph === 'failed' || ph === 'ready' ? ph : false;
      }, OPEN_MS);
      if (ended !== 'failed') r.problems.push(`stops.docx together ended "${ended}", not "failed"`);
      const left = await until('the log to say the member whose opening failed left', () => {
        const snap = server.relay.snapshot(sRoom);
        return snap && snap.log.some((e) => e.kind === 'leave') ? snap : false;
      }, 20_000);
      const how = left.departures.at(-1)?.how;
      if (!left.log.some((e) => e.kind === 'join')) r.problems.push('stops.docx together did not join the session');
      if (how !== 'left') r.problems.push(`the member whose opening failed went "${how}", not by leaving`);
      if (left.members.length !== 0) r.problems.push(`${left.members.length} member(s) still in the failed session`);
      await sleep(AFTER_FAILED_MS);
      const st = await appFrame(sp).evaluate(() => ({
        phase: document.documentElement.dataset.fxPhase || '',
        text: document.getElementById('fx-status-text')?.textContent || '',
        editorFrames: document.querySelectorAll('#fx-editor-box iframe').length,
      }));
      step('failed together, left', { how, phase: st.phase });
      r.failedTogether = { how, ...st };
      if (st.phase !== 'failed') r.problems.push(`${AFTER_FAILED_MS / 1000} s after it failed together the page says "${st.phase}"`);
      if (st.text !== STOPPED_TR) r.problems.push(`together, the person reads ${JSON.stringify(st.text)}, not ${JSON.stringify(STOPPED_TR)}`);
      if (st.editorFrames !== 0) r.problems.push('together, the editor is still loading behind the error');
    } finally {
      await sctx.close().catch(() => {});
    }
  } catch (e) {
    r.problems.push(String(e?.message ?? e).slice(0, 400));
    for (const x of people2) {
      try {
        mkdirSync(path.join(DIST, 'e2e-shots'), { recursive: true });
        if (!x.page.isClosed()) await x.page.screenshot({ path: path.join(DIST, 'e2e-shots', `${engine}-together-${x.who}-FAILED.png`) });
      } catch {
        /* the page is gone */
      }
    }
  }
  for (const x of people2) await x.ctx.close().catch(() => {});
  r.failures = [...new Set(failures)];
  r.consoleErrors = [...new Set(consoleErrors)];
  if (r.failures.length) r.problems.push(`failed requests: ${r.failures.slice(0, 5).join(', ')}`);
  r.ok = r.problems.length === 0;
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
  // On a phone: the document in ONLYOFFICE's phone app, light and dark.
  for (const theme of ['light', 'dark']) {
    const ctx = await phoneContext(browser, engine, theme);
    const page = await ctx.newPage();
    const name = `${engine}-tr.docx-phone-390-${theme}.png`;
    try {
      await page.goto(`${server.origin}/?doc=tr.docx&locale=tr&theme=${theme}&tag=shot-${engine}-phone-${theme}`);
      await viewReady(page, 'reader');
      await sleep(1500);
      await page.screenshot({ path: path.join(DIST, 'e2e-shots', name) });
      out.push({ name, ok: true });
    } catch (e) {
      out.push({ name, ok: false, error: String(e?.message ?? e).slice(0, 200) });
    }
    await ctx.close();
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
      if (o.settings) {
        const r = await settingsRun(browser, server, engine);
        report.results.push(r);
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${engine} ${r.doc}${r.ok ? '' : `: ${r.problems.join('; ')}`}`);
      }
      if (o.phone) {
        const r = await phoneRun(browser, server, engine, o);
        report.results.push(r);
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${engine} ${r.doc}${r.ok ? '' : `: ${r.problems.join('; ')}`}`);
      }
      for (const doc of o.formula ? ['formula.odt', 'formula-nostyle.odt'] : []) {
        const r = await formulaRun(browser, server, engine, doc);
        report.results.push(r);
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${engine} ${r.doc}${r.ok ? '' : `: ${r.problems.join('; ')}`}`);
      }
      if (o.stop) {
        const r = await stopRun(browser, server, engine);
        report.results.push(r);
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${engine} ${r.doc}${r.ok ? '' : `: ${r.problems.join('; ')}`}`);
      }
      if (o.encrypted) {
        const r = await encryptedRun(browser, server, engine, o);
        report.results.push(r);
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${engine} ${r.doc}${r.ok ? '' : `: ${r.problems.join('; ')}`}`);
      }
      if (o.together) {
        const r = await togetherRun(browser, server, engine, o);
        report.results.push(r);
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${engine} ${r.doc}${r.ok ? '' : `: ${r.problems.join('; ')}`}`);
      }
      if (o.about) {
        const r = await aboutRun(browser, server, engine, o);
        report.results.push(r);
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${engine} ${r.doc}${r.ok ? '' : `: ${r.problems.join('; ')}`}`);
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
