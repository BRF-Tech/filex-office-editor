// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The weekly upstream watch (scripts/upstream-watch.mjs): which Docker Hub
// tag is the newest release, when an issue is due, that the same version
// never gets a second issue, that the pin file is well formed, and that the
// workflow keeps to the run's own GITHUB_TOKEN with issues: write.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PIN_FILE,
  alreadyOpened,
  compareVersions,
  issueBody,
  issueTitle,
  marker,
  newestRelease,
  parseTag,
  validatePin,
} from '../scripts/upstream-watch.mjs';

const tag = (name: string, digest = `sha256:${name}`, tag_status = 'active') => ({
  name,
  digest,
  tag_status,
  last_updated: '2026-07-22T08:00:00Z',
});

describe('parseTag', () => {
  it('reads releases and image revisions, and nothing else', () => {
    expect(parseTag('9.4.0')).toEqual({ version: [9, 4, 0], revision: 0 });
    expect(parseTag('9.4.0.1')).toEqual({ version: [9, 4, 0], revision: 1 });
    expect(parseTag('v9.4.0')).toEqual({ version: [9, 4, 0], revision: 0 });
    for (const moving of ['latest', '9', '9.4', '9.5.0-beta', '', 'v9.4']) {
      expect(parseTag(moving)).toBeNull();
    }
  });

  it('compares numerically, not as text', () => {
    expect(compareVersions([9, 10, 0], [9, 9, 3])).toBe(1);
    expect(compareVersions([9, 4, 0], [9, 4, 0])).toBe(0);
    expect(compareVersions([8, 99, 99], [9, 0, 0])).toBe(-1);
  });
});

describe('newestRelease', () => {
  it('takes the highest release, then its highest image revision', () => {
    const n = newestRelease([
      tag('latest'),
      tag('9.4'),
      tag('9.4.0'),
      tag('9.4.0.1'),
      tag('9.3.1.2'),
      tag('9.10.0'),
      tag('9.10.0.2'),
      tag('9.10.0.1'),
    ]);
    expect(n?.tag).toBe('9.10.0.2');
    expect(n?.version).toEqual([9, 10, 0]);
    expect(n?.digest).toBe('sha256:9.10.0.2');
  });

  it('skips inactive tags and anything that is not a release', () => {
    const n = newestRelease([tag('9.4.0.1'), tag('9.5.0.1', 'sha256:x', 'inactive'), tag('9.6.0-beta')]);
    expect(n?.tag).toBe('9.4.0.1');
  });

  it('finds nothing in a list without releases', () => {
    expect(newestRelease([tag('latest'), tag('9')])).toBeNull();
  });
});

describe('one issue per version', () => {
  it('finds an earlier issue by its marker, open or closed', () => {
    const issues = [
      { number: 3, state: 'closed', title: 'something else', body: `text\n\n${marker('9.5.0')}` },
      { number: 4, state: 'open', title: 'unrelated', body: null },
    ];
    expect(alreadyOpened(issues, '9.5.0')?.number).toBe(3);
    expect(alreadyOpened(issues, '9.5.1')).toBeNull();
  });

  it('also by its exact title, if the marker was edited away', () => {
    const issues = [{ number: 7, state: 'closed', title: issueTitle('9.6.0'), body: 'edited' }];
    expect(alreadyOpened(issues, '9.6.0')?.number).toBe(7);
  });

  it('writes the marker into the body it opens', () => {
    const pin = validatePin(JSON.parse(readFileSync(PIN_FILE, 'utf8')));
    const newest = { version: [9, 5, 0], revision: 1, tag: '9.5.0.1', digest: 'sha256:abc', updated: null };
    const body = issueBody({ pin, newest, release: null, runUrl: '' });
    expect(body).toContain(marker('9.5.0'));
    expect(body).toContain(pin.digest);
    // The phone apps are checked too: how they load sdkjs, and that they still only read.
    expect(body).toMatch(/isSupportEditFeature\(\)/);
    expect(body).toContain('src/frame/hold.ts');
    expect(alreadyOpened([{ number: 1, state: 'open', title: 'x', body }], '9.5.0')?.number).toBe(1);
  });
});

describe('upstream/onlyoffice.json', () => {
  it('is well formed: version, build, image tag and digest agree', () => {
    const pin = validatePin(JSON.parse(readFileSync(PIN_FILE, 'utf8')));
    expect(pin.parsed.version).toEqual(parseTag(pin.tag)?.version);
    expect(pin.build.startsWith(`${pin.version}.`)).toBe(true);
    expect(pin.source_tag).toBe(`v${pin.build}`);
  });

  it('refuses a pin that does not hold together', () => {
    const good = JSON.parse(readFileSync(PIN_FILE, 'utf8'));
    expect(() => validatePin({ ...good, digest: 'sha256:short' })).toThrow(/digest/);
    expect(() => validatePin({ ...good, tag: '9.3.1.2' })).toThrow(/tag must belong/);
    expect(() => validatePin({ ...good, version: 'latest' })).toThrow(/version/);
  });
});

describe('the workflow', () => {
  const yml = readFileSync(new URL('../.github/workflows/upstream-watch.yml', import.meta.url), 'utf8');

  it('runs weekly and by hand', () => {
    expect(yml).toMatch(/schedule:\s*\n(\s*#.*\n)*\s*- cron: '\d+ \d+ \* \* \d'/);
    expect(yml).toContain('workflow_dispatch:');
  });

  it('uses only the run token, with issues: write and read-only contents', () => {
    const secrets = [...yml.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    expect(new Set(secrets)).toEqual(new Set(['GITHUB_TOKEN']));
    expect(yml).toMatch(/permissions:\s*\n\s*contents: read\s*\n\s*issues: write\s*\n/);
  });
});
