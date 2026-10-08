// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-onlyoffice, the office editor
// app for filex (see README.md and NOTICE).
//
// x2t, ONLYOFFICE's document converter, compiled to WebAssembly: it turns a
// docx/xlsx/pptx into the editor's own format (Editor.bin, with the images
// beside it) and back. A Document Server runs it as a native program on the
// server; here it runs in the browser, so the document is never converted
// anywhere else.
//
// The wasm build is not in this repository yet: it is built from ONLYOFFICE core at
// the same tag as the editor files it serves (core v9.4.0.129 for Docs 9.4)
// and loaded into a Worker; this file drives a loaded module. The calling
// convention (an in-memory file system under /working, a params.xml, main1)
// is the one the wasm build exports; CryptPad drives its build the same way.
//
// ⚠ Measured in the research (2026-10-06): the editor (sdkjs 9.4) opens an
// Editor.bin written without base64 ("DOCY;v10;0;...") and refuses the
// base64 form ("Invalid typed array length"), which is why m_bIsNoBase64 is
// true whenever the target is the editor's format.

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

/** What x2t converts between here: the three office formats and the editor's own. */
export type X2tFormat = 'docx' | 'xlsx' | 'pptx' | 'bin';

export const X2T_DIR = '/working';
const MEDIA_DIR = `${X2T_DIR}/media`;
const PARAMS = `${X2T_DIR}/params.xml`;
const MEDIA_NAME = /^[A-Za-z0-9._-]{1,128}$/;
const FORMATS: readonly string[] = ['docx', 'xlsx', 'pptx', 'bin'];

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
