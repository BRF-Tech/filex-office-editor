// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Every kind of file the app opens: the 44 a Document Server edits for filex
// (filex's editkind.Published, docs/PARITY.md row A3) and csv. Pure: the
// app page, the worker and the tests read the same table.
//
// For each: the editor it opens in, the type x2t reads it into the editor's
// format with (m_nFormatTo: by the extension alone x2t refuses a doc, xls,
// ppt or csv - 88, measured on the server build, docs/SERVER.md), and how a
// save is written:
//   - in place, in its own format, when x2t writes it (src/formats.ts, the
//     formats measured with Turkish text, and dotm, xltm, xlsb, potm, ppsm:
//     written and read back with the text whole, docs/SERVER.md);
//   - beside it, as OOXML, when x2t cannot write it (doc, xls, ppt and the
//     other legacy formats, the flat ODF ones: x2t answers 88; a Document
//     Server cannot write the binary ones either): the file stays
//     as it was and filex writes the save next to it, choosing the name
//     ("rapor.docx", "rapor (2).docx") as it does for a Document Server's
//     save (filex's callback_format.go). The app asks for that with
//     file.save's `beside` (filex 0.57).

export type DocumentType = 'word' | 'cell' | 'slide';

export interface Kind {
  /** The file's extension, as x2t names its format. */
  ext: string;
  documentType: DocumentType;
  /** The bridge's EditorType: 0 text, 1 spreadsheet, 2 presentation. */
  editorType: 0 | 1 | 2;
  mime: string;
  /** The blank document an empty file opens as (`blankExt` its format). */
  blank: string;
  blankExt: 'docx' | 'xlsx' | 'pptx';
  /** x2t's type for the file's own format (m_nFormatTo), when x2t writes it. */
  writes: number | null;
  /** The format a save is written beside the file in, when x2t cannot write the file's own. */
  beside: 'docx' | 'xlsx' | 'pptx' | null;
}

/** x2t's type for the editor's own format, by editor (AVS_OFFICESTUDIO_FILE_CANVAS_*). */
export const CANVAS: Readonly<Record<DocumentType, number>> = { word: 0x2001, cell: 0x2002, slide: 0x2003 };

const EDITOR_TYPE: Readonly<Record<DocumentType, 0 | 1 | 2>> = { word: 0, cell: 1, slide: 2 };

const BLANK: Readonly<Record<DocumentType, { path: string; ext: 'docx' | 'xlsx' | 'pptx' }>> = {
  word: { path: 'editor/document-templates/new/default/new.docx.bin', ext: 'docx' },
  cell: { path: 'editor/document-templates/new/default/new.xlsx.bin', ext: 'xlsx' },
  slide: { path: 'editor/document-templates/new/default/new.pptx.bin', ext: 'pptx' },
};

const OOXML = 'application/vnd.openxmlformats-officedocument';
const ODF = 'application/vnd.oasis.opendocument';
const MS = 'application/vnd.ms-';

/** ext, editor, mime, x2t's type when it writes the format (null: saved beside). */
const TABLE: readonly [string, DocumentType, string, number | null][] = [
  // word
  ['docx', 'word', `${OOXML}.wordprocessingml.document`, 0x0041],
  ['docm', 'word', `${MS}word.document.macroEnabled.12`, 0x004b],
  ['dotx', 'word', `${OOXML}.wordprocessingml.template`, 0x004c],
  ['dotm', 'word', `${MS}word.template.macroEnabled.12`, 0x004d],
  ['doc', 'word', 'application/msword', null],
  ['dot', 'word', 'application/msword', null],
  ['odt', 'word', `${ODF}.text`, 0x0043],
  ['ott', 'word', `${ODF}.text-template`, 0x004f],
  ['fodt', 'word', `${ODF}.text-flat-xml`, null],
  ['rtf', 'word', 'application/rtf', 0x0044],
  ['wps', 'word', `${MS}works`, null],
  ['wpt', 'word', `${MS}works`, null],
  ['stw', 'word', 'application/vnd.sun.xml.writer.template', null],
  ['sxw', 'word', 'application/vnd.sun.xml.writer', null],
  ['mht', 'word', 'message/rfc822', null],
  ['mhtml', 'word', 'message/rfc822', null],
  // cell
  ['xlsx', 'cell', `${OOXML}.spreadsheetml.sheet`, 0x0101],
  ['xlsm', 'cell', `${MS}excel.sheet.macroEnabled.12`, 0x0105],
  ['xltx', 'cell', `${OOXML}.spreadsheetml.template`, 0x0106],
  ['xltm', 'cell', `${MS}excel.template.macroEnabled.12`, 0x0107],
  ['xls', 'cell', `${MS}excel`, null],
  ['xlt', 'cell', `${MS}excel`, null],
  ['xlsb', 'cell', `${MS}excel.sheet.binary.macroEnabled.12`, 0x0108],
  ['ods', 'cell', `${ODF}.spreadsheet`, 0x0103],
  ['ots', 'cell', `${ODF}.spreadsheet-template`, 0x010a],
  ['fods', 'cell', `${ODF}.spreadsheet-flat-xml`, null],
  ['csv', 'cell', 'text/csv', 0x0104],
  ['et', 'cell', 'application/vnd.wps-office.et', null],
  ['ett', 'cell', 'application/vnd.wps-office.ett', null],
  ['sxc', 'cell', 'application/vnd.sun.xml.calc', null],
  // slide
  ['pptx', 'slide', `${OOXML}.presentationml.presentation`, 0x0081],
  ['pptm', 'slide', `${MS}powerpoint.presentation.macroEnabled.12`, 0x0085],
  ['potx', 'slide', `${OOXML}.presentationml.template`, 0x0087],
  ['potm', 'slide', `${MS}powerpoint.template.macroEnabled.12`, 0x0088],
  ['ppsx', 'slide', `${OOXML}.presentationml.slideshow`, 0x0084],
  ['ppsm', 'slide', `${MS}powerpoint.slideshow.macroEnabled.12`, 0x0086],
  ['ppt', 'slide', `${MS}powerpoint`, null],
  ['pot', 'slide', `${MS}powerpoint`, null],
  ['pps', 'slide', `${MS}powerpoint`, null],
  ['odp', 'slide', `${ODF}.presentation`, 0x0083],
  ['otp', 'slide', `${ODF}.presentation-template`, 0x008a],
  ['fodp', 'slide', `${ODF}.presentation-flat-xml`, null],
  ['dps', 'slide', 'application/vnd.wps-office.dps', null],
  ['dpt', 'slide', 'application/vnd.wps-office.dpt', null],
  ['sxi', 'slide', 'application/vnd.sun.xml.impress', null],
];

const KINDS: ReadonlyMap<string, Kind> = new Map(
  TABLE.map(([ext, documentType, mime, writes]): [string, Kind] => [
    ext,
    {
      ext,
      documentType,
      editorType: EDITOR_TYPE[documentType],
      mime,
      blank: BLANK[documentType].path,
      blankExt: BLANK[documentType].ext,
      writes,
      beside: writes === null ? BLANK[documentType].ext : null,
    },
  ]),
);

/** Every extension the app opens, in the table's order (the manifest's viewer rows). */
export const OPENS: readonly string[] = TABLE.map(([ext]) => ext);

/** The kind of document a file is, by its extension (with or without the dot); null: not one the app opens. */
export function kindOf(ext: string | undefined | null): Kind | null {
  const e = String(ext ?? '')
    .replace(/^\./, '')
    .toLowerCase();
  return KINDS.get(e) ?? null;
}

/** The kind a save beside writes (docx, xlsx or pptx), for its mime and x2t type. */
export function besideKind(k: Kind): Kind | null {
  return k.beside ? kindOf(k.beside) : null;
}
