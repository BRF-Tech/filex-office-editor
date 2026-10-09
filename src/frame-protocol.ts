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
//
// Editing together (filex 0.56): the app page holds the session (filex's
// `coedit.*`), the editor page holds the bridge. The bridge's appends, lease
// requests and cursor go to the app page (co-append, co-lease, co-cursor),
// and the session's entries come back in the log's order (co-entry), each
// image another member inserted ahead of the change that shows it
// (co-media).

import type { BridgeAppend, BridgeEntry, BridgeMember } from './bridge';

import type { TextOptions } from './formats';

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
  /**
   * Editing together (filex 0.56): this editor's member of the session. The
   * document is the session's base, and its log arrives as co-entry
   * messages; absent, the editor runs alone (session.ts).
   */
  together?: TogetherInfo;
  /**
   * The user id the editor was configured with (app/config.ts userId); the
   * bridge must use the same. Absent: EDITOR_USER_ID.
   */
  userId?: string;
}

/** Who this editor is in a session it edits together. */
export interface TogetherInfo {
  me: BridgeMember;
  /**
   * The log's head when filex handed the session over (filex 0.56: the
   * changes it kept in this browser from an earlier opening included). The
   * bridge answers the editor's auth once it has read this far.
   */
  head?: number;
}

/** The next entry of the session's log, opened and checked by filex. */
export interface CoEntryMessage {
  t: 'co-entry';
  entry: BridgeEntry;
}

/** filex's answer to a lease the editor page asked for (co-lease). */
export interface CoLeaseAnswer {
  t: 'co-lease-answer';
  id: number;
  granted: boolean;
}

/** Another member's cursor. */
export interface CoCursorIn {
  t: 'co-cursor-in';
  client: string;
  cursor: unknown;
}

/** An image another member inserted, before the change that shows it: the editor page registers it under media/<name>. */
export interface CoMediaMessage {
  t: 'co-media';
  name: string;
  bytes: ArrayBuffer;
}

/** An image this editor inserted is kept with the session (or could not be). */
export interface CoMediaStored {
  t: 'co-media-stored';
  name: string;
  ok: boolean;
}

/** filex refused what the editor page asked to append ("no_lease", "log_full"...). */
export interface CoRefused {
  t: 'co-refused';
  kind: string;
  code: string;
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

/**
 * The editor's settings kept from the openings before (settings.ts), the
 * app page's first word on the port: the editor page holds the editor's
 * start until it has them.
 */
export interface SettingsMessage {
  t: 'settings';
  values: Record<string, string>;
}

/** An export the editor page asked for is done (or failed: the app page told the person). */
export interface ExportedMessage {
  t: 'exported';
  id: number;
  ok: boolean;
}

export type ToFrame =
  | OpenMessage
  | SnapshotRequest
  | SavedMessage
  | ThemeMessage
  | SettingsMessage
  | ExportedMessage
  | CoEntryMessage
  | CoLeaseAnswer
  | CoCursorIn
  | CoMediaMessage
  | CoMediaStored
  | CoRefused;

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

/** The editor wrote its settings: the ones worth keeping, all of them (settings.ts pickSettings). */
export interface SettingsChanged {
  t: 'settings-changed';
  values: Record<string, string>;
}

/**
 * "Download as" or Print in the editor: the app page writes the document in
 * that format with x2t and hands it to filex (formats.ts). What a Document
 * Server would have been sent, but to the page next door.
 */
export interface ExportRequest {
  t: 'export';
  id: number;
  /** The editor's file type (formats.ts). */
  format: number;
  purpose: 'download' | 'print';
  /** The name the editor gave the file (the document's, with the format's extension). */
  title: string;
  /** asc_nativeGetFile's answer and the images, as for a save. */
  bin: string;
  media: MediaFile[];
  /** For PDF: the pages as the editor drew them, and the fonts it drew them with. */
  pdf?: ArrayBuffer;
  fonts?: MediaFile[];
  /** The editor's json parameters for the conversion (printPages, watermark...). */
  json?: string;
  /** For txt and csv: the encoding and the delimiter the editor's dialog chose (formats.ts textOptions). */
  text?: TextOptions;
}

/** Editing together: put this in the session's log (the bridge's append). */
export interface CoAppendRequest {
  t: 'co-append';
  append: BridgeAppend;
}

/** Editing together: the changes lease (the bridge's lease); an acquire is answered with co-lease-answer. */
export interface CoLeaseRequest {
  t: 'co-lease';
  id: number;
  op: 'acquire' | 'release';
  seen: number;
}

/** Editing together: this editor's cursor, for the others. */
export interface CoCursorOut {
  t: 'co-cursor';
  cursor: unknown;
}

/** Editing together: an image the person inserted, to keep with the session (answered with co-media-stored). */
export interface CoMediaPut {
  t: 'co-media-put';
  name: string;
  bytes: ArrayBuffer;
}

export type FromFrame =
  | SnapshotResult
  | SaveRequest
  | DirtyMessage
  | StateMessage
  | NoticeMessage
  | SettingsChanged
  | ExportRequest
  | CoAppendRequest
  | CoLeaseRequest
  | CoCursorOut
  | CoMediaPut;

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
