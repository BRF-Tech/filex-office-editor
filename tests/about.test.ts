// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The notice ONLYOFFICE's terms ask for (src/app/strings.ts legal), behind
// the "About this editor" button in the corner of the editor's frame
// (app/index.html, app/filex/app.css, src/app/about.ts): the button is there
// at every opening, reachable by keyboard, and opens the notice whole, the
// source address in it as plain text to select and copy - no link, nothing
// on a click (from 0.5.3). No line under the editor any more. What the
// browser draws is measured by e2e/run.mjs (aboutRun).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { legalParts } from '../src/app/about';
import { STRINGS, sourceOf } from '../src/app/strings';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(path.join(ROOT, ...p.split('/')), 'utf8');
const html = read('app/index.html');
const css = read('app/filex/app.css');
const main = read('src/app/main.ts');

/** The opening tag of the element with this id (its attributes), or null. */
function tagOf(id: string): string | null {
  const m = new RegExp(`<[a-z0-9]+\\b[^>]*\\bid="${id}"[^>]*>`, 'i').exec(html);
  return m ? m[0] : null;
}

/** The declarations of the CSS rules whose selector is exactly `selector`. */
function rulesOf(selector: string): string {
  const out: string[] = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim());
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out.join(';');
}

const FACTS = { version: '10.0.0', build: 169, tag: 'v10.0.0.169', app: '0.5.2' };

describe('the notice behind "About this editor"', () => {
  it('is the notice, whole and unchanged, the source address in it as plain text - in both languages', () => {
    for (const t of [STRINGS.en, STRINGS.tr]) {
      for (const o of [FACTS, { ...FACTS, app: '0.0.0' }]) {
        const parts = legalParts(t, o);
        expect(parts.map((p) => p.text).join('')).toBe(t.legal(o));
        expect(parts.filter((p) => p.source)).toEqual([{ text: sourceOf(o.app), source: true }]);
        // No run carries an address to open.
        for (const p of parts) expect(p).not.toHaveProperty('href');
      }
    }
    expect(legalParts(STRINGS.en, FACTS).find((p) => p.source)?.text).toBe('github.com/BRF-Tech/filex-office-editor/tree/v0.5.2');
  });

  it('is named "About this editor" / "Bu düzenleyici hakkında", and its panel has a close button', () => {
    expect(STRINGS.en.legalLabel).toBe('About this editor');
    expect(STRINGS.tr.legalLabel).toBe('Bu düzenleyici hakkında');
    for (const t of [STRINGS.en, STRINGS.tr]) expect(t.close.length).toBeGreaterThan(0);
    expect(STRINGS.tr.close).toBe('Kapat');
  });
});

describe('the app page: a button in the corner of the editor, no line under it', () => {
  it('has no line under the editor any more', () => {
    expect(tagOf('fx-legal')).toBeNull();
    expect(css).not.toMatch(/#fx-legal\b/);
    expect(main).not.toMatch(/fx-legal/);
  });

  it('has the button at every opening: a real button, never hidden, first in the page (the first Tab reaches it)', () => {
    const b = tagOf('fx-about');
    expect(b).not.toBeNull();
    expect(b).toMatch(/^<button\b/);
    expect(b).toMatch(/\btype="button"/);
    expect(b).toMatch(/\baria-label="About this editor"/);
    expect(b).toMatch(/\baria-haspopup="dialog"/);
    expect(b).toMatch(/\baria-controls="fx-about-panel"/);
    expect(b).toMatch(/\baria-expanded="false"/);
    expect(b).not.toMatch(/\bhidden\b/);
    expect(b).not.toMatch(/\btabindex="-1"/);
    // Before the editor's frame and the phone's switch: the first thing Tab reaches in the app page.
    expect(html.indexOf('id="fx-about"')).toBeLessThan(html.indexOf('id="fx-editor-box"'));
    expect(html.indexOf('id="fx-about"')).toBeLessThan(html.indexOf('id="fx-switch"'));
    // main.ts never hides it.
    expect(main).not.toMatch(/fx-about'\)\.hidden\s*=\s*true/);
  });

  it('opens a panel that holds the notice and a close button', () => {
    const p = tagOf('fx-about-panel');
    expect(p).toMatch(/\brole="dialog"/);
    expect(p).toMatch(/\baria-labelledby="fx-about-title"/);
    expect(p).toMatch(/\btabindex="-1"/);
    expect(p).toMatch(/\bhidden\b/);
    expect(tagOf('fx-about-title')).not.toBeNull();
    expect(tagOf('fx-about-text')).not.toBeNull();
    expect(tagOf('fx-about-close')).toMatch(/^<button\b[^>]*\btype="button"/);
  });

  it('shows the source address as plain, selectable text: no link, nothing on a click, nothing through filex', () => {
    // No link in the page, none made for the panel, and no click handler on the notice.
    expect(html).not.toMatch(/<a\b/i);
    expect(main).not.toMatch(/createElement\(\s*['"]a['"]\s*\)/);
    expect(main).not.toMatch(/fx-about-text'\)\.addEventListener/);
    // Nothing goes to filex's clipboard, nothing asks filex to open a page, and nothing in the panel says what a click did.
    expect(main).not.toMatch(/\.copy\(|clipboard\.write|ui\.open/);
    expect(tagOf('fx-about-note')).toBeNull();
    for (const t of [STRINGS.en, STRINGS.tr]) {
      expect(t).not.toHaveProperty('sourceCopied');
      expect(t).not.toHaveProperty('sourceCopyFailed');
    }
    // The address: a run of its own, selectable, set apart in a monospace face, with nothing that says "click".
    expect(main).toMatch(/fx-about-source/);
    expect(css).not.toMatch(/#fx-about-text a\b/);
    expect(css).not.toMatch(/user-select:\s*none/);
    expect(rulesOf('#fx-about-text')).toMatch(/user-select:\s*text/);
    const s = rulesOf('.fx-about-source');
    expect(s).toMatch(/user-select:\s*text/);
    expect(s).toMatch(/font-family:[^;]*monospace/);
    expect(s).not.toMatch(/cursor:\s*pointer|text-decoration:\s*underline/);
  });

  it('draws the button in both themes, above the editor and the opening message, with a focus ring', () => {
    const b = rulesOf('#fx-about');
    expect(b).toMatch(/position:\s*absolute/);
    expect(b).not.toMatch(/display:\s*none|visibility:\s*hidden|opacity:\s*0(\D|$)/);
    const z = Number(/z-index:\s*(\d+)/.exec(b)?.[1]);
    const statusZ = Number(/z-index:\s*(\d+)/.exec(rulesOf('#fx-status'))?.[1]);
    expect(z).toBeGreaterThan(statusZ);
    expect(b).toMatch(/background:\s*var\(--fe-bg/);
    expect(rulesOf('html[data-theme="dark"] #fx-about')).toMatch(/background:\s*var\(--fe-bg/);
    expect(rulesOf('#fx-about:focus-visible')).toMatch(/outline:\s*2px solid/);
    // On a phone it moves to the footer, beside "Edit", off the document.
    expect(rulesOf('html[data-fx-phone] #fx-foot')).toMatch(/display:\s*flex/);
    expect(rulesOf('#fx-foot')).toMatch(/display:\s*none/);
  });
});
