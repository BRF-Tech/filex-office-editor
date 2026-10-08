// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The editor pages load their interface templates while they run, with
// RequireJS's text plugin ("text!.../ParagraphSettings.template"). filex
// serves no .template file, so the bundle carries them as .template.txt
// (scripts/editor/rules.mjs) and this asks for that name - through the
// plugin's own setting for the request it makes (text.createXhr), so the
// plugin and the editor's code stay as they ship.

/** A template's address, as the bundle serves it: ".template" becomes ".template.txt", the query stays. */
export function templateUrl(url: string): string {
  return url.replace(/\.template(?=$|[?#])/, '.template.txt');
}

type Xhr = XMLHttpRequest & { open: (...args: unknown[]) => void };

/** An XMLHttpRequest that asks for a template under the name the bundle serves it with. */
export function templateXhr(): XMLHttpRequest {
  const xhr = new XMLHttpRequest() as Xhr;
  const open = xhr.open;
  xhr.open = function (this: XMLHttpRequest, method: unknown, url: unknown, ...rest: unknown[]) {
    return (open as (...a: unknown[]) => void).call(this, method, typeof url === 'string' ? templateUrl(url) : url, ...rest);
  } as Xhr['open'];
  return xhr;
}

interface RequireJs {
  config?: (c: Record<string, unknown>) => void;
  defined?: (id: string) => boolean;
  (id: string): unknown;
}

/**
 * Set the text plugin up before it loads (its configuration is read once,
 * when it is defined); if it has loaded already, set the loaded one.
 */
export function serveTemplatesAsTxt(win: Record<string, unknown>): void {
  const req = (win.requirejs ?? win.require) as RequireJs | undefined;
  if (typeof req !== 'function') return;
  try {
    req.config?.({ config: { text: { createXhr: templateXhr } } });
    if (req.defined?.('text')) {
      const text = req('text') as { createXhr?: () => XMLHttpRequest } | undefined;
      if (text) text.createXhr = templateXhr;
    }
  } catch {
    // Without it the templates do not load, and the editor says so.
  }
}
