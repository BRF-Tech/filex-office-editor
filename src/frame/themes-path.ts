// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The presentation editor sets its themes' folder with a slash at the end
// ("../../../../sdkjs/slide/themes/") and then loads `path + "/themes.js"`:
// sdkjs/slide/themes//themes.js. A Document Server's nginx merges the two
// slashes; filex does not - a request with an empty path segment is refused
// (404) by design - and the presentation editor then has no theme list
// (measured, 2026-10-08). This takes the trailing slash off the path the
// editor is given, as soon as its API object exists (sdkjs sets
// window.editor in its constructor, before the editor's interface calls
// SetThemesPath).

type Api = { SetThemesPath?: ((path: unknown) => unknown) & { __filex?: boolean } };

function trim(api: Api | null | undefined): void {
  const f = api?.SetThemesPath;
  if (!api || typeof f !== 'function' || f.__filex) return;
  const wrapped = function (this: unknown, path: unknown) {
    return f.call(this, typeof path === 'string' ? path.replace(/\/+$/, '') : path);
  } as Api['SetThemesPath'] & { __filex?: boolean };
  wrapped.__filex = true;
  api.SetThemesPath = wrapped;
}

export function trimThemesPath(win: Record<string, unknown>): void {
  let value = win.editor as Api | undefined;
  trim(value);
  try {
    Object.defineProperty(win, 'editor', {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (v: Api) => {
        value = v;
        trim(v);
      },
    });
  } catch {
    // Not definable: the presentation editor goes without its theme list.
  }
}
