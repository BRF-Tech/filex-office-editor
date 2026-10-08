// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// ONLYOFFICE's two pages - api.js in the page that embeds the editor, and
// the editor's Gateway in the editor's frame - take each other's messages
// only when `event.origin` is the origin of the other's ADDRESS (api.js:
// the frame's src; the Gateway: the parentOrigin it was given, from the
// embedding page's location.origin). Under filex every page is an opaque
// origin (sandbox allow-scripts): its location still says
// https://files.example.com, but the messages it sends carry the origin
// "null" - so each side would drop every message of the other, and the
// editor would never get its configuration (measured, Chromium 2026-10-08:
// the editor sat at its loading screen with "init" and "openDocument"
// received and ignored).
//
// This hands such a message on to the page's own listeners with the origin
// they expect, and only when it comes from the one window it should come
// from (event.source, the object - which says more than an origin, "null"
// for every sandboxed page, ever could). ONLYOFFICE's files stay as they
// ship. A message from anywhere else, or one that already carries a real
// origin, is left exactly as it is.

/**
 * Listen first (capture, registered before ONLYOFFICE's listeners) for
 * string messages from `peer()` with the origin "null", and dispatch them
 * again with `origin()`.
 */
export function adaptOpaqueOrigin(win: Window, peer: () => Window | null | undefined, origin: () => string | null): void {
  win.addEventListener(
    'message',
    (ev: MessageEvent) => {
      if (!ev.isTrusted || ev.origin !== 'null' || typeof ev.data !== 'string') return;
      const from = peer();
      if (!from || ev.source !== from) return;
      const o = origin();
      if (!o || o === 'null') return;
      ev.stopImmediatePropagation();
      let again: MessageEvent;
      try {
        again = new MessageEvent('message', { data: ev.data, origin: o, source: ev.source });
      } catch {
        // Firefox will not put a window of another origin in a MessageEvent
        // made by a page ("could not be converted to WindowProxy"). Neither
        // api.js nor the Gateway reads `source`; the event goes without it.
        again = new MessageEvent('message', { data: ev.data, origin: o });
      }
      win.dispatchEvent(again);
    },
    true,
  );
}
