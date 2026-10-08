// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// One person, no relay: the session log of a document only this editor has
// open. The bridge (bridge.ts) is written against filex's relay - one order
// for everybody, changes only under the lease, the lease only for a member
// that has seen every change - and this class keeps exactly those rules for
// a single member, in the editor's frame. The bridge cannot tell the
// difference, so the editor answers the same way alone as with others, and
// the relay can take this class's place (co-editing, plan step A6) without
// a change to the bridge.
//
// Nothing is kept here but counters: the bridge holds the changes (it hands
// them to an editor that reconnects), and the document itself is the
// editor's. A save is the frame's work; this class only learns how far it
// reached (saved()), which is what makes the bridge "dirty" or not.

import type { BridgeAppend, BridgeEntry, BridgeHost, BridgeMember } from './bridge';

/** The bridge, as far as the session drives it. */
export interface SessionBridge {
  onEntry(e: BridgeEntry): void;
  onLease(granted: boolean): void;
  start(): void;
}

/** When queued work runs (a turn later by default; tests run it by hand). */
export type SessionDefer = (run: () => void) => void;

export interface LocalSessionOptions {
  me: BridgeMember;
  now?: () => number;
  defer?: SessionDefer;
  /** Something the session refused (a bug in the bridge or the frame). */
  notice?: (what: string, detail?: unknown) => void;
}

/** What the frame gives the bridge's host besides the log. */
export type EditorSide = Pick<BridgeHost, 'toEditor' | 'save' | 'notice'>;

export class LocalSession {
  private bridge: SessionBridge | null = null;
  private lastSeq = 0;
  /** The seq of the last changes entry: the lease goes only to a bridge that has seen it. */
  private changesHead = 0;
  private savedThrough = 0;
  private holder: string | null = null;
  private started = false;
  private readonly queue: (() => void)[] = [];
  private draining = false;
  private readonly now: () => number;
  private readonly defer: SessionDefer;

  constructor(private readonly o: LocalSessionOptions) {
    this.now = o.now ?? (() => Date.now());
    this.defer = o.defer ?? ((run) => setTimeout(run, 0));
  }

  /** The bridge's host: the log is this session, the rest is the frame's. */
  host(side: EditorSide): BridgeHost {
    return {
      toEditor: side.toEditor,
      save: side.save,
      notice: side.notice,
      append: (a) => this.post(() => this.append(a)),
      lease: (op, seen) => this.post(() => this.lease(op, seen)),
      // Nobody else to show a cursor to.
      cursor: () => {},
    };
  }

  /**
   * Plug the bridge in and open the session: its member joins, and the
   * bridge, having read the whole log (its own join), answers the editor's
   * auth. Once.
   */
  start(bridge: SessionBridge): void {
    if (this.started) throw new Error('office-e2e: the session has started already');
    this.started = true;
    this.bridge = bridge;
    this.push({ kind: 'join', member: this.o.me });
    bridge.start();
  }

  /** The last entry's seq. */
  get head(): number {
    return this.lastSeq;
  }

  /** The seq of the last changes entry (0: no change since the document was opened). */
  get changes(): number {
    return this.changesHead;
  }

  /** True when there are changes no save has. */
  get dirty(): boolean {
    return this.changesHead > this.savedThrough;
  }

  /**
   * A save of the document as it was at `through` (the head when its
   * snapshot was taken) is written: the log says so, which tells the
   * bridge what is saved.
   */
  saved(through: number): void {
    if (!this.started || through <= this.savedThrough) return;
    const t = Math.min(through, this.lastSeq);
    this.savedThrough = t;
    this.post(() => this.push({ kind: 'saved', through: t }));
  }

  private post(run: () => void): void {
    this.queue.push(run);
    if (this.draining) return;
    this.draining = true;
    this.defer(() => {
      try {
        while (this.queue.length > 0) this.queue.shift()?.();
      } finally {
        this.draining = false;
      }
    });
  }

  private push(body: BridgeAppend | { kind: 'join'; member: BridgeMember } | { kind: 'saved'; through: number }): void {
    const seq = this.lastSeq + 1;
    this.lastSeq = seq;
    const e = { seq, at: this.now(), client: this.o.me.client, ...body } as BridgeEntry;
    if (e.kind === 'changes') this.changesHead = seq;
    this.bridge?.onEntry(e);
  }

  private append(a: BridgeAppend): void {
    // The relay's rule: changes only from the lease's holder. The bridge
    // asks for the lease before it lets the editor send, so a refusal here
    // is a bug - said, not hidden, and the changes do not land.
    if (a.kind === 'changes' && this.holder !== this.o.me.client) {
      this.o.notice?.('refused', 'changes without the lease');
      return;
    }
    this.push(a);
  }

  private lease(op: 'acquire' | 'release', seen: number): void {
    const me = this.o.me.client;
    if (op === 'release') {
      if (this.holder === me) this.holder = null;
      return;
    }
    const granted = (this.holder === null || this.holder === me) && seen === this.changesHead;
    if (granted) this.holder = me;
    this.bridge?.onLease(granted);
  }
}
