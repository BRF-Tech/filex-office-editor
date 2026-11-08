// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The live viewer and ONLYOFFICE 10.0's view mode.
//
// Editing together, a member who may only read the file follows the others'
// changes as they land: ONLYOFFICE's live viewer (bridge.ts
// liveViewerSupport), which applies them only while fast co-editing is on
// (sdkjs baseEditorsApi.isLiveViewer, asc_docs_api._autoSaveInner).
// web-apps turns it on for the live viewer when the document is ready
// (Main.onDocumentContentReady: asc_SetFastCollaborative).
//
// 10.0's text editor puts a document in view mode into the review display
// "Original" too (asc_setViewMode(true): SetDisplayModeInReview), and that
// turns fast co-editing off (CDocument.BeginViewModeInReview: Set_Fast(false)).
// The editor runs asc_setViewMode itself once its whole API has loaded; here
// that came after web-apps had turned fast co-editing on, so the watcher's
// editor showed none of the changes it held (measured 2026-11-08, Chromium:
// fast co-editing off 144 ms after web-apps turned it on, by the editor's
// own asc_setViewMode; on again by hand, the changes showed). So after each
// asc_setViewMode(true) the choice web-apps made is made again - only when it
// chose fast co-editing, which for a reader it does only for the live viewer.
//
// Reported upstream: https://github.com/ONLYOFFICE/DocumentServer/issues/3900
// (2026-11-08). When a release fixes it there, this workaround can go.

import { keysOf } from './sdk';

interface ViewApi {
  asc_setViewMode?: (isViewMode: boolean, ...rest: unknown[]) => unknown;
  asc_SetFastCollaborative?: (on: boolean) => unknown;
  __fxViewMode?: boolean;
}

/**
 * Wrap the editor API's asc_setViewMode, under each key it has (10.0 calls
 * it by its renamed one), so that after view mode is set the editor is in
 * fast co-editing again whenever `fastChosen()` says web-apps chose it. Once.
 */
export function keepLiveViewing(api: ViewApi | null, fastChosen: () => boolean): void {
  if (!api || api.__fxViewMode || typeof api.asc_setViewMode !== 'function') return;
  const original = api.asc_setViewMode;
  const wrapped = function (this: ViewApi, isViewMode: boolean, ...rest: unknown[]) {
    const out = original.call(this, isViewMode, ...rest);
    if (isViewMode) {
      try {
        if (fastChosen()) this.asc_SetFastCollaborative?.(true);
      } catch {
        // The editor went away meanwhile.
      }
    }
    return out;
  };
  for (const k of new Set(['asc_setViewMode', ...keysOf(api, original)])) (api as Record<string, unknown>)[k] = wrapped;
  api.__fxViewMode = true;
}

/** web-apps' setting for its choice of co-editing mode, per editor (Main.loadCoAuthSettings). */
const COAUTH_SETTING = { word: 'de-settings-coauthmode', cell: 'sse-settings-coauthmode', slide: 'pe-settings-coauthmode' } as const;

/** Whether web-apps chose fast co-editing (its Common.Utils.InternalSettings); false where it has no such setting (the phone apps). */
export function webAppsChoseFast(win: Record<string, unknown>, kind: keyof typeof COAUTH_SETTING): boolean {
  const common = win.Common as { Utils?: { InternalSettings?: { get?: (k: string) => unknown } } } | undefined;
  const get = common?.Utils?.InternalSettings?.get;
  return typeof get === 'function' && get.call(common!.Utils!.InternalSettings, COAUTH_SETTING[kind]) === true;
}
