// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Page layout without a browser (docs/SERVER.md): sdkjs - the editor's own
// JavaScript, which a Document Server runs in V8 (doctrenderer) to lay a
// document out into pages - run by QuickJS compiled to WebAssembly, under
// wazero, with no browser and no native code of ONLYOFFICE's.
//
// This file plays doctrenderer's part (core v9.4.0.129,
// DesktopEditor/doctrenderer): the same scripts in the same order
// (editors.cpp GetAllScript), `native` and CreateEmbedObject answered as its
// embedded objects answer them (embed/NativeControlEmbed.cpp), and
// fonts_ie.js - FreeType and HarfBuzz compiled to asm.js, which doctrenderer
// loads when it has no native shaper - in place of the native text
// measurer. A job is what doctrenderer does for a PDF or an image
// (doctrenderer.cpp, DoctRendererFormat::PDF / IMAGE): open the Editor.bin,
// asc_nativeCalculateFile, asc_nativePrintPagesCount, asc_nativeGetPDF -
// the pages as drawing commands, the pdf.bin x2t turns into a PDF or a
// picture (x2t's doct_bin2pdf / doct_bin2image).
//
//   qjs --std worker.js <engine dir> <word|cell|slide>
//       a worker: says {"ready":...} once the scripts are in, then takes one
//       JSON job per line on stdin and answers one JSON line per job
//   qjs --std worker.js <engine dir> <kind> <Editor.bin> <out pdf.bin> [pdf|image] [json]
//       one job
//
// A job: {"in": Editor.bin, "out": pdf.bin, "mode": "pdf"|"image",
// "json": the Document Server's m_sJsonParams or null, "fonts": a directory
// to put the fonts the pages were drawn with, plain, as "<id>.ttf"}.
//
// The engine directory holds sdkjs/ and fonts/ as the app's bundle has them
// (the editor's files, the package's web fonts) and layout/: this file,
// fonts_ie.js and xregexp-all-min.js (from the same Document Server release;
// the editor bundle leaves them out).

/* global std, os, scriptArgs, print */

var BASE = scriptArgs[1] || '/e';
var KIND = scriptArgs[2] || 'word';
var EDITOR_TYPE = { word: 'document', cell: 'spreadsheet', slide: 'presentation' }[KIND];

function readBin(path) {
  var f = std.open(path, 'rb');
  if (!f) throw new Error('cannot open ' + path);
  f.seek(0, std.SEEK_END);
  var n = f.tell();
  f.seek(0, std.SEEK_SET);
  var buf = new Uint8Array(n);
  if (n > 0) f.read(buf.buffer, 0, n);
  f.close();
  return buf;
}

function writeBin(path, data) {
  var f = std.open(path, 'wb');
  if (!f) throw new Error('cannot write ' + path);
  if (data.length > 0) f.write(data.buffer, data.byteOffset, data.length);
  f.close();
}

// With layout-host.wasm (server/layout/host) and LAYOUT_CACHE set, a script
// runs from its QuickJS bytecode, compiled once into that directory: most of
// a worker's start is parsing sdkjs (docs/SERVER.md).
var CACHE = std.getenv('LAYOUT_CACHE') || '';
var BYTECODE = CACHE && typeof globalThis.runBytecode === 'function' && typeof globalThis.compileScript === 'function';

function run(path) {
  if (BYTECODE) {
    var cached = CACHE + '/' + path.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]/g, '_') + '.qbc';
    var f = std.open(cached, 'rb');
    if (f) f.close();
    else globalThis.compileScript(path, cached);
    globalThis.runBytecode(cached);
    return;
  }
  var src = std.loadFile(path);
  if (src === null) throw new Error('cannot read ' + path);
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  std.evalScript(src);
}

// An image's size from its header (PNG, GIF, JPEG, BMP), for
// GetImageOriginalSize; undefined for anything else, as doctrenderer
// answers for a picture it cannot open.
function imageSize(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    return { W: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, H: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { W: b[6] | (b[7] << 8), H: b[8] | (b[9] << 8) };
  if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4d) {
    return { W: b[18] | (b[19] << 8) | (b[20] << 16) | (b[21] << 24), H: Math.abs(b[22] | (b[23] << 8) | (b[24] << 16) | (b[25] << 24)) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    var i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return undefined;
      var m = b[i + 1];
      var len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { W: (b[i + 7] << 8) | b[i + 8], H: (b[i + 5] << 8) | b[i + 6] };
      i += 2 + len;
    }
  }
  return undefined;
}

// The package's web fonts are the Document Server's: their first 32 bytes
// are XORed with this GUID (sdkjs CFontFileLoader.LoadFontArrayBuffer).
var ODTTF = [0xa0, 0x66, 0xd6, 0x20, 0x14, 0x96, 0x47, 0xfa, 0x95, 0x69, 0xb8, 0x50, 0xb0, 0x41, 0x49, 0x48];
function fontBinary(id) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(id))) throw new Error('bad font id');
  var b = readBin(BASE + '/fonts/' + id);
  for (var i = 0; i < Math.min(32, b.length); i++) b[i] ^= ODTTF[i % 16];
  return b;
}

var job = null; // the job being laid out (its paths), for `native`
var saveLen = 0;
var unknown = {};
var nativeImpl = {
  GetEditorType: function () { return EDITOR_TYPE; },
  GetFilePath: function () { return job ? job.in : ''; },
  SetFilePath: function () {},
  GetFileId: function () { return 'filex'; },
  SetFileId: function () {},
  GetFontBinary: fontBinary,
  GetFontsDirectory: function () { return BASE + '/fonts/'; },
  GetFileBinary: function (p) { return readBin(p); },
  GetFileString: function (p) { return std.loadFile(p); },
  CheckNextChange: function () { return false; },
  GetCountChanges: function () { return 0; },
  GetChangesFile: function () { return ''; },
  ConsoleLog: function () {},
  GetImagesPath: function () { return job ? job.media : ''; },
  GetImageUrl: function (u) { return u; },
  GetImageOriginalSize: function (u) {
    var name = String(u).replace(/^.*[\\/]/, '');
    if (!job || !/^[A-Za-z0-9._-]{1,128}$/.test(name)) return undefined;
    try {
      return imageSize(readBin(job.media + name));
    } catch (e) {
      return undefined;
    }
  },
  GetDevicePixelRatio: function () { return 1; },
  AddImageInChanges: function () {},
  // asc_nativeGetPDF hands back its whole buffer; Save_End says how much of
  // it is the drawing (doctrenderer writes m_nSaveBinaryLen bytes).
  Save_End: function (header, len) { saveLen = len; }
};
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.native = new Proxy(nativeImpl, {
  get: function (t, k) {
    if (k in t) return t[k];
    if (typeof k === 'string') unknown['native.' + k] = true;
    return undefined;
  }
});
// The embedded objects sdkjs creates beside the text measurer (CZipEmbed,
// CGraphicsEmbed, CHashEmbed): a document opened from an Editor.bin and
// drawn into a pdf.bin does not need them - a call answers null and is
// noted.
globalThis.CreateEmbedObject = function (name) {
  return new Proxy({}, {
    get: function (t, k) {
      if (typeof k !== 'string') return undefined;
      unknown[name + '.' + k] = true;
      return function () { return null; };
    }
  });
};
globalThis.FreeEmbedObject = function () {};

var fontEngine = { ms: 0, calls: 0 };
function timeFontEngine() {
  var fonts = globalThis.AscFonts;
  Object.keys(fonts).forEach(function (k) {
    var f = fonts[k];
    if (typeof f !== 'function' || !/^(FT_|HB_)/.test(k)) return;
    fonts[k] = function () {
      var s = Date.now();
      try {
        return f.apply(this, arguments);
      } finally {
        fontEngine.ms += Date.now() - s;
        fontEngine.calls++;
      }
    };
  });
}

function load() {
  var t = Date.now();
  run(BASE + '/sdkjs/common/Native/native.js');
  run(BASE + '/sdkjs/common/Native/jquery_native.js');
  run(BASE + '/layout/xregexp-all-min.js');
  run(BASE + '/sdkjs/' + KIND + '/sdk-all-min.js');
  run(BASE + '/layout/fonts_ie.js');
  timeFontEngine();
  run(BASE + '/sdkjs/' + KIND + '/sdk-all.js');
  if (KIND === 'cell') std.evalScript('$.ready();');
  run(BASE + '/sdkjs/common/AllFonts.js');
  std.evalScript('window.InitNativeEditors();');
  return Date.now() - t;
}

function layout(j) {
  var ms = {};
  var t = Date.now();
  function lap(n) {
    var now = Date.now();
    ms[n] = now - t;
    t = now;
  }
  var stage = 'open';
  job = { in: j.in, media: String(j.in).replace(/[^/]*$/, '') + 'media/' };
  saveLen = 0;
  fontEngine.ms = 0;
  fontEngine.calls = 0;
  try {
    var data = readBin(j.in);
    var head = String.fromCharCode.apply(null, data.subarray(0, 16));
    var version = parseInt((/;v(\d+);/.exec(head) || [0, 0])[1], 10);
    var opts = j.json && typeof j.json === 'object' ? JSON.parse(JSON.stringify(j.json)) : {};
    // doctrenderer reads the document's api from Asc.editor, in a context
    // of its own for each document; a worker keeps its context, and the
    // api's constructor fills Asc.editor only while it is empty.
    globalThis.Asc.editor = undefined;
    globalThis.editor = undefined;
    globalThis.NativeOpenFileData(data, version, undefined, opts);
    var api = globalThis.Asc.editor;
    lap('open');
    stage = 'calculate';
    var params = j.json && typeof j.json === 'object' ? j.json : null;
    api.asc_nativeCalculateFile(params);
    var pages = api.asc_nativePrintPagesCount(params);
    lap('calculate');
    stage = 'save';
    var getParams = j.mode === 'image' ? Object.assign({}, params || {}, { saveFormat: 'image' }) : params;
    var out = api.asc_nativeGetPDF(getParams);
    if (!out) throw new Error('no drawing');
    if (saveLen > 0 && saveLen < out.length) out = out.subarray(0, saveLen);
    writeBin(j.out, out);
    var fonts = [];
    (globalThis.AscFonts.g_font_files || []).forEach(function (f) {
      if (!f || f.Status !== 0) return;
      fonts.push(String(f.Id));
      if (j.fonts) writeBin(j.fonts + '/' + f.Id + '.ttf', fontBinary(f.Id));
    });
    lap('save');
    return { ok: true, pages: pages, bytes: out.length, fonts: fonts, ms: ms, font_engine: { ms: fontEngine.ms, calls: fontEngine.calls } };
  } catch (e) {
    return { ok: false, stage: stage, error: String(e), stack: String((e && e.stack) || '').slice(0, 1000), ms: ms };
  } finally {
    job = null;
  }
}

function answer(o) {
  var u = Object.keys(unknown);
  if (u.length) o.unanswered = u;
  print(JSON.stringify(o));
  std.out.flush();
}

var loadMs;
try {
  loadMs = load();
} catch (e) {
  answer({ ready: false, error: String(e), stack: String((e && e.stack) || '').slice(0, 1000) });
  std.exit(1);
}

if (scriptArgs.length > 4) {
  var one = layout({ in: scriptArgs[3], out: scriptArgs[4], mode: scriptArgs[5] || 'pdf', json: scriptArgs[6] ? JSON.parse(scriptArgs[6]) : null, fonts: null });
  one.load_ms = loadMs;
  answer(one);
} else {
  answer({ ready: true, kind: KIND, load_ms: loadMs });
  for (;;) {
    var line = std.in.getline();
    if (line === null) break;
    if (!line.trim()) continue;
    var req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      answer({ ok: false, stage: 'request', error: String(e) });
      continue;
    }
    answer(layout(req));
  }
}
