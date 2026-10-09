// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The editor page's script. The bundle serves it at
// web-apps/vendor/socketio/socket.io.min.js - the address ONLYOFFICE's editor
// pages load socket.io from (with RequireJS, as the module "socketio") - so
// the editor's own files stay as ONLYOFFICE ships them and its socket is the
// shim (shim.ts): a Document Server answered here, in this page, by the
// bridge (bridge.ts) over the session (session.ts). Nothing of the document
// leaves the page through it.
//
// It also holds this page's half of the link to the app page
// (frame-protocol.ts): the document comes in as bytes and becomes blob:
// addresses made HERE (a page may read only its own), and a save goes out
// as the editor holds the document (asc_nativeGetFile) with its images.

import { OfficeBridge, personName, type BridgeEntry, type BridgeMember } from '../bridge';
import type { DocumentKind } from '../formats';
import {
  EDITOR_USER_ID,
  FRAME_HELLO,
  FRAME_VERSION,
  MEDIA_NAME,
  isFramePort,
  mediaType,
  type ExportRequest,
  type FromFrame,
  type MediaFile,
  type OpenMessage,
  type SnapshotResult,
  type ToFrame,
} from '../frame-protocol';
import type { EditorMessage } from '../protocol';
import { adaptOpaqueOrigin } from '../origin';
import { LocalSession } from '../session';
import { pickSettings, readSettings } from '../settings';
import { BridgeSocketPort, createSocketIo, installSocketIo } from '../shim';
import { loadedFonts, retry, takeOverDownloads, trimDownloadFormats, type ExportJob } from './export';
import { holdScripts } from './hold';
import { keepImagesInPage } from './images';
import { SaveRetry } from './save-retry';
import { KeptStorage } from './storage';
import { serveTemplatesAsTxt } from './text';
import { trimThemesPath } from './themes-path';
import { guardWorkers } from './workers';

/** The editor's own build (upstream/onlyoffice.json), put in by the build. */
declare const __OO_BUILD__: { version: string; number: number };

type AnyWindow = Window & Record<string, unknown>;

const win = window as unknown as AnyWindow;

let port: MessagePort | null = null;
const early: FromFrame[] = [];
let doc: OpenMessage | null = null;
let connected = false;
const waiting: EditorMessage[] = [];
let bridge: OfficeBridge | null = null;
let session: LocalSession | null = null;
let lastDirty = false;
/** documentOpen's map: filled when the document arrives, read when the bridge answers the editor's auth. */
const documentUrls: Record<string, string> = {};
/** How long the editor's start waits for its kept settings before it starts without them. */
const SETTINGS_WAIT_MS = 5000;
/** Exports the app page is writing: their end, by id. */
const pendingExports = new Map<number, () => void>();
let exportSeq = 0;

/** Which editor this page is (its address: web-apps/apps/<editor>/main/index.html, or .../mobile/ for the phone app). */
function pageKind(): DocumentKind {
  const m = /\/apps\/(documenteditor|spreadsheeteditor|presentationeditor)\//.exec(location.pathname);
  return m?.[1] === 'spreadsheeteditor' ? 'cell' : m?.[1] === 'presentationeditor' ? 'slide' : 'word';
}
const kind = pageKind();
/** ONLYOFFICE's phone app (web-apps/apps/<editor>/mobile/), which reads only, rather than the editor ("main"). */
const phoneApp = /\/apps\/[a-z]+\/mobile\//.test(location.pathname);

/** Where the editor page is (see the app page's phase()). */
function phase(name: string): void {
  document.documentElement.dataset.fxPhase = name;
  const w = window as unknown as { __fxPhases?: [string, number][] };
  (w.__fxPhases ??= []).push([name, Math.round(performance.now())]);
}

function post(m: FromFrame, transfer: Transferable[] = []): void {
  if (!port) {
    // Before the port only words go out; a snapshot needs the port anyway.
    early.push(m);
    return;
  }
  port.postMessage(m, transfer);
}

function notice(what: string, detail?: unknown): void {
  post({ t: 'notice', what, detail: detail === undefined ? undefined : String(detail).slice(0, 200) });
}

// ---------------------------------------------------------------------------
// The socket: the editor connects as soon as it has its configuration, which
// may be before the document has come over. Its first messages wait.
// ---------------------------------------------------------------------------

const saveRetry = new SaveRetry();

// The editor's settings: what it writes goes to the app page to keep
// (settings.ts); what was kept comes in as the app page's first word, and
// the editor's start waits for it (installSocketIo), a few seconds at most.
// What the editor writes before the kept settings are in is not reported
// on its own: the app page keeps the whole set it is sent, and a set
// without the kept ones would drop them. It goes out once they are in.
let settingsIn = false;
let reportWaiting = false;
const kept = new KeptStorage(win, (entries) => {
  if (!settingsIn) {
    reportWaiting = true;
    return;
  }
  post({ t: 'settings-changed', values: pickSettings(entries) });
});
kept.install();
let settingsArrived: () => void = () => {};
const settingsReady = new Promise<void>((resolve) => {
  settingsArrived = resolve;
  setTimeout(resolve, SETTINGS_WAIT_MS);
});

const socketPort = new BridgeSocketPort(() => ({
  connect: () => {
    phase('socket');
    saveRetry.attach(editorApi());
    keepImagesInPage(win.AscCommon as Parameters<typeof keepImagesInPage>[0]);
    connected = true;
    if (bridge) bridge.connect();
    else begin();
  },
  fromEditor: (msg) => {
    saveRetry.sent(msg.type);
    if (bridge) bridge.fromEditor(msg);
    else waiting.push(msg);
  },
}));

installSocketIo(win as unknown as { io?: unknown; define?: unknown }, createSocketIo(socketPort.connector), settingsReady);
// The phone app has no RequireJS to hold: its sdkjs scripts wait instead (hold.ts).
if (phoneApp) holdScripts(document.body, settingsReady);
serveTemplatesAsTxt(win);
trimThemesPath(win);
guardWorkers(win, document.baseURI);
// The editor's Gateway hears the app page (origin.ts): with the origin the
// app page's address has, which api.js gave the editor as parentOrigin.
adaptOpaqueOrigin(
  window,
  () => (window.parent !== window ? window.parent : null),
  () => {
    const given = win.parentOrigin;
    return typeof given === 'string' ? given : null;
  },
);

function begin(): void {
  if (bridge || !doc || !connected) return;
  const open = doc;
  const me: BridgeMember = { client: 'local', user: EDITOR_USER_ID, name: personName(open.name), indexUser: 1, canEdit: open.canEdit };
  const s = new LocalSession({ me, notice });
  const b = new OfficeBridge({
    me,
    editorType: open.editorType,
    build: __OO_BUILD__,
    documentUrls,
    docId: open.key,
    keeperName: 'filex',
    host: s.host({
      toEditor: (msg) => {
        socketPort.toEditor(msg);
        saveRetry.seen(msg.type);
      },
      // Save in the editor (its button, Ctrl+S): the app page writes the file.
      save: () => post({ t: 'save' }),
      notice,
    }),
  });
  session = s;
  bridge = b;
  b.connect();
  for (const m of waiting.splice(0)) b.fromEditor(m);
  s.start({
    onEntry: (e: BridgeEntry) => {
      b.onEntry(e);
      const dirty = b.dirty;
      if (dirty !== lastDirty) {
        lastDirty = dirty;
        post({ t: 'dirty', dirty });
      }
    },
    onLease: (granted) => b.onLease(granted),
    start: () => b.start(),
  });
  phase('bridge');
  post({ t: 'state', state: 'connected' });
}

// ---------------------------------------------------------------------------
// The app page
// ---------------------------------------------------------------------------

function onOpen(m: OpenMessage): void {
  if (doc) return;
  phase('document');
  doc = m;
  documentUrls['Editor.bin'] = URL.createObjectURL(new Blob([m.bin], { type: 'application/octet-stream' }));
  for (const f of m.media) {
    if (!MEDIA_NAME.test(f.name)) continue;
    documentUrls[`media/${f.name}`] = URL.createObjectURL(new Blob([f.bytes], { type: mediaType(f.name) }));
  }
  begin();
}

/** The editor's API object: window.editor (text, presentation) or Asc.editor (spreadsheet). */
function editorApi(): Record<string, unknown> | null {
  const asc = win.Asc as Record<string, unknown> | undefined;
  const api = (asc && (asc.editor as Record<string, unknown> | undefined)) || (win.editor as Record<string, unknown> | undefined);
  return api ?? null;
}

function base64Bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** An image the editor has, as bytes: a blob: address of this page, or a data: address. */
async function imageBytes(url: string): Promise<ArrayBuffer | null> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    if (comma < 0 || !/;base64$/i.test(url.slice(0, comma))) return null;
    const b = base64Bytes(url.slice(comma + 1));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  if (!url.startsWith('blob:')) return null;
  const res = await fetch(url);
  return res.ok ? res.arrayBuffer() : null;
}

/** The document's images, by the names Editor.bin refers to them with. */
async function snapshotMedia(): Promise<MediaFile[]> {
  const common = win.AscCommon as Record<string, unknown> | undefined;
  const registry = common?.g_oDocumentUrls as { getUrls?: () => Record<string, string> } | undefined;
  const urls = registry?.getUrls?.() ?? {};
  const out: MediaFile[] = [];
  const seen = new Set<string>();
  for (const [key, url] of Object.entries(urls)) {
    if (!key.startsWith('media/') || typeof url !== 'string') continue;
    const name = key.slice('media/'.length);
    if (!MEDIA_NAME.test(name) || seen.has(name)) continue;
    const bytes = await imageBytes(url);
    if (!bytes) {
      notice('image', `media/${name} could not be read`);
      continue;
    }
    seen.add(name);
    out.push({ name, bytes });
  }
  return out;
}

async function onSnapshot(id: number): Promise<void> {
  const api = editorApi();
  const getFile = api?.asc_nativeGetFile as (() => unknown) | undefined;
  if (!api || typeof getFile !== 'function' || !session) {
    post({ t: 'snapshot', id, error: 'the editor is not ready' });
    return;
  }
  try {
    // The head first: whatever reaches the log after it is newer than this
    // snapshot as far as "saved" goes (it may be in it already; then the
    // next save writes the same again, which is harmless).
    const through = session.head;
    const bin = getFile.call(api);
    if (typeof bin !== 'string' || bin.length === 0) throw new Error('the editor gave no document');
    const media = await snapshotMedia();
    const res: SnapshotResult = { t: 'snapshot', id, bin, media, through };
    post(
      res,
      media.map((m) => m.bytes),
    );
  } catch (e) {
    post({ t: 'snapshot', id, error: String((e as Error)?.message ?? e).slice(0, 200) });
  }
}

/** "Download as" or Print in the editor: the app page writes it (frame/export.ts). */
async function onExport(job: ExportJob, done: () => void): Promise<void> {
  const api = editorApi();
  const getFile = api?.asc_nativeGetFile as (() => unknown) | undefined;
  try {
    if (!api || typeof getFile !== 'function') throw new Error('the editor is not ready');
    const bin = getFile.call(api);
    if (typeof bin !== 'string' || bin.length === 0) throw new Error('the editor gave no document');
    const media = await snapshotMedia();
    const fonts = job.pdf ? loadedFonts(win) : undefined;
    const id = ++exportSeq;
    pendingExports.set(id, done);
    const pdf = job.pdf ? (job.pdf.buffer.slice(job.pdf.byteOffset, job.pdf.byteOffset + job.pdf.byteLength) as ArrayBuffer) : undefined;
    const m: ExportRequest = { t: 'export', id, format: job.format.id, purpose: job.purpose, title: job.title, bin, media, pdf, fonts, json: job.json, text: job.text };
    post(m, [...media.map((f) => f.bytes), ...(fonts ?? []).map((f) => f.bytes), ...(pdf ? [pdf] : [])]);
  } catch (e) {
    notice('export', (e as Error)?.message ?? e);
    done();
  }
}

function onExported(id: number): void {
  const done = pendingExports.get(id);
  pendingExports.delete(id);
  done?.();
}

// The editor's File menu lists every format a Document Server writes; the
// phone app's Download page is its own (what x2t does not write here is
// refused, and the app page says so).
if (!phoneApp) retry(() => trimDownloadFormats(win, kind));
retry(() =>
  takeOverDownloads(
    win,
    kind,
    (job, done) => void onExport(job, done),
    (why) => notice('export-refused', why),
  ),
);

function onSaved(ok: boolean, through: number): void {
  if (ok && through > 0) session?.saved(through);
  bridge?.saved(ok);
}

function onTheme(dark: boolean): void {
  const common = win.Common as { UI?: { Themes?: { setTheme?: (id: string) => void } } } | undefined;
  try {
    common?.UI?.Themes?.setTheme?.(dark ? 'theme-night' : 'theme-white');
  } catch (e) {
    notice('theme', e);
  }
}

function onPortMessage(ev: MessageEvent): void {
  const m = ev.data as ToFrame | null;
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'open':
      onOpen(m);
      return;
    case 'snapshot':
      void onSnapshot(m.id);
      return;
    case 'saved':
      onSaved(m.ok === true, typeof m.through === 'number' ? m.through : 0);
      return;
    case 'theme':
      onTheme(m.dark === true);
      return;
    case 'settings':
      kept.seed(readSettings(m.values));
      settingsIn = true;
      settingsArrived();
      if (reportWaiting) {
        reportWaiting = false;
        post({ t: 'settings-changed', values: pickSettings(kept.entries()) });
      }
      return;
    case 'exported':
      onExported(m.id);
      return;
  }
}

function onWindowMessage(ev: MessageEvent): void {
  // Only the app page that made this frame hands it a port: the parent, by
  // the object, never by an origin ("null" for every sandboxed page).
  if (ev.source !== window.parent || !isFramePort(ev.data) || !ev.ports[0]) return;
  window.removeEventListener('message', onWindowMessage);
  port = ev.ports[0];
  phase('port');
  port.onmessage = onPortMessage;
  for (const m of early.splice(0)) port.postMessage(m);
}

if (window.parent !== window) {
  window.addEventListener('message', onWindowMessage);
  window.parent.postMessage({ type: FRAME_HELLO, v: FRAME_VERSION }, '*');
}
