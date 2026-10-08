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
// ⚠ Measured (2026-10-08, CryptPad's x2t 9.3.2+3, tests/x2t-wasm.test.ts):
//   - written, with the Turkish text whole: docx, docm, dotx, odt, ott, rtf;
//     xlsx, xlsm, xltx, ods, ots; pptx, pptm, potx, ppsx, odp, otp. A
//     template or macro-enabled type needs m_nFormatTo (by the file name
//     alone x2t writes a plain docx/xlsx/pptx);
//   - PDF (and PDF/A) from the pages the editor lays out (its renderer's
//     drawing, x2t's pdf.bin) and the fonts it drew with;
//   - txt and csv come out with every letter outside ASCII cut to its low
//     byte ("Şehir" → "^ehir"): left out until a build of our own (plan step
//     A2b) writes them right;
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
  T(0x0101, 'xlsx', `${OOXML}.spreadsheetml.sheet`, 'cell'),
  T(0x0105, 'xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12', 'cell'),
  T(0x0106, 'xltx', `${OOXML}.spreadsheetml.template`, 'cell'),
  T(0x0103, 'ods', `${ODF}.spreadsheet`, 'cell'),
  T(0x010a, 'ots', `${ODF}.spreadsheet-template`, 'cell'),
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
