// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// Driving x2t (ONLYOFFICE's converter, built to WebAssembly) in the browser
// (task #189). The module here is a stand-in with the emscripten file system
// calls x2t's build exports; the real conversion is measured against the
// wasm build when it exists. What is under test is the driver's side: the
// order it writes, the format flags the editor needs, the images it carries
// both ways, and that it leaves nothing of one document behind for the next.
import { describe, expect, it } from 'vitest';

import { X2T_DIR, X2tError, x2tConvert, x2tParams, type X2tModule } from '../src/x2t';

type Behaviour = (params: string, files: Map<string, Uint8Array | string>) => unknown;

function fakeX2t(behaviour: Behaviour) {
  const files = new Map<string, Uint8Array | string>();
  const dirs = new Set<string>();
  const calls: unknown[][] = [];
  const m: X2tModule = {
    FS: {
      mkdir(p) {
        if (dirs.has(p)) throw new Error('EEXIST');
        dirs.add(p);
      },
      writeFile(p, d) {
        files.set(p, d);
      },
      readFile(p) {
        const v = files.get(p);
        if (v === undefined) throw new Error('ENOENT');
        return typeof v === 'string' ? new TextEncoder().encode(v) : v;
      },
      readdir(p) {
        const names = [...files.keys()]
          .filter((k) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/'))
          .map((k) => k.slice(p.length + 1));
        return ['.', '..', ...names];
      },
      unlink(p) {
        if (!files.delete(p)) throw new Error('ENOENT');
      },
    },
    ccall(name, ret, types, args) {
      calls.push([name, ret, types, args]);
      return behaviour(String(files.get(args[0] as string)), files);
    },
  };
  return { m, files, calls };
}

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

describe('x2tParams', () => {
  it('names the files, the theme folder and the base64 flag', () => {
    const xml = x2tParams('/working/input.docx', '/working/output.bin', true);
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?><TaskQueueDataConvert')).toBe(true);
    expect(tag(xml, 'm_sFileFrom')).toBe('/working/input.docx');
    expect(tag(xml, 'm_sFileTo')).toBe('/working/output.bin');
    expect(tag(xml, 'm_sThemeDir')).toBe('/working/themes');
    expect(tag(xml, 'm_bIsNoBase64')).toBe('true');
    expect(tag(x2tParams('a', 'b', false), 'm_bIsNoBase64')).toBe('false');
  });
});

describe('x2tConvert', () => {
  it('docx to the editor format: no base64 (the only form sdkjs 9.4 opens), images out, nothing left behind', () => {
    const { m, files, calls } = fakeX2t((params, fs) => {
      fs.set(tag(params, 'm_sFileTo')!, 'DOCY;v10;0;BIN');
      fs.set(`${X2T_DIR}/media/image1.png`, new Uint8Array([137, 80, 78, 71]));
      return 0;
    });
    const docx = new Uint8Array([80, 75, 3, 4]);
    const out = x2tConvert(m, { bytes: docx, format: 'docx' }, 'bin');
    expect(new TextDecoder().decode(out.bytes)).toBe('DOCY;v10;0;BIN');
    expect(Object.keys(out.media)).toEqual(['image1.png']);
    expect(calls).toEqual([['main1', 'number', ['string'], [`${X2T_DIR}/params.xml`]]]);
    expect(files.size).toBe(0);
  });

  it('back to docx: the images go in beside the document, base64 is off, the input was the editor\'s text form', () => {
    let params = '';
    let input: Uint8Array | string | undefined;
    const { m, files } = fakeX2t((p, fs) => {
      params = p;
      input = fs.get(tag(p, 'm_sFileFrom')!);
      expect(fs.get(`${X2T_DIR}/media/image1.png`)).toEqual(new Uint8Array([1, 2, 3]));
      fs.set(tag(p, 'm_sFileTo')!, new Uint8Array([80, 75, 3, 4]));
      return 0;
    });
    const out = x2tConvert(m, { bytes: 'DOCY;v5;12;QUJD', format: 'bin', media: { 'image1.png': new Uint8Array([1, 2, 3]) } }, 'docx');
    expect(out.bytes).toEqual(new Uint8Array([80, 75, 3, 4]));
    expect(out.media).toEqual({});
    expect(tag(params, 'm_bIsNoBase64')).toBe('false');
    expect(tag(params, 'm_sFileTo')).toBe(`${X2T_DIR}/output.docx`);
    expect(input).toBe('DOCY;v5;12;QUJD');
    expect(files.size).toBe(0);
  });

  it('a failed conversion is an X2tError with its code, and still leaves nothing behind', () => {
    const { m, files } = fakeX2t(() => 89);
    expect(() => x2tConvert(m, { bytes: new Uint8Array([1]), format: 'xlsx' }, 'bin')).toThrow(X2tError);
    try {
      x2tConvert(m, { bytes: new Uint8Array([1]), format: 'xlsx' }, 'bin');
    } catch (e) {
      expect((e as X2tError).code).toBe(89);
    }
    expect(files.size).toBe(0);
  });

  it('no output file is an error too', () => {
    const { m } = fakeX2t(() => 0);
    expect(() => x2tConvert(m, { bytes: new Uint8Array([1]), format: 'pptx' }, 'bin')).toThrow(/no output/);
  });

  it('refuses an image name that would leave the media folder, and a conversion to the same format', () => {
    const { m, files } = fakeX2t(() => 0);
    expect(() => x2tConvert(m, { bytes: 'x', format: 'bin', media: { '../params.xml': new Uint8Array([1]) } }, 'docx')).toThrow(
      /bad media name/,
    );
    expect(files.size).toBe(0);
    expect(() => x2tConvert(m, { bytes: 'x', format: 'docx' }, 'docx')).toThrow(X2tError);
  });

  it('an image left from an earlier document does not come out with the next one', () => {
    const { m, files } = fakeX2t((p, fs) => {
      fs.set(tag(p, 'm_sFileTo')!, 'DOCY;v10;0;');
      return 0;
    });
    files.set(`${X2T_DIR}/media/old.png`, new Uint8Array([9]));
    const out = x2tConvert(m, { bytes: new Uint8Array([1]), format: 'docx' }, 'bin');
    expect(out.media).toEqual({});
  });

  it('runs twice on one module (the folders already exist the second time)', () => {
    const { m } = fakeX2t((p, fs) => {
      fs.set(tag(p, 'm_sFileTo')!, 'DOCY;v10;0;');
      return 0;
    });
    x2tConvert(m, { bytes: new Uint8Array([1]), format: 'docx' }, 'bin');
    expect(() => x2tConvert(m, { bytes: new Uint8Array([1]), format: 'docx' }, 'bin')).not.toThrow();
  });
});
