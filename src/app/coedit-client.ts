// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// filex's `coedit.*` (filex 0.56), as the app page calls it. The SDK the app
// builds against (@brftech/filex-app-ui 0.53) predates them, so this is a
// thin client over its raw request and its event listener: the method and
// event names and the shapes are filex's protocol (filex
// docs/APP-PLUGINS-API.md → Editing together), nothing more.

import type { FilexApp } from '@brftech/filex-app-ui';

import type { CoEditCursor, CoEditDropped, CoEditHello } from '../coedit';

/** What the app page needs of filex to edit together; tests hand it a stand-in. */
export interface CoEditApi {
  join(index?: number): Promise<CoEditHello>;
  subscribe(from: number): Promise<void>;
  append(kind: 'changes' | 'lock' | 'release', body: unknown): Promise<{ seq: number }>;
  lease(op: 'acquire' | 'release', changesSeen: number): Promise<boolean>;
  cursor(cursor: unknown): void;
  putBlob(name: string, bytes: ArrayBuffer): Promise<void>;
  getBlob(name: string): Promise<ArrayBuffer>;
  leave(): Promise<void>;
  /** A new version of the opened file, holding the log up to `through`. */
  save(bytes: ArrayBuffer, mime: string, through: number): Promise<void>;
  onEntry(h: (e: unknown) => void): () => void;
  onCursor(h: (c: CoEditCursor) => void): () => void;
  onDropped(h: (d: CoEditDropped) => void): () => void;
}

type RawRequest = (method: never, params?: unknown, transfer?: Transferable[]) => Promise<unknown>;
type RawOn = (event: never, handler: (data: unknown) => void) => () => void;

/** The client over the SDK's connection. */
export function coeditApi(fx: FilexApp): CoEditApi {
  const request = fx.request.bind(fx) as unknown as RawRequest;
  const on = fx.on.bind(fx) as unknown as RawOn;
  const call = <T>(method: string, params?: unknown, transfer?: Transferable[]) => request(method as never, params, transfer) as Promise<T>;
  return {
    join: (index = 0) => call<CoEditHello>('coedit.join', { index }),
    subscribe: async (from) => {
      await call('coedit.subscribe', { from });
    },
    append: (kind, body) => call<{ seq: number }>('coedit.append', { kind, body }),
    lease: async (op, changesSeen) => {
      const r = await call<{ granted?: boolean } | null>('coedit.lease', { op, changesSeen });
      return r?.granted === true;
    },
    cursor: (cursor) => {
      call('coedit.cursor', { cursor }).catch(() => {});
    },
    putBlob: async (name, bytes) => {
      await call('coedit.blob.put', { name, data: bytes }, [bytes]);
    },
    getBlob: async (name) => {
      const r = await call<{ bytes?: ArrayBuffer } | null>('coedit.blob.get', { name });
      if (!r || !(r.bytes instanceof ArrayBuffer)) throw new Error(`no blob ${name}`);
      return r.bytes;
    },
    leave: async () => {
      await call('coedit.leave');
    },
    save: async (bytes, mime, through) => {
      await call('file.save', { index: 0, data: bytes, mime, through }, [bytes]);
    },
    onEntry: (h) => on('coedit.entry' as never, h),
    onCursor: (h) => on('coedit.cursor' as never, (d) => h(d as CoEditCursor)),
    onDropped: (h) => on('coedit.dropped' as never, (d) => h((d ?? {}) as CoEditDropped)),
  };
}

/** The codes with which filex says "no editing together here": the app edits alone. */
export const ALONE_CODES: readonly string[] = ['unavailable', 'not_granted', 'unknown_method'];

/** The error code of a filex refusal (FilexError.code), '' for anything else. */
export function codeOf(e: unknown): string {
  const c = (e as { code?: unknown })?.code;
  return typeof c === 'string' ? c : '';
}

/** The message filex gave with a refusal (its short code, e.g. "not_ready", "no_lease"). */
export function messageOf(e: unknown): string {
  const m = (e as { message?: unknown })?.message;
  return typeof m === 'string' ? m : '';
}
