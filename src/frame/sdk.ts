// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// sdkjs's own objects, found by what they are when their names are gone.
//
// ONLYOFFICE Docs 10.0 ships sdkjs compiled with property renaming: what it
// exports by a quoted name stays (the asc_* API, sync_EndAction in word,
// SetThemesPath, the Asc.c_oAsc* enums, AscFonts.getFontStream, window.editor
// and Asc.editor), everything else gets a short name that changes from build
// to build. Measured on 10.0.0.169 (2026-11-08): AscCommon.baseEditorsApi,
// _downloadAsUsingServer, AscCommon.g_oDocumentUrls and
// AscCommon.c_oAscEncodings are in none of the bundle's files, and word's
// sdk-all.js went from 28.9 MB to 9.4 MB. The frame used those three; each
// is found here by its 9.4 name first, then by its shape. When neither
// finds it, the caller says so (the feature is refused, not guessed at).

export type AnyObject = Record<string, unknown>;

/** An object and its prototypes, up to Object.prototype (left out). */
export function chainOf(o: unknown): AnyObject[] {
  const out: AnyObject[] = [];
  let p = o as AnyObject | null;
  while (p && p !== Object.prototype && out.length < 32) {
    out.push(p);
    p = Object.getPrototypeOf(p) as AnyObject | null;
  }
  return out;
}

/** An own property's value without calling a getter; undefined for an accessor. */
export function ownValue(o: object, k: string): unknown {
  const d = Object.getOwnPropertyDescriptor(o, k);
  return d && 'value' in d ? d.value : undefined;
}

function sourceOf(f: unknown): string {
  try {
    return typeof f === 'function' ? Function.prototype.toString.call(f) : '';
  } catch {
    return '';
  }
}

/** downloadAs builds the server command: {c: "save"} with these keys (sdkjs apiBase.js). */
const SAVE_COMMAND = /\bc\s*:\s*["']save["']|\[\s*["']c["']\s*\]\s*=\s*["']save["']/;
/**
 * Its last statement: the server step, called with downloadAs's five values
 * - at the end of the method (cell, slide) or of the block it runs in (word
 * 10.0: `if(!this.dze(q,v)){...this.w7f(q,v,y,x,u)}}`).
 */
const LAST_CALL = /this\.([\w$]+)\(\s*[\w$]+(?:\s*,\s*[\w$]+){4}\s*\)\s*;?\s*(?:\}\s*)+$/;

/**
 * The editor's last step of "Download as" and Print - the one that posts to
 * the Document Server - on the API's prototypes: `_downloadAsUsingServer`
 * (9.4), or the method downloadAs ends with (10.0, renamed). downloadAs is
 * the method whose source builds the server command (`{c: "save"}`, with
 * `nobase64` and `withoutPassword`); its last call, with the same five
 * arguments, is the step. Null: not there (yet).
 */
export function findDownloadStep(api: unknown): { owner: AnyObject; name: string } | null {
  const chain = chainOf(api);
  const owning = (name: string) => chain.find((p) => typeof ownValue(p, name) === 'function') ?? null;
  const named = owning('_downloadAsUsingServer');
  if (named) return { owner: named, name: '_downloadAsUsingServer' };
  for (const p of chain) {
    for (const k of Object.getOwnPropertyNames(p)) {
      const s = sourceOf(ownValue(p, k));
      if (!s || !SAVE_COMMAND.test(s) || !s.includes('nobase64') || !s.includes('withoutPassword')) continue;
      const m = LAST_CALL.exec(s);
      const owner = m ? owning(m[1]) : null;
      if (owner && m) return { owner, name: m[1] };
    }
  }
  return null;
}

/**
 * Every key a function is under on an object and its prototypes. 10.0's
 * sdkjs exports a method by its quoted name as one more key for the same
 * function and calls it, inside, by its renamed key (asc_Save: Ctrl+S and
 * the toolbar's Save reach the renamed one).
 */
export function keysOf(o: unknown, f: unknown): string[] {
  const out = new Set<string>();
  if (typeof f !== 'function') return [];
  for (const p of chainOf(o)) {
    for (const k of Object.getOwnPropertyNames(p)) if (ownValue(p, k) === f) out.add(k);
  }
  return [...out];
}

/** sync_EndAction sends this event, and nothing else in sdkjs does (one occurrence in each of 10.0's three bundles). */
const END_ACTION_EVENT = /["']asc_onEndAction["']/;

/**
 * The key of the editor's sync_EndAction, which ends a wait the editor shows
 * (a Download as, a Print): by its name where the build exports it (word),
 * else (cell, slide in 10.0) the method whose source sends asc_onEndAction.
 * Called through the API (api[key]), so a more derived override under the
 * same renamed key is the one that runs. Null: not there.
 */
export function findEndAction(api: unknown): string | null {
  const chain = chainOf(api);
  if (chain.some((p) => typeof ownValue(p, 'sync_EndAction') === 'function')) return 'sync_EndAction';
  for (const p of chain) {
    for (const k of Object.getOwnPropertyNames(p)) {
      if (END_ACTION_EVENT.test(sourceOf(ownValue(p, k)))) return k;
    }
  }
  return null;
}

/** The editor's register of the document's files (sdkjs DocumentUrls), as the frame uses it. */
export interface DocumentUrls {
  getUrls(): Record<string, string>;
  addUrls(urls: Record<string, string>): void;
}

function isPlainMap(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/**
 * AscCommon.g_oDocumentUrls: by its name (9.4), or (10.0) the object on
 * AscCommon holding a map with one of the files the frame handed the editor
 * (`known`: Editor.bin, media/...) at its address - and, beside it, the
 * reverse map (address to name) that DocumentUrls keeps too. Null: not
 * there, or the editor has not taken the files in yet.
 */
export function findDocumentUrls(common: unknown, known: Record<string, string>): DocumentUrls | null {
  if (!common || typeof common !== 'object') return null;
  const named = ownValue(common, 'g_oDocumentUrls') as { getUrls?: unknown; addUrls?: unknown } | undefined;
  if (named && typeof named.getUrls === 'function' && typeof named.addUrls === 'function') {
    return {
      getUrls: () => (named.getUrls as () => Record<string, string>).call(named) ?? {},
      addUrls: (u) => (named.addUrls as (u: Record<string, string>) => void).call(named, u),
    };
  }
  const entries = Object.entries(known).filter(([, url]) => typeof url === 'string' && url.length > 0);
  if (entries.length === 0) return null;
  for (const k of Object.getOwnPropertyNames(common)) {
    const reg = ownValue(common, k);
    if (!reg || typeof reg !== 'object' || Array.isArray(reg)) continue;
    let urls: Record<string, unknown> | null = null;
    let reverse: Record<string, unknown> | null = null;
    for (const f of Object.getOwnPropertyNames(reg)) {
      const m = ownValue(reg, f);
      if (!isPlainMap(m)) continue;
      if (!urls && entries.some(([name, url]) => m[name] === url)) urls = m;
      else if (!reverse && entries.some(([name, url]) => m[url] === name)) reverse = m;
    }
    if (!urls) continue;
    const map = urls;
    const back = reverse;
    return {
      getUrls: () => {
        const out: Record<string, string> = {};
        for (const [name, url] of Object.entries(map)) if (typeof url === 'string') out[name] = url;
        return out;
      },
      addUrls: (u) => {
        for (const [name, url] of Object.entries(u)) {
          map[name] = url;
          if (back) back[url] = name;
        }
      },
    };
  }
  return null;
}

/** An encoding of the editor's list: [its number, the code page, the name, the label]. */
function isEncodingList(v: unknown): v is unknown[][] {
  if (!Array.isArray(v) || v.length < 10) return false;
  if (!v.every((e) => Array.isArray(e) && typeof e[0] === 'number')) return false;
  return v.some((e) => (e as unknown[])[0] === 46 && (e as unknown[]).includes('UTF-8'));
}

/**
 * The encodings the TXT and CSV dialogs offer (AscCommon.c_oAscEncodings,
 * read by sdkjs each time it asks): by its name (9.4), or the array of
 * AscCommon shaped like it (10.0). Null: not there.
 */
export function findEncodings(common: unknown): unknown[][] | null {
  if (!common || typeof common !== 'object') return null;
  const named = ownValue(common, 'c_oAscEncodings');
  if (Array.isArray(named)) return named as unknown[][];
  for (const k of Object.getOwnPropertyNames(common)) {
    const v = ownValue(common, k);
    if (isEncodingList(v)) return v;
  }
  return null;
}
