// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The dictionaries a release publishes for filex to install with one click
// (scripts/pack-dictionaries.mjs; filex 0.57's ui.extras and its
// filex-extras/1 catalog): one item a language the bundle does not carry,
// its Hunspell and hyphenation files unchanged at the paths the editor reads
// under extra/dictionaries/, their licences beside them, the catalog pinned
// in the manifest.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { BUNDLED_DICTIONARIES, dictionaryUrl } from '../src/frame/workers';
import { CATALOG_URL, LIMITS, buildDictionaries, bundledDictionaries, withDictionaries } from '../scripts/pack-dictionaries.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fx-dict-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A folder laid out as the image's dictionaries/ (one folder a language). */
function images(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(path.join(tmp, 'd-'));
  for (const [rel, data] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), data);
  }
  return dir;
}

const SOURCE = 'ONLYOFFICE Docs 9.4.0.129 (test)';
const LATIN1 = Buffer.from([0x4e, 0x79, 0x6e, 0x6f, 0x72, 0x73, 0x6b, 0xe6]);

describe('the dictionaries a release publishes (scripts/pack-dictionaries.mjs)', () => {
  it("leaves out the bundle's languages: in-image.sh's list is the app's", () => {
    expect(bundledDictionaries()).toEqual([...BUNDLED_DICTIONARIES]);
  });

  it('one item a language: its .aff, .dic and hyph_ .dic at the paths the editor reads, each with its size and SHA-256', () => {
    const dir = images({
      'pl_PL/pl_PL.aff': 'SET UTF-8\n',
      'pl_PL/pl_PL.dic': '2\nkot\npies\n',
      'pl_PL/hyph_pl_PL.dic': 'UTF-8\n1a1\n',
      'pl_PL/pl_PL_Polish.txt': 'LGPL\n',
      'pl_PL/pl_PL.json': '{"codes": [1045]}',
      'pl_PL/th_pl_PL_v2.dat': 'thesaurus',
      'nn_NO/nn_NO.aff': 'SET ISO8859-1\n',
      'nn_NO/nn_NO.dic': '1\nord\n',
      'nn_NO/COPYING': LATIN1,
      'ru_RU/ru_RU.aff': 'SET KOI8-R\n',
      'ru_RU/ru_RU.dic': '1\nслово\n',
      'en_US/en_US.aff': 'bundled',
      'en_US/en_US.dic': 'bundled',
    });
    const { catalog, bytes, files } = buildDictionaries(dir, { bundled: BUNDLED_DICTIONARIES, source: SOURCE });
    expect(catalog.format).toBe('filex-extras/1');
    expect(catalog.kind).toBe('dictionaries');
    expect(catalog.items.map((i: { id: string }) => i.id)).toEqual(['nn_NO', 'pl_PL', 'ru_RU']);
    const pl = catalog.items.find((i: { id: string }) => i.id === 'pl_PL');
    expect(pl.files).toEqual([
      { path: 'pl_PL/pl_PL.aff.txt', url: 'dict-pl_PL.aff', size: 10, sha256: sha256('SET UTF-8\n') },
      { path: 'pl_PL/pl_PL.dic.txt', url: 'dict-pl_PL.dic', size: 11, sha256: sha256('2\nkot\npies\n') },
      { path: 'pl_PL/hyph_pl_PL.dic.txt', url: 'dict-hyph_pl_PL.dic', size: 10, sha256: sha256('UTF-8\n1a1\n') },
    ]);
    // Every file is the image's, byte for byte, at the address the catalog names.
    for (const item of catalog.items) {
      for (const f of item.files) expect(sha256(files.get(f.url)!)).toBe(f.sha256);
    }
    // What filex installs is where the editor's spell checker and hyphenation look (src/frame/workers.ts).
    const root = 'https://f.example/_appui/office-editor/abc/';
    for (const f of pl.files) {
      const name = f.path.split('/')[1].replace(/\.txt$/, '');
      expect(dictionaryUrl(`../dictionaries/pl_PL/${name}`, root, BUNDLED_DICTIONARIES)).toBe(`${root}extra/dictionaries/${f.path}`);
    }
    // The catalog as filex reads it: within its limits, the same bytes as the object.
    expect(bytes.length).toBeLessThanOrEqual(LIMITS.catalogBytes);
    expect(JSON.parse(bytes.toString('utf8'))).toEqual(catalog);
  });

  it('puts each language\'s licence and notice files beside it, unchanged, and says so where there are none', () => {
    const dir = images({
      'pl_PL/pl_PL.aff': 'a',
      'pl_PL/pl_PL.dic': 'd',
      'pl_PL/pl_PL_Polish.txt': 'LGPL\n',
      'pl_PL/pl_PL.json': '{"codes": [1045]}',
      'nn_NO/nn_NO.aff': 'a',
      'nn_NO/nn_NO.dic': 'd',
      'nn_NO/COPYING': LATIN1,
      'ru_RU/ru_RU.aff': 'a',
      'ru_RU/ru_RU.dic': 'd',
    });
    const { catalog, files } = buildDictionaries(dir, { bundled: [], source: SOURCE });
    const pl = files.get('dict-pl_PL.LICENSE.txt')!.toString('utf8');
    expect(pl).toContain(SOURCE);
    expect(pl).toContain('===== pl_PL_Polish.txt =====\nLGPL\n');
    expect(pl).not.toContain('codes');
    // A licence in another encoding keeps its bytes.
    expect(files.get('dict-nn_NO.LICENSE.txt')!.includes(LATIN1)).toBe(true);
    expect(files.get('dict-ru_RU.LICENSE.txt')!.toString('utf8')).toContain('carries no licence or notice file');
    for (const item of catalog.items) {
      expect(item.license).toBe(`see dict-${item.id}.LICENSE.txt`);
      expect(item.license_file.sha256).toBe(sha256(files.get(`dict-${item.id}.LICENSE.txt`)!));
    }
  });

  it('refuses a language folder or a file filex would not take, and a language without its .dic', () => {
    expect(() => buildDictionaries(images({ 'pl-PL/pl-PL.aff': 'a', 'pl-PL/pl-PL.dic': 'd' }), { bundled: [], source: SOURCE })).toThrow(/language folder/);
    expect(() => buildDictionaries(images({ 'pl_PL/pl_PL.aff': 'a' }), { bundled: [], source: SOURCE })).toThrow(/no pl_PL\.dic/);
    expect(() => buildDictionaries(images({ 'pl_PL/pl_PL.aff': '', 'pl_PL/pl_PL.dic': 'd' }), { bundled: [], source: SOURCE })).toThrow(/0 bytes/);
  });

  it("the manifest names the release's catalog by its tag and pins it (ui.extras, filex 0.57)", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'filex-app.json'), 'utf8'));
    const cat = manifest.ui.extras.dictionaries.catalog;
    expect(cat.url).toBe(CATALOG_URL);
    expect(CATALOG_URL).toBe('https://github.com/BRF-Tech/filex-office-editor/releases/download/{tag}/dictionaries.json');
    expect(cat.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.ui.package_fetch).toBe(true);
    expect(withDictionaries(manifest, cat.sha256)).toEqual(manifest);
  });
});
