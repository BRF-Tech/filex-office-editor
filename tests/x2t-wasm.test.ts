// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The x2t smoke test: the real WebAssembly build that upstream/onlyoffice.json
// pins, driven by src/x2t.ts in Node, takes a Word document, a workbook and
// a presentation with Turkish text to the editor's format (Editor.bin) and
// back, and loses nothing on the way: every text, the bold and italic runs,
// the table, the sheet's name, its numbers and its formula. Then Download
// as: every format offered, and a txt and a csv in each encoding offered,
// with every Turkish letter whole.
//
// It needs the build in dist/x2t (bash scripts/x2t/build.sh, or
// scripts/fetch-x2t.mjs from a build made elsewhere; about 40 MB). Without
// it the suite is skipped - `npm test` stays offline - and `npm run
// test:x2t` fails rather than skip. X2T_DIR points elsewhere (another build,
// to compare).

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';

import { beforeAll, describe, expect, it } from 'vitest';

import { CSV, EXPORT_FORMATS, PDF, TEXT_ENCODINGS, TXT, type DocumentKind } from '../src/formats';
import { CANVAS } from '../src/kinds';
import { X2tError, stopsX2t, x2tConvert, x2tExport, x2tStopReason, type X2tFormat, type X2tModule } from '../src/x2t';
import { writeZip } from '../scripts/lib/zip.mjs';
import {
  FORMULA,
  LEGACY_CSV,
  TR,
  docx,
  docxParagraphs,
  docxRuns,
  docxWithPicture,
  emfPicture,
  formulaLines,
  odtWithFormula,
  ofdPackage,
  parts,
  pptx,
  texts,
  xlsx,
} from './fixtures/office';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.X2T_DIR ? path.resolve(process.env.X2T_DIR) : path.join(here, '..', 'dist', 'x2t');
const present = existsSync(path.join(DIR, 'x2t.js')) && existsSync(path.join(DIR, 'x2t.wasm'));
const required = process.env.X2T_REQUIRED === '1' || process.env.npm_lifecycle_event === 'test:x2t';

if (!present && required) {
  throw new Error(`x2t is not in ${DIR}: run bash scripts/x2t/build.sh (or node scripts/fetch-x2t.mjs --dir DIR)`);
}

type EmModule = X2tModule & { onRuntimeInitialized?: () => void; onAbort?: (what: unknown) => void };

// x2t.js is emscripten's CommonJS script; this package is "type": "module",
// so it is run as CommonJS by hand, the way Node would.
async function loadX2t(): Promise<EmModule> {
  const file = path.join(DIR, 'x2t.js');
  const source = ['(function (module, exports, require, __dirname, __filename) {', readFileSync(file, 'utf8'), '})'].join('\n');
  const wrapped = vm.runInThisContext(source, { filename: file }) as (
    module: { exports: unknown },
    exports: unknown,
    require: NodeRequire,
    dirname: string,
    filename: string,
  ) => void;
  const mod = { exports: {} as unknown };
  wrapped(mod, mod.exports, createRequire(file), DIR, file);
  const m = mod.exports as EmModule;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('x2t did not start within 120 s')), 120_000);
    m.onRuntimeInitialized = () => {
      clearTimeout(t);
      resolve();
    };
  });
  return m;
}

const head = (b: Uint8Array, n = 12) => Buffer.from(b.subarray(0, n)).toString('latin1');

/**
 * A txt or csv written in x2t's code page `codepage` (formats.ts
 * TEXT_ENCODINGS): whether it starts with that encoding's byte order mark,
 * and its text. Measured: UTF-8 and UTF-16 come with one, UTF-32 without.
 */
function decodeAs(bytes: Uint8Array, codepage: number): { bom: boolean; text: string } {
  const b = Buffer.from(bytes);
  const starts = (...x: number[]) => x.every((v, i) => b[i] === v);
  const utf32 = (x: Buffer, le: boolean) => {
    let t = '';
    for (let i = 0; i + 3 < x.length; i += 4) t += String.fromCodePoint(le ? x.readUInt32LE(i) : x.readUInt32BE(i));
    return t;
  };
  switch (codepage) {
    case 46: {
      const bom = starts(0xef, 0xbb, 0xbf);
      return { bom, text: b.subarray(bom ? 3 : 0).toString('utf8') };
    }
    case 48: {
      const bom = starts(0xff, 0xfe);
      return { bom, text: b.subarray(bom ? 2 : 0).toString('utf16le') };
    }
    case 49: {
      const bom = starts(0xfe, 0xff);
      return { bom, text: Buffer.from(b.subarray(bom ? 2 : 0)).swap16().toString('utf16le') };
    }
    case 50: {
      const bom = starts(0xff, 0xfe, 0, 0);
      return { bom, text: utf32(b.subarray(bom ? 4 : 0), true) };
    }
    case 51: {
      const bom = starts(0, 0, 0xfe, 0xff);
      return { bom, text: utf32(b.subarray(bom ? 4 : 0), false) };
    }
    default:
      throw new Error(`no decoder for code page ${codepage}`);
  }
}
/** Which encodings x2t starts with a byte order mark (measured): UTF-8 and UTF-16. */
const WITH_BOM = new Set([46, 48, 49]);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

/** The parts that differ between two office files (compared by content: x2t's zips carry the time). */
function partsDiffer(a: Uint8Array, b: Uint8Array): string[] {
  const pa = parts(a);
  const pb = parts(b);
  return [...new Set([...pa.keys(), ...pb.keys()])].filter((k) => pa.get(k) !== pb.get(k));
}

function bytesDiffer(a: Uint8Array, b: Uint8Array): number {
  let n = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
}

describe.skipIf(!present)('x2t (WebAssembly) round trips with src/x2t.ts', () => {
  let m: EmModule;
  const measured: string[] = [];

  beforeAll(async () => {
    const t0 = performance.now();
    m = await loadX2t();
    measured.push(`x2t started in ${Math.round(performance.now() - t0)} ms`);
  }, 180_000);

  const toBin = (bytes: Uint8Array, format: Exclude<X2tFormat, 'bin'>) => x2tConvert(m, { bytes, format }, 'bin');
  const fromBin = (bin: { bytes: Uint8Array; media: Record<string, Uint8Array> }, format: Exclude<X2tFormat, 'bin'>) =>
    x2tConvert(m, { bytes: bin.bytes, format: 'bin', media: bin.media }, format).bytes;

  // Measured on CryptPad's v9.3.2+3 build and again on this project's: a
  // docx or pptx gives the same Editor.bin every time; an xlsx does not -
  // x2t writes a block of the workbook's Editor.bin from memory it never
  // cleared, so a few bytes in it differ from one conversion to the next
  // (the xlsx made from either is the same). `stableBin` says which kind the
  // format is.
  function roundTrip(input: Uint8Array, format: Exclude<X2tFormat, 'bin'>, magic: string, stableBin: boolean) {
    const t0 = performance.now();
    const bin = toBin(input, format);
    const t1 = performance.now();
    const back = fromBin(bin, format);
    const t2 = performance.now();
    // The editor opens Editor.bin only without base64 (src/x2t.ts).
    expect(head(bin.bytes, magic.length)).toBe(magic);

    // The same document again: the same Editor.bin (docx, pptx), or one
    // that gives the same file (xlsx).
    const again = toBin(input, format);
    if (stableBin) expect(same(again.bytes, bin.bytes)).toBe(true);
    expect(partsDiffer(fromBin(again, format), back)).toEqual([]);

    // Saved again and again: the first save adds what x2t always writes
    // (styles, settings, a theme, document properties); from the second
    // save on, open + save changes nothing.
    const bin2 = toBin(back, format);
    const back2 = fromBin(bin2, format);
    const bin3 = toBin(back2, format);
    const back3 = fromBin(bin3, format);
    expect(partsDiffer(back3, back2)).toEqual([]);
    if (stableBin) expect(same(bin3.bytes, bin2.bytes)).toBe(true);

    measured.push(
      `${format}: ${input.length} B -> Editor.bin ${bin.bytes.length} B (${Math.round(t1 - t0)} ms) -> ${format} ${back.length} B (${Math.round(t2 - t1)} ms); ` +
        `Editor.bin again: ${same(again.bytes, bin.bytes) ? 'identical' : `${bytesDiffer(again.bytes, bin.bytes)} bytes differ`}; ` +
        `second save changed: ${partsDiffer(back2, back).join(', ') || 'nothing'}; third save: Editor.bin ${same(bin3.bytes, bin2.bytes) ? 'identical' : 'differs'}, parts identical`,
    );
    return { bin, back };
  }

  it('docx: Turkish text, bold and italic runs and the table come back', () => {
    const { back } = roundTrip(docx(), 'docx', 'DOCY;v', true);
    const doc = parts(back).get('word/document.xml');
    expect(doc).toBeDefined();
    const paras = docxParagraphs(doc!);
    for (const t of [TR.title, TR.body, ...TR.cells]) expect(paras).toContain(t);
    expect(paras).toContain(`${TR.bold} / ${TR.italic}`);
    const runs = docxRuns(doc!);
    expect(runs.find((r) => r.text.includes(TR.bold))?.bold).toBe(true);
    expect(runs.find((r) => r.text.includes(TR.italic))?.italic).toBe(true);
    expect(runs.find((r) => r.text.includes(TR.body))?.bold).toBe(false);
    expect((doc!.match(/<w:tc[\s>]/g) ?? []).length).toBe(4);
  });

  it('xlsx: the sheet name, the strings, the numbers and the formula come back', () => {
    const { back } = roundTrip(xlsx(), 'xlsx', 'XLSY;v', false);
    const p = parts(back);
    const wb = p.get('xl/workbook.xml') ?? '';
    expect(wb).toContain(`name="${TR.sheet}"`);
    const sheetName = [...p.keys()].find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
    const sheet = p.get(sheetName ?? '') ?? '';
    const shared = texts(p.get('xl/sharedStrings.xml') ?? '', 't');
    const inline = texts(sheet, 't');
    for (const t of [...TR.cells, 'Toplam']) expect([...shared, ...inline]).toContain(t);
    expect(sheet).toMatch(/<f>SUM\(B2:B3\)<\/f>/);
    expect(texts(sheet, 'v')).toEqual(expect.arrayContaining(['18.5', '21']));
  });

  it('pptx: the slide text, bold and plain, comes back', () => {
    const { back } = roundTrip(pptx(), 'pptx', 'PPTY;v', true);
    const p = parts(back);
    const slideName = [...p.keys()].find((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    const slide = p.get(slideName ?? '') ?? '';
    const t = texts(slide, 'a:t');
    expect(t).toContain(TR.slideTitle);
    expect(t).toContain(TR.slideBody);
    const titleRun = [...slide.matchAll(/<a:r>[\s\S]*?<\/a:r>/g)].map((x) => x[0]).find((r) => r.includes(TR.slideTitle)) ?? '';
    expect(titleRun).toMatch(/<a:rPr[^>]*\bb="1"/);
  });

  // "Download as" (src/formats.ts): every format offered is written, as its
  // own type, with the Turkish text whole.
  const CONTENT_TYPE: Record<string, string> = {
    docx: 'wordprocessingml.document.main',
    docm: 'ms-word.document.macroEnabled.main',
    dotx: 'wordprocessingml.template.main',
    xlsx: 'spreadsheetml.sheet.main',
    xlsm: 'ms-excel.sheet.macroEnabled.main',
    xltx: 'spreadsheetml.template.main',
    pptx: 'presentationml.presentation.main',
    pptm: 'ms-powerpoint.presentation.macroEnabled.main',
    potx: 'presentationml.template.main',
    ppsx: 'presentationml.slideshow.main',
  };
  const kinds: [DocumentKind, () => Uint8Array, Exclude<X2tFormat, 'bin'>, string[]][] = [
    ['word', docx, 'docx', [TR.title, TR.body, TR.bold, TR.italic, ...TR.cells]],
    ['cell', xlsx, 'xlsx', [...TR.cells]],
    ['slide', pptx, 'pptx', [TR.slideTitle, TR.slideBody]],
  ];
  /** The words of a written file: its XML without tags, an RTF with its escapes read, a txt or csv as UTF-8. */
  function words(bytes: Uint8Array, ext: string): string {
    if (ext === 'rtf') return Buffer.from(bytes).toString('latin1').replace(/\\u(-?\d+)\*?/g, (_, n) => String.fromCharCode((Number(n) + 65536) % 65536));
    if (ext === 'txt' || ext === 'csv') return decodeAs(bytes, 46).text;
    return [...parts(bytes).values()].join('\n').replace(/<[^>]+>/g, '');
  }

  for (const [kind, make, from, expected] of kinds) {
    it(`${kind}: every Download as format but PDF, as its own type, with the Turkish text`, () => {
      const bin = toBin(make(), from);
      const done: string[] = [];
      for (const f of EXPORT_FORMATS.filter((x) => x.kind === kind)) {
        const t0 = performance.now();
        const out = x2tExport(m, { bin: bin.bytes, media: bin.media, formatTo: f.id, ext: f.ext });
        done.push(`${f.ext} ${out.length} B ${Math.round(performance.now() - t0)} ms`);
        if (f.ext === 'rtf') expect(head(out, 5)).toBe('{\\rtf');
        else if (f.ext === 'txt' || f.ext === 'csv') expect(decodeAs(out, 46).bom, f.ext).toBe(true);
        else if (CONTENT_TYPE[f.ext]) expect(parts(out).get('[Content_Types].xml'), f.ext).toContain(CONTENT_TYPE[f.ext]);
        else expect(parts(out).get('mimetype'), f.ext).toBe(f.mime);
        const w = words(out, f.ext);
        for (const t of expected) expect(w, `${f.ext}: ${t}`).toContain(t);
      }
      measured.push(`${kind} Download as: ${done.join(', ')}`);
    });
  }

  it('PDF needs the pages the editor drew: without them x2t writes nothing', () => {
    const bin = toBin(docx(), 'docx');
    expect(() => x2tExport(m, { bin: bin.bytes, formatTo: PDF, ext: 'pdf' })).toThrow(X2tError);
  });

  // ⚠ CryptPad's 9.3.2+3 cut every letter outside ASCII of a txt or csv to
  // its low byte ("Şifreli" -> "^ifreli"): its UnicodeConverter handed
  // wchar_t to ICU with u_strFromWCS, which fails in the WebAssembly build,
  // and fell back to the low bytes (scripts/x2t/patches/03-unicode-utf32.patch).
  // These two are red on that build and green on this project's.
  it('txt: the Turkish text whole, in UTF-8', () => {
    const bin = toBin(docx(), 'docx');
    const done: string[] = [];
    for (const codepage of TEXT_ENCODINGS.txt) {
      const out = x2tExport(m, { bin: bin.bytes, media: bin.media, formatTo: TXT, ext: 'txt', text: { codepage } });
      const { bom, text } = decodeAs(out, codepage);
      expect(bom, `code page ${codepage}`).toBe(WITH_BOM.has(codepage));
      for (const t of [TR.title, TR.body, `${TR.bold} / ${TR.italic}`, ...TR.cells]) expect(text, `code page ${codepage}: ${t}`).toContain(t);
      done.push(`code page ${codepage} ${out.length} B`);
    }
    measured.push(`txt: ${done.join(', ')}`);
  });

  it("csv: the sheet's Turkish text whole, with the delimiter chosen", () => {
    const bin = toBin(xlsx(), 'xlsx');
    const csv = (text: { codepage: number; delimiter?: number; delimiterChar?: string }) =>
      decodeAs(x2tExport(m, { bin: bin.bytes, media: bin.media, formatTo: CSV, ext: 'csv', text }), text.codepage);
    const comma = csv({ codepage: 46 });
    expect(comma.bom).toBe(true);
    const rows = comma.text.split(/\r?\n/).filter((r) => r.length > 0);
    expect(rows[0]).toBe(`${TR.cells[0]},${TR.cells[1]}`);
    expect(rows.slice(1).join('\n')).toContain(TR.cells[2]);
    expect(rows.slice(1).join('\n')).toContain(TR.cells[3]);
    expect(csv({ codepage: 46, delimiter: 2 }).text.split(/\r?\n/)[0]).toBe(`${TR.cells[0]};${TR.cells[1]}`);
    expect(csv({ codepage: 46, delimiter: 1 }).text.split(/\r?\n/)[0]).toBe(`${TR.cells[0]}\t${TR.cells[1]}`);
    expect(csv({ codepage: 46, delimiterChar: '|' }).text.split(/\r?\n/)[0]).toBe(`${TR.cells[0]}|${TR.cells[1]}`);
    for (const codepage of TEXT_ENCODINGS.csv) {
      const { bom, text } = csv({ codepage });
      expect(bom, `code page ${codepage}`).toBe(WITH_BOM.has(codepage));
      for (const t of TR.cells) expect(text, `code page ${codepage}: ${t}`).toContain(t);
    }
    measured.push(`csv: ${rows.length} rows, first ${JSON.stringify(rows[0])}`);
  });

  // ⚠ emscripten's ICU port carries no conversion tables: before x2t
  // v9.4.0.129+3 every code page but UTF-8/16/32 and ISO-8859-1 was lost - a
  // windows-1254 csv opened as an empty sheet, a Word 95 document without
  // its text. +3 links the tables core's UnicodeConverter reaches
  // (scripts/x2t/icu-data.py, icu-converters.txt). Red on +2.
  it('csv in a legacy code page: the text comes in whole, single-byte and multi-byte (ICU conversion tables)', () => {
    const done: string[] = [];
    for (const c of LEGACY_CSV) {
      const bytes = new Uint8Array([...c.bytes, 0x0d, 0x0a]);
      const bin = x2tConvert(m, { bytes, format: 'csv' }, 'bin', { formatTo: CANVAS.cell, text: { codepage: c.codepage, delimiter: 2 } });
      const p = parts(fromBin(bin, 'xlsx'));
      const sheetName = [...p.keys()].find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
      const got = [...texts(p.get('xl/sharedStrings.xml') ?? '', 't'), ...texts(p.get(sheetName ?? '') ?? '', 't')];
      for (const t of c.cells) expect(got, `${c.name} (x2t's ${c.codepage}): ${t}`).toContain(t);
      done.push(c.name);
    }
    // And written: the workbook's Turkish cells as windows-1254, read back with Node's decoder.
    const bin = toBin(xlsx(), 'xlsx');
    const out = x2tExport(m, { bin: bin.bytes, media: bin.media, formatTo: CSV, ext: 'csv', text: { codepage: 36 } });
    const text = new TextDecoder('windows-1254').decode(out);
    for (const t of TR.cells) expect(text, `windows-1254 written: ${t}`).toContain(t);
    measured.push(`csv in ${done.join(', ')}: the cells whole; written as windows-1254 ${out.length} B`);
  });

  // ⚠ CryptPad's 9.3.2+3 does not link ONLYOFFICE's StarMath converter, and
  // the ODF reader converts every LibreOffice formula with it: such an odt
  // stopped the module ("Aborted(missing function:
  // _ZN8StarMath18CStarMathConverterC1Ev)"). This build links it
  // (scripts/x2t/patches/04-starmath.patch). Last before the report: on a
  // build without it the module is gone after this.
  //
  // Where the formula is: in the line, where the frame is - at the end of
  // the first sentence, between the words of the second - and not a
  // floating shape (wp:anchor) at the top left of the margin, which the
  // editor draws in front of the sentence. A frame without a style was such
  // a shape until scripts/x2t/patches/05-frame-anchor.patch (#220).
  for (const styled of [true, false]) {
    it(`odt: a LibreOffice formula comes in as OOXML math, in its place in the line (frames ${styled ? 'with the style LibreOffice gives them' : 'without a style'})`, () => {
      const bin = toBin(odtWithFormula({ styled }), 'odt');
      const doc = parts(fromBin(bin, 'docx')).get('word/document.xml') ?? '';
      expect(doc).toMatch(/<m:oMath>/);
      expect(texts(doc, 'm:t').join('')).toContain('a+b');
      expect(/<wp:anchor[\s>]|<w:txbxContent[\s>]/.test(doc), 'the formula is a floating shape (wp:anchor), not in the line').toBe(false);
      const lines = formulaLines(doc);
      expect(lines).toContain(`${FORMULA.end} [a+b]`);
      expect(lines).toContain(`${FORMULA.before} [a+b] ${FORMULA.after}`);
      measured.push(`odt with two formulas (${styled ? 'styled' : 'no style'}): Editor.bin ${bin.bytes.length} B, back as OOXML math in the line: ${JSON.stringify(lines)}`);
    });
  }

  it('reports what it measured', () => {
    console.log(`x2t smoke (${DIR}):\n  ${measured.join('\n  ')}`);
    expect(measured.length).toBeGreaterThan(1);
  });
});

// x2t stops - emscripten's abort() - on a document that needs a function the
// build does not have: here an OFD package (x2t knows it by what it holds,
// whatever its name, and has no OFD reader). The worker must see it as the
// module stopping, not as a failed conversion (src/worker/x2t-worker.ts,
// #220): Module.onAbort first, then a WebAssembly.RuntimeError out of ccall.
// A module of its own: after an abort it cannot be used again.
describe.skipIf(!present)('x2t (WebAssembly) stopping on a document', () => {
  it('an OFD package named .docx stops the module: onAbort, then a RuntimeError, both read as "missing function: COFDFile::COFDFile"', async () => {
    const m = await loadX2t();
    const aborts: unknown[] = [];
    m.onAbort = (what) => aborts.push(what);
    let thrown: unknown = null;
    try {
      x2tConvert(m, { bytes: ofdPackage(), format: 'docx' }, 'bin');
    } catch (e) {
      thrown = e;
    }
    expect(thrown, 'the conversion threw').not.toBeNull();
    expect(thrown).not.toBeInstanceOf(X2tError);
    expect(stopsX2t(thrown)).toBe(true);
    expect(String((thrown as Error).message)).toMatch(/^Aborted\(missing function: _ZN8COFDFile/);
    expect(aborts.map(x2tStopReason)).toEqual(['missing function: COFDFile::COFDFile']);
    expect(x2tStopReason(thrown)).toBe('missing function: COFDFile::COFDFile');
  }, 180_000);
});

/**
 * HTML to md with x2t in a worker thread of its own, ended after `ms`: where
 * x2t loops on it (v9.4.0.129+2 did), the test fails instead of holding the
 * run. x2t's md type is AVS_OFFICESTUDIO_FILE_DOCUMENT_MD (92).
 */
function mdInWorker(html: string, ms: number): Promise<string> {
  const code = [
    "const { parentPort, workerData } = require('node:worker_threads');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const vm = require('node:vm');",
    "const { createRequire } = require('node:module');",
    "const NL = String.fromCharCode(10);",
    "const file = path.join(workerData.dir, 'x2t.js');",
    "const src = '(function (module, exports, require, __dirname, __filename) {' + NL + fs.readFileSync(file, 'utf8') + NL + '})';",
    'const mod = { exports: {} };',
    'vm.runInThisContext(src, { filename: file })(mod, mod.exports, createRequire(file), workerData.dir, file);',
    'const x = mod.exports;',
    'x.onRuntimeInitialized = () => {',
    '  try {',
    "    for (const d of ['/working', '/working/media']) { try { x.FS.mkdir(d); } catch (e) {} }",
    "    x.FS.writeFile('/working/input.html', workerData.html);",
    "    x.FS.writeFile('/working/params.xml', '<?xml version=\"1.0\" encoding=\"utf-8\"?><TaskQueueDataConvert><m_sFileFrom>/working/input.html</m_sFileFrom>' +",
    "      '<m_sFileTo>/working/output.md</m_sFileTo><m_nFormatTo>92</m_nFormatTo><m_bIsNoBase64>true</m_bIsNoBase64></TaskQueueDataConvert>');",
    "    const rc = x.ccall('main1', 'number', ['string'], ['/working/params.xml']);",
    "    parentPort.postMessage({ rc, md: rc === 0 ? Buffer.from(x.FS.readFile('/working/output.md')).toString('utf8') : null });",
    '  } catch (e) {',
    '    parentPort.postMessage({ error: String(e) });',
    '  }',
    '};',
  ].join('\n');
  return new Promise((resolve, reject) => {
    const w = new Worker(code, { eval: true, workerData: { dir: DIR, html } });
    const t = setTimeout(() => {
      void w.terminate();
      reject(new Error(`HTML to md did not finish in ${ms / 1000} s`));
    }, ms);
    w.on('message', (r: { rc?: number; md?: string | null; error?: string }) => {
      clearTimeout(t);
      void w.terminate();
      if (r.error) reject(new Error(`x2t stopped: ${r.error}`));
      else if (r.rc !== 0 || r.md == null) reject(new Error(`x2t: HTML to md failed (${r.rc})`));
      else resolve(r.md);
    });
    w.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

// ⚠ docs/PARITY.md A14: before x2t v9.4.0.129+3 the SVG engine of
// ONLYOFFICE's graphics library ran HtmlFile2's copy of the CSS calculator,
// built for another layout of the same classes, and HtmlFile2 ran the SVG
// engine's std::vector<NSCSS::CNode> code
// (scripts/x2t/patches/06-svg-css-namespace.patch): every metafile x2t
// opened wrote past its block. A Word document with one small EMF picture
// stopped the module ("null function or function signature mismatch",
// measured on +2), as did a PDF of a document with SVG pictures; HTML to md
// stopped or looped on any HTML. Red on +2; each in a module of its own.
describe.skipIf(!present)('x2t (WebAssembly) with pictures and HTML (docs/PARITY.md A14)', () => {
  it("a Word document with an EMF picture: into the editor's format with the picture as SVG beside it, and back", async () => {
    const m = await loadX2t();
    const input = docxWithPicture(emfPicture(), 'emf', 'image/x-emf');
    const bin = x2tConvert(m, { bytes: input, format: 'docx' }, 'bin');
    expect(head(bin.bytes, 6)).toBe('DOCY;v');
    const names = Object.keys(bin.media);
    const svg = names.find((n) => n.endsWith('.svg'));
    expect(svg, `media: ${names.join(', ')}`).toBeDefined();
    expect(Buffer.from(bin.media[svg!]).toString('utf8')).toMatch(/<svg[\s>]/);
    expect(names.some((n) => n.endsWith('.emf'))).toBe(true);
    const back = parts(x2tConvert(m, { bytes: bin.bytes, format: 'bin', media: bin.media }, 'docx').bytes);
    expect(docxParagraphs(back.get('word/document.xml') ?? '')).toContain(TR.title);
    expect([...back.keys()].some((k) => /^word\/media\/[^/]+\.emf$/.test(k))).toBe(true);
    // The same module, ten more times: the heap stays whole.
    for (let i = 0; i < 10; i++) expect(head(x2tConvert(m, { bytes: input, format: 'docx' }, 'bin').bytes, 6)).toBe('DOCY;v');
  }, 180_000);

  it('HTML to md: the text, bold and the table come out as md', async () => {
    const html =
      `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /></head><body>` +
      `<p><b>${TR.bold}</b></p><p>${TR.body}</p>` +
      `<table><tr><td>${TR.cells[0]}</td><td>${TR.cells[1]}</td></tr><tr><td>${TR.cells[2]}</td><td>${TR.cells[3]}</td></tr></table>` +
      `</body></html>`;
    const md = await mdInWorker(html, 60_000);
    expect(md).toContain(`**${TR.bold}**`);
    expect(md).toContain(TR.body);
    expect(md).toMatch(new RegExp(`\\|\\s*${TR.cells[0]}\\s*\\|\\s*${TR.cells[1]}\\s*\\|`));
  }, 120_000);
});
