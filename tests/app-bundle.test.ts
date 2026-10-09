// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The app's bundle (scripts/build-app.mjs): what the manifest refers to is
// in it, the editor pages get the bridge where they load socket.io, and -
// when a bundle has been built on this machine (dist/ui) - it is what the
// build says it is.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EDITOR_PREFIX, SOCKET_IO, readEditor } from '../scripts/build-app.mjs';
import { inlineCodeIn } from '../scripts/editor/html.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const lock = JSON.parse(readFileSync(path.join(ROOT, 'upstream', 'editor.lock.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'filex-app.json'), 'utf8'));
const UI = path.join(ROOT, 'dist', 'ui');

describe('the manifest and the locked editor files', () => {
  it('every new document copies a blank the editor files hold', () => {
    expect(manifest.new_documents.length).toBe(3);
    for (const n of manifest.new_documents) {
      expect(n.template.startsWith(EDITOR_PREFIX)).toBe(true);
      expect(lock.files[n.template.slice(EDITOR_PREFIX.length)], n.template).toBeTruthy();
      expect(n.template.endsWith(`new.${n.ext}.bin`)).toBe(true);
    }
  });

  it('asks filex to print (ui.print, filex 0.55) and to hand files over, and says why in both languages', () => {
    expect(manifest.ui.print).toBe(true);
    expect(manifest.ui.download).toBe(true);
    for (const p of ['ui:print', 'ui:download']) {
      expect(manifest.permission_reasons[p]?.en, p).toBeTruthy();
      expect(manifest.permission_reasons[p]?.tr, p).toBeTruthy();
    }
  });

  it('is what filex 0.56 installs: its fields, its permissions, the release it names', () => {
    // filex refuses a manifest with a field it does not know
    // (wasmplugin.ParseManifest, DisallowUnknownFields) and a permission it
    // does not know (ParsePermission). 0.56 knows encrypted folders
    // (`encrypted_folders`, the derived files:e2e-plaintext) and editing
    // together (the `co_edit` block, the derived files:co-edit), so the
    // manifest asks for filex 0.56 (0.55 would refuse either block).
    const fields = ['manifest_version', 'name', 'version', 'filex', 'label', 'description', 'homepage', 'permissions', 'permission_reasons', 'languages', 'co_edit', 'ui', 'encrypted_folders', 'views', 'new_documents'];
    expect(Object.keys(manifest).filter((k) => !fields.includes(k))).toEqual([]);
    expect(Object.keys(manifest.ui).filter((k) => !['bundle', 'csp', 'package_fetch', 'frame_package', 'connect_blob', 'download', 'print'].includes(k))).toEqual([]);
    // files:e2e-plaintext and files:co-edit are derived from their blocks:
    // filex refuses either written into `permissions`.
    expect(manifest.permissions).toEqual(['files:read', 'files:write']);
    expect(manifest.co_edit).toEqual({ open: true });
    expect(manifest.filex).toBe('>=0.56.0');
    for (const lang of ['en', 'tr']) expect(manifest.permission_reasons['files:co-edit']?.[lang], lang).toBeTruthy();
    const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    expect(manifest.version).toBe(version);
    expect(manifest.ui.bundle.url).toBe(`https://github.com/BRF-Tech/filex-office-editor/releases/download/v${version}/ui.zip`);
    expect(manifest.ui.bundle.sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const [p, why] of Object.entries(manifest.permission_reasons as Record<string, Record<string, string>>)) {
      for (const lang of manifest.languages) expect(why[lang], `${p} ${lang}`).toBeTruthy();
    }
  });

  it('asks to edit documents of encrypted folders (filex 0.56), and says what that means in both languages', () => {
    expect(manifest.encrypted_folders).toEqual({ open: true });
    const why = manifest.permission_reasons['files:e2e-plaintext'];
    expect(why?.en).toContain('sees every document you open with it');
    expect(why?.tr).toContain('her belgenin içeriğini görür');
    // filex's own conditions for the block: an interface, a viewer, files:read.
    expect(manifest.views.some((v: { placement: string; ui?: string }) => v.placement === 'viewer' && !!v.ui)).toBe(true);
    expect(manifest.permissions).toContain('files:read');
    expect(manifest.description.en).toContain('encrypted folders');
  });

  it('the editor pages load socket.io from where the bridge goes', () => {
    expect(lock.files[SOCKET_IO]).toBeTruthy();
  });

  it('carries the interface templates as .template.txt, and no .template', () => {
    const names = Object.keys(lock.files);
    expect(names.filter((p) => p.endsWith('.template.txt')).length).toBeGreaterThan(80);
    expect(names.filter((p) => p.endsWith('.template'))).toEqual([]);
    expect(names).toContain('web-apps/apps/documenteditor/main/app/template/ParagraphSettings.template.txt');
    expect(names).toContain('web-apps/apps/common/main/lib/template/ExtendedColorDialog.template.txt');
  });

  it('holds no themes.json or plugins.json of its own (the build adds empty ones)', () => {
    expect(lock.files['themes.json']).toBeUndefined();
    expect(lock.files['plugins.json']).toBeUndefined();
  });

  it('carries the phone editors, their pages without inline code, loading socket.io from the same place', () => {
    for (const editor of ['documenteditor', 'spreadsheeteditor', 'presentationeditor']) {
      const page = `web-apps/apps/${editor}/mobile/index.html`;
      expect(lock.files[page], page).toBeTruthy();
      expect(lock.files[`web-apps/apps/${editor}/mobile/dist/js/app.js`], editor).toBeTruthy();
      expect(lock.changed[page], page).toMatch(/inline scripts? moved/);
    }
    expect(Object.keys(lock.files).some((p) => /^web-apps\/apps\/[^/]+\/(embed|forms)\//.test(p))).toBe(false);
  });
});

describe.skipIf(!existsSync(path.join(UI, 'index.html')))('dist/ui (a bundle built on this machine)', () => {
  const read = (p: string) => readFileSync(path.join(UI, ...p.split('/')));

  it('the editor files in it are the locked ones, but for the two the build replaces and the two it adds', () => {
    const changed = new Set([SOCKET_IO, 'filex/CHANGES.txt']);
    const locked = { files: Object.fromEntries(Object.entries(lock.files as Record<string, string>).filter(([p]) => !changed.has(p))) };
    expect(() => readEditor(path.join(UI, 'editor'), locked as never)).toThrow(/^[^]*the editor files are not the locked ones[^]*$/);
    let message = '';
    try {
      readEditor(path.join(UI, 'editor'), locked as never);
    } catch (e) {
      message = String((e as Error).message);
    }
    const lines = message.split('\n').slice(1).map((l) => l.trim()).sort();
    expect(lines).toEqual(['+ filex/CHANGES.txt (not in the lock)', `+ ${SOCKET_IO} (not in the lock)`, '+ themes.json (not in the lock)', '+ plugins.json (not in the lock)'].sort());
  });

  it("serves the bridge at socket.io's address, and says so in the changes list", () => {
    const shim = read(EDITOR_PREFIX + SOCKET_IO).toString('utf8');
    expect(shim).toMatch(/filex-office-editor .* built from src\/frame\/main\.ts/);
    expect(shim).not.toMatch(/Socket\.IO v4/);
    expect(read(`${EDITOR_PREFIX}filex/CHANGES.txt`).toString('utf8')).toMatch(/socket\.io\.min\.js: ONLYOFFICE's copy of the socket\.io client/);
    expect(JSON.parse(read(`${EDITOR_PREFIX}themes.json`).toString('utf8'))).toEqual({ themes: [] });
    expect(JSON.parse(read(`${EDITOR_PREFIX}plugins.json`).toString('utf8'))).toEqual({ pluginsData: [] });
    expect(read(`${EDITOR_PREFIX}filex/CHANGES.txt`).toString('utf8')).toMatch(/plugins\.json: an empty list of plugins/);
  });

  it('carries the pinned x2t, the app page without inline code, and the licence', () => {
    const pin = JSON.parse(readFileSync(path.join(ROOT, 'upstream', 'onlyoffice.json'), 'utf8')).x2t;
    for (const f of ['x2t.js', 'x2t.wasm']) expect(createHash('sha256').update(read(`x2t/${f}`)).digest('hex')).toBe(pin.files[f]);
    expect(inlineCodeIn(read('index.html').toString('utf8'), 'index.html')).toEqual([]);
    for (const p of ['filex/app.js', 'filex/app.css', 'filex/x2t-worker.js', 'LICENSE', 'NOTICE']) expect(existsSync(path.join(UI, p)), p).toBe(true);
  });
});
