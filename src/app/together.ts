// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Editing together (filex 0.56), the app page's half: the session filex keeps
// for the document (`coedit.*`, coedit-client.ts), between filex and the
// editor page (relay-session.ts holds the editor page's half).
//
//   - join: before the editor is configured, because the editor's user id is
//     the member's; filex says "no editing together here" (unavailable, not
//     granted, an older filex) and the app edits alone, as before;
//   - the base: the member that started the session puts exactly the bytes it
//     opened, every other one opens those - never the file, which may hold a
//     save of the session already, while the log applies to the base;
//   - the log: filex hands every member the same entries in the same order;
//     they go to the editor page in that order, each image another member
//     inserted ahead of the change that shows it (fetched from the session's
//     blobs, a few tries while its upload may still be under way);
//   - the editor page's appends, lease and cursor go to filex; filex's answer
//     to a lease goes back;
//   - who saves: every member folds the same log into the same answer
//     (coedit.ts foldSave) - the ten-minute version is the saver's, the last
//     writer to leave saves, and only the last writer is told "unsaved
//     changes" by filex, so closing while others edit asks nothing.
//
// No window, no filex: the tests drive it with a stand-in api.

import {
  BASE_BLOB,
  autosaveDue,
  bridgeMember,
  emptySaveState,
  foldSave,
  lastWriter,
  mediaBlobName,
  mediaNamesIn,
  saverOf,
  toBridgeEntry,
  unsaved,
  type CoEditDropped,
  type CoEditHello,
  type SaveState,
} from '../coedit';
import type { BridgeEntry, BridgeMember } from '../bridge';
import type { FromFrame, ToFrame } from '../frame-protocol';
import { ALONE_CODES, codeOf, messageOf, type CoEditApi } from './coedit-client';

/** How long apart the app page hands filex a cursor (the latest wins). */
export const CURSOR_EVERY_MS = 250;
/** How an image another member inserted is fetched while its upload may still be under way. */
export const MEDIA_TRIES_MS = [0, 250, 500, 1000, 2000, 4000, 8000];
/** How many times a join filex answers "not_ready" (the starter has not put the base yet) is tried. */
export const JOIN_TRIES = 3;

export type JoinOutcome =
  | { ok: true; hello: CoEditHello }
  /** Edit alone: filex offers no editing together here (`code`), or could not be reached. */
  | { ok: false; code: string; message: string; expected: boolean };

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Join the session of the opened file. `expected` says whether "alone" is
 * filex's plain answer (no editing together here) or something went wrong
 * (the person is told they edit alone).
 */
export async function joinSession(api: CoEditApi, sleep: (ms: number) => Promise<void> = realSleep): Promise<JoinOutcome> {
  let last: unknown = null;
  for (let i = 0; i < JOIN_TRIES; i++) {
    try {
      const hello = await api.join(0);
      if (!hello || typeof hello.session !== 'string' || !hello.me || typeof hello.me.client !== 'string') {
        return { ok: false, code: 'failed', message: 'filex answered the join with something else', expected: false };
      }
      return { ok: true, hello: { ...hello, created: hello.created === true } };
    } catch (e) {
      last = e;
      // The member that started the session has not put the base yet: filex
      // waited for it already; try again a little later.
      if (codeOf(e) === 'unavailable' && messageOf(e) === 'not_ready' && i < JOIN_TRIES - 1) {
        await sleep(2000);
        continue;
      }
      break;
    }
  }
  const code = codeOf(last) || 'failed';
  const message = messageOf(last);
  return { ok: false, code, message, expected: ALONE_CODES.includes(code) && message !== 'not_ready' };
}

export interface TogetherOptions {
  api: CoEditApi;
  hello: CoEditHello;
  /** Something for the diagnostics. */
  notice?: (what: string, detail?: unknown) => void;
  /** Who is in, what is saved, changed (the app page re-reads lastWriter, unsaved). */
  onChange?: () => void;
  /** filex stopped handing entries over (`gone`: join again; `broken`: stop). */
  onDropped?: (d: CoEditDropped) => void;
  /** filex refused an append (`no_lease`, `log_full`, `read_only`...). */
  onRefused?: (kind: string, code: string) => void;
  /** The local clock (tests). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class Together {
  readonly hello: CoEditHello;
  /** This member, as the bridge lists it (the editor is configured with its user id). */
  readonly me: BridgeMember;
  private toFrame: (m: ToFrame, transfer?: Transferable[]) => void = () => {};
  private readonly offs: (() => void)[] = [];
  private pipeline: Promise<void> = Promise.resolve();
  /**
   * The lease calls, one after another. The bridge gives the lease back as
   * its batch comes back and asks for it again for the next one at once; two
   * calls in flight together can reach filex in either order, and a release
   * that lands after the next acquire takes the lease just granted (the
   * relay's release clears its holder) - the next changes are then refused
   * (`no_lease`) and the editor waits for them for good. Measured in a real
   * filex 0.56: in an encrypted folder about one opening in two.
   */
  private leasing: Promise<unknown> = Promise.resolve();
  /** Images the editor page has (the base's, this member's own, the ones handed over). */
  private readonly media = new Set<string>();
  private save: SaveState = emptySaveState();
  /** The relay's clock minus the local one, from the last entry (for the ten-minute rule). */
  private clockSkew = 0;
  private stopped = false;
  private subscribed = false;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorNext: { cursor: unknown } | null = null;
  private cursorAt = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: TogetherOptions) {
    this.hello = o.hello;
    this.me = bridgeMember(o.hello.me);
    this.now = o.now ?? (() => Date.now());
    this.sleep = o.sleep ?? realSleep;
    this.offs.push(
      o.api.onEntry((e) => this.onEntry(e)),
      o.api.onCursor((c) => {
        if (!this.stopped && c && typeof c.client === 'string' && c.client !== this.me.client) {
          this.toFrame({ t: 'co-cursor-in', client: c.client, cursor: c.cursor });
        }
      }),
      o.api.onDropped((d) => {
        if (this.stopped) return;
        this.stopped = true;
        this.o.onDropped?.(d);
      }),
    );
  }

  /** This member started the session (it puts the base). */
  get created(): boolean {
    return this.hello.created;
  }

  /**
   * The document every member opens: the starter reads it (`read`, the
   * bytes it opened) and puts it as the session's base; everybody else
   * opens the base.
   */
  async base(read: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    if (!this.created) return this.o.api.getBlob(BASE_BLOB);
    const bytes = await read();
    await this.o.api.putBlob(BASE_BLOB, bytes.slice(0));
    return bytes;
  }

  /** The images in the base document: the editor page has them already. */
  haveMedia(names: string[]): void {
    for (const n of names) this.media.add(n);
  }

  /**
   * The editor page that holds this member's editor: its document has been
   * handed over (with `together`), so the log may start to flow. The whole
   * log, from the first entry: the bridge builds the document from it.
   */
  async attach(toFrame: (m: ToFrame, transfer?: Transferable[]) => void): Promise<void> {
    this.toFrame = toFrame;
    if (this.subscribed) return;
    this.subscribed = true;
    await this.o.api.subscribe(0);
  }

  // -------------------------------------------------------------------------
  // The log
  // -------------------------------------------------------------------------

  private onEntry(raw: unknown): void {
    if (this.stopped) return;
    const e = toBridgeEntry(raw);
    if (!e) {
      // filex checked the seal and the order; an entry the bridge cannot take
      // would leave this member's document behind everybody else's.
      this.o.notice?.('entry', 'an entry of the session is not one the editor takes');
      this.stopped = true;
      this.o.onDropped?.({ from: this.save.changesHead, reason: 'broken' });
      return;
    }
    this.pipeline = this.pipeline.then(() => this.deliver(e)).catch((err) => this.o.notice?.('entry', (err as Error)?.message ?? err));
  }

  private async deliver(e: BridgeEntry): Promise<void> {
    if (this.stopped) return;
    if (e.kind === 'changes') {
      for (const name of mediaNamesIn(e.body.changes)) {
        if (this.media.has(name)) continue;
        const bytes = await this.fetchMedia(name);
        if (this.stopped) return;
        this.media.add(name);
        if (bytes) this.toFrame({ t: 'co-media', name, bytes }, [bytes]);
        else this.o.notice?.('image', `media/${name} is not in the session; the change shows it without it`);
      }
    }
    const before = this.summary();
    this.save = foldSave(this.save, e);
    this.clockSkew = e.at - this.now();
    this.toFrame({ t: 'co-entry', entry: e });
    if (this.summary() !== before) this.o.onChange?.();
  }

  private async fetchMedia(name: string): Promise<ArrayBuffer | null> {
    for (const wait of MEDIA_TRIES_MS) {
      if (wait) await this.sleep(wait);
      if (this.stopped) return null;
      try {
        return await this.o.api.getBlob(mediaBlobName(name));
      } catch {
        // Not there yet: its upload may still be under way.
      }
    }
    return null;
  }

  private summary(): string {
    const s = this.save;
    return `${s.members.map((m) => `${m.client}:${m.canEdit}`).join(',')}|${unsaved(s)}`;
  }

  // -------------------------------------------------------------------------
  // The editor page
  // -------------------------------------------------------------------------

  /** A message of the editor page's about the session; false: not one of them. */
  fromFrame(m: FromFrame): boolean {
    switch (m.t) {
      case 'co-append':
        if (this.stopped) return true;
        this.o.api.append(m.append.kind, m.append.body).catch((e) => {
          const code = messageOf(e) || codeOf(e) || 'failed';
          this.toFrame({ t: 'co-refused', kind: m.append.kind, code });
          this.o.onRefused?.(m.append.kind, code);
        });
        return true;
      case 'co-lease':
        if (m.op === 'release') {
          if (!this.stopped) this.lease('release', m.seen).catch(() => {});
          return true;
        }
        if (this.stopped) {
          this.toFrame({ t: 'co-lease-answer', id: m.id, granted: false });
          return true;
        }
        this.lease('acquire', m.seen).then(
          (granted) => this.toFrame({ t: 'co-lease-answer', id: m.id, granted }),
          () => this.toFrame({ t: 'co-lease-answer', id: m.id, granted: false }),
        );
        return true;
      case 'co-cursor':
        this.cursor(m.cursor);
        return true;
      case 'co-media-put': {
        const name = String(m.name);
        this.media.add(name);
        if (this.stopped) {
          this.toFrame({ t: 'co-media-stored', name, ok: false });
          return true;
        }
        this.o.api.putBlob(mediaBlobName(name), m.bytes).then(
          () => this.toFrame({ t: 'co-media-stored', name, ok: true }),
          (e) => {
            this.o.notice?.('image', `media/${name}: ${messageOf(e) || codeOf(e)}`);
            this.toFrame({ t: 'co-media-stored', name, ok: false });
          },
        );
        return true;
      }
    }
    return false;
  }

  /** A lease call to filex once the one before it is answered (`leasing`). */
  private lease(op: 'acquire' | 'release', seen: number): Promise<boolean> {
    const run = this.leasing.then(() => this.o.api.lease(op, seen));
    this.leasing = run.catch(() => undefined);
    return run;
  }

  /** The latest cursor, at most every CURSOR_EVERY_MS. */
  private cursor(cursor: unknown): void {
    if (this.stopped || !this.me.canEdit) return;
    this.cursorNext = { cursor };
    if (this.cursorTimer) return;
    const wait = Math.max(0, this.cursorAt + CURSOR_EVERY_MS - this.now());
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = null;
      const next = this.cursorNext;
      this.cursorNext = null;
      if (!next || this.stopped) return;
      this.cursorAt = this.now();
      this.o.api.cursor(next.cursor);
    }, wait);
  }

  // -------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------

  /** The log as far as saving goes. */
  get state(): SaveState {
    return this.save;
  }

  /** The log holds changes no save has. */
  get unsaved(): boolean {
    return unsaved(this.save);
  }

  /** Nobody else who may write is in: this member's leaving leaves the unsaved changes to nobody. */
  get lastWriter(): boolean {
    return lastWriter(this.save, this.me.client);
  }

  /** This member writes the ten-minute versions. */
  get saver(): boolean {
    return saverOf(this.save) === this.me.client;
  }

  /** A ten-minute version is due, and it is this member's to write. */
  autosaveDue(): boolean {
    return !this.stopped && autosaveDue(this.save, this.me.client, this.now() + this.clockSkew);
  }

  /** The session goes on: filex has not dropped this member. */
  get active(): boolean {
    return !this.stopped;
  }

  /** Write a new version holding the log up to `through`; filex records it in the log. */
  saveFile(bytes: ArrayBuffer, mime: string, through: number): Promise<void> {
    return this.o.api.save(bytes, mime, through);
  }

  /** Leave the session (the editor is going away). */
  async leave(): Promise<void> {
    const was = this.stopped;
    this.dispose();
    if (!was) await this.o.api.leave().catch(() => {});
  }

  /** Stop listening; nothing more goes to the editor page. */
  dispose(): void {
    this.stopped = true;
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.cursorTimer = null;
    for (const off of this.offs.splice(0)) off();
  }
}
