// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Editing together (filex 0.56): the session of a document several people
// have open, as the editor page sees it. It takes LocalSession's place
// (session.ts) and speaks to the bridge (bridge.ts) exactly the same way -
// the bridge cannot tell the two apart - but the log is filex's: what the
// bridge appends, asks of the lease or says about its cursor goes to the app
// page, which hands it to filex (`coedit.*`); what filex hands every member,
// in one order, comes back here as entries and goes to the bridge in that
// order, the bridge's own appends included (they come back with their place
// in the log, like everybody else's).
//
// Two things are this class's own:
//
//   - the bridge starts once its member's join is read: everything before it
//     in the log - the base's changes, the other members, their locks - is in
//     the bridge then, and its answer to the editor's auth carries all of it;
//   - an image the person inserts goes to the session (co-media-put) before
//     the change that shows it is appended: a change waits until every
//     image inserted before it is kept, so another member never applies a
//     change whose image it cannot fetch.
//
// Transport-agnostic: `out` is the way to the app page (frame/main.ts posts
// it on the frame's port), and the app page's answers are its methods.

import type { BridgeAppend, BridgeEntry, BridgeHost, BridgeMember } from './bridge';
import type { FromFrame } from './frame-protocol';
import type { EditorSide, SessionBridge } from './session';

export interface RelaySessionOptions {
  me: BridgeMember;
  /** The way to the app page. */
  out: (m: FromFrame, transfer?: Transferable[]) => void;
  /** Something that went wrong (for the frame's diagnostics). */
  notice?: (what: string, detail?: unknown) => void;
}

/** A bridge that hears other members' cursors too. */
export type RelayBridge = SessionBridge & { onCursor?(client: string, body: { cursor?: unknown }): void };

export class RelaySession {
  private bridge: RelayBridge | null = null;
  private started = false;
  private live = false;
  private lastSeq = 0;
  private changesHead = 0;
  private savedThrough = 0;
  /** Entries that came before the bridge was plugged in. */
  private readonly early: BridgeEntry[] = [];
  /** What goes to the app page goes in the bridge's order, a change after the images before it. */
  private chain: Promise<void> = Promise.resolve();
  /** Images on their way to the session, by name. */
  private readonly uploads = new Map<string, { done: Promise<boolean>; settle: (ok: boolean) => void }>();
  private leaseSeq = 0;
  private readonly leases = new Map<number, true>();
  private broken = false;

  constructor(private readonly o: RelaySessionOptions) {}

  /** The bridge's host: the log is filex's, the rest is the frame's. */
  host(side: EditorSide): BridgeHost {
    return {
      toEditor: side.toEditor,
      save: side.save,
      notice: side.notice,
      append: (a) => this.append(a),
      lease: (op, seen) => this.lease(op, seen),
      cursor: (body) => {
        if (!this.broken) this.o.out({ t: 'co-cursor', cursor: body.cursor });
      },
    };
  }

  /**
   * Plug the bridge in. The entries read so far go to it; it starts (answers
   * the editor's auth) once its member's join has been read. Once.
   */
  start(bridge: RelayBridge): void {
    if (this.started) throw new Error('office-e2e: the session has started already');
    this.started = true;
    this.bridge = bridge;
    for (const e of this.early.splice(0)) this.apply(e);
  }

  /** The last entry's seq. */
  get head(): number {
    return this.lastSeq;
  }

  /** The seq of the last changes entry. */
  get changes(): number {
    return this.changesHead;
  }

  /** The log holds changes no save has. */
  get dirty(): boolean {
    return this.changesHead > this.savedThrough;
  }

  /** The bridge has started: this member's join has been read. */
  get joined(): boolean {
    return this.live;
  }

  /**
   * A save of the document up to `through` is written. Together, the log
   * says so (filex writes the saved entry after the save); nothing to do.
   */
  saved(_through: number): void {}

  // -------------------------------------------------------------------------
  // From the app page
  // -------------------------------------------------------------------------

  /** The next entry of the session's log. */
  entry(e: BridgeEntry): void {
    if (this.broken) return;
    if (!this.bridge) {
      this.early.push(e);
      return;
    }
    this.apply(e);
  }

  /** filex's answer to a lease asked for with `id`. */
  leaseAnswer(id: number, granted: boolean): void {
    if (!this.leases.delete(id)) return;
    this.bridge?.onLease(granted);
  }

  /** Another member's cursor. */
  cursorFrom(client: string, cursor: unknown): void {
    if (client === this.o.me.client) return;
    this.bridge?.onCursor?.(client, { cursor });
  }

  /** An image this editor inserted is kept with the session, or could not be. */
  mediaStored(name: string, ok: boolean): void {
    const u = this.uploads.get(name);
    if (!u) return;
    this.uploads.delete(name);
    u.settle(ok);
    if (!ok) this.o.notice?.('image', `media/${name} was not kept with the session; the others will not see it`);
  }

  /** filex refused something this editor appended. */
  refused(kind: string, code: string): void {
    this.o.notice?.('refused', `${kind}: ${code}`);
  }

  /** The session cannot go on together (filex said `broken`): nothing more goes out or in. */
  stop(): void {
    this.broken = true;
    for (const u of this.uploads.values()) u.settle(false);
    this.uploads.clear();
  }

  // -------------------------------------------------------------------------
  // From the editor page
  // -------------------------------------------------------------------------

  /**
   * The person inserted an image (frame/images.ts): it goes to the session
   * now, and the next change waits for it.
   */
  imageInserted(name: string, bytes: ArrayBuffer | Promise<ArrayBuffer>): void {
    if (this.broken || this.uploads.has(name)) return;
    let settle: (ok: boolean) => void = () => {};
    const done = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    // Registered now, before the editor makes the change that shows it: the
    // bytes may take a turn to read (a Blob), the change must wait anyway.
    this.uploads.set(name, { done, settle });
    Promise.resolve(bytes).then(
      (b) => {
        if (!this.broken && this.uploads.has(name)) this.o.out({ t: 'co-media-put', name, bytes: b }, [b]);
      },
      () => this.mediaStored(name, false),
    );
  }

  private append(a: BridgeAppend): void {
    if (this.broken) return;
    const waitFor = a.kind === 'changes' ? [...this.uploads.values()].map((u) => u.done) : [];
    this.queue(async () => {
      if (waitFor.length) await Promise.all(waitFor);
      if (!this.broken) this.o.out({ t: 'co-append', append: a });
    });
  }

  private lease(op: 'acquire' | 'release', seen: number): void {
    if (this.broken) {
      if (op === 'acquire') this.bridge?.onLease(false);
      return;
    }
    const id = ++this.leaseSeq;
    if (op === 'acquire') this.leases.set(id, true);
    this.queue(async () => {
      this.o.out({ t: 'co-lease', id, op, seen });
    });
  }

  private queue(run: () => Promise<void>): void {
    this.chain = this.chain.then(run).catch((e) => this.o.notice?.('session', (e as Error)?.message ?? e));
  }

  private apply(e: BridgeEntry): void {
    const bridge = this.bridge;
    if (!bridge) return;
    if (e.seq !== this.lastSeq + 1) {
      // filex hands every entry once, in order; anything else is a bug, and
      // a bridge that skipped one would build another document.
      this.o.notice?.('order', `entry ${e.seq} after ${this.lastSeq}`);
      this.stop();
      return;
    }
    this.lastSeq = e.seq;
    if (e.kind === 'changes') this.changesHead = e.seq;
    if (e.kind === 'saved') this.savedThrough = Math.max(this.savedThrough, e.through);
    try {
      bridge.onEntry(e);
    } catch (err) {
      this.o.notice?.('entry', (err as Error)?.message ?? err);
      this.stop();
      return;
    }
    if (!this.live && e.kind === 'join' && e.member.client === this.o.me.client) {
      this.live = true;
      bridge.start();
    }
  }
}
