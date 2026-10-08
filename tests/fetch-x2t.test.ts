// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The x2t pin ("x2t" in upstream/onlyoffice.json) and scripts/fetch-x2t.mjs:
// the pin holds together, and a download is refused unless the release's
// SHA-512 and each file's SHA-256 match it. No network: the zips here are
// made in the test. (tests/x2t-wasm.test.ts runs the real build.)

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { X2T_FILES, extractX2t, readX2tPin, validateX2tPin } from '../scripts/fetch-x2t.mjs';
import { writeZip } from '../scripts/lib/zip.mjs';

describe('the x2t pin (upstream/onlyoffice.json "x2t")', () => {
  it('is well formed: release, address, SHA-512 and both files', () => {
    const x2t = readX2tPin();
    expect(x2t.release).toBe('v9.3.2+3');
    expect(x2t.url).toBe('https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/download/v9.3.2%2B3/x2t.zip');
    expect(Object.keys(x2t.files).sort()).toEqual([...X2T_FILES].sort());
  });

  it('refuses a pin that does not hold together', () => {
    const good = readX2tPin();
    expect(() => validateX2tPin({ ...good, sha512: 'abc' })).toThrow(/sha512/);
    expect(() => validateX2tPin({ ...good, url: 'http://example.com/x2t.zip' })).toThrow(/url/);
    expect(() => validateX2tPin({ ...good, files: { 'x2t.js': good.files['x2t.js'] } })).toThrow(/x2t\.wasm/);
  });

  it('extractX2t refuses a zip that is not the pinned one, and a file that is not', () => {
    const fake = writeZip([
      { name: 'x2t.js', data: Buffer.from('js') },
      { name: 'x2t.wasm', data: Buffer.from('wasm') },
    ]);
    const good = readX2tPin();
    expect(() => extractX2t(fake, good)).toThrow(/SHA-512/);
    const sha512 = createHash('sha512').update(fake).digest('hex');
    expect(() => extractX2t(fake, { ...good, sha512 })).toThrow(/x2t\.js: SHA-256/);
    const files = {
      'x2t.js': createHash('sha256').update('js').digest('hex'),
      'x2t.wasm': createHash('sha256').update('wasm').digest('hex'),
    };
    const out = extractX2t(fake, { ...good, sha512, files });
    expect(out['x2t.wasm'].toString()).toBe('wasm');
  });
});
