// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The editor's settings kept from one opening to the next (src/settings.ts)
// and the editor page's watcher on its storage (src/frame/storage.ts).
import { describe, expect, it } from 'vitest';

import { KeptStorage, hasStandIn } from '../src/frame/storage';
import { SETTINGS_MAX_BYTES, SETTING_MAX_CHARS, keptSetting, pickSettings, readSettings, sameSettings } from '../src/settings';

describe('which settings are kept', () => {
  it('everything the editor writes but the theme, the right-to-left switch and the probes', () => {
    for (const k of ['de-settings-unit', 'sse-settings-zoom', 'de-help-tip-multipage-view-statusbar', 'app-settings-recent-langs', 'pe-last-zoom']) {
      expect(keptSetting(k), k).toBe(true);
    }
    for (const k of ['ui-theme', 'ui-theme-id', 'content-theme', 'settings-ui-rtl', 'test', '__fx_probe', '', 'x'.repeat(129)]) {
      expect(keptSetting(k), k).toBe(false);
    }
  });

  it("the phone app's settings too (all under mobile-), but its theme, its dark document and its direction", () => {
    for (const k of ['mobile-de-settings-zoom', 'mobile-de-mobile-settings-unit', 'mobile-sse-settings-zoom', 'mobile-de-view-review-mode']) {
      expect(keptSetting(k), k).toBe(true);
    }
    for (const k of ['mobile-ui-theme-client', 'mobile-content-theme', 'mobile-mode-direction']) expect(keptSetting(k), k).toBe(false);
    // One set for both apps: a page reports the other app's kept keys with its own.
    const both = pickSettings([
      ['de-settings-unit', '1'],
      ['mobile-de-settings-zoom', '120'],
      ['mobile-ui-theme-client', '{"id":"theme-dark","type":"dark"}'],
    ]);
    expect(both).toEqual({ 'de-settings-unit': '1', 'mobile-de-settings-zoom': '120' });
  });

  it('only short values, in key order, so the same settings are the same JSON', () => {
    const got = pickSettings([
      ['de-z', '1'],
      ['ui-theme', '{"id":"theme-white"}'],
      ['de-a', 'ğüşıöç'],
      ['de-long', 'x'.repeat(SETTING_MAX_CHARS + 1)],
    ]);
    expect(Object.keys(got)).toEqual(['de-a', 'de-z']);
    expect(got['de-a']).toBe('ğüşıöç');
  });

  it('fit in one state value: the longest go first', () => {
    const all: [string, string][] = [];
    for (let i = 0; i < 40; i++) all.push([`de-k${String(i).padStart(2, '0')}`, 'v'.repeat(i < 30 ? 50 : 900)]);
    const got = pickSettings(all);
    expect(new TextEncoder().encode(JSON.stringify(got)).length).toBeLessThanOrEqual(SETTINGS_MAX_BYTES);
    for (let i = 0; i < 30; i++) expect(got[`de-k${String(i).padStart(2, '0')}`]).toBe('v'.repeat(50));
    expect(Object.keys(got).length).toBeLessThan(40);
  });

  it('reads back only what it could have written', () => {
    expect(readSettings(null)).toEqual({});
    expect(readSettings(['a'])).toEqual({});
    expect(readSettings({ 'de-a': '1', 'ui-theme-id': 'theme-night', 'de-n': 5, __proto__: { x: '1' } })).toEqual({ 'de-a': '1' });
  });

  it('the same settings in any order are the same', () => {
    expect(sameSettings({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
    expect(sameSettings({ a: '1' }, { a: '2' })).toBe(false);
  });
});

/** A page with the bundle's storage stand-in (an own data property, like filex/storage.js). */
function standInPage() {
  const data = new Map<string, string>();
  const standIn = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
  const win: Record<string, unknown> = {};
  Object.defineProperty(win, 'localStorage', { value: standIn, configurable: true, enumerable: true, writable: false });
  return { win, data };
}

describe("the editor page's storage watcher", () => {
  function setup() {
    const page = standInPage();
    const reports: [string, string][][] = [];
    const runs: (() => void)[] = [];
    const kept = new KeptStorage(page.win, (e) => reports.push(e), (run) => void runs.push(run));
    const turn = () => {
      while (runs.length) runs.shift()!();
    };
    expect(kept.install()).toBe(true);
    const ls = page.win.localStorage as Storage & Record<string, unknown>;
    return { ...page, kept, reports, turn, ls };
  }

  it('lets every read and write through, and reports a burst of writes once', () => {
    const { ls, data, reports, turn } = setup();
    ls.setItem('de-a', '1');
    ls['de-b'] = '2';
    ls.removeItem('de-a');
    expect(data.get('de-b')).toBe('2');
    expect(ls.getItem('de-b')).toBe('2');
    expect(ls['de-b']).toBe('2');
    expect(ls.length).toBe(1);
    expect(ls.key(0)).toBe('de-b');
    expect('de-b' in ls).toBe(true);
    expect(Object.keys(ls)).toEqual(['de-b']);
    expect(reports).toEqual([]);
    turn();
    expect(reports).toEqual([[['de-b', '2']]]);
    delete ls['de-b'];
    ls.clear();
    turn();
    expect(reports.length).toBe(2);
    expect(reports[1]).toEqual([]);
  });

  it('fills the storage with kept settings without reporting them, and never over a newer value', () => {
    const { kept, ls, reports, turn } = setup();
    ls.setItem('de-a', 'new');
    turn();
    kept.seed({ 'de-a': 'old', 'de-b': 'kept' });
    turn();
    expect(ls.getItem('de-a')).toBe('new');
    expect(ls.getItem('de-b')).toBe('kept');
    expect(reports.length).toBe(1);
  });

  it("leaves the browser's own storage alone", () => {
    const win = {};
    expect(hasStandIn(win)).toBe(false);
    expect(new KeptStorage(win, () => {}).install()).toBe(false);
    const { kept } = setup();
    expect(kept.install()).toBe(false);
  });
});
