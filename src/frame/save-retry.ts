// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The editor's Save, pressed while the editor is busy.
//
// The editor sends its changes every moment it is edited, and while one
// such hand-over runs - or while it is in the middle of something else - its
// Save does nothing at all (sdkjs apiBase.js asc_Save: `if (this.canSave &&
// this._saveCheck() && this.canSendChanges())`, and nothing is kept for
// later). With a Document Server that window is a round trip; it is there
// in this app too, and measured (Chromium, 2026-10-08) a Ctrl+S pressed
// right after typing was lost - no save, and nothing told the person.
//
// So a Save the person asks for is kept until the editor has really started
// it (its "forceSaveStart" reaches the bridge), and asked again when the
// editor is free: at the end of each hand-over (the bridge's unSaveLock),
// and on a short timer, a few times at most.

interface SaveApi {
  canSave?: boolean;
  asc_Save?: (isAutoSave?: boolean, ...rest: unknown[]) => unknown;
  __filexSave?: boolean;
}

const RETRY_MS = 700;
const MAX_TRIES = 8;

export class SaveRetry {
  private pending = false;
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private api: SaveApi | null = null;
  private original: SaveApi['asc_Save'] | null = null;

  /** Wrap the editor API's asc_Save (the name the editor's interface calls it by). Once. */
  attach(api: SaveApi | null): void {
    if (!api || api.__filexSave || typeof api.asc_Save !== 'function') return;
    const original = api.asc_Save;
    const self = this;
    api.asc_Save = function (this: SaveApi, isAutoSave?: boolean, ...rest: unknown[]) {
      if (!isAutoSave) self.want();
      return original.call(this, isAutoSave, ...rest);
    };
    api.__filexSave = true;
    this.api = api;
    this.original = original;
  }

  /** A message the editor sent the bridge. */
  sent(type: unknown): void {
    if (type === 'forceSaveStart') this.done();
  }

  /** A message the bridge sends the editor: the end of a hand-over is a moment to ask again. */
  seen(type: unknown): void {
    if (type === 'unSaveLock' && this.pending) this.later(50);
  }

  private want(): void {
    this.pending = true;
    this.tries = 0;
    this.later(RETRY_MS);
  }

  private done(): void {
    this.pending = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private later(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.retry(), ms);
  }

  private retry(): void {
    this.timer = null;
    const api = this.api;
    if (!this.pending || !api || !this.original) return;
    if (this.tries >= MAX_TRIES) {
      this.pending = false;
      return;
    }
    if (api.canSave === false) {
      // A hand-over runs: its unSaveLock (or this timer) asks again.
      this.later(RETRY_MS);
      return;
    }
    this.tries++;
    this.original.call(api);
    if (this.pending) this.later(RETRY_MS);
  }
}
