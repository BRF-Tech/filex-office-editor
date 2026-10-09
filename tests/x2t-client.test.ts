// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The app page's side of the converter (src/app/x2t-client.ts) with a
// stand-in for the worker: a conversion is never left waiting. x2t stopping
// (the worker's "stopped"), the worker dying (error, messageerror) and a
// conversion that does not finish in time each fail what waits, with why;
// the worker is ended, and the next conversion starts a new one (#220).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { X2tClient, X2tFailure, conversionTimeoutMs } from '../src/app/x2t-client';
import type { WorkerReply, WorkerRequest } from '../src/app/x2t-messages';

/** A worker stand-in: records what the page posts, answers when the test says. */
class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  readonly posted: WorkerRequest[] = [];
  terminated = false;

  constructor(readonly url: string) {}

  postMessage(m: WorkerRequest): void {
    this.posted.push(m);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(m: WorkerReply): void {
    this.onmessage?.({ data: m } as MessageEvent);
  }

  /** The last conversion posted, answered with `bytes`. */
  answer(bytes = new Uint8Array([1, 2, 3]).buffer): void {
    const last = this.posted.filter((m) => m.t !== 'start').at(-1) as { id: number };
    this.reply({ t: 'result', id: last.id, bytes, media: [], ms: 1 });
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function client(timeoutMs?: (bytes: number) => number) {
  const workers: FakeWorker[] = [];
  const c = new X2tClient('https://pkg.example/filex/x2t-worker.js', 'https://pkg.example/x2t/', {
    timeoutMs,
    makeWorker: (url) => {
      const w = new FakeWorker(url);
      workers.push(w);
      return w as unknown as Worker;
    },
  });
  return { c, workers };
}

const doc = () => new Uint8Array([0x50, 0x4b]).buffer;

describe('X2tClient: a conversion is never left waiting', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts a worker from a blob: address and converts', async () => {
    const { c, workers } = client();
    expect(workers).toHaveLength(1);
    expect(workers[0].url).toMatch(/^blob:/);
    expect(workers[0].posted[0]).toEqual({ t: 'start', base: 'https://pkg.example/x2t/' });
    workers[0].reply({ t: 'ready', ms: 200 });
    await expect(c.started()).resolves.toBe(200);
    const p = c.convert('docx', 'bin', doc());
    await flush();
    workers[0].answer();
    await expect(p).resolves.toMatchObject({ ms: 1 });
  });

  it('x2t stopping fails the conversion with why, ends the worker, and the next conversion has a new one', async () => {
    const { c, workers } = client();
    workers[0].reply({ t: 'ready', ms: 1 });
    const p = c.convert('docx', 'bin', doc());
    await flush();
    workers[0].reply({ t: 'stopped', message: 'missing function: COFDFile::COFDFile' });
    const e = await p.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(X2tFailure);
    expect(e).toMatchObject({ kind: 'stopped', detail: 'missing function: COFDFile::COFDFile' });
    expect(workers[0].terminated).toBe(true);

    // The result that follows "stopped" in the worker changes nothing.
    workers[0].answer();

    const next = c.convert('bin', 'docx', 'DOCY;v10;0;');
    await flush();
    expect(workers).toHaveLength(2);
    workers[1].reply({ t: 'ready', ms: 1 });
    await flush();
    workers[1].answer();
    await expect(next).resolves.toMatchObject({ ms: 1 });
  });

  it('a conversion that does not finish in time fails, the worker is ended, the next one starts anew', async () => {
    const { c, workers } = client(() => 5_000);
    workers[0].reply({ t: 'ready', ms: 1 });
    const p = c.convert('odt', 'bin', doc());
    const caught = p.catch((x: unknown) => x);
    await flush();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(workers[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const e = await caught;
    expect(e).toBeInstanceOf(X2tFailure);
    expect(e).toMatchObject({ kind: 'timeout', seconds: 5 });
    expect(workers[0].terminated).toBe(true);

    const next = c.convert('docx', 'bin', doc());
    await flush();
    expect(workers).toHaveLength(2);
    workers[1].reply({ t: 'ready', ms: 1 });
    await flush();
    workers[1].answer();
    await expect(next).resolves.toBeDefined();
  });

  it('an answer in time clears the timer', async () => {
    const { c, workers } = client(() => 5_000);
    workers[0].reply({ t: 'ready', ms: 1 });
    const p = c.convert('docx', 'bin', doc());
    await flush();
    workers[0].answer();
    await expect(p).resolves.toBeDefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(workers[0].terminated).toBe(false);
  });

  it('the worker dying (error) fails what waits, with its message', async () => {
    const { c, workers } = client();
    workers[0].reply({ t: 'ready', ms: 1 });
    const p = c.convert('docx', 'bin', doc());
    await flush();
    workers[0].onerror?.({ message: 'Uncaught RangeError: Maximum call stack size exceeded', preventDefault() {} } as ErrorEvent);
    await expect(p).rejects.toMatchObject({ kind: 'stopped', detail: 'Uncaught RangeError: Maximum call stack size exceeded' });
    expect(workers[0].terminated).toBe(true);
  });

  it('an answer that cannot be read (messageerror) fails what waits', async () => {
    const { c, workers } = client();
    workers[0].reply({ t: 'ready', ms: 1 });
    const p = c.convert('docx', 'bin', doc());
    await flush();
    workers[0].onmessageerror?.({} as MessageEvent);
    await expect(p).rejects.toBeInstanceOf(X2tFailure);
  });

  it('x2t not starting fails the conversion with the reason; a later one tries a new worker', async () => {
    const { c, workers } = client();
    const p = c.convert('docx', 'bin', doc());
    await flush();
    workers[0].reply({ t: 'failed', message: 'x2t.wasm: HTTP 404' });
    await expect(p).rejects.toThrow('x2t.wasm: HTTP 404');
    await expect(c.started()).rejects.toThrow('x2t.wasm: HTTP 404');
    expect(workers[0].terminated).toBe(true);
    const next = c.convert('docx', 'bin', doc());
    await flush();
    expect(workers).toHaveLength(2);
    workers[1].reply({ t: 'ready', ms: 1 });
    await flush();
    workers[1].answer();
    await expect(next).resolves.toBeDefined();
  });

  it('x2t own error (a conversion that fails) keeps the worker', async () => {
    const { c, workers } = client();
    workers[0].reply({ t: 'ready', ms: 1 });
    const p = c.convert('docx', 'bin', doc());
    await flush();
    const id = (workers[0].posted.at(-1) as { id: number }).id;
    workers[0].reply({ t: 'result', id, error: 'x2t: conversion failed (89)', code: 89 });
    await expect(p).rejects.toThrow('x2t: conversion failed (89)');
    expect(workers[0].terminated).toBe(false);
  });

  it('the time a conversion may take grows with its size', () => {
    expect(conversionTimeoutMs(0)).toBe(60_000);
    expect(conversionTimeoutMs(1)).toBe(65_000);
    expect(conversionTimeoutMs(10 * 1048576)).toBe(110_000);
  });
});
