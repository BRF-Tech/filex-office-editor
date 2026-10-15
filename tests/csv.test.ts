// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// A csv's dialect (src/csv.ts): read when it opens, declared when it is
// saved (docs/PARITY.md A5, filex task #255). New in 0.4.0: 0.3.1 opened no
// csv at all.
import { describe, expect, it } from 'vitest';

import { SNIFF_BYTES, csvText, csvToUtf8, dialectOf, sniffCsv, writtenDialect } from '../src/csv';

const enc = (s: string) => new TextEncoder().encode(s);
const BOM = [0xef, 0xbb, 0xbf];

/** Turkish text in windows-1254, byte by byte (Ş 0xDE, ı 0xFD, İ 0xDD, ğ 0xF0). */
function cp1254(s: string): Uint8Array {
  const map: Record<string, number> = { Ş: 0xde, ş: 0xfe, ı: 0xfd, İ: 0xdd, ğ: 0xf0, Ğ: 0xd0, ç: 0xe7, Ç: 0xc7, ö: 0xf6, Ö: 0xd6, ü: 0xfc, Ü: 0xdc };
  return Uint8Array.from([...s].map((c) => map[c] ?? c.charCodeAt(0)));
}

describe('a csv sniffed as filex sniffs it', () => {
  it('a semicolon csv with a byte order mark and CRLF', () => {
    const b = Uint8Array.from([...BOM, ...enc('Şehir;Sıcaklık\r\nİstanbul;18,5\r\nIğdır;21\r\n')]);
    expect(sniffCsv(b)).toEqual({ delimiter: ';', encoding: 'utf-8', bom: true, eol: 'crlf' });
  });

  it('a tab csv, a pipe csv, a comma csv with quoted delimiters', () => {
    expect(sniffCsv(enc('a\tb\tc\n1\t2\t3\n')).delimiter).toBe('\t');
    expect(sniffCsv(enc('a|b\n1|2\n')).delimiter).toBe('|');
    expect(sniffCsv(enc('ad,"not; this",c\n1,"x;y",3\n'))).toEqual({ delimiter: ',', encoding: 'utf-8', bom: false, eol: 'lf' });
  });

  it('bytes that are not UTF-8 take the fallback encoding; UTF-16 by its mark', () => {
    expect(sniffCsv(cp1254('Şehir;Sıcaklık\nIğdır;21\n'), 'windows-1254').encoding).toBe('windows-1254');
    expect(sniffCsv(Uint8Array.from([0xff, 0xfe, 0x61, 0, 0x3b, 0, 0x62, 0]))).toMatchObject({ encoding: 'utf-16le', bom: true });
  });

  it('a rune cut at the end of the sample is still UTF-8', () => {
    const line = 'Şehir;Iğdır\n';
    const big = enc(line.repeat(Math.ceil(SNIFF_BYTES / line.length) + 10));
    // Cut so the sample ends inside "ş" (two bytes).
    let at = SNIFF_BYTES;
    while ((big[at] & 0xc0) !== 0x80) at++;
    expect(sniffCsv(big.subarray(0, at + 50)).encoding).toBe('utf-8');
  });
});

describe("filex's text_dialect", () => {
  it('is taken when it is one, refused otherwise', () => {
    expect(dialectOf({ text_dialect: { delimiter: ';', encoding: 'windows-1254', bom: false, eol: 'crlf' } })).toEqual({ delimiter: ';', encoding: 'windows-1254', bom: false, eol: 'crlf' });
    expect(dialectOf({})).toBeNull();
    expect(dialectOf({ text_dialect: { delimiter: ';;', encoding: 'utf-8' } })).toBeNull();
    expect(dialectOf({ text_dialect: { delimiter: '"', encoding: 'utf-8' } })).toBeNull();
    expect(dialectOf({ text_dialect: { delimiter: ';', encoding: 'no-such-encoding' } })).toBeNull();
  });
});

describe('the csv as x2t reads and writes it here', () => {
  // x2t's ICU has no conversion tables: a windows-1254 csv came out as an
  // empty sheet (docs/SERVER.md). The browser turns it into UTF-8 first.
  it('turns the file into UTF-8 without a byte order mark', () => {
    const d = { delimiter: ';', encoding: 'windows-1254', bom: false, eol: 'lf' as const };
    expect(new TextDecoder().decode(csvToUtf8(cp1254('Şehir;Iğdır'), d))).toBe('Şehir;Iğdır');
    const u = { delimiter: ',', encoding: 'utf-8', bom: true, eol: 'lf' as const };
    expect(Array.from(csvToUtf8(Uint8Array.from([...BOM, 0x61]), u))).toEqual([0x61]);
  });

  it("gives x2t its delimiter, by x2t's number or as a character of its own", () => {
    expect(csvText({ delimiter: ';', encoding: 'utf-8', bom: false, eol: 'lf' })).toEqual({ codepage: 46, delimiter: 2 });
    expect(csvText({ delimiter: '\t', encoding: 'utf-8', bom: false, eol: 'lf' })).toEqual({ codepage: 46, delimiter: 1 });
    expect(csvText({ delimiter: '|', encoding: 'utf-8', bom: false, eol: 'lf' })).toEqual({ codepage: 46, delimiterChar: '|' });
  });

  it("declares what x2t wrote: UTF-8, its mark and line ends as they are", () => {
    expect(writtenDialect(Uint8Array.from([...BOM, ...enc('a;b\nc;d\n')]), ';')).toEqual({ delimiter: ';', encoding: 'utf-8', bom: true, eol: 'lf' });
    expect(writtenDialect(enc('a,b\r\nc,d\r\n'), ',')).toEqual({ delimiter: ',', encoding: 'utf-8', bom: false, eol: 'crlf' });
  });
});
