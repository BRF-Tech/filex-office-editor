// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The editor bundle's build (scripts/extract-editor.sh and scripts/editor/):
// what it keeps of the Document Server image, the change it makes to the
// HTML pages (no inline code, the storage stand-in first), the reproducible
// zip, filex's limits and the committed lock file. The image
// itself is not needed: the build is measured where docker is, and its
// result is the committed upstream/editor.lock.json these tests read.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { diffLocks } from '../scripts/editor/bundle.mjs';
import { inlineCodeIn, isExecutableType, transformHtml } from '../scripts/editor/html.mjs';
import { BUDGET, FONT_EXCLUDE, LIMITS, checkBundle, classify, pathOK, servedType } from '../scripts/editor/rules.mjs';
import { crc32, readZip, writeZip } from '../scripts/lib/zip.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const LOCK = path.join(ROOT, 'upstream', 'editor.lock.json');

describe('zip', () => {
  const files = [
    { name: 'b/ğüşıöç.txt', data: Buffer.from('Çağrı Iğdır\n'.repeat(50), 'utf8') },
    { name: 'a.json', data: Buffer.from('{"x":1}') },
    { name: 'c/random.bin', data: createHash('sha512').update('x').digest() },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ];

  it('writes the same bytes for the same files, in any order', () => {
    const a = writeZip(files);
    const b = writeZip([...files].reverse());
    expect(a.equals(b)).toBe(true);
  });

  it('reads back what it wrote: sorted, one date, deflated only when smaller', () => {
    const entries = readZip(writeZip(files));
    expect(entries.map((e) => e.name)).toEqual(['a.json', 'b/ğüşıöç.txt', 'c/random.bin', 'empty.txt']);
    for (const e of entries) {
      const f = files.find((x) => x.name === e.name)!;
      expect(e.read().equals(f.data)).toBe(true);
      expect(e.mode).toBe(0o100644);
    }
    expect(entries.find((e) => e.name === 'b/ğüşıöç.txt')!.method).toBe(8);
    expect(entries.find((e) => e.name === 'c/random.bin')!.method).toBe(0);
  });

  it('refuses unsafe and duplicate names', () => {
    expect(() => writeZip([{ name: '../x', data: Buffer.from('') }])).toThrow(/unsafe/);
    expect(() => writeZip([{ name: '/x', data: Buffer.from('') }])).toThrow(/unsafe/);
    expect(() => writeZip([{ name: 'a\\b', data: Buffer.from('') }])).toThrow(/unsafe/);
    expect(() => writeZip([{ name: 'x', data: Buffer.from('1') }, { name: 'x', data: Buffer.from('2') }])).toThrow(/twice/);
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});

describe('what the bundle keeps', () => {
  const cases: Array<[string, string]> = [
    ['web-apps/apps/documenteditor/main/index.html', 'keep'],
    ['web-apps/apps/spreadsheeteditor/main/index_internal.html', 'keep'],
    ['web-apps/apps/presentationeditor/main/locale/tr.json', 'keep'],
    ['web-apps/apps/common/main/lib/component/ComboBoxFonts.js', 'keep'],
    ['web-apps/vendor/socketio/socket.io.min.js', 'keep'],
    ['sdkjs/word/sdk-all.js', 'keep'],
    ['sdkjs/word/sdk-all-min.js', 'keep'],
    ['sdkjs/common/AllFonts.js', 'keep'],
    ['sdkjs/common/libfont/engine/fonts.wasm', 'keep'],
    ['sdkjs/common/Images/fonts_thumbnail@2x.png', 'keep'],
    ['sdkjs/slide/themes/theme3/theme.bin', 'keep'],
    ['sdkjs/slide/themes/theme3/thumbnail@1.5x.png', 'drop'],
    ['sdkjs/slide/themes/theme12/thumbnail.png', 'drop'],
    ['sdkjs/common/Images/themes_thumbnail@2x.png', 'keep'],
    ['fonts/042', 'keep'],
    ['LICENSE.txt', 'keep'],
    ['3rd-Party.txt', 'keep'],
    ['core-fonts-licenses/dejavu/LICENSE.txt', 'keep'],
    ['web-apps/apps/documenteditor/main/resources/help/en/Contents.json', 'drop'],
    ['web-apps/apps/common/main/resources/help/de/images/x.png', 'drop'],
    ['web-apps/apps/pdfeditor/main/index.html', 'drop'],
    ['web-apps/apps/visioeditor/main/app.js', 'drop'],
    // The phone editors stay (read-only in ONLYOFFICE's open-source build; rules.mjs APPS).
    ['web-apps/apps/documenteditor/mobile/index.html', 'keep'],
    ['web-apps/apps/spreadsheeteditor/mobile/dist/js/app.js', 'keep'],
    ['web-apps/apps/presentationeditor/mobile/css/framework7.css', 'keep'],
    ['web-apps/apps/spreadsheeteditor/mobile/locale/l10n/functions/tr_desc.json', 'keep'],
    ['web-apps/apps/documenteditor/mobile/resources/img/charts/bar-normal.svg', 'keep'],
    ['web-apps/apps/visioeditor/mobile/index.html', 'drop'],
    ['web-apps/apps/spreadsheeteditor/embed/index.html', 'drop'],
    ['web-apps/apps/documenteditor/forms/index.html', 'drop'],
    ['web-apps/apps/api/wopi/editor-wopi.ejs', 'drop'],
    ['web-apps/vendor/monaco/monaco/min/vs/loader.js', 'drop'],
    ['web-apps/apps/documenteditor/main/app/template/StatusBar.template', 'rename'],
    ['web-apps/apps/common/main/lib/template/ExtendedColorDialog.template', 'rename'],
    ['sdkjs/pdf/src/engine/drawingfile.wasm', 'drop'],
    ['sdkjs/visio/sdk-all.js', 'drop'],
    ['sdkjs/cell/sdk-all.bin', 'drop'],
    ['sdkjs/slide/themes/src/01_blank.pptx', 'drop'],
    ['sdkjs/slide/themes/theme22/Image__c48369', 'drop'],
    ['sdkjs/common/spell/spell/spell.js.mem', 'drop'],
    ['sdkjs/common/libfont/engine/fonts_ie.js', 'drop'],
    ['sdkjs/common/zlib/engine/zlib_ie.js', 'drop'],
    ['fonts/042.gz', 'drop'],
    ['sdkjs/word/sdk-all.js.br', 'drop'],
  ];

  it.each(cases)('%s: %s', (p, action) => {
    expect(classify(p).action).toBe(action);
  });

  it('serves api.js from api.js.tpl and gives license files an extension filex serves', () => {
    expect(classify('web-apps/apps/api/documents/api.js.tpl')).toMatchObject({ action: 'rename', to: 'web-apps/apps/api/documents/api.js' });
    expect(classify('license/Backbone.license')).toMatchObject({ action: 'rename', to: 'license/Backbone.license.txt' });
    expect(classify('core-fonts-licenses/asana/LICENSE.txt').action).toBe('keep');
    expect(classify('core-fonts-licenses/x/COPYING').action).toBe('keep');
  });

  it('serves the interface templates the editor loads while it runs as .template.txt', () => {
    expect(classify('web-apps/apps/documenteditor/main/app/template/ParagraphSettings.template')).toMatchObject({
      action: 'rename',
      to: 'web-apps/apps/documenteditor/main/app/template/ParagraphSettings.template.txt',
    });
    expect(servedType('x/ParagraphSettings.template.txt')).toBe(true);
  });

  it("serves the Document Server's blank documents as .bin, for filex's New menu", () => {
    for (const ext of ['docx', 'xlsx', 'pptx']) {
      const p = `document-templates/new/default/new.${ext}`;
      expect(classify(p)).toMatchObject({ action: 'rename', to: `${p}.bin` });
      expect(servedType(`${p}.bin`)).toBe(true);
    }
  });

  it('leaves out the large CJK fonts and keeps the metric stand-ins', () => {
    for (const f of ['arphic-ukai', 'wqy-zenhei', 'takao-gothic', 'nanum', 'noto/Noto_Sans_KR']) expect(FONT_EXCLUDE).toContain(f);
    for (const f of ['liberation', 'crosextra', 'caladea', 'dejavu', 'droid', 'noto', 'openoffice', 'asana']) expect(FONT_EXCLUDE).not.toContain(f);
  });

  it("follows filex's served list and path rule", () => {
    expect(servedType('a/b.js')).toBe(true);
    expect(servedType('fonts/000')).toBe(true);
    expect(servedType('x.template')).toBe(false);
    expect(servedType('x.license')).toBe(false);
    expect(servedType('x.pptx')).toBe(false);
    expect(pathOK('editor/web-apps/a.js')).toBe(true);
    for (const bad of ['', '/a', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'C:/a', 'a\nb']) expect(pathOK(bad)).toBe(false);
  });

  it("checkBundle refuses what filex refuses", () => {
    expect(checkBundle([{ name: 'editor/a.js', size: 10 }], 100)).toEqual([]);
    expect(checkBundle([{ name: 'a.js', size: 1 }], LIMITS.zipBytes + 1).join()).toMatch(/zip is/);
    expect(checkBundle([{ name: 'a.js', size: LIMITS.fileBytes + 1 }], 1).join()).toMatch(/over/);
    expect(checkBundle([{ name: 'a.html', size: LIMITS.htmlBytes + 1 }], 1).join()).toMatch(/HTML page/);
    expect(checkBundle([{ name: 'a.template', size: 1 }], 1).join()).toMatch(/extension/);
    expect(checkBundle([{ name: 'A.js', size: 1 }, { name: 'a.js', size: 1 }], 1).join()).toMatch(/case/);
    const many = Array.from({ length: LIMITS.files + 1 }, (_, i) => ({ name: `f${i}.js`, size: 1 }));
    expect(checkBundle(many, 1).join()).toMatch(/files, over/);
  });
});

describe('the HTML pages: no inline code', () => {
  const page = [
    '<!DOCTYPE html><html><head>',
    '<link rel="stylesheet" href="app.css" media="print" onload="this.media=\'all\'">',
    '<!-- <script>commented()</script> -->',
    '<script type="text/template" id="t"><div onclick="x"><%= y %></div></script>',
    '<script>var a = "</scr" + "ipt>"; document.write(\'<script src="x.js"><\\/script>\');</script>',
    '<script src="../../vendor/require.js"></script>',
    "<SCRIPT type='module'>import './m.js';</SCRIPT>",
    '<style>.a{background:url(x.png)} /* <script> */</style>',
    '</head><body><div id="app"></div></body></html>',
  ].join('\n');

  it('moves every executable inline script into a file, unchanged and in order', () => {
    const r = transformHtml(page, { name: 'index.html', storage: '../filex/storage.js' });
    expect(r.scripts.map((s: { file: string }) => s.file)).toEqual(['index.inline-1.js', 'index.inline-2.js']);
    expect(r.scripts[0].body).toBe('var a = "</scr" + "ipt>"; document.write(\'<script src="x.js"><\\/script>\');');
    expect(r.scripts[1].body).toBe("import './m.js';");
    expect(r.html).toContain('<script src="index.inline-1.js"></script>');
    expect(r.html).toContain("<SCRIPT type='module' src=\"index.inline-2.js\"></script>");
    expect(r.html.indexOf('index.inline-1.js')).toBeLessThan(r.html.indexOf('require.js'));
    expect(r.html.indexOf('require.js')).toBeLessThan(r.html.indexOf('index.inline-2.js'));
  });

  it('keeps templates, comments, styles and src scripts as they are', () => {
    const r = transformHtml(page, { name: 'index.html', storage: null });
    expect(r.html).toContain('<script type="text/template" id="t"><div onclick="x"><%= y %></div></script>');
    expect(r.html).toContain('<!-- <script>commented()</script> -->');
    expect(r.html).toContain('<style>.a{background:url(x.png)} /* <script> */</style>');
    expect(r.html).toContain('<script src="../../vendor/require.js"></script>');
  });

  it('turns the asynchronous stylesheet into a plain one', () => {
    const r = transformHtml(page, { name: 'index.html', storage: null });
    expect(r.html).toContain('<link rel="stylesheet" href="app.css" media="all">');
    expect(r.changes.join()).toMatch(/media="all"/);
  });

  it('loads the storage stand-in before any other script', () => {
    const r = transformHtml(page, { name: 'index.html', storage: '../filex/storage.js' });
    const first = r.html.indexOf('<script', r.html.indexOf('-->'));
    expect(r.html.slice(first)).toMatch(/^<script src="\.\.\/filex\/storage\.js"><\/script>/);
    expect(r.html.indexOf('storage.js')).toBeLessThan(r.html.indexOf('type="text/template"'));
  });

  it('leaves nothing filex would block', () => {
    expect(inlineCodeIn(page).length).toBeGreaterThan(0);
    const r = transformHtml(page, { name: 'index.html', storage: '../filex/storage.js' });
    expect(inlineCodeIn(r.html)).toEqual([]);
  });

  it('refuses inline code it does not know how to move', () => {
    expect(() => transformHtml('<body onload="go()"></body>', { name: 'a.html' })).toThrow(/onload/);
    expect(() => transformHtml('<a href="javascript:void(0)">x</a>', { name: 'a.html' })).toThrow(/javascript:/);
    expect(() => transformHtml('<img src=x onerror=alert(1)>', { name: 'a.html' })).toThrow(/onerror/);
  });

  it('reads script types as HTML does', () => {
    for (const t of [undefined, '', 'text/javascript', 'application/javascript', 'module', 'TEXT/JavaScript']) expect(isExecutableType(t)).toBe(true);
    for (const t of ['text/template', 'text/x-template', 'application/json', 'application/ld+json']) expect(isExecutableType(t)).toBe(false);
  });

  it("a phone editor's page (web-apps/apps/*/mobile/index.html, 9.4): the deferred app, then its inline scripts in order", () => {
    const phone = [
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src * \'self\' \'unsafe-inline\' \'unsafe-eval\' data: blob:">',
      '<style>.skl-navbar { height: calc(var(--skl-navbar-height) + 1px); }</style>',
      '<script defer="defer" src="dist/js/app.js"></script><link href="css/app.css" rel="stylesheet"></head>',
      '<body><script>window.Common = {Locale: {defaultLang: "en"}};</script>',
      "<script>window.asceditor = 'word'; const load_stylesheet = reflink => {};</script>",
      '<div id="app"></div>',
      '<script>window.parentOrigin = params["parentOrigin"];</script>',
      '<script src="../../../vendor/jquery/jquery.min.js"></script><div id="app"></div></body></html>',
    ].join('');
    const r = transformHtml(phone, { name: 'index.html', storage: '../../../../filex/storage.js' });
    expect(r.scripts.map((s: { file: string }) => s.file)).toEqual(['index.inline-1.js', 'index.inline-2.js', 'index.inline-3.js']);
    expect(r.scripts[2].body).toBe('window.parentOrigin = params["parentOrigin"];');
    expect(r.html.indexOf('../../../../filex/storage.js')).toBeLessThan(r.html.indexOf('dist/js/app.js'));
    expect(r.html).toContain('<script defer="defer" src="dist/js/app.js"></script>');
    expect(r.html.indexOf('index.inline-3.js')).toBeLessThan(r.html.indexOf('jquery.min.js'));
    expect(r.html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(inlineCodeIn(r.html)).toEqual([]);
  });

  it('changes nothing in a page without inline code', () => {
    const plain = '<html><head><script src="a.js"></script></head></html>';
    const r = transformHtml(plain, { name: 'p.html', storage: null });
    expect(r.html).toBe(plain);
    expect(r.changes).toEqual([]);
  });
});

describe('the storage stand-in (filex/storage.js)', () => {
  const code = readFileSync(path.join(ROOT, 'scripts', 'editor', 'storage.js'), 'utf8');

  function run(window: object) {
    vm.runInNewContext(code, { window, Map, Array, Object, Proxy, String, Number });
    return window as { localStorage: Storage; sessionStorage: Storage };
  }

  it('gives a page whose browser refuses storage an in-memory one', () => {
    const w = {};
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(w, name, {
        configurable: true,
        get() {
          throw new Error('SecurityError: the document is sandboxed');
        },
      });
    }
    const { localStorage: ls, sessionStorage: ss } = run(w);
    ls.setItem('theme', 'dark');
    expect(ls.getItem('theme')).toBe('dark');
    expect(ls.getItem('none')).toBeNull();
    expect(ls.length).toBe(1);
    expect(ls.key(0)).toBe('theme');
    expect(ls.key(1)).toBeNull();
    (ls as unknown as Record<string, string>).zoom = '120';
    expect(ls.getItem('zoom')).toBe('120');
    expect((ls as unknown as Record<string, string>).zoom).toBe('120');
    expect(Object.keys(ls)).toEqual(['theme', 'zoom']);
    ls.removeItem('theme');
    expect(ls.length).toBe(1);
    ls.clear();
    expect(ls.length).toBe(0);
    ss.setItem('a', 1 as unknown as string);
    expect(ss.getItem('a')).toBe('1');
    expect(ls.getItem('a')).toBeNull();
  });

  it('leaves the browser storage in place where there is one', () => {
    const real = { getItem: () => 'real' };
    const w = { localStorage: real, sessionStorage: real };
    run(w);
    expect(w.localStorage).toBe(real);
    expect(w.sessionStorage).toBe(real);
  });

  it('takes navigator.serviceWorker away where reading it throws (Chromium, sandboxed), and only there', () => {
    const real = { getItem: () => 'real' };
    class Navigator {}
    Object.defineProperty(Navigator.prototype, 'serviceWorker', {
      configurable: true,
      get() {
        throw new Error("SecurityError: Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.");
      },
    });
    const w = { localStorage: real, sessionStorage: real, Navigator, navigator: new Navigator() };
    run(w);
    expect('serviceWorker' in w.navigator).toBe(false);
    expect(() => (w.navigator as { serviceWorker?: unknown }).serviceWorker).not.toThrow();

    const container = { register: () => Promise.resolve() };
    class Open {}
    Object.defineProperty(Open.prototype, 'serviceWorker', { configurable: true, get: () => container });
    const w2 = { localStorage: real, sessionStorage: real, Navigator: Open, navigator: new Open() };
    run(w2);
    expect((w2.navigator as { serviceWorker?: unknown }).serviceWorker).toBe(container);

    // No navigator at all: nothing to do, nothing thrown.
    expect(() => run({ localStorage: real, sessionStorage: real })).not.toThrow();
  });
});

describe('upstream/editor.lock.json (the committed build)', () => {
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  const pin = JSON.parse(readFileSync(path.join(ROOT, 'upstream', 'onlyoffice.json'), 'utf8'));
  const files = Object.entries(lock.files as Record<string, string>);

  it('was built from the pinned image', () => {
    expect(lock.onlyoffice.image).toBe(`${pin.image}@${pin.digest}`);
    expect(lock.onlyoffice.build).toBe(pin.build);
    expect(lock.onlyoffice.package).toBe(pin.build.replace(/\.(\d+)$/, '-$1'));
    expect(lock.rules.font_exclude).toEqual(FONT_EXCLUDE);
  });

  it('fits within what filex accepts, and its totals add up', () => {
    const entries = files.map(([p, v]) => ({ name: lock.bundle.prefix + p, size: Number(v.split(' ')[1]) }));
    expect(checkBundle(entries, lock.bundle.zip_bytes)).toEqual([]);
    expect(entries.length).toBe(lock.bundle.files);
    expect(entries.reduce((n, e) => n + e.size, 0)).toBe(lock.bundle.bytes);
    expect(lock.bundle.zip_bytes).toBeLessThanOrEqual(BUDGET.zipBytes);
    for (const [, v] of files) expect(v).toMatch(/^[0-9a-f]{64} \d+$/);
  });

  it('holds only files the rules keep, and every page has its scripts beside it', () => {
    for (const [p] of files) {
      if (p.startsWith('filex/') || /\.inline-\d+\.js$/.test(p) || /\/FONTS\.txt$/.test(p)) continue;
      const c = classify(p);
      expect([p, c.action]).toEqual([p, 'keep']);
    }
    for (const p of Object.keys(lock.changed)) expect(lock.files[p]).toBeDefined();
    for (const p of Object.keys(lock.added)) expect(lock.files[p]).toBeDefined();
    for (const p of ['filex/storage.js', 'filex/CHANGES.txt', 'web-apps/apps/api/documents/api.js', 'LICENSE.txt', '3rd-Party.txt']) {
      expect(lock.files[p]).toBeDefined();
    }
    for (const editor of ['documenteditor', 'spreadsheeteditor', 'presentationeditor']) {
      expect(lock.changed[`web-apps/apps/${editor}/main/index.html`]).toMatch(/inline scripts moved/);
    }
  });

  it('carries this exact storage stand-in', () => {
    const sum = createHash('sha256').update(readFileSync(path.join(ROOT, 'scripts', 'editor', 'storage.js'))).digest('hex');
    expect(lock.files['filex/storage.js'].split(' ')[0]).toBe(sum);
  });

  it('diffLocks names what changed', () => {
    const other = structuredClone(lock);
    delete other.files['LICENSE.txt'];
    other.files['new.js'] = `${'0'.repeat(64)} 1`;
    other.bundle.zip_sha256 = 'x';
    const d = diffLocks(lock, other);
    expect(d).toContain('- LICENSE.txt');
    expect(d).toContain('+ new.js');
    expect(d.some((x: string) => x.startsWith('bundle:'))).toBe(true);
    expect(diffLocks(lock, structuredClone(lock))).toEqual([]);
  });
});

const BUILT = path.join(ROOT, 'dist', 'editor');

describe.skipIf(!existsSync(BUILT))('dist/editor (a build on this machine)', () => {
  it('has no inline code in any HTML page', () => {
    const problems: string[] = [];
    const visit = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) visit(p);
        else if (/\.html?$/i.test(n)) problems.push(...inlineCodeIn(readFileSync(p, 'utf8'), path.relative(BUILT, p)));
      }
    };
    visit(BUILT);
    expect(problems).toEqual([]);
  });
});
