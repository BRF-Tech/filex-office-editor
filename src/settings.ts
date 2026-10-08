// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The editor's settings, kept from one opening to the next.
//
// ONLYOFFICE's editor keeps its settings in localStorage: units, zoom, the
// ribbon folded or not, which "New" hints the person has closed... Under
// filex the editor's page has no storage (an opaque origin), so the bundle
// gives it an in-memory one (scripts/editor/storage.js), which forgets
// everything when the page goes. filex keeps a small store per person and
// app (the SDK's state.get / state.set, in the person's preferences: 8 KiB
// a value, 16 KiB an app). The editor page reports what the editor wrote,
// the app page keeps it there under one key, and the next opening starts
// from it.
//
// Pure: the editor page and the app page share it, and the tests read it.

/** The state key the app keeps the editor's settings under. */
export const SETTINGS_KEY = 'editor-settings';

/**
 * What one state value may be (filex's LIMITS.maxStateBytes, 8 KiB as JSON),
 * less a margin; the app keeps nothing else, far under its 16 KiB.
 */
export const SETTINGS_MAX_BYTES = 8 * 1024 - 256;

/** A setting longer than this is not kept (a recent-items list, a cache). */
export const SETTING_MAX_CHARS = 1024;

/**
 * Keys the editor writes that are not the person's to keep:
 *   - the theme: filex chooses it (light/dark follows filex), and the editor
 *     page reads ui-theme-id before anything else - a kept one would win
 *     over filex's;
 *   - the right-to-left switch, which the editor page reads in its first
 *     lines, before kept settings can reach it;
 *   - the probes the editor and its page write to see whether storage works;
 *   - the same for ONLYOFFICE's phone app, whose keys all start with
 *     "mobile-": its theme (its page reads mobile-ui-theme-client first),
 *     the document's dark colours, the right-to-left switch.
 * Every other key of either app is kept, in the one set: the phone app's
 * page and the editor's page are given the same settings and report all of
 * them, so neither drops the other's.
 */
const NOT_KEPT = new Set([
  'ui-theme',
  'ui-theme-id',
  'content-theme',
  'test',
  'settings-ui-rtl',
  'mobile-ui-theme-client',
  'mobile-content-theme',
  'mobile-mode-direction',
]);

/** Whether the editor's `key` is a setting worth keeping. */
export function keptSetting(key: string): boolean {
  return key.length > 0 && key.length <= 128 && !NOT_KEPT.has(key) && !key.startsWith('__');
}

/** The UTF-8 size of the JSON of `v`. */
function jsonBytes(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}

export type Settings = Record<string, string>;

/**
 * The settings to keep from what the editor's storage holds: only the kept
 * keys and short values, in key order (so the same settings are the same
 * JSON), and - should they not fit in one state value - without the longest
 * values first, until they do.
 */
export function pickSettings(all: Iterable<[string, string]>, maxBytes = SETTINGS_MAX_BYTES): Settings {
  const kept: [string, string][] = [];
  for (const [k, v] of all) {
    if (typeof k !== 'string' || typeof v !== 'string') continue;
    if (!keptSetting(k) || v.length > SETTING_MAX_CHARS) continue;
    kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let out: Settings = Object.fromEntries(kept);
  if (jsonBytes(out) <= maxBytes) return out;
  const byLength = [...kept].sort((a, b) => b[0].length + b[1].length - (a[0].length + a[1].length) || (a[0] < b[0] ? -1 : 1));
  const drop = new Set<string>();
  for (const [k] of byLength) {
    drop.add(k);
    out = Object.fromEntries(kept.filter(([key]) => !drop.has(key)));
    if (jsonBytes(out) <= maxBytes) break;
  }
  return out;
}

/** What a kept value from filex is, as settings: anything else is nothing. */
export function readSettings(v: unknown): Settings {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Settings = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' && keptSetting(k) && val.length <= SETTING_MAX_CHARS) out[k] = val;
  }
  return out;
}

/** The same settings, whatever the order of their keys. */
export function sameSettings(a: Settings, b: Settings): boolean {
  const norm = (s: Settings) => JSON.stringify(Object.keys(s).sort().map((k) => [k, s[k]]));
  return norm(a) === norm(b);
}
