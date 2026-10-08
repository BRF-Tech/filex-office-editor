// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The app page (index.html): what filex opens.
//
//   1. connect to filex (@brftech/filex-app-ui) and read the file;
//   2. convert it to the editor's format with x2t, in a worker;
//   3. start ONLYOFFICE's editor (api.js, DocsAPI.DocEditor) from the
//      package - its page runs in a frame of its own, where frame.ts answers
//      it in place of a Document Server - and hand that frame the document;
//   4. save: the editor's Save, filex's Save, Ctrl+S, and every ten minutes
//      while there are changes - the document as the editor holds it, back
//      through x2t to the file's own format, as a new version of the file.
//
//   5. "Download as" and Print: the editor page hands over what the editor
//      asked for (frame/export.ts), x2t writes it, filex hands it to the
//      person (ui.download) or prints it;
//   6. the editor's settings: kept in filex's store for this app
//      (state.get/set, settings.ts) and given back at the next opening;
//   7. on a phone: ONLYOFFICE's phone app to read (it only reads, see
//      config.ts phoneLayout), and "Edit" / "Reading view" to switch to the
//      editor (folded) and back, with the document as it is.
//
// One person, one document (plan step A3). Nothing leaves the browser but
// the saves, the files the person asks for and the settings, and those go
// to filex through the SDK.

import { connect, FilexError, type FilexApp } from '@brftech/filex-app-ui';

import { exportFormat, exportName } from '../formats';
import {
  FRAME_PORT,
  FRAME_VERSION,
  isFrameHello,
  type ExportRequest,
  type FromFrame,
  type OpenMessage,
  type SnapshotResult,
  type ToFrame,
} from '../frame-protocol';
import { adaptOpaqueOrigin } from '../origin';
import { SETTINGS_KEY, readSettings, sameSettings, type Settings } from '../settings';
import { NARROW_PX, editorConfig, isPhone, kindOf, uiLang, type Kind, type View } from './config';
import { STRINGS, type Strings } from './strings';
import { X2tClient, type Converted } from './x2t-client';

declare const __OO_BUILD__: { version: string; number: number };
declare const __OO_SOURCE_TAG__: string;
declare const __APP_VERSION__: string;

/** A save every ten minutes while there are changes (the policy of #189). */
const AUTOSAVE_MS = 10 * 60 * 1000;
/** How long a save waits for the editor to hand its last changes to the bridge. */
const SETTLE_MS = 3000;
/** The editor's settings are kept this long after its last write (a burst of writes is one write to filex). */
const KEEP_SETTINGS_MS = 2000;
/** filex's answer when it has no such method (an older filex) or no handler for it here. */
const NOT_OFFERED = new Set(['unknown_method', 'unavailable', 'not_granted']);

const BASE = new URL('.', document.baseURI).href;

/** What api.js's DocsAPI.DocEditor gives back: the app uses only its end. */
interface DocEditor {
  destroyEditor?: () => void;
}

interface DocsApiWindow {
  DocsAPI?: { DocEditor: new (placeholder: string, config: Record<string, unknown>) => DocEditor };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/**
 * Where the opening is: on <html data-fx-phase>, and with its time in
 * window.__fxPhases, for the measurements (e2e/run.mjs) and anyone looking
 * at a page that does not open.
 */
function phase(name: string): void {
  document.documentElement.dataset.fxPhase = name;
  const w = window as unknown as { __fxPhases?: [string, number][] };
  (w.__fxPhases ??= []).push([name, Math.round(performance.now())]);
}

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`index.html has no #${id}`);
  return e;
}

function setStatus(text: string | null, error = false): void {
  const box = el('fx-status');
  if (text === null) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.classList.toggle('fx-error', error);
  el('fx-status-text').textContent = text;
}

function setLegal(t: Strings): void {
  const box = el('fx-legal');
  box.setAttribute('aria-label', t.legalLabel);
  box.textContent = t.legal({ version: __OO_BUILD__.version, build: __OO_BUILD__.number, tag: __OO_SOURCE_TAG__, app: __APP_VERSION__ });
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`${src} did not load`));
    document.head.appendChild(s);
  });
}

function randomKey(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return `fx${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function reason(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  const msg = String((e as Error)?.message ?? e);
  return typeof code === 'string' && code !== msg ? `${msg} (${code})` : msg;
}

// ---------------------------------------------------------------------------
// The editor's frame
// ---------------------------------------------------------------------------

function editorFrame(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>('#fx-editor-box iframe');
}

/** api.js hears the editor frame's messages (origin.ts says why this is needed under filex). */
function adaptEditorOrigin(): void {
  adaptOpaqueOrigin(
    window,
    () => editorFrame()?.contentWindow,
    () => {
      const f = editorFrame();
      try {
        return f ? new URL(f.src, document.baseURI).origin : null;
      } catch {
        return null;
      }
    },
  );
}

/** The link to the editor's frame: its hello, then a MessagePort only the two hold. */
class FrameLink {
  private port: MessagePort | null = null;
  private readonly outbox: { m: ToFrame; transfer: Transferable[] }[] = [];
  private seq = 0;
  private readonly snapshots = new Map<number, (r: SnapshotResult) => void>();
  onMessage: (m: FromFrame) => void = () => {};

  constructor() {
    window.addEventListener('message', (ev: MessageEvent) => {
      const f = editorFrame();
      if (!f || ev.source !== f.contentWindow || !f.contentWindow || !isFrameHello(ev.data)) return;
      if (this.port) {
        // The editor's page loaded again: the document it had is gone with it.
        this.onMessage({ t: 'state', state: 'closed' });
        return;
      }
      const ch = new MessageChannel();
      this.port = ch.port1;
      ch.port1.onmessage = (e: MessageEvent) => this.receive(e.data as FromFrame);
      f.contentWindow.postMessage({ type: FRAME_PORT, v: FRAME_VERSION }, '*', [ch.port2]);
      for (const o of this.outbox.splice(0)) ch.port1.postMessage(o.m, o.transfer);
    });
  }

  send(m: ToFrame, transfer: Transferable[] = []): void {
    if (this.port) this.port.postMessage(m, transfer);
    else this.outbox.push({ m, transfer });
  }

  /**
   * The editor's frame is being replaced (the person switched between the
   * phone app and the editor): forget its port and what was waiting for it,
   * so the next frame's hello gets a port of its own.
   */
  reset(): void {
    try {
      this.port?.close();
    } catch {
      // Closed already.
    }
    this.port = null;
    this.outbox.splice(0);
    for (const [id, done] of [...this.snapshots]) done({ t: 'snapshot', id, error: 'the editor was closed' });
    this.snapshots.clear();
  }

  snapshot(): Promise<SnapshotResult> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.snapshots.set(id, resolve);
      this.send({ t: 'snapshot', id });
    });
  }

  private receive(m: FromFrame): void {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'snapshot') {
      const done = this.snapshots.get(m.id);
      this.snapshots.delete(m.id);
      done?.(m);
      return;
    }
    this.onMessage(m);
  }
}

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

class OfficeApp {
  readonly link = new FrameLink();
  private frameDirty = false;
  /** The editor has changes it has not handed to the bridge yet (api.js onDocumentStateChange). */
  private editorDirty = false;
  private shownDirty = false;
  private saving: Promise<void> | null = null;
  private lastSave = Date.now();
  private settleWaiters: (() => void)[] = [];
  /** The settings filex holds for the editor, and the ones waiting to go there. */
  private keptSettings: Settings = {};
  private nextSettings: Settings | null = null;
  private settingsTimer: ReturnType<typeof setTimeout> | null = null;
  /** What the app shows (config.ts View): the phone app only reads; the editor edits a file that can be written. */
  view: View = 'editor';
  /** What filex granted for handing files over: ui:download, ui:print (filex 0.55). */
  grants = { download: false, print: false };

  constructor(
    private readonly fx: FilexApp,
    private readonly t: Strings,
    private readonly kind: Kind,
    private readonly x2t: X2tClient,
    private readonly canEdit: boolean,
    private readonly title: string,
  ) {
    this.link.onMessage = (m) => this.onFrame(m);
  }

  /** The settings filex kept, for the editor page (its first word on the port). */
  giveSettings(values: Settings): void {
    this.keptSettings = values;
    this.link.send({ t: 'settings', values });
  }

  /** The kept settings again, as they are now, for the next editor page (after a switch). */
  resendSettings(): void {
    this.keepSettings();
    this.link.send({ t: 'settings', values: this.keptSettings });
  }

  /** A save can be made: the file can be written and the editor (not the phone app, which reads) holds it. */
  private get editing(): boolean {
    return this.canEdit && this.view === 'editor';
  }

  /** The editor's frame was replaced by one showing `view`: what the old one had in hand is gone with it. */
  frameReplaced(view: View): void {
    this.view = view;
    this.frameDirty = false;
    this.editorDirty = false;
    for (const w of this.settleWaiters.splice(0)) w();
    this.updateDirty();
  }

  /**
   * The document as the editor holds it now, as Editor.bin again - what the
   * phone app opens when the person goes back to reading. Unsaved changes
   * are saved first (the editor that holds them is about to go).
   */
  async current(): Promise<Converted> {
    if (this.shownDirty || this.editorDirty) await this.save();
    await this.settle();
    const snap = await this.link.snapshot();
    if (snap.error || typeof snap.bin !== 'string') throw new Error(snap.error ?? 'no document');
    const file = await this.x2t.convert('bin', this.kind.ext, snap.bin, snap.media ?? []);
    return this.x2t.convert(this.kind.ext, 'bin', file.bytes);
  }

  private settingsChanged(values: Settings): void {
    this.nextSettings = values;
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => this.keepSettings(), KEEP_SETTINGS_MS);
  }

  /** Write the editor's settings to filex, if they changed. */
  keepSettings(): void {
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
    const next = this.nextSettings;
    this.nextSettings = null;
    if (!next || sameSettings(next, this.keptSettings)) return;
    this.keptSettings = next;
    this.fx.state.set(SETTINGS_KEY, next).catch((e) => console.warn('[office-editor] settings not kept:', reason(e)));
  }

  private onFrame(m: FromFrame): void {
    switch (m.t) {
      case 'save':
        void this.save().catch(() => {});
        return;
      case 'settings-changed':
        this.settingsChanged(readSettings(m.values));
        return;
      case 'export':
        void this.exportFor(m);
        return;
      case 'dirty':
        this.frameDirty = m.dirty;
        this.updateDirty();
        return;
      case 'state':
        if (m.state === 'closed') setStatus(this.t.openFailed('the editor page reloaded'), true);
        return;
      case 'notice':
        console.warn('[office-editor]', m.what, m.detail ?? '');
        // A format x2t does not write here, or a server command: the phone
        // app's Download lists every format a Document Server writes.
        if (m.what === 'export-refused') this.fx.toast(this.t.notAvailable, 'info');
        return;
    }
  }

  /** api.js onDocumentStateChange: true while the editor holds changes not yet sent. */
  onEditorState(dirty: boolean): void {
    this.editorDirty = dirty;
    if (!dirty) for (const w of this.settleWaiters.splice(0)) w();
    this.updateDirty();
  }

  private updateDirty(): void {
    const dirty = this.editing && (this.frameDirty || this.editorDirty);
    if (dirty === this.shownDirty) return;
    this.shownDirty = dirty;
    this.fx.dirty(dirty);
  }

  /** Wait (a little) for the editor to send what it holds, so the save and "saved" agree. */
  private settle(): Promise<void> {
    if (!this.editorDirty) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, SETTLE_MS);
      this.settleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Write the document as the editor holds it now, as a new version of the file. One at a time. */
  save(): Promise<void> {
    if (!this.editing) return Promise.resolve();
    if (this.saving) return this.saving;
    const run = (async () => {
      let through = 0;
      try {
        await this.settle();
        const snap = await this.link.snapshot();
        if (snap.error || typeof snap.bin !== 'string') throw new Error(snap.error ?? 'no document');
        through = snap.through ?? 0;
        const out = await this.x2t.convert('bin', this.kind.ext, snap.bin, snap.media ?? []);
        await this.fx.save(out.bytes, { mime: this.kind.mime });
        this.lastSave = Date.now();
        this.link.send({ t: 'saved', ok: true, through });
      } catch (e) {
        this.link.send({ t: 'saved', ok: false, through: 0 });
        this.fx.toast(this.t.saveFailed(reason(e)), 'error');
        throw e;
      }
    })();
    this.saving = run.finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  /** Write what "Download as" or Print asked for, and hand it to filex. */
  private async exportFor(m: ExportRequest): Promise<void> {
    let ok = true;
    try {
      const f = exportFormat(m.format, this.kind.documentType);
      if (!f) throw new Error(`format ${m.format} is not written here`);
      const out = await this.x2t.export({ bin: m.bin, media: m.media ?? [], formatTo: f.id, ext: f.ext, pdf: m.pdf, fonts: m.fonts, json: m.json });
      const name = exportName(m.title || this.title, f);
      if (m.purpose === 'print') await this.print(name, out.bytes);
      else await this.fx.download(name, out.bytes, f.mime);
    } catch (e) {
      // A no to filex's question is the person's answer, not a failure.
      if (!(e instanceof FilexError && e.code === 'cancelled')) {
        ok = false;
        this.fx.toast(this.t.exportFailed(reason(e)), 'error');
      }
    }
    this.link.send({ t: 'exported', id: m.id, ok });
  }

  /**
   * Print a PDF. With the ui:print grant (filex 0.55, `ui.print` in the
   * manifest), filex prints it from its own print page; without it, or where
   * filex cannot (an older filex: unknown_method; a host with no print page:
   * unavailable), the PDF goes to the person as a download (ui:download), to
   * print from their PDF viewer, and they are told - a sandboxed frame like
   * this one may not open the browser's print dialog (window.print needs
   * allow-modals, which filex does not give).
   */
  private async print(name: string, bytes: ArrayBuffer): Promise<void> {
    if (this.grants.print) {
      try {
        const copy = bytes.slice(0);
        await this.fx.request('ui.print' as never, { name, data: copy, mime: 'application/pdf' }, [copy]);
        return;
      } catch (e) {
        if (!(e instanceof FilexError && NOT_OFFERED.has(e.code)) || !this.grants.download) throw e;
      }
    }
    await this.fx.download(name, bytes, 'application/pdf');
    this.fx.toast(this.t.printAsDownload, 'info');
  }

  /** The ten-minute save, while there are changes. */
  tick(): void {
    if (this.shownDirty && !this.saving && Date.now() - this.lastSave >= AUTOSAVE_MS) void this.save().catch(() => {});
  }
}

async function readDocument(fx: FilexApp, kind: Kind): Promise<ArrayBuffer> {
  const file = await fx.open(0);
  const bytes = await file.bytes();
  if (bytes.byteLength > 0 || !kind.blank) return bytes;
  // An empty file opens as a blank document of its kind (filex's New menu
  // copies the same blank, so this is only a file made empty elsewhere).
  const res = await fetch(new URL(kind.blank, BASE).href);
  if (!res.ok) throw new Error(`the blank ${kind.ext} is missing from the package`);
  return res.arrayBuffer();
}

async function main(): Promise<void> {
  let fx: FilexApp;
  try {
    fx = await connect();
  } catch {
    setLegal(STRINGS[uiLang(navigator.language)]);
    setStatus(STRINGS[uiLang(navigator.language)].notInFilex, true);
    return;
  }
  phase('connected');
  const s = fx.session;
  const t = STRINGS[uiLang(s.locale)];
  setLegal(t);
  const info = s.files?.[0];
  const kind = kindOf(info?.ext);
  if (!info || !kind) {
    setStatus(t.unsupported(info?.ext ?? '?'), true);
    return;
  }
  setStatus(t.opening(info.name));
  const canEdit = !info.readOnly;
  const grants = Array.isArray(s.grants) ? s.grants : [];
  const canDownload = grants.includes('ui:download');
  // filex 0.55 prints a PDF the app hands it (ui:print); without that grant
  // Print hands the PDF over as a download (print()).
  const canPrintPdf = grants.includes('ui:print');

  const x2t = new X2tClient(new URL('filex/x2t-worker.js', BASE).href, new URL('x2t/', BASE).href);
  const app = new OfficeApp(fx, t, kind, x2t, canEdit, info.name);
  app.grants = { download: canDownload, print: canPrintPdf };
  const userName = s.user?.name || 'filex';
  let dark = s.theme?.mode === 'dark';
  // A phone opens ONLYOFFICE's phone app, to read (config.ts phoneLayout);
  // "Edit" switches to the editor, folded. Decided once, at the opening.
  const phone = isPhone({
    width: window.innerWidth,
    coarsePointer: typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
    touchPoints: typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0,
  });

  // The editor's kept settings: the editor page holds the editor's start for them.
  fx.state
    .get(SETTINGS_KEY)
    .then(readSettings, () => ({}))
    .then((values) => app.giveSettings(values));
  fx.on('close.request', () => app.keepSettings());
  window.addEventListener('pagehide', () => app.keepSettings());

  // The document is read and converted while the editor loads.
  void x2t.started().then(() => phase('x2t-ready'), () => {});
  const converted = readDocument(fx, kind).then((bytes) => {
    phase('read');
    return x2t.convert(kind.ext, 'bin', bytes);
  });

  let docsApi: NonNullable<DocsApiWindow['DocsAPI']>;
  try {
    adaptEditorOrigin();
    await loadScript(new URL('editor/web-apps/apps/api/documents/api.js', BASE).href);
    const api = (window as unknown as DocsApiWindow).DocsAPI;
    if (!api) throw new Error('api.js did not define DocsAPI');
    docsApi = api;
  } catch (e) {
    phase('failed');
    setStatus(t.openFailed(reason(e)), true);
    return;
  }

  /** The editor (or the phone app) on screen now. */
  let editor: DocEditor | null = null;

  /** Start ONLYOFFICE's editor (`view` "editor") or its phone app ("reader"); returns the document key of this frame. */
  const start = (view: View): string => {
    const key = randomKey();
    document.documentElement.dataset.fxView = view;
    const config = editorConfig({
      kind,
      title: info.name,
      key,
      locale: s.locale,
      dark,
      userName,
      canEdit,
      canDownload,
      // Print needs filex's print (ui:print) or, where filex has none, a download.
      canPrint: canPrintPdf || canDownload,
      narrow: window.innerWidth > 0 && window.innerWidth < NARROW_PX,
      phone: view === 'reader',
      events: {
        onAppReady: () => phase('editor-app-ready'),
        onDocumentReady: () => {
          phase('ready');
          setStatus(null);
        },
        onDocumentStateChange: (e) => app.onEditorState(e.data === true),
        onError: (e) => {
          const d = e.data as { errorCode?: number; errorDescription?: string } | undefined;
          console.warn('[office-editor] editor error', d);
        },
      },
    });
    editor = new docsApi.DocEditor('fx-editor', config);
    return key;
  };

  /** Hand the editor page of this frame a copy of the document (the app keeps its own for a switch). */
  const handOver = (doc: Converted, key: string): void => {
    const media = doc.media.map((m) => ({ name: m.name, bytes: m.bytes.slice(0) }));
    const open: OpenMessage = {
      t: 'open',
      editorType: kind.editorType,
      bin: doc.bytes.slice(0),
      media,
      name: userName,
      // The phone app reads only; the bridge then lets no change in either.
      canEdit: canEdit && app.view === 'editor',
      key,
    };
    app.link.send(open, [open.bin, ...media.map((m) => m.bytes)]);
  };

  app.frameReplaced(phone ? 'reader' : 'editor');
  let key: string;
  /** The document as the app last converted it: what the next frame is given. */
  let latest: Converted;
  try {
    key = start(app.view);
    fx.on('theme', (th) => {
      dark = (th as { mode?: string })?.mode === 'dark';
      app.link.send({ t: 'theme', dark });
    });
    latest = await converted;
    phase('converted');
    handOver(latest, key);
  } catch (e) {
    phase('failed');
    setStatus(t.openFailed(reason(e)), true);
    return;
  }

  // ---- The switch between the phone app and the editor (a phone, a file that can be written).
  const button = el('fx-switch') as HTMLButtonElement;
  const showSwitch = (): void => {
    if (!phone || !canEdit) {
      button.hidden = true;
      return;
    }
    const reading = app.view === 'reader';
    button.hidden = false;
    button.dataset.view = app.view;
    button.textContent = reading ? t.edit : t.read;
    button.title = reading ? t.editHint : t.readHint;
  };
  let switching = false;
  const switchTo = async (view: View): Promise<void> => {
    if (switching || view === app.view) return;
    switching = true;
    button.disabled = true;
    let doc: Converted;
    try {
      // Back to reading: the document as the editor holds it, saved first.
      // To the editor: the phone app changed nothing, the last one stands.
      doc = view === 'reader' ? await app.current() : latest;
    } catch (e) {
      fx.toast(t.switchFailed(reason(e)), 'error');
      switching = false;
      button.disabled = false;
      return;
    }
    phase('switching');
    setStatus(t.opening(info.name));
    try {
      app.keepSettings();
      editor?.destroyEditor?.();
      editor = null;
      app.link.reset();
      app.frameReplaced(view);
      latest = doc;
      key = start(view);
      app.resendSettings();
      handOver(latest, key);
      showSwitch();
    } catch (e) {
      phase('failed');
      setStatus(t.openFailed(reason(e)), true);
    } finally {
      switching = false;
      button.disabled = false;
    }
  };
  button.addEventListener('click', () => {
    void switchTo(app.view === 'reader' ? 'editor' : 'reader');
  });
  showSwitch();

  if (canEdit) {
    fx.onSave(async () => {
      await app.save();
    });
    setInterval(() => app.tick(), 30_000);
  }
}

void main();
