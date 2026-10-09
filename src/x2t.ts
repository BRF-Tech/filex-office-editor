// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// x2t, ONLYOFFICE's document converter, compiled to WebAssembly: it turns a
// docx/xlsx/pptx into the editor's own format (Editor.bin, with the images
// beside it) and back. A Document Server runs it as a native program on the
// server; here it runs in the browser, so the document is never converted
// anywhere else.
//
// The wasm build is pinned in upstream/onlyoffice.json ("x2t"): this
// project's own build from ONLYOFFICE core at the same tag as the editor
// files (core v9.4.0.129 for Docs 9.4), made by scripts/x2t/build.sh and
// checked by its SHA-256 (release 0.1.0 carried CryptPad's v9.3.2+3). It is
// loaded into a Worker; this file drives a loaded module. The calling
// convention (an in-memory file system under /working, a params.xml, main1)
// is the one the wasm build exports; CryptPad drives its build the same way.
// tests/x2t-wasm.test.ts runs this driver against the real build (`npm run
// test:x2t`): docx, xlsx and pptx with Turkish text, to Editor.bin and back.
//
// ⚠ Measured in the research (2026-10-06): the editor (sdkjs 9.4) opens an
// Editor.bin written without base64 ("DOCY;v10;0;...") and refuses the
// base64 form ("Invalid typed array length"), which is why m_bIsNoBase64 is
// true whenever the target is the editor's format.

import type { TextOptions } from './formats';

/** The part of the emscripten module x2t uses. */
export interface X2tModule {
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array | string): void;
    readFile(path: string): Uint8Array;
    readdir(path: string): string[];
    unlink(path: string): void;
  };
  ccall(name: string, returnType: string, argTypes: string[], args: unknown[]): unknown;
}

/** What x2t converts between here: the office formats (OOXML and their OpenDocument kin) and the editor's own. */
export type X2tFormat = 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'bin';

export const X2T_DIR = '/working';
const MEDIA_DIR = `${X2T_DIR}/media`;
const PARAMS = `${X2T_DIR}/params.xml`;
const MEDIA_NAME = /^[A-Za-z0-9._-]{1,128}$/;
const FORMATS: readonly string[] = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'bin'];

export class X2tError extends Error {
  constructor(
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'X2tError';
  }
}

/**
 * A C++ symbol as a person can read it: `_ZN8COFDFileC1EPN7NSFonts17IApplicationFontsE`
 * is `COFDFile::COFDFile`. Only the name (its nested names, a constructor or
 * a destructor), not the parameters; anything else comes back as it is.
 */
export function readableSymbol(sym: string): string {
  if (!sym.startsWith('_Z')) return sym;
  const s = sym.slice(2);
  const nested = s.startsWith('N');
  let i = nested ? 1 : 0;
  while (nested && 'KVr'.includes(s[i] ?? '-')) i++;
  const parts: string[] = [];
  for (;;) {
    const m = /^\d+/.exec(s.slice(i));
    if (!m) break;
    const n = Number(m[0]);
    i += m[0].length;
    if (n <= 0 || i + n > s.length) return sym;
    parts.push(s.slice(i, i + n));
    i += n;
    if (!nested) break;
  }
  if (parts.length === 0) return sym;
  const last = parts[parts.length - 1];
  if (nested && /^C[1-5]/.test(s.slice(i))) parts.push(last);
  else if (nested && /^D[0-5]/.test(s.slice(i))) parts.push(`~${last}`);
  return parts.join('::');
}

/**
 * Why the module stopped, in one line: what emscripten's abort() was given
 * (Module.onAbort), or the text of the error it threw ("Aborted(missing
 * function: _ZN8COFDFile...). Build with -sASSERTIONS for more info."),
 * without emscripten's wrapping and with a missing function's name made
 * readable ("missing function: COFDFile::COFDFile").
 */
export function x2tStopReason(what: unknown): string {
  let s = String((what as Error | null)?.message ?? what ?? '').trim();
  s = s.replace(/^RuntimeError:\s*/, '');
  s = s.replace(/\.?\s*Build with -sASSERTIONS for more info\.?$/, '');
  const wrapped = /^Aborted\(([\s\S]*)\)$/.exec(s);
  if (wrapped) s = wrapped[1].trim();
  s = s.replace(/missing function: (\S+)/, (_, sym: string) => `missing function: ${readableSymbol(sym)}`);
  return s.slice(0, 200) || 'aborted';
}

/**
 * Whether an error out of x2t means the module cannot be used again: an
 * abort (emscripten calls Module.onAbort, then throws a
 * WebAssembly.RuntimeError), a trap (unreachable, an access out of bounds:
 * also a RuntimeError) or the stack or the memory running out (RangeError).
 * The module is then in whatever state it stopped in; only a new one
 * converts reliably.
 */
export function stopsX2t(e: unknown): boolean {
  const wasm = (globalThis as { WebAssembly?: { RuntimeError?: abstract new (...a: never[]) => Error } }).WebAssembly;
  return (!!wasm?.RuntimeError && e instanceof wasm.RuntimeError) || e instanceof RangeError;
}

/**
 * The conversion order. Every path in it is one this file chose (fixed names
 * under /working), never a document's name, so nothing in it needs escaping.
 */
export function x2tParams(from: string, to: string, noBase64: boolean): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
    `<m_sFileFrom>${from}</m_sFileFrom>` +
    `<m_sThemeDir>${X2T_DIR}/themes</m_sThemeDir>` +
    `<m_sFileTo>${to}</m_sFileTo>` +
    `<m_bIsNoBase64>${noBase64 ? 'true' : 'false'}</m_bIsNoBase64>` +
    '</TaskQueueDataConvert>'
  );
}

function mkdirs(m: X2tModule): void {
  for (const dir of [X2T_DIR, MEDIA_DIR, `${X2T_DIR}/fonts`, `${X2T_DIR}/themes`]) {
    try {
      m.FS.mkdir(dir);
    } catch {
      // There already.
    }
  }
}

function mediaNames(m: X2tModule): string[] {
  return m.FS.readdir(MEDIA_DIR).filter((n) => n !== '.' && n !== '..');
}

function remove(m: X2tModule, path: string): void {
  try {
    m.FS.unlink(path);
  } catch {
    // Not there.
  }
}

export interface X2tInput {
  bytes: Uint8Array | string;
  format: X2tFormat;
  /** The images an Editor.bin refers to (by name, without "media/"), for a conversion back to an office file. */
  media?: Record<string, Uint8Array>;
}

export interface X2tOutput {
  bytes: Uint8Array;
  /** The images x2t took out of an office file (by name, without "media/"): documentOpen's "media/<name>". */
  media: Record<string, Uint8Array>;
}

/** A document written in another format ("Download as", Print): see ../formats.ts for what x2t writes here. */
export interface X2tExport {
  /** The editor's document: asc_nativeGetFile's answer ("DOCY;v5;<size>;<base64>"). */
  bin: Uint8Array | string;
  /** Its images, by name (without "media/"). */
  media?: Record<string, Uint8Array>;
  /** The target: the editor's file type (x2t's m_nFormatTo) and the extension x2t writes. */
  formatTo: number;
  ext: string;
  /**
   * For PDF: the pages as the editor laid them out (its renderer's drawing,
   * what a Document Server receives to print), which x2t turns into PDF
   * pages beside the document (pdf.bin) - x2t has no layout of its own.
   */
  pdf?: Uint8Array;
  /** For PDF: the fonts the pages were drawn with, by file name. */
  fonts?: Record<string, Uint8Array>;
  /** The editor's json parameters (printPages, watermark...), as a Document Server passes them. */
  json?: string;
  /** For txt and csv: the encoding and the delimiter the person chose (../formats.ts textOptions). */
  text?: TextOptions;
}

const EXT = /^[a-z0-9]{2,5}$/;

function xmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The conversion order for an export: x2tParams with the target's type, the
 * fonts, the json parameters and, for txt and csv, the encoding and the
 * delimiter (the names a Document Server gives them).
 */
export function x2tExportParams(from: string, to: string, formatTo: number, o: { fonts: boolean; json?: string; text?: TextOptions }): string {
  const t = o.text;
  const extra =
    `<m_nFormatTo>${Math.trunc(formatTo)}</m_nFormatTo>` +
    (o.fonts ? `<m_sFontDir>${X2T_DIR}/fonts/</m_sFontDir>` : '') +
    (o.json ? `<m_sJsonParams>${xmlText(o.json)}</m_sJsonParams>` : '') +
    (t ? `<m_nCsvTxtEncoding>${Math.trunc(t.codepage)}</m_nCsvTxtEncoding>` : '') +
    (t?.delimiter !== undefined ? `<m_nCsvDelimiter>${Math.trunc(t.delimiter)}</m_nCsvDelimiter>` : '') +
    (t?.delimiterChar !== undefined ? `<m_nCsvDelimiterChar>${xmlText(t.delimiterChar)}</m_nCsvDelimiterChar>` : '');
  return x2tParams(from, to, false).replace('</TaskQueueDataConvert>', `${extra}</TaskQueueDataConvert>`);
}

/**
 * Write the editor's document in another format. Leaves /working as it found
 * it, like x2tConvert.
 */
export function x2tExport(m: X2tModule, e: X2tExport): Uint8Array {
  if (!EXT.test(e.ext) || e.ext === 'bin' || !Number.isInteger(e.formatTo) || e.formatTo <= 0) {
    throw new X2tError(null, `x2t: cannot write ${e.ext}`);
  }
  mkdirs(m);
  for (const n of mediaNames(m)) remove(m, `${MEDIA_DIR}/${n}`);
  const from = `${X2T_DIR}/input.bin`;
  const out = `${X2T_DIR}/output.${e.ext}`;
  const pdfBin = `${X2T_DIR}/pdf.bin`;
  const fontsDir = `${X2T_DIR}/fonts`;
  const fonts = Object.entries(e.fonts ?? {});
  try {
    m.FS.writeFile(from, e.bin);
    for (const [name, bytes] of Object.entries(e.media ?? {})) {
      if (!MEDIA_NAME.test(name)) throw new X2tError(null, `x2t: bad media name ${JSON.stringify(name)}`);
      m.FS.writeFile(`${MEDIA_DIR}/${name}`, bytes);
    }
    if (e.pdf) m.FS.writeFile(pdfBin, e.pdf);
    for (const [name, bytes] of fonts) {
      if (!MEDIA_NAME.test(name)) throw new X2tError(null, `x2t: bad font name ${JSON.stringify(name)}`);
      m.FS.writeFile(`${fontsDir}/${name}`, bytes);
    }
    m.FS.writeFile(PARAMS, x2tExportParams(from, out, e.formatTo, { fonts: fonts.length > 0, json: e.json, text: e.text }));
    const rc = m.ccall('main1', 'number', ['string'], [PARAMS]);
    if (typeof rc === 'number' && rc !== 0) throw new X2tError(rc, `x2t: conversion failed (${rc})`);
    try {
      const bytes = m.FS.readFile(out);
      if (bytes.length === 0) throw new Error('empty');
      return bytes;
    } catch {
      throw new X2tError(typeof rc === 'number' ? rc : null, 'x2t: no output');
    }
  } finally {
    remove(m, from);
    remove(m, out);
    remove(m, pdfBin);
    remove(m, PARAMS);
    for (const n of mediaNames(m)) remove(m, `${MEDIA_DIR}/${n}`);
    for (const [name] of fonts) remove(m, `${fontsDir}/${name}`);
  }
}

/**
 * Convert one document. Leaves /working as it found it: every file it wrote
 * or x2t wrote is removed, so the next conversion sees nothing of this one.
 */
export function x2tConvert(m: X2tModule, input: X2tInput, to: X2tFormat): X2tOutput {
  if (!FORMATS.includes(input.format) || !FORMATS.includes(to) || input.format === to) {
    throw new X2tError(null, `x2t: cannot convert ${input.format} to ${to}`);
  }
  mkdirs(m);
  for (const n of mediaNames(m)) remove(m, `${MEDIA_DIR}/${n}`);
  const from = `${X2T_DIR}/input.${input.format}`;
  const out = `${X2T_DIR}/output.${to}`;
  try {
    m.FS.writeFile(from, input.bytes);
    for (const [name, bytes] of Object.entries(input.media ?? {})) {
      if (!MEDIA_NAME.test(name)) throw new X2tError(null, `x2t: bad media name ${JSON.stringify(name)}`);
      m.FS.writeFile(`${MEDIA_DIR}/${name}`, bytes);
    }
    m.FS.writeFile(PARAMS, x2tParams(from, out, to === 'bin'));
    const rc = m.ccall('main1', 'number', ['string'], [PARAMS]);
    if (typeof rc === 'number' && rc !== 0) throw new X2tError(rc, `x2t: conversion failed (${rc})`);
    let bytes: Uint8Array;
    try {
      bytes = m.FS.readFile(out);
    } catch {
      throw new X2tError(typeof rc === 'number' ? rc : null, 'x2t: no output');
    }
    const media: Record<string, Uint8Array> = {};
    if (to === 'bin') {
      for (const n of mediaNames(m)) media[n] = m.FS.readFile(`${MEDIA_DIR}/${n}`);
    }
    return { bytes, media };
  } finally {
    remove(m, from);
    remove(m, out);
    remove(m, PARAMS);
    for (const n of mediaNames(m)) remove(m, `${MEDIA_DIR}/${n}`);
  }
}
