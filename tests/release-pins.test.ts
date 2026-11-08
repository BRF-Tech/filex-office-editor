// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// What a release's files are held to (scripts/release-pins.mjs, used by
// scripts/release.sh): the pins it writes for a version, the mismatches it
// names, the release's notes and assets.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { changelogSection, isVersion, releaseAssets, releaseProblems, releaseUrl, withReleasePins } from '../scripts/release-pins.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const manifest = () => ({
  version: '1.2.3',
  ui: {
    bundle: { url: releaseUrl('1.2.3', 'ui.zip'), sha256: 'u'.repeat(64) },
    extras: { dictionaries: { catalog: { url: 'x/{tag}/dictionaries.json', sha256: 'c'.repeat(64) } } },
  },
  engines: { office: { url: 'x/{tag}/engine.zip', sha256: 'e'.repeat(64) } },
});
const pin = () => ({ x2t: { url: releaseUrl('1.2.3', 'x2t.zip'), sha512: 'x'.repeat(128), release: 'v1+1' } });
const catalog = JSON.stringify({ items: [{ id: 'pl_PL', files: [{ url: 'dict-pl_PL.aff', size: 3, sha256: 'a'.repeat(64) }], license_file: { url: 'dict-pl_PL.LICENSE.txt', size: 5, sha256: 'b'.repeat(64) } }] });
const files = () => ({
  uiSha256: 'u'.repeat(64),
  engineSha256: 'e'.repeat(64),
  x2tSha512: 'x'.repeat(128),
  catalogSha256: 'c'.repeat(64),
  catalog,
  dictionaries: { 'dict-pl_PL.aff': { size: 3, sha256: 'a'.repeat(64) }, 'dict-pl_PL.LICENSE.txt': { size: 5, sha256: 'b'.repeat(64) } },
});

describe('the release pins (scripts/release-pins.mjs)', () => {
  it("names the release's assets by the version's tag", () => {
    expect(releaseUrl('0.5.0', 'ui.zip')).toBe('https://github.com/BRF-Tech/filex-office-editor/releases/download/v0.5.0/ui.zip');
    expect(isVersion('0.5.0')).toBe(true);
    expect(isVersion('v0.5.0')).toBe(false);
    expect(isVersion('0.5')).toBe(false);
  });

  it("pins ui.zip and x2t.zip for a version, and nothing else of the files", () => {
    const m = manifest();
    const p = pin();
    const next = withReleasePins(m, p, { version: '1.3.0', uiSha256: '1'.repeat(64), x2tSha512: '2'.repeat(128) });
    expect(next.manifest.ui.bundle).toEqual({ url: releaseUrl('1.3.0', 'ui.zip'), sha256: '1'.repeat(64) });
    expect(next.manifest.ui.extras).toEqual(m.ui.extras);
    expect(next.manifest.engines).toEqual(m.engines);
    expect(next.pin.x2t).toEqual({ url: releaseUrl('1.3.0', 'x2t.zip'), sha512: '2'.repeat(128), release: 'v1+1' });
    expect(m.ui.bundle.sha256).toBe('u'.repeat(64));
    expect(() => withReleasePins(m, p, { version: 'v1', uiSha256: '', x2tSha512: '' })).toThrow(/version/);
  });

  it('agrees with files that match, and names every mismatch', () => {
    expect(releaseProblems({ version: '1.2.3', manifest: manifest(), pin: pin(), files: files() })).toEqual([]);
    const f = files();
    f.uiSha256 = '9'.repeat(64);
    f.x2tSha512 = '8'.repeat(128);
    f.dictionaries['dict-pl_PL.aff'] = { size: 4, sha256: 'a'.repeat(64) };
    delete (f.dictionaries as Record<string, unknown>)['dict-pl_PL.LICENSE.txt'];
    const problems = releaseProblems({ version: '1.2.4', manifest: manifest(), pin: pin(), files: f });
    expect(problems.join('\n')).toMatch(/version is 1\.2\.3, not 1\.2\.4/);
    expect(problems.join('\n')).toMatch(/ui\.bundle\.url/);
    expect(problems.join('\n')).toMatch(/ui\.zip: SHA-256 9+/);
    expect(problems.join('\n')).toMatch(/x2t\.zip: SHA-512 8+/);
    expect(problems.join('\n')).toMatch(/dict-pl_PL\.aff: 4 bytes/);
    expect(problems.join('\n')).toMatch(/dict-pl_PL\.LICENSE\.txt: in the catalog, not built/);
  });

  it("takes a version's notes from CHANGELOG.md, without its heading", () => {
    const text = '# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-11-08\n\nThe notes.\n\n### Fixed\n\n- a thing\n\n## [1.2.2] - 2026-10-01\n\nOld.\n';
    expect(changelogSection(text, '1.2.3')).toBe('The notes.\n\n### Fixed\n\n- a thing');
    expect(changelogSection(text, '1.2.2')).toBe('Old.');
    expect(changelogSection(text, '1.2.4')).toBeNull();
    const own = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const version = JSON.parse(readFileSync(path.join(ROOT, 'filex-app.json'), 'utf8')).version as string;
    expect(changelogSection(own, version)?.length).toBeGreaterThan(100);
  });

  it('lists the three zips, then the catalog and its files', () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'oe-rel-'));
    mkdirSync(path.join(dist, 'dictionaries'));
    for (const n of ['dictionaries.json', 'dict-pl_PL.aff', 'dict-de_DE.dic']) writeFileSync(path.join(dist, 'dictionaries', n), n);
    expect(releaseAssets(dist, manifest()).map(([n]: [string, string]) => n)).toEqual(['ui.zip', 'engine.zip', 'x2t.zip', 'dict-de_DE.dic', 'dict-pl_PL.aff', 'dictionaries.json']);
    expect(releaseAssets(dist, { ui: {} }).length).toBe(3);
  });
});
