// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The x2t smoke test: the real WebAssembly build that upstream/onlyoffice.json
// pins, driven by src/x2t.ts in Node, takes a Word document, a workbook and
// a presentation with Turkish text to the editor's format (Editor.bin) and
// back, and loses nothing on the way: every text, the bold and italic runs,
// the table, the sheet's name, its numbers and its formula.
//
// It needs the build in dist/x2t (scripts/fetch-x2t.mjs, about 39 MB). Without
// it the suite is skipped - `npm test` stays offline - and `npm run
// test:x2t` fetches it first and fails rather than skip. X2T_DIR points
// elsewhere.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { beforeAll, describe, expect, it } from 'vitest';

import { x2tConvert, type X2tFormat, type X2tModule } from '../src/x2t';
import { TR, docx, docxParagraphs, docxRuns, parts, pptx, texts, xlsx } from './fixtures/office';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.X2T_DIR ? path.resolve(process.env.X2T_DIR) : path.join(here, '..', 'dist', 'x2t');
const present = existsSync(path.join(DIR, 'x2t.js')) && existsSync(path.join(DIR, 'x2t.wasm'));
const required = process.env.X2T_REQUIRED === '1' || process.env.npm_lifecycle_event === 'test:x2t';

if (!present && required) {
  throw new Error(`x2t is not in ${DIR}: run node scripts/fetch-x2t.mjs`);
}

type EmModule = X2tModule & { onRuntimeInitialized?: () => void };

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

  // Measured on CryptPad's v9.3.2+3 build: a docx or pptx gives the same
  // Editor.bin every time; an xlsx does not - x2t writes a block of the
  // workbook's Editor.bin from memory it never cleared, so a few bytes in it
  // differ from one conversion to the next (the xlsx made from either is
  // the same). `stableBin` says which kind the format is.
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

  it('reports what it measured', () => {
    console.log(`x2t smoke (${DIR}):\n  ${measured.join('\n  ')}`);
    expect(measured.length).toBeGreaterThan(1);
  });
});
