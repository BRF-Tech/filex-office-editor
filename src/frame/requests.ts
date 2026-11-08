// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The editor page's requests the frame takes part in, by their address -
// which stays whatever sdkjs's build renames (sdk.ts):
//
//   - the font files the editor loads (GET <package>/editor/fonts/<id>,
//     sdkjs CFontFileLoader.LoadFontArrayBuffer): which ones, so a PDF gets
//     the fonts its pages were drawn with (export.ts);
//   - an image the person inserts (POST <package>/editor/upload/<document>,
//     sdkjs UploadImageFiles): answered here as the Document Server answers
//     it - the image's name in the document and an address - with the image
//     kept in the page (images.ts).

/** The package's root (the folder holding editor/), from an address under it. */
function packageRootOf(abs: string): string | null {
  const i = abs.indexOf('/editor/');
  return i < 0 ? null : abs.slice(0, i + 1);
}

const FONT = /\/editor\/fonts\/([A-Za-z0-9._-]{1,64})$/;
const UPLOAD = /\/editor\/upload\/[^/?#]+$/;

/** The fonts the editor has loaded, by their id in the package and their address. */
export class LoadedFonts {
  private readonly byId = new Map<string, string>();
  add(id: string, url: string): void {
    if (!this.byId.has(id)) this.byId.set(id, url);
  }
  entries(): [string, string][] {
    return [...this.byId.entries()];
  }
}

/** What an upload is answered with: the HTTP status and, for 200, the JSON body. */
export interface UploadAnswer {
  status: number;
  body?: string;
}
export type UploadHandler = (file: Blob) => UploadAnswer | Promise<UploadAnswer>;

interface XhrProto {
  open: (...a: unknown[]) => void;
  send: (...a: unknown[]) => void;
  setRequestHeader: (...a: unknown[]) => void;
  __filexRequests?: boolean;
}

interface Watched {
  fonts: LoadedFonts;
  upload: UploadHandler | null;
}

const watched = new WeakMap<object, Watched>();

function settle(xhr: Record<string, unknown>, status: number, body: string): void {
  const own = (k: string, v: unknown) => Object.defineProperty(xhr, k, { value: v, configurable: true });
  own('readyState', 4);
  own('status', status);
  own('statusText', status === 200 ? 'OK' : 'Error');
  own('responseText', body);
  own('response', body);
  const ev = typeof Event === 'function' ? new Event('readystatechange') : ({ type: 'readystatechange' } as unknown as Event);
  const rsc = xhr.onreadystatechange as ((this: unknown, e: Event) => void) | null | undefined;
  if (typeof rsc === 'function') rsc.call(xhr, ev);
  const load = xhr.onload as ((this: unknown, e: Event) => void) | null | undefined;
  if (typeof load === 'function') load.call(xhr, ev);
}

/**
 * Watch the editor page's XMLHttpRequest: record the font files it loads in
 * `fonts`, and answer its image uploads with `upload` (once per window; a
 * second call only sets the upload handler). Addresses are read against
 * `base` (the page's document.baseURI).
 */
export function watchRequests(win: Record<string, unknown>, base: string, fonts: LoadedFonts, upload: UploadHandler | null): void {
  const X = win.XMLHttpRequest as { prototype: XhrProto } | undefined;
  if (!X) return;
  const proto = X.prototype;
  const state: Watched = (watched.get(proto) as Watched | undefined) ?? { fonts, upload };
  if (upload) state.upload = upload;
  watched.set(proto, state);
  if (proto.__filexRequests) return;
  const marks = new WeakMap<object, 'upload'>();
  const open = proto.open;
  const send = proto.send;
  const setHeader = proto.setRequestHeader;
  proto.open = function (this: Record<string, unknown>, ...a: unknown[]) {
    marks.delete(this);
    let abs = '';
    try {
      abs = new URL(String(a[1]), base).href.split(/[?#]/)[0];
    } catch {
      abs = '';
    }
    const method = String(a[0] ?? '').toUpperCase();
    if (abs && packageRootOf(abs)) {
      const f = method === 'GET' ? FONT.exec(abs) : null;
      if (f) {
        const id = f[1];
        const xhr = this as unknown as { addEventListener?: (t: string, h: () => void) => void; status?: number };
        xhr.addEventListener?.('load', () => {
          if (xhr.status === 200) state.fonts.add(id, abs);
        });
      } else if (method === 'POST' && UPLOAD.test(abs) && state.upload) {
        marks.set(this, 'upload');
        return;
      }
    }
    return open.apply(this, a);
  };
  proto.setRequestHeader = function (this: Record<string, unknown>, ...a: unknown[]) {
    if (marks.has(this)) return;
    return setHeader.apply(this, a);
  };
  proto.send = function (this: Record<string, unknown>, ...a: unknown[]) {
    if (!marks.has(this)) return send.apply(this, a);
    marks.delete(this);
    const handler = state.upload;
    const file = a[0];
    const xhr = this;
    Promise.resolve()
      .then(() => (handler && file instanceof Blob ? handler(file) : { status: 400 }))
      .then(
        (r) => settle(xhr, r.status, r.status === 200 ? (r.body ?? '{}') : ''),
        () => settle(xhr, 500, ''),
      );
  };
  proto.__filexRequests = true;
}

/** A font file's own first bytes: TrueType, OpenType, a collection, Apple's 'true'. */
function looksLikeFont(b: Uint8Array): boolean {
  if (b.length < 4) return false;
  const tag = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  return tag === 0x00010000 || tag === 0x4f54544f || tag === 0x74746366 || tag === 0x74727565;
}

/** The package's web fonts come with their first 32 bytes XORed with this GUID (sdkjs Externals.js guidOdttf). */
const ODTTF = [0xa0, 0x66, 0xd6, 0x20, 0x14, 0x96, 0x47, 0xfa, 0x95, 0x69, 0xb8, 0x50, 0xb0, 0x41, 0x49, 0x48];

/** A font file as the editor decodes it: the package's copy, its first 32 bytes put back. */
export function plainFont(raw: ArrayBuffer): ArrayBuffer {
  const b = new Uint8Array(raw.slice(0));
  if (looksLikeFont(b)) return b.buffer as ArrayBuffer;
  for (let i = 0; i < Math.min(32, b.length); i++) b[i] ^= ODTTF[i % 16];
  return b.buffer as ArrayBuffer;
}
