// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// What the app page tells ONLYOFFICE's editor (src/app/config.ts), and the
// small rules of the editor page's script (src/frame): the template names,
// the themes path, the Save kept while the editor is busy, the workers.
import { describe, expect, it, vi } from 'vitest';

import {
  NARROW_PX,
  PHONE_THEME_DARK,
  PHONE_THEME_LIGHT,
  editorConfig,
  editorLang,
  editorRegion,
  isPhone,
  kindOf,
  narrowLayout,
  phoneLayout,
  uiLang,
  THEME_DARK,
  THEME_LIGHT,
} from '../src/app/config';
import { STRINGS } from '../src/app/strings';
import { EDITOR_USER_ID, isFrameHello, isFramePort, mediaType, FRAME_HELLO, FRAME_PORT } from '../src/frame-protocol';
import { HELD_SCRIPTS, holdScripts } from '../src/frame/hold';
import { SaveRetry } from '../src/frame/save-retry';
import { templateUrl } from '../src/frame/text';
import { trimThemesPath } from '../src/frame/themes-path';
import { InertWorker, SPELL_ENGINE } from '../src/frame/workers';

describe('the kind of document', () => {
  it('by extension, with or without the dot, in any case', () => {
    expect(kindOf('docx')).toMatchObject({ documentType: 'word', editorType: 0 });
    expect(kindOf('.XLSX')).toMatchObject({ documentType: 'cell', editorType: 1 });
    expect(kindOf('pptx')).toMatchObject({ documentType: 'slide', editorType: 2 });
    expect(kindOf('odt')).toMatchObject({ documentType: 'word', blank: '' });
    for (const no of ['pdf', 'doc', '', null, undefined, 'docx.exe', 'constructor', '__proto__']) expect(kindOf(no as string)).toBeNull();
  });

  it('a blank document for each OOXML kind, in the bundle as the manifest names it', () => {
    expect(kindOf('docx')!.blank).toBe('editor/document-templates/new/default/new.docx.bin');
    expect(kindOf('xlsx')!.blank).toBe('editor/document-templates/new/default/new.xlsx.bin');
    expect(kindOf('pptx')!.blank).toBe('editor/document-templates/new/default/new.pptx.bin');
  });
});

describe('languages', () => {
  it("the app's words: Turkish for tr*, English otherwise", () => {
    expect(uiLang('tr')).toBe('tr');
    expect(uiLang('tr-TR')).toBe('tr');
    expect(uiLang('en-GB')).toBe('en');
    expect(uiLang('trk')).toBe('en');
    expect(uiLang(undefined)).toBe('en');
  });

  it("the editor's language and region", () => {
    expect(editorLang('tr')).toBe('tr');
    expect(editorLang('pt-BR')).toBe('pt');
    expect(editorLang('')).toBe('en');
    expect(editorRegion('tr')).toBe('tr-TR');
    expect(editorRegion('pt-br')).toBe('pt-BR');
    expect(editorRegion('en')).toBe('en-US');
    expect(editorRegion('nonsense!')).toBe('en-US');
  });

  it('the legal line names ONLYOFFICE, says the version is modified, and where the source is - in both languages', () => {
    const o = { version: '9.4.0', build: 129, tag: 'v9.4.0.129', app: '0.1.0' };
    for (const t of [STRINGS.en, STRINGS.tr]) {
      const line = t.legal(o);
      expect(line).toMatch(/ONLYOFFICE Docs/);
      expect(line).toMatch(/Ascensio System SIA/);
      expect(line).toMatch(/v9\.4\.0\.129/);
      expect(line).toMatch(/github\.com\/BRF-Tech\/filex-office-editor/);
      expect(line).toMatch(/ONLYOFFICE®/);
      expect(line).toMatch(/AGPL/);
      expect(line).toContain('github.com/BRF-Tech/filex-office-editor/tree/v0.1.0');
    }
    // A build between releases has no tag of its own: the repository.
    expect(STRINGS.en.legal({ ...o, app: '0.0.0' })).toMatch(/source code: github\.com\/BRF-Tech\/filex-office-editor\. /);
    expect(STRINGS.tr.legal(o)).toMatch(/değiştirilmiş olabilir/);
    expect(STRINGS.en.legal(o)).toMatch(/may have been modified/);
  });
});

describe('the editor configuration', () => {
  const base = { kind: kindOf('docx')!, title: 'Rapor.docx', key: 'k1', locale: 'tr', dark: false, userName: 'Ayşe', canEdit: true };

  it('edits in fast co-editing with Save going to the bridge, as the user the bridge expects', () => {
    const c = editorConfig(base) as any;
    expect(c.documentType).toBe('word');
    expect(c.document).toMatchObject({ fileType: 'docx', key: 'k1', title: 'Rapor.docx' });
    expect(c.document.url).toBe('filex:document');
    expect(c.editorConfig).toMatchObject({ mode: 'edit', lang: 'tr', region: 'tr-TR', coEditing: { mode: 'fast', change: false } });
    expect(c.editorConfig.user).toEqual({ id: EDITOR_USER_ID, name: 'Ayşe' });
    expect(c.editorConfig.customization).toMatchObject({ forcesave: true, plugins: false, macros: false, help: false, feedback: false, goback: false, uiTheme: THEME_LIGHT });
    expect(c.editorConfig.customization.features.spellcheck).toEqual({ mode: false, change: false });
    expect(c.document.permissions).toMatchObject({ edit: true, download: false, print: false, chat: false });
    expect(c.editorConfig.customization.chat).toBeUndefined();
    // "Suggest a feature" opens ONLYOFFICE's site, which the sandbox cannot.
    expect(c.editorConfig.customization.suggestFeature).toBe(false);
  });

  it('lists only people without a group, so the bridge keeper is not counted', () => {
    const c = editorConfig({ ...base, userName: `Ayşe${String.fromCharCode(160)}Yılmaz` }) as any;
    expect(c.document.permissions.userInfoGroups).toEqual(['']);
    expect(c.editorConfig.user.name).toBe('Ayşe Yılmaz');
  });

  it('Download as and Print where filex can hand the file over', () => {
    const c = editorConfig({ ...base, canDownload: true, canPrint: true }) as any;
    expect(c.document.permissions).toMatchObject({ download: true, print: true });
  });

  it('a narrow frame folds the editor, and nothing else changes', () => {
    expect(NARROW_PX).toBe(600);
    const wide = editorConfig(base) as any;
    const narrow = editorConfig({ ...base, narrow: true }) as any;
    expect(narrow.editorConfig.customization).toMatchObject(narrowLayout());
    expect(narrowLayout()).toMatchObject({ compactToolbar: true, hideRulers: true });
    expect(narrowLayout().zoom).toBeUndefined();
    expect(narrowLayout().compactHeader).toBeUndefined();
    for (const k of Object.keys(narrowLayout())) expect(wide.editorConfig.customization[k]).toBeUndefined();
  });

  it('a file that cannot be saved opens to read, and the dark theme follows filex', () => {
    const c = editorConfig({ ...base, canEdit: false, dark: true }) as any;
    expect(c.editorConfig.mode).toBe('view');
    expect(c.document.permissions).toMatchObject({ edit: false, review: false, comment: false });
    expect(c.editorConfig.customization.uiTheme).toBe(THEME_DARK);
  });
});

describe('on a phone', () => {
  const base = { kind: kindOf('docx')!, title: 'Rapor.docx', key: 'k1', locale: 'tr', dark: false, userName: 'Ayşe', canEdit: true };

  it('a narrow touch screen is a phone; a narrow window with a mouse, or a wide tablet, is not', () => {
    expect(isPhone({ width: 390, coarsePointer: true, touchPoints: 5 })).toBe(true);
    expect(isPhone({ width: 390, coarsePointer: false, touchPoints: 1 })).toBe(true);
    expect(isPhone({ width: 390, coarsePointer: true, touchPoints: 0 })).toBe(true);
    expect(isPhone({ width: 390, coarsePointer: false, touchPoints: 0 })).toBe(false);
    expect(isPhone({ width: NARROW_PX, coarsePointer: true, touchPoints: 5 })).toBe(false);
    expect(isPhone({ width: 820, coarsePointer: true, touchPoints: 5 })).toBe(false);
    expect(isPhone({ width: 0, coarsePointer: true, touchPoints: 5 })).toBe(false);
  });

  it("opens ONLYOFFICE's phone app, to read, with its own theme names", () => {
    const c = editorConfig({ ...base, phone: true, narrow: true, canDownload: true, canPrint: true }) as any;
    expect(c.type).toBe('mobile');
    // The open-source phone app only reads: in edit mode it says a commercial licence is needed.
    expect(c.editorConfig.mode).toBe('view');
    expect(c.document.permissions).toMatchObject({ edit: false, review: false, comment: false, download: true, print: true });
    expect(c.document.permissions.userInfoGroups).toEqual(['']);
    expect(c.editorConfig.customization.uiTheme).toBe(PHONE_THEME_LIGHT);
    expect(c.editorConfig.customization.mobile).toEqual({ forceView: true, disableForceDesktop: true });
    expect(c.editorConfig.customization).toMatchObject(phoneLayout());
    // Not folded: that is the editor's, and the phone app has its own layout.
    for (const k of Object.keys(narrowLayout())) expect(c.editorConfig.customization[k]).toBeUndefined();
    // Nothing that would reach a server, as for the editor.
    expect(c.editorConfig.customization).toMatchObject({ forcesave: true, plugins: false, macros: false, help: false, feedback: false, goback: false });
    const night = editorConfig({ ...base, phone: true, dark: true }) as any;
    expect(night.editorConfig.customization.uiTheme).toBe(PHONE_THEME_DARK);
  });

  it('the editor stays the desktop one everywhere else, folded when narrow (a phone after "Edit" too)', () => {
    const wide = editorConfig(base) as any;
    const narrow = editorConfig({ ...base, narrow: true, phone: false }) as any;
    expect(wide.type).toBe('desktop');
    expect(narrow.type).toBe('desktop');
    expect(narrow.editorConfig.mode).toBe('edit');
    expect(narrow.editorConfig.customization).toMatchObject(narrowLayout());
    expect(narrow.editorConfig.customization.mobile).toBeUndefined();
    expect(narrow.editorConfig.customization.uiTheme).toBe(THEME_LIGHT);
  });
});

describe('the frame protocol', () => {
  it('knows its hello and its port, and nothing else', () => {
    expect(isFrameHello({ type: FRAME_HELLO, v: 1 })).toBe(true);
    expect(isFrameHello({ type: FRAME_HELLO, v: 2 })).toBe(false);
    expect(isFrameHello({ type: 'filex:hello', v: 1 })).toBe(false);
    expect(isFramePort({ type: FRAME_PORT, v: 1 })).toBe(true);
    expect(isFramePort('x')).toBe(false);
  });

  it('gives an image blob its type by extension', () => {
    expect(mediaType('image1.png')).toBe('image/png');
    expect(mediaType('a.JPEG')).toBe('image/jpeg');
    expect(mediaType('x.emf')).toBe('image/emf');
    expect(mediaType('noext')).toBe('application/octet-stream');
  });
});

describe('the editor page', () => {
  it('asks for an interface template under the name the bundle serves it with', () => {
    expect(templateUrl('../../documenteditor/main/app/template/X.template')).toBe('../../documenteditor/main/app/template/X.template.txt');
    expect(templateUrl('a/X.template?_dc=1')).toBe('a/X.template.txt?_dc=1');
    expect(templateUrl('a/X.template.txt')).toBe('a/X.template.txt');
    expect(templateUrl('a/locale/tr.json')).toBe('a/locale/tr.json');
  });

  it('gives the presentation editor its themes folder without the trailing slash', () => {
    const calls: unknown[] = [];
    const win: Record<string, unknown> = {};
    trimThemesPath(win);
    const api = { SetThemesPath: (p: unknown) => calls.push(p) };
    win.editor = api;
    (win.editor as typeof api).SetThemesPath('../../../../sdkjs/slide/themes/');
    expect(calls).toEqual(['../../../../sdkjs/slide/themes']);
    expect(win.editor).toBe(api);
  });

  it('keeps a Save the editor dropped and makes it when the editor is free', () => {
    vi.useFakeTimers();
    try {
      const r = new SaveRetry();
      const calls: (boolean | undefined)[] = [];
      const api = {
        canSave: false,
        asc_Save(isAutoSave?: boolean) {
          calls.push(isAutoSave);
        },
      };
      r.attach(api);
      api.asc_Save(); // dropped by the editor: a hand-over runs
      vi.advanceTimersByTime(1000);
      expect(calls).toEqual([undefined]);
      api.canSave = true;
      r.seen('unSaveLock');
      vi.advanceTimersByTime(60);
      expect(calls).toEqual([undefined, undefined]);
      r.sent('forceSaveStart');
      vi.advanceTimersByTime(5000);
      expect(calls.length).toBe(2);
      // An autosave is not the person's: nothing is kept for it.
      api.asc_Save(true);
      vi.advanceTimersByTime(5000);
      expect(calls).toEqual([undefined, undefined, true]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the phone app's sdkjs scripts until the kept settings are in, in order, and lets the rest through", async () => {
    const added: string[] = [];
    const proto = {
      appendChild<T>(n: T): T {
        const x = n as unknown as { src?: string; tagName: string };
        added.push(x.src ?? x.tagName);
        return n;
      },
    };
    const body = Object.create(proto) as typeof proto;
    let open: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      open = resolve;
    });
    const B = 'https://f.example/_appui/office-editor/abc/editor/';
    expect(holdScripts(body as never, ready)).toBe(true);
    body.appendChild({ tagName: 'script', src: `${B}web-apps/vendor/xregexp/xregexp-all-min.js` });
    body.appendChild({ tagName: 'SCRIPT', src: `${B}sdkjs/common/AllFonts.js` });
    body.appendChild({ tagName: 'DIV' });
    body.appendChild({ tagName: 'script', src: `${B}sdkjs/word/sdk-all-min.js` });
    expect(added).toEqual([`${B}web-apps/vendor/xregexp/xregexp-all-min.js`, 'DIV']);
    open();
    await ready;
    await Promise.resolve();
    expect(added).toEqual([`${B}web-apps/vendor/xregexp/xregexp-all-min.js`, 'DIV', `${B}sdkjs/common/AllFonts.js`, `${B}sdkjs/word/sdk-all-min.js`]);
    // The page's own appendChild is back.
    expect(Object.prototype.hasOwnProperty.call(body, 'appendChild')).toBe(false);
    body.appendChild({ tagName: 'script', src: `${B}sdkjs/slide/sdk-all-min.js` });
    expect(added[added.length - 1]).toBe(`${B}sdkjs/slide/sdk-all-min.js`);
  });

  it("holds them under filex's bootstrap too, whose Node.prototype.appendChild is read-only", async () => {
    const added: string[] = [];
    const proto = {};
    Object.defineProperty(proto, 'appendChild', {
      value: function <T>(n: T): T {
        added.push((n as unknown as { src: string }).src);
        return n;
      },
      writable: false,
      configurable: false,
    });
    const body = Object.create(proto) as { appendChild<T>(n: T): T };
    expect(() => {
      'use strict';
      (body as { appendChild: unknown }).appendChild = () => null;
    }).toThrow();
    let open: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      open = resolve;
    });
    expect(holdScripts(body as never, ready)).toBe(true);
    body.appendChild({ tagName: 'SCRIPT', src: 'x/sdkjs/common/AllFonts.js' });
    expect(added).toEqual([]);
    open();
    await ready;
    await Promise.resolve();
    expect(added).toEqual(['x/sdkjs/common/AllFonts.js']);
    expect(Object.prototype.hasOwnProperty.call(body, 'appendChild')).toBe(false);
  });

  it('lets the held scripts go when the wait fails too, and holds nothing without a parent', async () => {
    const added: string[] = [];
    const body = { appendChild: <T>(n: T): T => (added.push((n as unknown as { src: string }).src), n) };
    const ready = Promise.reject(new Error('no settings'));
    holdScripts(body as never, ready);
    body.appendChild({ tagName: 'script', src: 'x/sdkjs/cell/sdk-all-min.js' });
    expect(added).toEqual([]);
    await ready.catch(() => {});
    await Promise.resolve();
    expect(added).toEqual(['x/sdkjs/cell/sdk-all-min.js']);
    expect(holdScripts(null, Promise.resolve())).toBe(false);
    expect(HELD_SCRIPTS.test('https://f.example/editor/web-apps/vendor/socketio/socket.io.min.js')).toBe(false);
  });

  it("gives the spell checker's engine a worker that does nothing", () => {
    expect(SPELL_ENGINE.test('https://f.example/_appui/office-editor/abc/editor/sdkjs/common/spell/spell/spell.js')).toBe(true);
    expect(SPELL_ENGINE.test('https://f.example/_appui/office-editor/abc/x2t/x2t.js')).toBe(false);
    const w = new InertWorker();
    expect(() => w.postMessage()).not.toThrow();
    expect(() => w.terminate()).not.toThrow();
  });
});
