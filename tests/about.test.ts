// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The notice ONLYOFFICE's terms ask for (src/app/strings.ts legal), behind
// the "About this editor" button in the corner of the editor's frame
// (app/index.html, app/filex/app.css, src/app/about.ts): the button is there
// at every opening, reachable by keyboard, and opens the notice whole, with
// the source as a link. No line under the editor any more. What the browser
// draws is measured by e2e/run.mjs (aboutRun).
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
  it('is the notice, whole and unchanged, with the source as a link - in both languages', () => {
    for (const t of [STRINGS.en, STRINGS.tr]) {
      for (const o of [FACTS, { ...FACTS, app: '0.0.0' }]) {
        const parts = legalParts(t, o);
        expect(parts.map((p) => p.text).join('')).toBe(t.legal(o));
        const links = parts.filter((p) => p.href);
        expect(links).toEqual([{ text: sourceOf(o.app), href: `https://${sourceOf(o.app)}` }]);
      }
    }
    expect(legalParts(STRINGS.en, FACTS).find((p) => p.href)?.href).toBe('https://github.com/BRF-Tech/filex-office-editor/tree/v0.5.2');
  });

  it('is named "About this editor" / "Bu düzenleyici hakkında", and its panel says how the link is opened', () => {
    expect(STRINGS.en.legalLabel).toBe('About this editor');
    expect(STRINGS.tr.legalLabel).toBe('Bu düzenleyici hakkında');
    for (const t of [STRINGS.en, STRINGS.tr]) {
      expect(t.close.length).toBeGreaterThan(0);
      expect(t.sourceCopied).toMatch(/\S/);
      expect(t.sourceCopyFailed).toMatch(/\S/);
    }
    expect(STRINGS.tr.close).toBe('Kapat');
    // The app's Turkish words carry their own letters, and no long dash.
    for (const s of [STRINGS.tr.sourceCopied, STRINGS.tr.sourceCopyFailed]) expect(s).not.toMatch(/[—–]/);
    expect(STRINGS.tr.sourceCopied).toMatch(/[ğıüşöç]/);
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

  it('opens a panel that holds the notice, a close button and a line for what the link did', () => {
    const p = tagOf('fx-about-panel');
    expect(p).toMatch(/\brole="dialog"/);
    expect(p).toMatch(/\baria-labelledby="fx-about-title"/);
    expect(p).toMatch(/\btabindex="-1"/);
    expect(p).toMatch(/\bhidden\b/);
    expect(tagOf('fx-about-title')).not.toBeNull();
    expect(tagOf('fx-about-text')).not.toBeNull();
    expect(tagOf('fx-about-close')).toMatch(/^<button\b[^>]*\btype="button"/);
    expect(tagOf('fx-about-note')).toMatch(/\brole="status"/);
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
