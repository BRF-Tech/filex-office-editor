// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The app page's side of the converter: starts the worker (from a blob:
// address whose one line imports the worker's file from the package) and
// hands it documents, one at a time.
//
// A conversion fails, and is never left waiting, when x2t stops (the
// worker's "stopped": an abort, a trap), when the worker dies (its error or
// messageerror event) or when the conversion does not finish in time
// (conversionTimeoutMs: a loop in x2t answers nothing, and a worker busy in
// one can only be ended). The worker is then ended, and the next conversion
// starts a new one: a save after a Download as that stopped x2t still
// converts.

import type { WorkerExport, WorkerFile, WorkerReply, WorkerRequest } from './x2t-messages';

export interface Converted {
  bytes: ArrayBuffer;
  media: WorkerFile[];
  ms: number;
}

/**
 * The converter stopped on the document (`stopped`: x2t aborted, or its
 * worker died; `detail` says why, in x2t's words) or did not finish in
 * `seconds` (`timeout`). The page tells the person (strings.ts).
 */
export class X2tFailure extends Error {
  constructor(
    readonly kind: 'stopped' | 'timeout',
    readonly detail: string,
    readonly seconds = 0,
  ) {
    super(kind === 'timeout' ? `x2t did not finish in ${seconds} s` : `x2t stopped: ${detail}`);
    this.name = 'X2tFailure';
  }
}

/**
 * How long one conversion may take, from the bytes it is given: a minute,
 * and five seconds more for every MiB (measured: 12-40 ms for the test
 * documents; x2t's start, 0.2-1.7 s, is not counted).
 */
export function conversionTimeoutMs(bytes: number): number {
  return 60_000 + 5_000 * Math.ceil(Math.max(0, bytes) / 1048576);
}

export interface X2tClientOptions {
  /** How long a conversion of `bytes` may take (ms); conversionTimeoutMs. */
  timeoutMs?: (bytes: number) => number;
  /** Makes the worker from its blob: address (tests give a stand-in). */
  makeWorker?: (url: string) => Worker;
}

interface Pending {
  resolve: (c: Converted) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One worker and its x2t: used until x2t stops, the worker dies or a conversion runs out of time. */
class Converter {
  readonly ready: Promise<number>;
  /** Why it cannot convert any more, once it cannot. */
  failure: Error | null = null;
  private readonly worker: Worker;
  private readonly url: string;
  private readonly pending = new Map<number, Pending>();
  private failStart: (e: Error) => void = () => {};

  constructor(workerUrl: string, x2tBase: string, make: (url: string) => Worker) {
    const boot = new Blob([`importScripts(${JSON.stringify(workerUrl)});`], { type: 'text/javascript' });
    this.url = URL.createObjectURL(boot);
    this.worker = make(this.url);
    let started: (ms: number) => void = () => {};
    this.ready = new Promise<number>((resolve, reject) => {
      started = resolve;
      this.failStart = reject;
    });
    // Unhandled until someone converts: the failure shows there.
    this.ready.catch(() => {});
    this.worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as WorkerReply;
      if (m.t === 'ready') {
        URL.revokeObjectURL(this.url);
        started(m.ms);
      } else if (m.t === 'failed') {
        this.end(new Error(m.message));
      } else if (m.t === 'stopped') {
        this.end(new X2tFailure('stopped', m.message));
      } else if (m.t === 'result') {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error || !m.bytes) p.reject(new Error(m.error ?? 'x2t gave nothing'));
        else p.resolve({ bytes: m.bytes, media: m.media ?? [], ms: m.ms ?? 0 });
      }
    };
    this.worker.onerror = (ev: ErrorEvent) => {
      ev.preventDefault?.();
      this.end(new X2tFailure('stopped', ev.message || 'the worker stopped'));
    };
    this.worker.onmessageerror = () => {
      this.end(new X2tFailure('stopped', 'an answer of the worker could not be read'));
    };
    const start: WorkerRequest = { t: 'start', base: x2tBase };
    this.worker.postMessage(start);
  }

  /** The converter cannot go on: what waits fails with `e`, and the worker is ended. */
  end(e: Error): void {
    if (this.failure) return;
    this.failure = e;
    this.failStart(e);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }

  run(id: number, m: WorkerRequest, transfer: Transferable[], ms: number): Promise<Converted> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<Converted>((resolve, reject) => {
      const timer = setTimeout(() => this.end(new X2tFailure('timeout', '', Math.round(ms / 1000))), ms);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage(m, transfer);
    });
  }
}

export class X2tClient {
  private current: Converter | null = null;
  private readonly first: Promise<number>;
  private readonly timeoutMs: (bytes: number) => number;
  private readonly makeWorker: (url: string) => Worker;
  private seq = 0;
  /** Conversions run one after another: x2t has one file system. */
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * `workerUrl` is the worker's file in the package, `x2tBase` the package's
   * x2t/ folder (both absolute, the second ending in "/").
   */
  constructor(
    private readonly workerUrl: string,
    private readonly x2tBase: string,
    o: X2tClientOptions = {},
  ) {
    this.timeoutMs = o.timeoutMs ?? conversionTimeoutMs;
    this.makeWorker = o.makeWorker ?? ((url) => new Worker(url));
    this.first = this.converter().ready;
  }

  /** How long x2t took to start (ms), once it has (the first worker). */
  started(): Promise<number> {
    return this.first;
  }

  /** The worker in use, or a new one when the last one can no longer convert. */
  private converter(): Converter {
    if (!this.current || this.current.failure) this.current = new Converter(this.workerUrl, this.x2tBase, this.makeWorker);
    return this.current;
  }

  /** Run `send` when the conversions before it are done; one at a time. */
  private queue(send: (id: number) => { m: WorkerRequest; transfer: Transferable[]; bytes: number }): Promise<Converted> {
    const run = async (): Promise<Converted> => {
      const c = this.converter();
      await c.ready;
      const id = ++this.seq;
      const { m, transfer, bytes } = send(id);
      return c.run(id, m, transfer, this.timeoutMs(bytes));
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }

  /** Convert `bytes` (an office file, or an Editor.bin's text) from one format to another. Transfers the buffers. */
  convert(from: string, to: string, bytes: ArrayBuffer | string, media: WorkerFile[] = []): Promise<Converted> {
    return this.queue((id) => {
      const transfer: Transferable[] = media.map((f) => f.bytes);
      if (typeof bytes !== 'string') transfer.push(bytes);
      const size = (typeof bytes === 'string' ? bytes.length : bytes.byteLength) + media.reduce((n, f) => n + f.bytes.byteLength, 0);
      return { m: { t: 'convert', id, from, to, bytes, media }, transfer, bytes: size };
    });
  }

  /** Write the editor's document in another format ("Download as", Print). Transfers the buffers. */
  export(e: WorkerExport): Promise<Converted> {
    return this.queue((id) => {
      const files = [...e.media, ...(e.fonts ?? [])];
      const transfer: Transferable[] = files.map((f) => f.bytes);
      if (e.pdf) transfer.push(e.pdf);
      const size = e.bin.length + files.reduce((n, f) => n + f.bytes.byteLength, 0) + (e.pdf?.byteLength ?? 0);
      return { m: { t: 'export', id, ...e }, transfer, bytes: size };
    });
  }
}
