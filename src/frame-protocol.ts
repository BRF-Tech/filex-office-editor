// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The app's two pages and what passes between them.
//
//   the app page (index.html, filex's frame)   talks to filex (the SDK),
//                                               converts with x2t, saves
//   └─ the editor page (ONLYOFFICE's, in a     runs the editor, the bridge
//      frame api.js makes)                     and the session (frame.ts)
//
// Under filex each page is an opaque origin of its own (sandbox
// allow-scripts): neither can reach into the other, and a blob: address one
// makes the other may not read. So the document goes over as bytes - an
// ArrayBuffer, transferred, never copied - and the editor page makes its
// own blob: addresses from them. The pages find each other with one hello
// on window.postMessage, each checking `event.source` (the origin is "null"
// for every sandboxed page, so it tells nothing), and then talk over a
// MessagePort only they hold.

/** The editor page's first word to the app page: "here I am, give me the port". */
export const FRAME_HELLO = 'filex-office-editor:hello';
/** The app page's answer, carrying the port. */
export const FRAME_PORT = 'filex-office-editor:port';
export const FRAME_VERSION = 1;

/** The id the editor is configured with: the bridge must use the same, the editor appends its indexUser to it. */
export const EDITOR_USER_ID = 'filex-person-';

/** One image of the document, by the name Editor.bin refers to it with ("image1.png", without "media/"). */
export interface MediaFile {
  name: string;
  bytes: ArrayBuffer;
}

/** The document, as the editor opens it. */
export interface OpenMessage {
  t: 'open';
  /** 0 text document, 1 spreadsheet, 2 presentation (the bridge's EditorType). */
  editorType: 0 | 1 | 2;
  /** Editor.bin as x2t wrote it. */
  bin: ArrayBuffer;
  media: MediaFile[];
  /** The person, as the editor lists them. */
  name: string;
  canEdit: boolean;
  /** The document's key (the editor's docId). */
  key: string;
}

/** The app page asks for the document as the editor holds it now. */
export interface SnapshotRequest {
  t: 'snapshot';
  id: number;
}

/** A save the editor page asked for (or the app page made) is done. */
export interface SavedMessage {
  t: 'saved';
  ok: boolean;
  /** The session head the saved snapshot was taken at (0 when nothing was saved). */
  through: number;
}

/** filex's theme changed. */
export interface ThemeMessage {
  t: 'theme';
  dark: boolean;
}

export type ToFrame = OpenMessage | SnapshotRequest | SavedMessage | ThemeMessage;

/** The document as the editor holds it: what x2t turns back into an office file. */
export interface SnapshotResult {
  t: 'snapshot';
  id: number;
  /** asc_nativeGetFile's answer: the editor's format with its header ("DOCY;v5;<size>;<base64>"). */
  bin?: string;
  media?: MediaFile[];
  /** The session head the snapshot was taken at. */
  through?: number;
  error?: string;
}

/** The person pressed Save in the editor (or Ctrl+S in it). */
export interface SaveRequest {
  t: 'save';
}

/** Changes no save has, or none. */
export interface DirtyMessage {
  t: 'dirty';
  dirty: boolean;
}

/** The editor has the document open, or could not open it. */
export interface StateMessage {
  t: 'state';
  state: 'connected' | 'opened' | 'closed';
}

/** Something for the diagnostics (what the bridge does not do, what it refused). */
export interface NoticeMessage {
  t: 'notice';
  what: string;
  detail?: string;
}

export type FromFrame = SnapshotResult | SaveRequest | DirtyMessage | StateMessage | NoticeMessage;

export function isFrameHello(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as { type?: unknown }).type === FRAME_HELLO && (v as { v?: unknown }).v === FRAME_VERSION;
}

export function isFramePort(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as { type?: unknown }).type === FRAME_PORT && (v as { v?: unknown }).v === FRAME_VERSION;
}

/** Media names the way x2t's driver accepts them; anything else is not passed on. */
export const MEDIA_NAME = /^[A-Za-z0-9._-]{1,128}$/;

/** The MIME type the editor page gives an image's blob (by its extension). */
export function mediaType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
    case 'jpe':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'svg':
      return 'image/svg+xml';
    case 'emf':
      return 'image/emf';
    case 'wmf':
      return 'image/wmf';
    default:
      return 'application/octet-stream';
  }
}
