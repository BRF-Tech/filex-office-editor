// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// How the opened file goes into the editor and back (src/app/document.ts):
// docs/PARITY.md rows A3 (every kind opens), A4 (a format x2t cannot write
// is saved beside), A5 (csv), A10 (a protected document). New in 0.4.0.
import { describe, expect, it } from 'vitest';

import { NEEDS_PASSWORD, WRONG_PASSWORD, openOptions, saveExtra, saveOptions, saveTarget, wantsPassword } from '../src/app/document';
import { CANVAS, OPENS, kindOf } from '../src/kinds';

const k = (ext: string) => kindOf(ext)!;
const CSV = { delimiter: ';', encoding: 'windows-1254', bom: false, eol: 'crlf' as const };

describe('the way in', () => {
  // By the extension alone x2t refuses doc, xls, ppt and csv (88, measured
  // on the server build); the editor's type makes it read them.
  it("names the editor's type for every kind", () => {
    for (const ext of OPENS) expect(openOptions({ kind: k(ext), csv: null }).formatTo, ext).toBe(CANVAS[k(ext).documentType]);
  });

  it("gives a csv's delimiter and a password", () => {
    expect(openOptions({ kind: k('csv'), csv: CSV, password: 'p' })).toEqual({ formatTo: 0x2002, text: { codepage: 46, delimiter: 2 }, password: 'p' });
  });
});

describe('the way out', () => {
  it("a format x2t writes is saved in place, by its own type", () => {
    expect(saveTarget(k('odt'))).toMatchObject({ ext: 'odt', formatTo: 0x0043, beside: false });
    expect(saveTarget(k('dotx'))).toMatchObject({ ext: 'dotx', formatTo: 0x004c, beside: false });
    expect(saveTarget(k('csv'))).toMatchObject({ ext: 'csv', formatTo: 0x0104, beside: false, mime: 'text/csv' });
  });

  it('a format x2t cannot write is saved beside it, as the OOXML of its editor', () => {
    expect(saveTarget(k('doc'))).toEqual({ ext: 'docx', mime: kindOf('docx')!.mime, formatTo: 0x0041, beside: true });
    expect(saveTarget(k('xls'))).toMatchObject({ ext: 'xlsx', beside: true });
    expect(saveTarget(k('ppt'))).toMatchObject({ ext: 'pptx', beside: true });
    expect(saveTarget(k('fodt'))).toMatchObject({ ext: 'docx', beside: true });
    expect(saveExtra({ kind: k('doc'), csv: null }, new Uint8Array([0x50, 0x4b]))).toEqual({ beside: 'docx' });
    expect(saveExtra({ kind: k('docx'), csv: null }, new Uint8Array([0x50, 0x4b]))).toEqual({});
  });

  it("a csv is written in its delimiter and declared as x2t wrote it", () => {
    expect(saveOptions({ kind: k('csv'), csv: CSV })).toEqual({ formatTo: 0x0104, text: { codepage: 46, delimiter: 2 } });
    const out = new TextEncoder().encode('\ufeffa;b\nc;d\n');
    expect(saveExtra({ kind: k('csv'), csv: CSV }, out)).toEqual({ csv: { delimiter: ';', encoding: 'utf-8', bom: true, eol: 'lf' } });
  });

  it('a protected document stays protected', () => {
    expect(saveOptions({ kind: k('docx'), csv: null, password: 'gizli' })).toEqual({ formatTo: 0x0041, savePassword: 'gizli' });
  });
});

describe('a protected document', () => {
  it("is told by x2t's codes: 90 no password, 91 a wrong one", () => {
    expect(NEEDS_PASSWORD).toBe(90);
    expect(WRONG_PASSWORD).toBe(91);
    expect(wantsPassword(90)).toBe(true);
    expect(wantsPassword(91)).toBe(true);
    expect(wantsPassword(80)).toBe(false);
    expect(wantsPassword(null)).toBe(false);
  });
});
