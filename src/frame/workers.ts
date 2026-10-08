// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Workers in the editor page. Under filex the page is an opaque origin, and
// an opaque origin may not start a worker from an address (measured,
// Chromium: "Script at '<package>/sdkjs/common/spell/spell/spell.js' cannot
// be accessed from origin 'null'"); worker-src allows blob: only. The editor
// starts one worker on its own, the spell checker's, inside its answer to
// the server's auth - and the exception stopped the document from opening.
//
//   - The spell checker gets a worker that does nothing. Spell checking
//     needs dictionaries, which the bundle does not carry (the editor is
//     configured with it off), so there is nothing for it to do anyway.
//   - Any other worker the editor starts from an address of the package
//     starts from a blob: address whose one line imports that script.

/** The spell checker's engine, by its address. */
export const SPELL_ENGINE = /\/sdkjs\/common\/spell\//;

/** A worker that takes every message and never answers. */
export class InertWorker extends EventTarget {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}

type WorkerCtor = new (url: string | URL, opts?: WorkerOptions) => Worker;

export function guardWorkers(win: Record<string, unknown>, base: string): void {
  const Native = win.Worker as WorkerCtor | undefined;
  if (typeof Native !== 'function' || (Native as unknown as { __filex?: boolean }).__filex) return;
  const Guarded = function (this: unknown, url: string | URL, opts?: WorkerOptions): Worker {
    let abs: string;
    try {
      abs = new URL(String(url), base).href;
    } catch {
      return new Native(url, opts);
    }
    if (SPELL_ENGINE.test(abs)) return new InertWorker() as unknown as Worker;
    try {
      return new Native(url, opts);
    } catch (e) {
      if (!(e instanceof Error || e instanceof DOMException) || (e as DOMException).name !== 'SecurityError' || abs.startsWith('blob:')) throw e;
      const boot = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(abs)});`], { type: 'text/javascript' }));
      return new Native(boot, opts);
    }
  } as unknown as WorkerCtor & { __filex?: boolean };
  Guarded.prototype = Native.prototype;
  Guarded.__filex = true;
  win.Worker = Guarded;
}
