// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The editor page's half of keeping the editor's settings (../settings.ts):
// it sees what the editor writes to its storage and fills the storage with
// what was kept before the editor starts.
//
// The bundle's first script on every editor page (filex/storage.js) gives a
// page the browser denies storage an in-memory localStorage, as an own
// property of window. This module puts a watcher in front of that one: every
// read goes to it unchanged, every write too, and a write also tells
// `onChange` (a little later, once for a burst of writes). Where the page has
// the browser's own storage, nothing is replaced and nothing is reported:
// the browser keeps it.

type Entries = [string, string][];

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
  key(i: number): string | null;
  readonly length: number;
}

/** When a burst of writes is reported (a turn later by default; tests run it by hand). */
export type Later = (run: () => void) => void;

/** True when the page's localStorage is the bundle's stand-in (an own data property of window), not the browser's. */
export function hasStandIn(win: object): boolean {
  const d = Object.getOwnPropertyDescriptor(win, 'localStorage');
  return !!d && 'value' in d && !!d.value;
}

export class KeptStorage {
  private base: StorageLike | null = null;
  private pending = false;

  constructor(
    private readonly win: object,
    private readonly onChange: (entries: Entries) => void,
    private readonly later: Later = (run) => {
      setTimeout(run, 400);
    },
  ) {}

  /** Put the watcher in front of the stand-in. False: the page has the browser's storage (or none at all). */
  install(): boolean {
    if (this.base || !hasStandIn(this.win)) return false;
    const base = (this.win as { localStorage: StorageLike }).localStorage;
    this.base = base;
    const changed = () => this.changed();
    const own = (t: object, p: PropertyKey) => Object.prototype.hasOwnProperty.call(t, p);
    const api: Record<string, unknown> = {
      getItem: (k: string) => base.getItem(k),
      setItem: (k: string, v: string) => {
        base.setItem(k, v);
        changed();
      },
      removeItem: (k: string) => {
        base.removeItem(k);
        changed();
      },
      clear: () => {
        base.clear();
        changed();
      },
      key: (i: number) => base.key(i),
    };
    const watcher = new Proxy(api, {
      get: (t, p) => {
        if (p === 'length') return base.length;
        if (typeof p === 'symbol' || own(t, p)) return t[p as string];
        const v = base.getItem(p);
        return v === null ? undefined : v;
      },
      set: (t, p, v) => {
        if (typeof p === 'symbol' || own(t, p) || p === 'length') return true;
        base.setItem(p, String(v));
        changed();
        return true;
      },
      has: (t, p) => typeof p === 'string' && (base.getItem(p) !== null || p in t || p === 'length'),
      deleteProperty: (_t, p) => {
        if (typeof p === 'string') {
          base.removeItem(p);
          changed();
        }
        return true;
      },
      ownKeys: () => this.entries().map(([k]) => k),
      getOwnPropertyDescriptor: (_t, p) => {
        if (typeof p !== 'string') return undefined;
        const v = base.getItem(p);
        return v === null ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
      },
    });
    Object.defineProperty(this.win, 'localStorage', { value: watcher, configurable: true, enumerable: true, writable: false });
    return true;
  }

  /** What the storage holds now. */
  entries(): Entries {
    const base = this.base;
    if (!base) return [];
    const out: Entries = [];
    for (let i = 0; i < base.length; i++) {
      const k = base.key(i);
      if (k === null) continue;
      const v = base.getItem(k);
      if (v !== null) out.push([k, v]);
    }
    return out;
  }

  /** Fill the storage with kept settings, as they were: not reported back (they are kept already). */
  seed(values: Record<string, string>): void {
    const base = this.base;
    if (!base) return;
    for (const [k, v] of Object.entries(values)) {
      // Something the editor wrote in this page's first moments is newer.
      if (base.getItem(k) === null) base.setItem(k, v);
    }
  }

  private changed(): void {
    if (this.pending) return;
    this.pending = true;
    this.later(() => {
      this.pending = false;
      this.onChange(this.entries());
    });
  }
}
