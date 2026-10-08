// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The app page's side of the converter: starts the worker (from a blob:
// address whose one line imports the worker's file from the package) and
// hands it documents, one at a time.

import type { WorkerFile, WorkerReply, WorkerRequest } from './x2t-messages';

export interface Converted {
  bytes: ArrayBuffer;
  media: WorkerFile[];
  ms: number;
}

export class X2tClient {
  private readonly worker: Worker;
  private readonly ready: Promise<number>;
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (c: Converted) => void; reject: (e: Error) => void }>();
  /** Conversions run one after another: x2t has one file system. */
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * `workerUrl` is the worker's file in the package, `x2tBase` the package's
   * x2t/ folder (both absolute, the second ending in "/").
   */
  constructor(workerUrl: string, x2tBase: string) {
    const boot = new Blob([`importScripts(${JSON.stringify(workerUrl)});`], { type: 'text/javascript' });
    const url = URL.createObjectURL(boot);
    this.worker = new Worker(url);
    let started: (ms: number) => void = () => {};
    let failed: (e: Error) => void = () => {};
    this.ready = new Promise<number>((resolve, reject) => {
      started = resolve;
      failed = reject;
    });
    // Unhandled until someone converts: the failure shows there.
    this.ready.catch(() => {});
    this.worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as WorkerReply;
      if (m.t === 'ready') {
        URL.revokeObjectURL(url);
        started(m.ms);
      } else if (m.t === 'failed') {
        failed(new Error(m.message));
      } else if (m.t === 'result') {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error || !m.bytes) p.reject(new Error(m.error ?? 'x2t gave nothing'));
        else p.resolve({ bytes: m.bytes, media: m.media ?? [], ms: m.ms ?? 0 });
      }
    };
    this.worker.onerror = (ev: ErrorEvent) => {
      failed(new Error(ev.message || 'the converter could not start'));
      for (const p of this.pending.values()) p.reject(new Error(ev.message || 'the converter stopped'));
      this.pending.clear();
    };
    this.post({ t: 'start', base: x2tBase });
  }

  /** How long x2t took to start (ms), once it has. */
  started(): Promise<number> {
    return this.ready;
  }

  private post(m: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer);
  }

  /** Convert `bytes` (an office file, or an Editor.bin's text) from one format to another. Transfers the buffers. */
  convert(from: string, to: string, bytes: ArrayBuffer | string, media: WorkerFile[] = []): Promise<Converted> {
    const run = async (): Promise<Converted> => {
      await this.ready;
      const id = ++this.seq;
      return new Promise<Converted>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        const transfer: Transferable[] = media.map((f) => f.bytes);
        if (typeof bytes !== 'string') transfer.push(bytes);
        this.post({ t: 'convert', id, from, to, bytes, media }, transfer);
      });
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }
}
