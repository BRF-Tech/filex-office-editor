// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The editor page against ONLYOFFICE Docs 10.0's sdkjs, whose build renames
// what it does not export by a quoted name (src/frame/sdk.ts): the server
// step of Download as found by what downloadAs does, the register of the
// document's files and the TXT/CSV encodings by what they hold, the fonts a
// PDF needs from the font files the editor fetched, and an inserted image
// answered at its upload request (src/frame/requests.ts, images.ts). The
// shapes below are 10.0.0.169's, minified as it ships them (read
// 2026-11-08); the browsers run the whole of it (e2e/run.mjs).
import { describe, expect, it, vi } from 'vitest';

import { PDF, TXT } from '../src/formats';
import { loadedFonts, takeOverDownloads, trimDownloadFormats, type ExportJob } from '../src/frame/export';
import { uploadAnswer } from '../src/frame/images';
import { LoadedFonts, plainFont, watchRequests } from '../src/frame/requests';
import { SaveRetry } from '../src/frame/save-retry';
import { findDocumentUrls, findDownloadStep, findEncodings, findEndAction, keysOf } from '../src/frame/sdk';

/** downloadAs's body, minified as each 10.0 bundle ships it (cell, slide: the method; word: inside `if(!this.dze(q,v)){...}`). */
const DOWNLOAD_AS =
  'var x={data:null,Bca:null,index:0,count:0};var y={c:"save"};y.id=this.K2;y.outputformat=v.bca;y.nobase64=!0;3===q&&(y.withoutPassword=!0,y.inline=1);var u="";this.v7f(q,v,y,x,u)||this.w7f(q,v,y,x,u)';

/**
 * sdkjs 10.0's base API, minified as it ships: downloadAs builds the server
 * command and ends with `this.v7f(...)||this.w7f(...)` (_downloadAs,
 * _downloadAsUsingServer). The word build keeps sync_EndAction by its name;
 * cell and slide do not (`named: false`): only its source says what it is.
 */
function minifiedApi({ word = true, named = true } = {}) {
  // A function's source is what the search reads, so downloadAs is written
  // the way the minified file has it (new Function adds the closing brace).
  const base: Record<string, unknown> = {};
  base.X3a = new Function('q', 'v', 'return q+v');
  base.Q9 = new Function('q', 'v', word ? `if(!this.dze(q,v)){${DOWNLOAD_AS}}` : DOWNLOAD_AS);
  base.dze = () => false;
  base.v7f = () => false;
  base.w7f = () => {
    throw new Error('the server step must not run');
  };
  base.Mq = new Function('a', 'b', 'this.Ox("asc_onEndAction",a,b);this.Pz(a)');
  base.Ox = () => {};
  base.Pz = () => {};
  const proto: Record<string, unknown> = Object.create(base);
  const ended: [number, number][] = [];
  // The editor's own sync_EndAction (a derived one, under the same renamed key).
  proto.Mq = (t: number, id: number) => ended.push([t, id]);
  if (named) proto.sync_EndAction = proto.Mq;
  const api = Object.create(proto) as Record<string, unknown>;
  api.Lna = 'Rapor.docx';
  return { base, proto, api, ended };
}

describe('the server step of Download as, renamed (10.0)', () => {
  it('is the last call of the method that builds the "save" command', () => {
    const { api, base } = minifiedApi();
    const step = findDownloadStep(api);
    expect(step?.name).toBe('w7f');
    expect(step?.owner).toBe(base);
  });

  it('is found the same way at the end of the block word runs it in, or of the method (cell, slide)', () => {
    expect(findDownloadStep(minifiedApi({ word: false }).api)?.name).toBe('w7f');
    expect(findDownloadStep(minifiedApi({ word: true }).api)?.name).toBe('w7f');
  });

  it("9.4's name wins where it is", () => {
    const proto = { _downloadAsUsingServer() {}, w7f() {} };
    expect(findDownloadStep(Object.create(proto))?.name).toBe('_downloadAsUsingServer');
    expect(findDownloadStep({ a: 1 })).toBeNull();
  });

  it('is taken over on the editor (Asc.editor), and the editor waits until it is over', () => {
    const { api, ended } = minifiedApi();
    const jobs: { job: ExportJob; done: () => void }[] = [];
    const refused: string[] = [];
    const win: Record<string, unknown> = { Asc: { editor: api, c_oAscAsyncActionType: { BlockInteraction: 1 }, c_oAscAsyncAction: { Print: 7 } } };
    expect(takeOverDownloads(win, 'word', (job, done) => jobs.push({ job, done }), (w) => refused.push(w))).toBe(true);
    const call = (...a: unknown[]) => (api.w7f as (...a: unknown[]) => void).apply(api, a);
    // options' fields are renamed (bca = fileType); the command's are not.
    call(6, { bca: 0x0043 }, { c: 'save', outputformat: 0x0043, title: 'Rapor.odt' }, { data: null, Bca: null }, 'asc_onDownloadUrl');
    call(7, { bca: PDF }, { c: 'save', outputformat: PDF, title: 'Rapor.pdf' }, { data: new Uint8Array([3, 2, 1]) }, 'asc_onPrintUrl');
    call(6, { bca: 0x0041 }, { c: 'save', outputformat: 0x0041 }, { data: null }, 'asc_onSaveMailMerge');
    expect(jobs.map((j) => [j.job.format.ext, j.job.purpose, j.job.title])).toEqual([
      ['odt', 'download', 'Rapor.odt'],
      ['pdf', 'print', 'Rapor.pdf'],
    ]);
    expect(Array.from(jobs[1].job.pdf!)).toEqual([3, 2, 1]);
    expect(refused).toEqual(['save']);
    jobs[0].done();
    expect(ended).toEqual([
      [1, 6],
      [1, 6],
    ]);
    expect(takeOverDownloads(win, 'word', () => {}, () => {})).toBe(true);
  });

  it("ends the editor's wait through its renamed sync_EndAction where the build does not export it (cell, slide)", () => {
    const { api, ended } = minifiedApi({ word: false, named: false });
    expect(findEndAction(api)).toBe('Mq');
    expect(findEndAction(minifiedApi().api)).toBe('sync_EndAction');
    expect(findEndAction({ a() {} })).toBeNull();
    const jobs: { job: ExportJob; done: () => void }[] = [];
    const win: Record<string, unknown> = { Asc: { editor: api, c_oAscAsyncActionType: { BlockInteraction: 1 } } };
    expect(takeOverDownloads(win, 'cell', (job, done) => jobs.push({ job, done }), () => {})).toBe(true);
    (api.w7f as (...a: unknown[]) => void).call(api, 6, { bca: 0x0103 }, { c: 'save', outputformat: 0x0103, title: 'Tablo.ods' }, { data: null }, 'asc_onDownloadUrl');
    expect(jobs.map((j) => j.job.format.ext)).toEqual(['ods']);
    expect(ended).toEqual([]);
    jobs[0].done();
    // The derived method under the renamed key ran, not the base one.
    expect(ended).toEqual([[1, 6]]);
  });
});

describe('Save, kept while the editor is busy, under each key 10.0 has it', () => {
  it('wraps the renamed key the editor calls itself as well as asc_Save', () => {
    vi.useFakeTimers();
    try {
      const calls: (boolean | undefined)[] = [];
      const proto: Record<string, unknown> = {};
      proto.g7 = function (isAutoSave?: boolean) {
        calls.push(isAutoSave);
      };
      proto.asc_Save = proto.g7;
      const api = Object.create(proto) as Record<string, unknown> & { asc_Save: (a?: boolean) => void; g7: (a?: boolean) => void };
      expect(keysOf(api, proto.g7).sort()).toEqual(['asc_Save', 'g7']);
      const r = new SaveRetry();
      r.attach(api);
      // Ctrl+S inside sdkjs: the renamed key; dropped by a busy editor, made again.
      api.g7();
      vi.advanceTimersByTime(800);
      expect(calls).toEqual([undefined, undefined]);
      r.sent('forceSaveStart');
      vi.advanceTimersByTime(5000);
      expect(calls.length).toBe(2);
      // An autosave through either key keeps nothing.
      api.g7(true);
      api.asc_Save(true);
      vi.advanceTimersByTime(5000);
      expect(calls).toEqual([undefined, undefined, true, true]);
      expect(proto.g7).not.toBe(api.g7);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the register of the document's files, renamed (10.0)", () => {
  const known = { 'Editor.bin': 'blob:x/1', 'media/image1.png': 'blob:x/2' };

  it('is the object of AscCommon holding a file the page handed the editor, at its address', () => {
    const reg = { a: { 'Editor.bin': 'blob:x/1', 'media/image1.png': 'blob:x/2' }, b: { 'blob:x/1': 'Editor.bin', 'blob:x/2': 'media/image1.png' }, c: '', d: 2 };
    const common = { Q1: { x: { 'Editor.bin': 'other' } }, Z9: reg, k: [1, 2] };
    const r = findDocumentUrls(common, known)!;
    expect(r.getUrls()).toEqual(known);
    r.addUrls({ 'media/image_fx0011223344556677.png': 'blob:x/3' });
    expect(reg.a['media/image_fx0011223344556677.png' as keyof typeof reg.a]).toBe('blob:x/3');
    expect(reg.b['blob:x/3' as keyof typeof reg.b]).toBe('media/image_fx0011223344556677.png');
  });

  it("9.4's g_oDocumentUrls by its name; nothing before the editor has the files", () => {
    const added: Record<string, string>[] = [];
    const common = { g_oDocumentUrls: { getUrls: () => ({ 'media/a.png': 'blob:y' }), addUrls: (u: Record<string, string>) => added.push(u) } };
    const r = findDocumentUrls(common, known)!;
    expect(r.getUrls()).toEqual({ 'media/a.png': 'blob:y' });
    r.addUrls({ 'media/b.png': 'blob:z' });
    expect(added).toEqual([{ 'media/b.png': 'blob:z' }]);
    expect(findDocumentUrls({ Z9: { a: {}, b: {} } }, known)).toBeNull();
    expect(findDocumentUrls(undefined, known)).toBeNull();
  });
});

describe('the encodings of the TXT and CSV dialogs, renamed (10.0)', () => {
  const list = () => [
    [0, 28596, 'ISO-8859-6', 'Arabic (ISO 8859-6)'],
    [1, 720, 'DOS-720', 'Arabic (OEM 720)'],
    [2, 1256, 'windows-1256', 'Arabic (Windows)'],
    [3, 28594, 'ISO-8859-4', 'Baltic (ISO 8859-4)'],
    [4, 28604, 'ISO-8859-13', 'Baltic (ISO 8859-13)'],
    [5, 775, 'IBM775', 'Baltic (OEM 775)'],
    [6, 1257, 'windows-1257', 'Baltic (Windows)'],
    [36, 1254, 'windows-1254', 'Turkish (Windows)'],
    [46, 65001, 'UTF-8', 'Unicode (UTF-8)'],
    [48, 1200, 'UTF-16LE', 'Unicode (UTF-16)'],
  ];

  it('are the array of AscCommon shaped like them, and are trimmed in place', () => {
    const enc = list();
    const common = { a: [1, 2, 3], b: [[1, 'x']], Rq: enc };
    expect(findEncodings(common)).toBe(enc);
    const win: Record<string, unknown> = { AscCommon: common, DE: { Views: { FileMenuPanels: { ViewSaveAs: { prototype: { formats: [[{ type: TXT }]] } } } } } };
    expect(trimDownloadFormats(win, 'word')).toBe(true);
    expect(common.Rq).toBe(enc);
    expect(enc.map((e) => e[0])).toEqual([46]);
    expect(findEncodings({ a: [[1, 'x']] })).toBeNull();
  });
});

describe('the fonts a PDF needs, from the font files the editor fetched (10.0)', () => {
  it('reads each one again from the package and decodes it as the editor does', async () => {
    const font = new Uint8Array(40);
    font.set([0x00, 0x01, 0x00, 0x00, 0x00, 0x0f]);
    const guid = [0xa0, 0x66, 0xd6, 0x20, 0x14, 0x96, 0x47, 0xfa, 0x95, 0x69, 0xb8, 0x50, 0xb0, 0x41, 0x49, 0x48];
    const packed = font.map((b, i) => (i < 32 ? b ^ guid[i % 16] : b));
    expect(Array.from(new Uint8Array(plainFont(packed.buffer)))).toEqual(Array.from(font));
    expect(Array.from(new Uint8Array(plainFont(font.buffer)))).toEqual(Array.from(font));
    const rec = new LoadedFonts();
    rec.add('074', 'https://pkg/editor/fonts/074');
    rec.add('074', 'https://pkg/editor/fonts/074');
    rec.add('../x', 'https://pkg/editor/fonts/x');
    rec.add('075', 'https://pkg/editor/fonts/075');
    const read = async (url: string) => (url.endsWith('074') ? packed.buffer.slice(0) : null);
    const got = await loadedFonts({ AscFonts: { getFontStream: () => undefined } }, rec, read);
    expect(got.map((f) => f.name)).toEqual(['074.ttf']);
    expect(Array.from(new Uint8Array(got[0].bytes))).toEqual(Array.from(font));
  });
});

/** A stand-in for the browser's XMLHttpRequest: records what reaches the network. */
function fakeXhr() {
  const sent: { method: string; url: string; body?: unknown }[] = [];
  class X {
    status = 0;
    readyState = 0;
    responseText = '';
    onreadystatechange: ((this: X) => void) | null = null;
    onload: ((this: X) => void) | null = null;
    private listeners: Record<string, (() => void)[]> = {};
    private m = '';
    private u = '';
    open(method: string, url: string) {
      this.m = method;
      this.u = url;
    }
    setRequestHeader() {}
    addEventListener(t: string, h: () => void) {
      (this.listeners[t] ??= []).push(h);
    }
    send(body?: unknown) {
      sent.push({ method: this.m, url: this.u, body });
      this.status = 200;
      for (const h of this.listeners.load ?? []) h();
    }
  }
  return { X, sent };
}

describe('the requests the frame takes part in (requests.ts)', () => {
  const base = 'https://pkg.example/apps/x/editor/web-apps/apps/documenteditor/main/index.html';

  it('records the font files the editor loads, by their id, and lets them through', () => {
    const { X, sent } = fakeXhr();
    const fonts = new LoadedFonts();
    watchRequests({ XMLHttpRequest: X }, base, fonts, null);
    const a = new X();
    a.open('GET', '../../../../fonts/074');
    a.send();
    const b = new X();
    b.open('GET', '../../../../sdkjs/common/AllFonts.js');
    b.send();
    expect(sent.map((s) => s.url)).toEqual(['../../../../fonts/074', '../../../../sdkjs/common/AllFonts.js']);
    expect(fonts.entries()).toEqual([['074', 'https://pkg.example/apps/x/editor/fonts/074']]);
  });

  it("answers an image upload as the Document Server does, and nothing of it reaches the network", async () => {
    const { X, sent } = fakeXhr();
    const inserted: string[] = [];
    watchRequests({ XMLHttpRequest: X }, base, new LoadedFonts(), uploadAnswer((name) => inserted.push(name)));
    const answers: { status: number; text: string }[] = [];
    const up = (file: Blob) =>
      new Promise<void>((resolve) => {
        const x = new X();
        x.open('POST', '../../../../upload/doc-1');
        x.setRequestHeader();
        x.onreadystatechange = function () {
          if (this.readyState === 4) {
            answers.push({ status: this.status, text: this.responseText });
            resolve();
          }
        };
        x.send(file);
      });
    await up(new Blob([new Uint8Array([1, 2])], { type: 'image/png' }));
    await up(new Blob(['x'], { type: 'text/plain' }));
    expect(sent).toEqual([]);
    expect(answers[0].status).toBe(200);
    const urls = JSON.parse(answers[0].text) as Record<string, string>;
    const [name] = Object.keys(urls);
    expect(name).toMatch(/^media\/image_fx[0-9a-f]{16}\.png$/);
    expect(urls[name]).toMatch(/^blob:/);
    expect(inserted).toEqual([name.slice('media/'.length)]);
    expect(answers[1].status).toBe(415);
  });
});
