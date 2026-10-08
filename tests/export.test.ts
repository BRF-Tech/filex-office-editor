// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// "Download as" and Print without a Document Server: the formats x2t writes
// here (src/formats.ts), and the editor page's side (src/frame/export.ts) -
// the File menu offers only those, and the editor's last step goes to the
// app page instead of a server. The browsers run the whole of it (e2e/run.mjs).
import { describe, expect, it } from 'vitest';

import { EXPORT_FORMATS, PDF, PDFA, exportFormat, exportName, isPdf } from '../src/formats';
import { loadedFonts, takeOverDownloads, trimDownloadFormats, type ExportJob } from '../src/frame/export';

describe('the formats', () => {
  it('each kind gets its own and PDF, nothing else', () => {
    const ids = (k: 'word' | 'cell' | 'slide') => EXPORT_FORMATS.filter((f) => exportFormat(f.id, k)).map((f) => f.ext);
    expect(ids('word')).toEqual(['pdf', 'pdf', 'docx', 'docm', 'dotx', 'odt', 'ott', 'rtf']);
    expect(ids('cell')).toEqual(['pdf', 'pdf', 'xlsx', 'xlsm', 'xltx', 'ods', 'ots']);
    expect(ids('slide')).toEqual(['pdf', 'pdf', 'pptx', 'pptm', 'potx', 'ppsx', 'odp', 'otp']);
    expect(exportFormat(0x0101, 'word')).toBeNull();
    // Measured broken or impossible in the wasm build (formats.ts): txt, csv, html, epub, fb2, md, images.
    for (const id of [0x0045, 0x0104, 0x0046, 0x0048, 0x0049, 0x005c, 0x0401, 0x0405, 'x', null]) expect(exportFormat(id, 'word')).toBeNull();
    expect(isPdf(PDF) && isPdf(PDFA) && !isPdf(0x0041)).toBe(true);
  });

  it("names the file after the document, with the format's extension, never a path", () => {
    const docx = exportFormat(0x0041, 'word')!;
    const pdf = exportFormat(PDF, 'word')!;
    expect(exportName('Rapor.docx', pdf)).toBe('Rapor.pdf');
    expect(exportName('Çalışma raporu.odt', docx)).toBe('Çalışma raporu.docx');
    expect(exportName('../a/b:c.docx', pdf)).toBe('.._a_b_c.pdf');
    expect(exportName('', pdf)).toBe('document.pdf');
  });
});

describe("the editor's Download as", () => {
  const panel = () => ({
    prototype: {
      formats: [
        [{ type: 0x0041 }, { type: PDF }, { type: 0x0043 }],
        [{ type: 0x004c }, { type: 0x004b }, { type: PDFA }, { type: 0x004f }],
        [{ type: 0x005c }, { type: 0x0044 }, { type: 0x0045 }, { type: 0x0049 }, { type: 0x0048 }, { type: 0x0046 }],
        [{ type: 0x0401 }, { type: 0x0405 }],
      ] as { type: number }[][],
    },
  });

  it('lists only what x2t writes here, once the panel is there', () => {
    const win: Record<string, unknown> = {};
    expect(trimDownloadFormats(win, 'word')).toBe(false);
    const view = panel();
    win.DE = { Views: { FileMenuPanels: { ViewSaveAs: view } } };
    expect(trimDownloadFormats(win, 'word')).toBe(true);
    expect(view.prototype.formats.map((r) => r.map((i) => i.type))).toEqual([[0x0041, PDF, 0x0043], [0x004c, 0x004b, PDFA, 0x004f], [0x0044]]);
    expect(trimDownloadFormats(win, 'word')).toBe(true);
    expect(view.prototype.formats.length).toBe(3);
  });

  function editor() {
    const ended: [number, number][] = [];
    const proto: Record<string, unknown> = {
      _downloadAsUsingServer: () => {
        throw new Error('the server step must not run');
      },
    };
    const win: Record<string, unknown> = {
      AscCommon: { baseEditorsApi: { prototype: proto } },
      Asc: { c_oAscAsyncActionType: { BlockInteraction: 1 }, c_oAscAsyncAction: { DownloadAs: 6, Print: 7 } },
    };
    const api = Object.assign(Object.create(proto), {
      documentTitle: 'Rapor.docx',
      sync_EndAction: (type: number, id: number) => ended.push([type, id]),
    });
    const jobs: { job: ExportJob; done: () => void }[] = [];
    const refused: string[] = [];
    return { win, api, ended, jobs, refused, take: () => takeOverDownloads(win, 'word', (job, done) => jobs.push({ job, done }), (why) => refused.push(why)) };
  }

  const call = (api: { _downloadAsUsingServer: (...a: unknown[]) => void }, ...a: unknown[]) => api._downloadAsUsingServer(...a);

  it("takes the server's step: a download, and the editor waits until it is over", () => {
    const e = editor();
    expect(e.take()).toBe(true);
    call(e.api, 6, { fileType: 0x0043 }, { c: 'save', outputformat: 0x0043, title: 'Rapor.odt' }, { data: new Uint8Array([1]) }, '');
    expect(e.jobs.length).toBe(1);
    expect(e.jobs[0].job).toMatchObject({ purpose: 'download', title: 'Rapor.odt', pdf: undefined, json: undefined });
    expect(e.jobs[0].job.format.ext).toBe('odt');
    expect(e.ended).toEqual([]);
    e.jobs[0].done();
    e.jobs[0].done();
    expect(e.ended).toEqual([[1, 6]]);
  });

  it('a PDF carries the pages the editor drew; Print is a PDF to print', () => {
    const e = editor();
    e.take();
    const drawn = new Uint8Array([9, 8, 7, 6]);
    call(e.api, 7, { fileType: PDF, isPdfPrint: true }, { c: 'save', jsonparams: { printPages: '1-2' } }, { data: drawn.subarray(1, 3) }, 'asc_onPrintUrl');
    const job = e.jobs[0].job;
    expect(job.purpose).toBe('print');
    expect(Array.from(job.pdf!)).toEqual([8, 7]);
    expect(job.pdf!.buffer).not.toBe(drawn.buffer);
    expect(job.json).toBe('{"printPages":"1-2"}');
    expect(job.title).toBe('Rapor.docx');
  });

  it("refuses what it does not write and the server's other commands, and ends the editor's wait", () => {
    const e = editor();
    e.take();
    call(e.api, 6, { fileType: 0x0045 }, { c: 'save' }, { data: null }, '');
    call(e.api, 6, { fileType: 0x0041 }, { c: 'sendmm' }, { data: null }, '');
    call(e.api, 6, { fileType: PDF }, { c: 'save' }, { data: new Uint8Array(0) }, '');
    expect(e.jobs).toEqual([]);
    expect(e.refused.length).toBe(3);
    expect(e.ended).toEqual([
      [1, 6],
      [1, 6],
      [1, 6],
    ]);
  });

  it('waits for the editor to be there', () => {
    expect(takeOverDownloads({}, 'word', () => {}, () => {})).toBe(false);
  });
});

describe('the fonts a PDF needs', () => {
  it('every loaded font file once, as the editor holds it, by its id', () => {
    const plain = new Uint8Array([0, 1, 0, 0, 5, 5, 5, 5]);
    const heap = new Uint8Array([7, 7, 0, 1, 0, 0, 6]);
    const win = {
      AscFonts: {
        g_font_files: [
          { Id: '074', Status: 0, stream_index: 0 },
          { Id: '075', Status: 0, stream_index: 1 },
          { Id: '076', Status: -1, stream_index: -1 },
          { Id: '../x', Status: 0, stream_index: 0 },
        ],
        getFontStream: (i: number) => (i === 0 ? { data: plain, size: 4 } : { data: heap.subarray(2), size: 5 }),
      },
    };
    const got = loadedFonts(win);
    expect(got.map((f) => f.name)).toEqual(['074.ttf', '075.ttf']);
    expect(Array.from(new Uint8Array(got[0].bytes))).toEqual([0, 1, 0, 0]);
    expect(Array.from(new Uint8Array(got[1].bytes))).toEqual([0, 1, 0, 0, 6]);
  });
});
