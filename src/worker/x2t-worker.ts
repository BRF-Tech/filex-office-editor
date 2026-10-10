// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The converter's worker: loads x2t (x2t/x2t.js and x2t.wasm from the
// package) and converts what the app page sends, one document at a time, so
// the page never stops answering while a large file converts.
//
// Under filex a worker can only start from a blob: address (worker-src
// blob:, and an opaque origin may not start one from a URL). The app page
// starts one whose only line imports this file from the package; this file
// then imports x2t.js the same way. Both are scripts of the package
// (script-src), and x2t.wasm is read with fetch (connect-src: the package).
//
// When x2t stops - emscripten's abort() (a function the build does not have,
// "Aborted(missing function: ...)"), a trap, the stack or the memory running
// out - the module cannot be used again. The worker says so once ("stopped",
// with why), then answers the conversion that stopped it with the same
// reason and refuses any other; the page ends it and starts a new one for
// the next conversion (app/x2t-client.ts). Measured (2026-10-10): the abort
// reaches the worker the same way in Chromium, Firefox and WebKit -
// Module.onAbort, then a WebAssembly.RuntimeError out of ccall.

import { X2tError, stopsX2t, x2tConvert, x2tExport, x2tStopReason, type X2tFormat, type X2tModule } from '../x2t';
import type { WorkerReply, WorkerRequest } from '../app/x2t-messages';

interface WorkerScope {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  importScripts(...urls: string[]): void;
  Module?: unknown;
}

const scope = self as unknown as WorkerScope;
let mod: X2tModule | null = null;
let starting = false;
/** Why x2t stopped, once it has: nothing more is converted here. */
let stopped: string | null = null;

function reply(m: WorkerReply, transfer: Transferable[] = []): void {
  scope.postMessage(m, transfer);
}

/** x2t stopped: said once, before the answer to the conversion it stopped in. */
function stop(why: string): void {
  if (stopped !== null) return;
  stopped = why;
  if (mod) reply({ t: 'stopped', message: why });
  else reply({ t: 'failed', message: `x2t stopped: ${why}` });
}

function exactBuffer(b: Uint8Array): ArrayBuffer {
  return (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) as ArrayBuffer;
}

function start(base: string): void {
  if (mod || starting) return;
  starting = true;
  const t0 = Date.now();
  const wasmUrl = `${base}x2t.wasm`;
  scope.Module = {
    // ⚠ CryptPad's build overrides locateFile in its pre-js (the page
    // script's query string as a cache key), and in a worker started from a
    // blob: address that resolves x2t.wasm against the blob: address. The
    // module is compiled here instead, from the package's address, as it
    // streams in.
    instantiateWasm: (imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => {
      const fromBytes = () =>
        fetch(wasmUrl)
          .then((r) => {
            if (!r.ok) throw new Error(`x2t.wasm: HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .then((b) => WebAssembly.instantiate(b, imports));
      const streamed =
        typeof WebAssembly.instantiateStreaming === 'function' ? WebAssembly.instantiateStreaming(fetch(wasmUrl), imports).catch(fromBytes) : fromBytes();
      streamed.then(
        (r) => done(r.instance, r.module),
        (e: unknown) => reply({ t: 'failed', message: `x2t.wasm could not be compiled: ${String((e as Error)?.message ?? e).slice(0, 200)}` }),
      );
      return {};
    },
    locateFile: (p: string) => base + p,
    print: () => {},
    printErr: () => {},
    onAbort: (what: unknown) => stop(x2tStopReason(what)),
    onRuntimeInitialized: () => {
      if (stopped !== null) return;
      mod = scope.Module as X2tModule;
      reply({ t: 'ready', ms: Date.now() - t0 });
    },
  };
  try {
    scope.importScripts(`${base}x2t.js`);
  } catch (e) {
    reply({ t: 'failed', message: `x2t could not be loaded: ${String((e as Error)?.message ?? e).slice(0, 200)}` });
  }
}

/** The answer to a conversion that threw: x2t's own error, or x2t stopping (said first). */
function failure(id: number, e: unknown): WorkerReply {
  if (stopped !== null || stopsX2t(e)) {
    stop(x2tStopReason(e));
    return { t: 'result', id, error: `x2t stopped: ${stopped}`, code: null };
  }
  const code = e instanceof X2tError ? e.code : null;
  return { t: 'result', id, error: String((e as Error)?.message ?? e).slice(0, 300), code };
}

/** The module, or why there is none to convert with. */
function ready(id: number): X2tModule | null {
  if (stopped !== null) reply({ t: 'result', id, error: `x2t stopped: ${stopped}`, code: null });
  else if (!mod) reply({ t: 'result', id, error: 'x2t is not loaded' });
  else return mod;
  return null;
}

function convert(m: Extract<WorkerRequest, { t: 'convert' }>): void {
  const x2t = ready(m.id);
  if (!x2t) return;
  const t0 = Date.now();
  try {
    const media: Record<string, Uint8Array> = {};
    for (const f of m.media ?? []) media[f.name] = new Uint8Array(f.bytes);
    const input = typeof m.bytes === 'string' ? m.bytes : new Uint8Array(m.bytes);
    const out = x2tConvert(x2t, { bytes: input, format: m.from as X2tFormat, media }, m.to as X2tFormat);
    const bytes = exactBuffer(out.bytes);
    const outMedia = Object.entries(out.media).map(([name, b]) => ({ name, bytes: exactBuffer(b) }));
    reply({ t: 'result', id: m.id, bytes, media: outMedia, ms: Date.now() - t0 }, [bytes, ...outMedia.map((f) => f.bytes)]);
  } catch (e) {
    reply(failure(m.id, e));
  }
}

function exportDocument(m: Extract<WorkerRequest, { t: 'export' }>): void {
  const x2t = ready(m.id);
  if (!x2t) return;
  const t0 = Date.now();
  try {
    const files = (list: { name: string; bytes: ArrayBuffer }[] | undefined) => Object.fromEntries((list ?? []).map((f) => [f.name, new Uint8Array(f.bytes)]));
    const out = x2tExport(x2t, {
      bin: m.bin,
      media: files(m.media),
      formatTo: m.formatTo,
      ext: m.ext,
      pdf: m.pdf ? new Uint8Array(m.pdf) : undefined,
      fonts: m.fonts ? files(m.fonts) : undefined,
      json: m.json,
      text: m.text,
    });
    const bytes = exactBuffer(out);
    reply({ t: 'result', id: m.id, bytes, media: [], ms: Date.now() - t0 }, [bytes]);
  } catch (e) {
    reply(failure(m.id, e));
  }
}

scope.onmessage = (ev: MessageEvent) => {
  const m = ev.data as WorkerRequest | null;
  if (!m || typeof m !== 'object') return;
  if (m.t === 'start') start(m.base);
  else if (m.t === 'convert') convert(m);
  else if (m.t === 'export') exportDocument(m);
};
