// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The x2t pin ("x2t" in upstream/onlyoffice.json), scripts/fetch-x2t.mjs and
// the build recipe in scripts/x2t/: the pin holds together, x2t is built
// from ONLYOFFICE core at the editor files' own tag, every source is pinned
// by commit, and files that are not the pinned build are refused. No network
// and no build: the zips here are made in the test. (tests/x2t-wasm.test.ts
// runs the real build.)

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { X2T_FILES, checkX2tFiles, extractX2t, readX2tPin, validateX2tPin } from '../scripts/fetch-x2t.mjs';
import { writeZip } from '../scripts/lib/zip.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIN = JSON.parse(readFileSync(path.join(ROOT, 'upstream', 'onlyoffice.json'), 'utf8'));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('the x2t pin (upstream/onlyoffice.json "x2t")', () => {
  it("is this project's build, from ONLYOFFICE core at the editor files' tag", () => {
    const x2t = readX2tPin();
    const core = x2t.build.sources.core;
    expect(core.repository).toBe('https://github.com/ONLYOFFICE/core.git');
    expect(core.tag).toBe(PIN.source_tag);
    expect(x2t.build.sources.build_tools.tag).toBe(PIN.source_tag);
    expect(x2t.release.startsWith(`${PIN.source_tag}+`)).toBe(true);
    expect(Object.keys(x2t.files).sort()).toEqual([...X2T_FILES].sort());
    expect(x2t.build.toolchain.image).toBe(`docker.io/emscripten/emsdk:${x2t.build.toolchain.emsdk}`);
  });

  it('names the toolchain the Dockerfile builds from, by the same digest and snapshot', () => {
    const t = readX2tPin().build.toolchain;
    const dockerfile = readFileSync(path.join(ROOT, 'scripts', 'x2t', 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain(`ARG EMSDK_IMAGE=${t.image}@${t.digest}`);
    expect(dockerfile).toContain(`ARG APT_SNAPSHOT=${t.apt_snapshot}`);
  });

  it('refuses a pin that does not hold together', () => {
    const good = readX2tPin();
    const sources = good.build.sources;
    expect(() => validateX2tPin({ ...good, release: 'v9.4' })).toThrow(/release/);
    expect(() => validateX2tPin({ ...good, files: { 'x2t.js': good.files['x2t.js'] } })).toThrow(/x2t\.wasm/);
    expect(() => validateX2tPin({ ...good, build: { ...good.build, sources: { ...sources, core: { ...sources.core, commit: 'v9.4.0.129' } } } })).toThrow(/core\.commit/);
    expect(() => validateX2tPin({ ...good, build: { ...good.build, toolchain: { ...good.build.toolchain, digest: 'latest' } } })).toThrow(/digest/);
    expect(() => validateX2tPin({ ...good, build: { ...good.build, sources: { ...sources, boost: { ...sources.boost, sha256: '' } } } })).toThrow(/boost\.sha256/);
    expect(() => validateX2tPin({ ...good, url: 'https://github.com/a/b/releases/download/v1/x2t.zip' })).toThrow(/sha512/);
    expect(() => validateX2tPin({ ...good, build: undefined })).toThrow(/build/);
  });

  it('checks the two files, and a zip of them (with its SHA-512 when one is pinned)', () => {
    const good = readX2tPin();
    const files = { 'x2t.js': sha256('js'), 'x2t.wasm': sha256('wasm') };
    const pinned = { ...good, files };
    expect(() => checkX2tFiles({ 'x2t.js': Buffer.from('js'), 'x2t.wasm': Buffer.from('other') }, pinned)).toThrow(/x2t\.wasm: SHA-256/);
    expect(() => checkX2tFiles({ 'x2t.js': Buffer.from('js') }, pinned)).toThrow(/no x2t\.wasm/);
    const zip = writeZip([
      { name: 'x2t.js', data: Buffer.from('js') },
      { name: 'x2t.wasm', data: Buffer.from('wasm') },
    ]);
    expect(extractX2t(zip, pinned)['x2t.wasm'].toString()).toBe('wasm');
    expect(() => extractX2t(zip, good)).toThrow(/x2t\.js: SHA-256/);
    const sha512 = createHash('sha512').update(zip).digest('hex');
    expect(() => extractX2t(zip, { ...pinned, sha512: 'a'.repeat(128) })).toThrow(/SHA-512/);
    expect(extractX2t(zip, { ...pinned, sha512 })['x2t.js'].toString()).toBe('js');
  });
});

describe('the build recipe (scripts/x2t)', () => {
  const dir = path.join(ROOT, 'scripts', 'x2t');
  const steps = readFileSync(path.join(dir, 'steps.sh'), 'utf8');

  it('fetches every repository by its pinned commit, and boost by its SHA-256', () => {
    for (const name of ['core', 'build_tools', 'hyphen', 'openssl']) {
      expect(steps).toContain(`"$(pin sources.${name}.repository)" "$(pin sources.${name}.commit)"`);
    }
    expect(steps).toContain('sha=$(pin sources.boost.sha256)');
    expect(steps).toMatch(/sha256sum -c --status/);
  });

  it('applies every patch in patches/, each a change to ONLYOFFICE core alone', () => {
    const patches = readdirSync(path.join(dir, 'patches')).filter((f) => f.endsWith('.patch'));
    expect(patches.length).toBeGreaterThan(0);
    expect(steps).toContain('for p in /x2t/patches/*.patch');
    for (const p of patches) {
      const text = readFileSync(path.join(dir, 'patches', p), 'latin1');
      const files = [...text.matchAll(/^diff --git a\/(\S+) b\//gm)].map((m) => m[1]);
      expect(files.length, p).toBeGreaterThan(0);
      for (const f of files) expect(f, p).not.toMatch(/^(\/|\.\.)/);
    }
  });

  it('keeps the UTF-32 fix: wchar_t goes to ICU through its UTF-32 functions', () => {
    const fix = readFileSync(path.join(dir, 'patches', '03-unicode-utf32.patch'), 'latin1');
    expect(fix).toMatch(/u_strFromUTF32WithSub/);
    expect(fix).toMatch(/u_strToUTF32WithSub/);
  });
});
