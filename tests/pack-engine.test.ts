// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// engine.zip, the office engine a release attaches (scripts/pack-engine.mjs):
// its pins in upstream/onlyoffice.json, the entries filex's engines.office
// contract asks for, every pinned file checked before it is packed, and the
// manifest block a release commit writes.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ENGINE_ENTRIES, ENGINE_PINNED, packEngine, validateEnginePin, withEngine } from '../scripts/pack-engine.mjs';
import { readZip } from '../scripts/lib/zip.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIN = JSON.parse(readFileSync(path.join(ROOT, 'upstream', 'onlyoffice.json'), 'utf8'));
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

describe('engine.zip (scripts/pack-engine.mjs)', () => {
  it("holds the entries filex's engines.office asks for: x2t-server.wasm, layout-host.wasm and the layout's scripts", () => {
    expect(ENGINE_ENTRIES).toEqual(['x2t-server.wasm', 'layout-host.wasm', 'layout/worker.js', 'layout/fonts_ie.js', 'layout/xregexp-all-min.js']);
  });

  it('pins every entry it does not build from this repository: the server x2t under x2t, the rest under engine', () => {
    const pinned = validateEnginePin(PIN);
    expect(Object.keys(pinned).sort()).toEqual([...ENGINE_PINNED, 'x2t-server.wasm'].sort());
    expect(pinned['x2t-server.wasm']).toBe(PIN.x2t.files['x2t-server.wasm']);
    expect(() => validateEnginePin({ ...PIN, engine: undefined })).toThrow(/engine/);
    expect(() => validateEnginePin({ ...PIN, engine: { files: { ...PIN.engine.files, 'layout-host.wasm': 'latest' } } })).toThrow(/layout-host\.wasm/);
    // The layout-host build names its toolchain by digest, so the pin holds.
    expect(readFileSync(path.join(ROOT, 'server', 'layout', 'host', 'build.sh'), 'utf8')).toMatch(/WASI_SDK_IMAGE=\S+@sha256:[0-9a-f]{64}\n/);
  });

  it('packs only files that match their pins, sorted, and the same bytes twice', () => {
    const files: Record<string, Buffer> = Object.fromEntries(ENGINE_ENTRIES.map((n) => [n, Buffer.from(`${n} contents`)]));
    const pinned = Object.fromEntries(Object.entries(files).filter(([n]) => n !== 'layout/worker.js').map(([n, b]) => [n, sha256(b)]));
    const zip = packEngine(files, pinned);
    expect(Buffer.from(packEngine(files, pinned)).equals(Buffer.from(zip))).toBe(true);
    expect(readZip(zip).map((e: { name: string }) => e.name)).toEqual([...ENGINE_ENTRIES].sort());
    expect(() => packEngine({ ...files, 'layout/fonts_ie.js': Buffer.from('another') }, pinned)).toThrow(/fonts_ie\.js: SHA-256/);
    expect(() => packEngine({ ...files, 'layout-host.wasm': undefined as unknown as Buffer }, pinned)).toThrow(/no layout-host\.wasm/);
  });

  it("writes the manifest's engines.office: the release's engine.zip by its tag, its SHA-256, the bundle's editor/", () => {
    const m = withEngine({ name: 'office-editor', ui: {} }, 'a'.repeat(64));
    expect(m.engines).toEqual({
      office: { url: 'https://github.com/BRF-Tech/filex-office-editor/releases/download/{tag}/engine.zip', sha256: 'a'.repeat(64), editor: 'editor' },
    });
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'filex-app.json'), 'utf8'));
    expect(withEngine(manifest, manifest.engines.office.sha256)).toEqual(manifest);
  });
});
