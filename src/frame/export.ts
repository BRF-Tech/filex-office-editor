// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// "Download as" and Print, without a Document Server.
//
// The editor makes both the same way: asc_DownloadAs / asc_Print →
// downloadAs → its _downloadAs puts what the server needs into a data
// container (for PDF: the pages as the editor lays them out, drawn by its
// renderer - x2t has no layout of its own) → _downloadAsUsingServer posts it
// to the Document Server, which converts and answers with an address. Here
// that last step goes to the app page instead (onExport): it converts with
// x2t in the browser and hands the result to filex - a download, or a PDF to
// print. The editor's own files are not touched: the step is replaced on the
// editor's API object while the page runs.
//
// The File menu's "Download as" lists every format a Document Server writes;
// trimDownloadFormats leaves the ones x2t writes here (formats.ts), and the
// encodings its TXT and CSV dialogs offer to the ones x2t writes them in.

import { exportFormat, isPdf, textEncodings, textOptions, type DocumentKind, type ExportFormat, type TextOptions } from '../formats';
import { MEDIA_NAME, type MediaFile } from '../frame-protocol';

type AnyWindow = Record<string, unknown>;

/** What the editor asked for, with what x2t needs to write it. */
export interface ExportJob {
  format: ExportFormat;
  purpose: 'download' | 'print';
  title: string;
  /** For PDF: the editor's renderer output (its pages), as bytes. */
  pdf?: Uint8Array;
  /** The editor's json parameters (printPages, watermark...). */
  json?: string;
  /** For txt and csv: the encoding and the delimiter the editor's dialog chose. */
  text?: TextOptions;
}

/** The editor's namespace for each kind (its Backbone application). */
const NAMESPACE: Record<DocumentKind, string> = { word: 'DE', cell: 'SSE', slide: 'PE' };

interface SaveAsView {
  prototype?: { formats?: { type?: unknown }[][]; __fxTrimmed?: boolean };
}

/**
 * Leave in the editor's "Download as" panel only the formats x2t writes
 * here. True once done (the panel's view is defined when the editor's File
 * menu module loads, so the caller tries until it is).
 */
export function trimDownloadFormats(win: AnyWindow, kind: DocumentKind): boolean {
  const ns = win[NAMESPACE[kind]] as { Views?: { FileMenuPanels?: { ViewSaveAs?: SaveAsView } } } | undefined;
  const proto = ns?.Views?.FileMenuPanels?.ViewSaveAs?.prototype;
  if (!proto || !Array.isArray(proto.formats)) return false;
  if (proto.__fxTrimmed) return true;
  proto.formats = proto.formats.map((row) => row.filter((item) => exportFormat(item?.type, kind) !== null)).filter((row) => row.length > 0);
  // The TXT (a document) and CSV (a workbook) dialogs list
  // AscCommon.c_oAscEncodings (getEncodingParams reads it each time): only
  // the encodings x2t writes that kind's text in here are left in it.
  const common = win.AscCommon as { c_oAscEncodings?: unknown[][] } | undefined;
  const keep = textEncodings(kind);
  if (keep && common && Array.isArray(common.c_oAscEncodings)) {
    common.c_oAscEncodings = common.c_oAscEncodings.filter((e) => Array.isArray(e) && keep.includes(e[0] as number));
  }
  proto.__fxTrimmed = true;
  return true;
}

/** Try `fn` until it says it is done, every `everyMs`, at most `tries` times. */
export function retry(fn: () => boolean, everyMs = 500, tries = 240): void {
  let n = 0;
  const go = () => {
    let done = false;
    try {
      done = fn();
    } catch {
      done = false;
    }
    if (!done && ++n < tries) setTimeout(go, everyMs);
  };
  go();
}

/** The bytes of a view, as a buffer of their own. */
function ownBuffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

interface FontFileLoader {
  Id?: unknown;
  Status?: unknown;
  stream_index?: unknown;
}

/**
 * The font files the editor has loaded (everything it laid the pages out
 * with), as the bytes it holds them - the package's web fonts come
 * obfuscated, the editor's copy is the plain file - by their id in the
 * package (x2t reads the family and style from the file itself).
 *
 * ⚠ Through getFontStream, not g_fonts_streams: a font the engine has taken
 * in is only a pointer into its WebAssembly memory there ({asc_marker, data,
 * len}). Measured 2026-10-08: reading g_fonts_streams gave x2t one face of
 * the four the page used, and the whole PDF came out in Liberation Serif
 * Bold Italic.
 */
export function loadedFonts(win: AnyWindow): MediaFile[] {
  const fonts = win.AscFonts as
    | { g_font_files?: (FontFileLoader | undefined)[]; getFontStream?: (index: number) => { data?: Uint8Array; size?: number } | undefined }
    | undefined;
  const files = fonts?.g_font_files ?? [];
  const out: MediaFile[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!f || f.Status !== 0 || typeof f.stream_index !== 'number' || f.stream_index < 0) continue;
    const name = `${String(f.Id ?? '')}.ttf`;
    if (!MEDIA_NAME.test(name) || seen.has(name)) continue;
    let s: { data?: Uint8Array; size?: number } | undefined;
    try {
      s = fonts?.getFontStream?.(f.stream_index);
    } catch {
      s = undefined;
    }
    if (!s?.data || typeof s.size !== 'number' || s.size <= 0) continue;
    seen.add(name);
    out.push({ name, bytes: ownBuffer(s.data.subarray(0, s.size)) });
  }
  return out;
}

interface EditorApi {
  sync_EndAction?: (type: number, id: number) => void;
  documentTitle?: string;
}

/**
 * Take the editor's last step of "Download as" and Print: `onExport` gets
 * what was asked for and calls `done` when it is over (written, refused or
 * failed - the app page tells the person), which ends the editor's wait.
 * False: the editor's API is not there yet (the caller tries again).
 */
export function takeOverDownloads(win: AnyWindow, kind: DocumentKind, onExport: (job: ExportJob, done: () => void) => void, onRefused: (why: string) => void): boolean {
  const common = win.AscCommon as { baseEditorsApi?: { prototype?: Record<string, unknown> } } | undefined;
  const proto = common?.baseEditorsApi?.prototype;
  if (!proto || typeof proto._downloadAsUsingServer !== 'function') return false;
  if (proto.__fxDownloads) return true;
  const asc = win.Asc as { c_oAscAsyncActionType?: { BlockInteraction?: number }; c_oAscAsyncAction?: { Print?: number } } | undefined;
  const BLOCK = asc?.c_oAscAsyncActionType?.BlockInteraction ?? 1;
  const PRINT = asc?.c_oAscAsyncAction?.Print ?? 7;
  proto._downloadAsUsingServer = function (this: EditorApi, actionType: number, options: Record<string, unknown> | null, additional: Record<string, unknown> | null, container: { data?: unknown } | null, downloadType: unknown) {
    const end = () => {
      if (actionType) {
        try {
          this.sync_EndAction?.(BLOCK, actionType);
        } catch {
          // The editor went away meanwhile.
        }
      }
    };
    const format = exportFormat(options?.fileType ?? additional?.outputformat, kind);
    const plain = additional?.c === 'save' && !options?.callback;
    if (!format || !plain) {
      // A server command this app does not answer (mail merge, a document
      // from an address...) or a format x2t does not write here.
      end();
      onRefused(format ? String(additional?.c ?? 'command') : `format ${String(options?.fileType ?? '?')}`);
      return;
    }
    // A txt or csv: the encoding and the delimiter the editor's dialog chose.
    const text = textOptions(format, additional);
    if (text === null) {
      end();
      onRefused(`encoding ${String(additional?.codepage ?? '?')}`);
      return;
    }
    const purpose = actionType === PRINT || downloadType === 'asc_onPrintUrl' ? 'print' : 'download';
    let pdf: Uint8Array | undefined;
    if (isPdf(format.id)) {
      const data = container?.data;
      if (data instanceof Uint8Array) pdf = data.slice();
      else if (typeof data === 'string') pdf = new TextEncoder().encode(data);
      if (!pdf || pdf.length === 0) {
        end();
        onRefused('the editor drew no pages');
        return;
      }
    }
    const jp = additional?.jsonparams;
    const job: ExportJob = {
      format,
      purpose,
      title: String(additional?.title ?? this.documentTitle ?? ''),
      pdf,
      json: jp && typeof jp === 'object' && Object.keys(jp).length > 0 ? JSON.stringify(jp) : undefined,
      text,
    };
    let over = false;
    onExport(job, () => {
      if (over) return;
      over = true;
      end();
    });
  };
  proto.__fxDownloads = true;
  return true;
}
