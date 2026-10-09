// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// What "Download as" and Print can make here. A Document Server converts on
// the server; here x2t does it in the browser, so the menu offers only what
// x2t writes from the editor's document. Pure: the editor page, the app page,
// the worker and the tests read the same table.
//
// The numbers are the editor's own file types (sdkjs Asc.c_oAscFileType, the
// same as x2t's AVS_OFFICESTUDIO_FILE_*): the editor hands them to
// asc_DownloadAs, and x2t takes them as m_nFormatTo.
//
// ⚠ Measured (2026-10-10, this project's x2t v9.4.0.129+1 - ONLYOFFICE core
// v9.4.0.129 - with tests/x2t-wasm.test.ts; CryptPad's 9.3.2+3 before it):
//   - written, with the Turkish text whole: docx, docm, dotx, odt, ott, rtf;
//     xlsx, xlsm, xltx, ods, ots; pptx, pptm, potx, ppsx, odp, otp. A
//     template or macro-enabled type needs m_nFormatTo (by the file name
//     alone x2t writes a plain docx/xlsx/pptx);
//   - PDF (and PDF/A) from the pages the editor lays out (its renderer's
//     drawing, x2t's pdf.bin) and the fonts it drew with;
//   - txt (a document) and csv (a workbook's sheet), with the encoding and
//     the delimiter chosen in the editor's dialog (textOptions). CryptPad's
//     build cut every letter outside ASCII to its low byte ("Şehir" →
//     "^ehir"); this build's UnicodeConverter writes them whole
//     (scripts/x2t/patches/03-unicode-utf32.patch). Only the encodings x2t
//     writes right here (textEncodings): x2t's other code pages need ICU's
//     conversion tables, which emscripten's ICU does not carry;
//   - html, md, fb2 and the images (jpg, png) need the Document Server's
//     renderer (doctrenderer), which the wasm build does not have; epub
//     stops the module. Left out.

/** The editor's three kinds, as api.js names them. */
export type DocumentKind = 'word' | 'cell' | 'slide';

export interface ExportFormat {
  /** Asc.c_oAscFileType: what the editor asks for and x2t's m_nFormatTo. */
  id: number;
  ext: string;
  mime: string;
  kind: DocumentKind | 'any';
}

export const PDF = 0x0201;
export const PDFA = 0x0209;
export const TXT = 0x0045;
export const CSV = 0x0104;

const T = (id: number, ext: string, mime: string, kind: DocumentKind | 'any'): ExportFormat => ({ id, ext, mime, kind });

const OOXML = 'application/vnd.openxmlformats-officedocument';
const ODF = 'application/vnd.oasis.opendocument';

/** Everything x2t writes here, by the editor's file type. */
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  T(PDF, 'pdf', 'application/pdf', 'any'),
  T(PDFA, 'pdf', 'application/pdf', 'any'),
  T(0x0041, 'docx', `${OOXML}.wordprocessingml.document`, 'word'),
  T(0x004b, 'docm', 'application/vnd.ms-word.document.macroEnabled.12', 'word'),
  T(0x004c, 'dotx', `${OOXML}.wordprocessingml.template`, 'word'),
  T(0x0043, 'odt', `${ODF}.text`, 'word'),
  T(0x004f, 'ott', `${ODF}.text-template`, 'word'),
  T(0x0044, 'rtf', 'application/rtf', 'word'),
  T(TXT, 'txt', 'text/plain', 'word'),
  T(0x0101, 'xlsx', `${OOXML}.spreadsheetml.sheet`, 'cell'),
  T(0x0105, 'xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12', 'cell'),
  T(0x0106, 'xltx', `${OOXML}.spreadsheetml.template`, 'cell'),
  T(0x0103, 'ods', `${ODF}.spreadsheet`, 'cell'),
  T(0x010a, 'ots', `${ODF}.spreadsheet-template`, 'cell'),
  T(CSV, 'csv', 'text/csv', 'cell'),
  T(0x0081, 'pptx', `${OOXML}.presentationml.presentation`, 'slide'),
  T(0x0085, 'pptm', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12', 'slide'),
  T(0x0087, 'potx', `${OOXML}.presentationml.template`, 'slide'),
  T(0x0084, 'ppsx', `${OOXML}.presentationml.slideshow`, 'slide'),
  T(0x0083, 'odp', `${ODF}.presentation`, 'slide'),
  T(0x008a, 'otp', `${ODF}.presentation-template`, 'slide'),
];

const BY_ID = new Map(EXPORT_FORMATS.map((f) => [f.id, f]));

/** The format with this file type, if this kind of document can be written as it here. */
export function exportFormat(id: unknown, kind: DocumentKind): ExportFormat | null {
  const f = typeof id === 'number' ? BY_ID.get(id) : undefined;
  return f && (f.kind === 'any' || f.kind === kind) ? f : null;
}

export function isPdf(id: number): boolean {
  return id === PDF || id === PDFA;
}

/**
 * The name a download gets: the document's name with the format's
 * extension. A name, never a path (filex refuses anything else).
 */
export function exportName(title: string, f: ExportFormat): string {
  const base = String(title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .trim()
    .slice(0, 200);
  return `${base || 'document'}.${f.ext}`;
}

/**
 * x2t's code pages, by the number x2t gives them (UnicodeConverter_Encodings.h;
 * the editor's AscCommon.c_oAscEncodings and its TXT and CSV dialogs use the
 * same numbers): UTF-8 is 46, x2t's default for a txt or csv.
 */
export const UTF8 = 46;

/**
 * The encodings x2t writes a txt or csv in here, by x2t's number. Measured
 * (2026-10-10, tests/x2t-wasm.test.ts):
 *   - csv: UTF-8 (46), UTF-16 (48) and UTF-16 big endian (49), each with its
 *     byte order mark, and UTF-32 (50, 51), without one;
 *   - txt: UTF-8 only. x2t's txt writer (TxtFile) writes UTF-8 for every
 *     code page but its own "Unicode" (50) and "big endian" (51), which it
 *     writes as UTF-16 by a path that leaves the text out wherever wchar_t
 *     is 32 bits (the lines come out empty) - ONLYOFFICE's own as much as
 *     this build's;
 *   - every other code page of the editor's list (windows-1254, ISO-8859-9,
 *     windows-1252...) needs ICU's conversion tables, and emscripten's ICU
 *     (68.2) is built without them: x2t cannot open the converter, and what
 *     came out was the text cut to its low bytes. ISO-8859-1 opens, and has
 *     no Ş, Ğ or İ.
 * The editor's TXT and CSV dialogs offer only these (frame/export.ts trims
 * its list).
 */
export const TEXT_ENCODINGS: Readonly<Record<'txt' | 'csv', readonly number[]>> = {
  txt: [46],
  csv: [46, 48, 49, 50, 51],
};

/** The encodings the editor's own text dialog offers for this kind of document (its TXT or CSV one). */
export function textEncodings(kind: DocumentKind): readonly number[] | null {
  return kind === 'word' ? TEXT_ENCODINGS.txt : kind === 'cell' ? TEXT_ENCODINGS.csv : null;
}

/** A csv's delimiter, as x2t numbers them (TCSVD_*): tab, semicolon, colon, comma, space. */
const CSV_DELIMITERS: readonly number[] = [1, 2, 3, 4, 5];

/** What x2t needs to write a txt or csv: the encoding and, for a csv, the delimiter. */
export interface TextOptions {
  /** x2t's code page number (one of TEXT_ENCODINGS). */
  codepage: number;
  /** x2t's TCSVD_* (CSV_DELIMITERS). */
  delimiter?: number;
  /** A delimiter of the person's own, one character. */
  delimiterChar?: string;
}

/**
 * For a txt or csv, what the editor's dialog chose - its Download as data
 * (the "additional data" a Document Server receives: codepage, delimiter,
 * delimiterChar) - as x2t takes it; UTF-8 when it chose no encoding. Null
 * for an encoding x2t does not write here, undefined for any other format.
 */
export function textOptions(f: ExportFormat, data: Record<string, unknown> | null | undefined): TextOptions | null | undefined {
  if (f.id !== TXT && f.id !== CSV) return undefined;
  const cp = data?.codepage;
  const codepage = typeof cp === 'number' && Number.isInteger(cp) && cp >= 0 ? cp : UTF8;
  if (!TEXT_ENCODINGS[f.id === TXT ? 'txt' : 'csv'].includes(codepage)) return null;
  const out: TextOptions = { codepage };
  if (f.id === CSV) {
    const d = data?.delimiter;
    if (typeof d === 'number' && CSV_DELIMITERS.includes(d)) out.delimiter = d;
    const c = data?.delimiterChar;
    if (typeof c === 'string' && [...c].length === 1 && c.codePointAt(0)! >= 0x20 && c !== '"') out.delimiterChar = c;
  }
  return out;
}
