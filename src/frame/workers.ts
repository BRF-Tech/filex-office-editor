// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Workers in the editor page. Under filex the page is an opaque origin, and
// an opaque origin may not start a worker from an address (measured,
// Chromium: "Script at '<package>/sdkjs/common/spell/spell/spell.js' cannot
// be accessed from origin 'null'"); worker-src allows blob: only. The editor
// starts one worker on its own, the spell checker's, inside its answer to
// the server's auth - and the exception stopped the document from opening.
//
//   - The spell checker (0.4.0) starts from a blob: address too, with what
//     a script started that way lacks: where its spell.wasm is (emscripten
//     finds it beside the script's address, and a blob: address has no
//     "beside"), and where the dictionaries are. The bundle carries the
//     dictionaries of filex's interface languages
//     (BUNDLED_DICTIONARIES, scripts/editor/in-image.sh), their .aff and
//     .dic served as .aff.txt and .dic.txt; the others come from what an
//     administrator added to the app (filex 0.57 serves them under the
//     package's extra/dictionaries/), and a language with neither is not
//     checked, as a Document Server without its dictionary does.
//   - Any other worker the editor starts from an address of the package
//     starts from a blob: address whose one line imports that script.

/** The spell checker's engine, by its address. */
export const SPELL_ENGINE = /\/sdkjs\/common\/spell\//;

/** The dictionaries in the bundle (scripts/editor/in-image.sh DICTIONARIES): filex's interface languages. */
export const BUNDLED_DICTIONARIES: readonly string[] = ['en_US', 'tr_TR', 'de_DE', 'es_ES', 'fr_FR', 'ar'];

/**
 * Where the spell checker finds a dictionary file: the bundle's copy
 * (editor/dictionaries/<lang>/<file>.txt) or one an administrator added
 * (extra/dictionaries/<lang>/<file>.txt), from the package's root. Any other
 * address is left as it is. Self-contained: the worker's boot script carries
 * its text.
 */
export function dictionaryUrl(url: string, root: string, bundled: readonly string[]): string {
  const m = /(?:^|\/)dictionaries\/+([A-Za-z_]{2,16})\/+([A-Za-z_]{2,32}\.(?:aff|dic))$/.exec(url);
  if (!m) return url;
  const where = bundled.indexOf(m[1]) >= 0 ? 'editor/dictionaries/' : 'extra/dictionaries/';
  return root + where + m[1] + '/' + m[2] + '.txt';
}

/**
 * The spell checker's boot script, run from a blob: address: spell.wasm's
 * place (emscripten's Module.locateFile), the dictionaries' addresses
 * (dictionaryUrl, on the worker's XMLHttpRequest), then the engine itself.
 */
export function spellBoot(engine: string, root: string, bundled: readonly string[]): string {
  const dir = engine.slice(0, engine.lastIndexOf('/') + 1);
  return [
    `var Module = { locateFile: function (p) { return ${JSON.stringify(dir)} + p; } };`,
    `var fxDictionaryUrl = ${dictionaryUrl.toString()};`,
    '(function () {',
    '  var open = XMLHttpRequest.prototype.open;',
    '  XMLHttpRequest.prototype.open = function () {',
    '    var a = Array.prototype.slice.call(arguments);',
    `    a[1] = fxDictionaryUrl(String(a[1]), ${JSON.stringify(root)}, ${JSON.stringify(bundled)});`,
    '    return open.apply(this, a);',
    '  };',
    '})();',
    `importScripts(${JSON.stringify(engine)});`,
  ].join('\n');
}

/** The package's root (the folder holding editor/), from an address under it; null when there is none. */
export function packageRoot(abs: string): string | null {
  const i = abs.indexOf('/editor/sdkjs/');
  return i < 0 ? null : abs.slice(0, i + 1);
}

/**
 * The hyphenation's dictionaries the editor page fetches itself
 * ("../../../../dictionaries/<lang>/hyph_<lang>.dic", from sdkjs): the same
 * addresses as the spell checker's (dictionaryUrl), on the page's
 * XMLHttpRequest.
 */
export function guardDictionaries(win: Record<string, unknown>, base: string): void {
  const X = win.XMLHttpRequest as { prototype: { open: (...a: unknown[]) => void; __filexDict?: boolean } } | undefined;
  const root = packageRoot(new URL('sdkjs/', new URL('../../../../', base)).href);
  if (!X || !root || X.prototype.__filexDict) return;
  const open = X.prototype.open;
  X.prototype.open = function (this: unknown, ...a: unknown[]) {
    if (typeof a[1] === 'string' || a[1] instanceof URL) {
      let abs: string;
      try {
        abs = new URL(String(a[1]), base).href;
      } catch {
        abs = String(a[1]);
      }
      const to = dictionaryUrl(abs, root, BUNDLED_DICTIONARIES);
      if (to !== abs) a[1] = to;
    }
    return open.apply(this, a);
  };
  X.prototype.__filexDict = true;
}

/** A worker that takes every message and never answers. */
export class InertWorker extends EventTarget {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}

type WorkerCtor = new (url: string | URL, opts?: WorkerOptions) => Worker;

export function guardWorkers(win: Record<string, unknown>, base: string): void {
  const Native = win.Worker as WorkerCtor | undefined;
  if (typeof Native !== 'function' || (Native as unknown as { __filex?: boolean }).__filex) return;
  const Guarded = function (this: unknown, url: string | URL, opts?: WorkerOptions): Worker {
    let abs: string;
    try {
      abs = new URL(String(url), base).href;
    } catch {
      return new Native(url, opts);
    }
    if (SPELL_ENGINE.test(abs)) {
      const root = packageRoot(abs);
      if (!root) return new InertWorker() as unknown as Worker;
      const boot = URL.createObjectURL(new Blob([spellBoot(abs, root, BUNDLED_DICTIONARIES)], { type: 'text/javascript' }));
      return new Native(boot, opts);
    }
    try {
      return new Native(url, opts);
    } catch (e) {
      if (!(e instanceof Error || e instanceof DOMException) || (e as DOMException).name !== 'SecurityError' || abs.startsWith('blob:')) throw e;
      const boot = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(abs)});`], { type: 'text/javascript' }));
      return new Native(boot, opts);
    }
  } as unknown as WorkerCtor & { __filex?: boolean };
  Guarded.prototype = Native.prototype;
  Guarded.__filex = true;
  win.Worker = Guarded;
}
