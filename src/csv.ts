// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// A csv's dialect - its delimiter, encoding, byte order mark and line ends -
// read when it opens and declared when it is saved (docs/PARITY.md, row A5;
// filex task #255). Pure: the app page and the tests read it as it is.
//
// x2t reads and writes a csv only in UTF-8 (and UTF-16/32) here: emscripten's
// ICU has no conversion tables, so a windows-1254 csv came out as an empty
// sheet (measured on the server build of x2t, docs/SERVER.md). So the app
// opens every csv as UTF-8 - the browser's TextDecoder turns the file's own
// encoding into it - and tells filex, when it saves, what it wrote: x2t's
// UTF-8 with a byte order mark and "\n", in the file's delimiter. filex puts
// the file's own dialect back (its encoding, BOM and line ends) and keeps the
// text of the cells nobody changed (KeepCSV), and refuses a save whose bytes
// do not match what the app declared, instead of writing a broken file.
//
// The dialect comes from filex (FileInfo `text_dialect`, filex 0.57: it
// sniffs the file as it does for a Document Server, csv.go SniffCSV) or,
// from an older filex, from the same sniff here.

import type { TextOptions } from './formats';

export interface CsvDialect {
  /** One character: , ; tab | or another. */
  delimiter: string;
  /** A WHATWG encoding label: "utf-8", "windows-1254", "utf-16le"... */
  encoding: string;
  bom: boolean;
  eol: 'lf' | 'crlf';
}

/** How much of a csv the sniff reads, as filex does (csv.go CSVSniffBytes). */
export const SNIFF_BYTES = 64 << 10;
const SNIFF_LINES = 50;
const CANDIDATES = [',', ';', '\t', '|'];

/** x2t's UTF-8 (UnicodeConverter_Encodings.h, src/formats.ts UTF8). */
const X2T_UTF8 = 46;
/** x2t's TCSVD_* (src/formats.ts CSV_DELIMITERS). */
const X2T_DELIMITER: Readonly<Record<string, number>> = { '\t': 1, ';': 2, ':': 3, ',': 4, ' ': 5 };

function validUtf8(b: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

/** A field count per line, quotes respected; the first SNIFF_LINES lines. */
function fieldCounts(text: string, d: string): number[] {
  const counts: number[] = [];
  let n = 1;
  let quoted = false;
  for (let i = 0; i < text.length && counts.length < SNIFF_LINES; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === d) n++;
    else if (!quoted && c === '\n') {
      counts.push(n);
      n = 1;
    }
  }
  return counts;
}

/**
 * The dialect of a csv from its first bytes, as filex sniffs it: a UTF-16
 * byte order mark, else UTF-8 (BOM noted) when the bytes are UTF-8 (a rune
 * cut at the end of the sample allowed), else `fallback`; CRLF from the first
 * line; the candidate delimiter that gives every line the same field count
 * (more than one), else the most frequent, else a comma.
 */
export function sniffCsv(bytes: Uint8Array, fallback = 'windows-1252'): CsvDialect {
  let head = bytes.subarray(0, SNIFF_BYTES);
  let encoding = 'utf-8';
  let bom = false;
  if (head[0] === 0xff && head[1] === 0xfe) {
    encoding = 'utf-16le';
    bom = true;
  } else if (head[0] === 0xfe && head[1] === 0xff) {
    encoding = 'utf-16be';
    bom = true;
  } else {
    if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
      bom = true;
      head = head.subarray(3);
    }
    let ok = validUtf8(head);
    for (let cut = 1; !ok && cut <= 3 && head.length > cut && bytes.length > SNIFF_BYTES; cut++) ok = validUtf8(head.subarray(0, head.length - cut));
    if (!ok) encoding = fallback;
  }
  const text = new TextDecoder(encoding).decode(head);
  const nl = text.indexOf('\n');
  const eol: CsvDialect['eol'] = nl > 0 && text[nl - 1] === '\r' ? 'crlf' : 'lf';
  let delimiter = ',';
  let best = -1;
  for (const d of CANDIDATES) {
    const counts = fieldCounts(text, d);
    if (counts.length > 0 && counts[0] > 1 && counts.every((c) => c === counts[0])) {
      delimiter = d;
      best = Infinity;
      break;
    }
    const total = counts.reduce((a, c) => a + c - 1, 0);
    if (total > best && total > 0) {
      best = total;
      delimiter = d;
    }
  }
  return { delimiter, encoding, bom, eol };
}

/** filex's `text_dialect` (FileInfo, filex 0.57) when it is one; null: an older filex. */
export function dialectOf(info: unknown): CsvDialect | null {
  const d = (info as { text_dialect?: Partial<CsvDialect> } | null)?.text_dialect;
  if (!d || typeof d !== 'object') return null;
  if (typeof d.delimiter !== 'string' || [...d.delimiter].length !== 1 || d.delimiter === '"') return null;
  if (typeof d.encoding !== 'string' || !d.encoding) return null;
  try {
    new TextDecoder(d.encoding);
  } catch {
    return null;
  }
  return { delimiter: d.delimiter, encoding: d.encoding, bom: d.bom === true, eol: d.eol === 'crlf' ? 'crlf' : 'lf' };
}

/** The csv's text as UTF-8, without a byte order mark: what x2t reads here. */
export function csvToUtf8(bytes: Uint8Array, d: CsvDialect): Uint8Array {
  const text = new TextDecoder(d.encoding).decode(bytes);
  return new TextEncoder().encode(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

/** What x2t takes to read or write the csv in UTF-8 with its delimiter. */
export function csvText(d: CsvDialect): TextOptions {
  const code = X2T_DELIMITER[d.delimiter];
  return code !== undefined ? { codepage: X2T_UTF8, delimiter: code } : { codepage: X2T_UTF8, delimiterChar: d.delimiter };
}

/** What a save declares it wrote: x2t's bytes as they are, in the delimiter it was given. */
export function writtenDialect(bytes: Uint8Array, delimiter: string): CsvDialect {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let crlf = false;
  for (let i = 1; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      crlf = bytes[i - 1] === 0x0d;
      break;
    }
  }
  return { delimiter, encoding: 'utf-8', bom, eol: crlf ? 'crlf' : 'lf' };
}
