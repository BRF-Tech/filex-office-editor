// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Holding the start of ONLYOFFICE's phone editors until the kept settings
// are in.
//
// The editor's pages ("main") load socket.io as a RequireJS module, and
// shim.ts installSocketIo holds that module - and with it the editor's
// start - until the kept settings (settings.ts) are in the page's storage.
// The phone editors ("mobile", web-apps/apps/*/mobile) have no RequireJS:
// their app loads its scripts itself, one after the other, each appended to
// <body> once the one before has loaded - xregexp, this script (at
// socket.io's address), then sdkjs (AllFonts.js, sdk-all-min.js) - and
// creates the editor when the last one has (9.4.0.129, read 2026-10-08).
// Holding sdkjs's scripts back until `ready` holds that start the same way.
// The scripts and the editor's code stay as they ship; the page's own
// appendChild is put back as soon as `ready` settles.

/** The scripts held back: sdkjs's (the ones the editor is created from). */
export const HELD_SCRIPTS = /\/sdkjs\//;

interface Parent {
  appendChild<T extends Node>(node: T): T;
}

function isHeld(node: unknown, held: RegExp): boolean {
  const n = node as { tagName?: unknown; src?: unknown } | null;
  return !!n && typeof n.tagName === 'string' && n.tagName.toUpperCase() === 'SCRIPT' && held.test(String(n.src ?? ''));
}

/**
 * Until `ready` settles (resolved or rejected), scripts whose address
 * matches `held` that are appended to `parent` wait, in order; everything
 * else goes in at once. False: there is no parent to watch, or it cannot be
 * watched (its appendChild cannot be defined).
 */
export function holdScripts(parent: Parent | null | undefined, ready: Promise<unknown>, held: RegExp = HELD_SCRIPTS): boolean {
  if (!parent) return false;
  const target = parent;
  const before = Object.getOwnPropertyDescriptor(target, 'appendChild');
  const original = target.appendChild;
  const waiting: Node[] = [];
  let open = false;
  const wrapper = function <T extends Node>(node: T): T {
    if (!open && isHeld(node, held)) {
      waiting.push(node);
      return node;
    }
    return original.call(target, node) as T;
  };
  // ⚠ Defined, not assigned: filex's bootstrap makes Node.prototype.appendChild
  // read-only (it wraps it to guard frames), and an inherited read-only
  // property refuses `body.appendChild = ...` ("appendChild" is read-only,
  // measured in Firefox 2026-10-08). The wrapper calls the page's own
  // appendChild - filex's guarded one.
  try {
    Object.defineProperty(target, 'appendChild', { value: wrapper, configurable: true, writable: true, enumerable: false });
  } catch {
    return false;
  }
  const release = () => {
    if (open) return;
    open = true;
    try {
      if (before) Object.defineProperty(target, 'appendChild', before);
      else Reflect.deleteProperty(target, 'appendChild');
    } catch {
      // The wrapper stays; it lets everything through now.
    }
    for (const n of waiting.splice(0)) original.call(target, n);
  };
  ready.then(release, release);
  return true;
}
