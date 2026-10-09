// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// Editing together (filex 0.56), the editor page's half (src/relay-session.ts):
// the session takes LocalSession's place in front of the real bridge, and its
// log is filex's. The relay here is a stand-in with filex's rules (one order,
// changes only under the lease, the lease only for a member that has seen
// every change), reached the way the editor page reaches it - through the
// app page's messages (co-append, co-lease, co-cursor, co-media-put) - and
// handing every member every entry, in order, a turn later.
import { describe, expect, it } from 'vitest';

import { OfficeBridge, type BridgeEntry, type BridgeMember } from '../src/bridge';
import type { FromFrame } from '../src/frame-protocol';
import { EDITOR_TYPE, type ServerMessage } from '../src/protocol';
import { RelaySession } from '../src/relay-session';

type Msg = ServerMessage & Record<string, any>;

const T = 1_700_000_000_000;

/** A turn of the event loop, and the promise chains behind it. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

interface Member {
  me: BridgeMember;
  session: RelaySession;
  bridge: OfficeBridge;
  sent: Msg[];
  out: FromFrame[];
  notices: string[];
  saves: number;
}

class Relay {
  readonly log: BridgeEntry[] = [];
  readonly members = new Map<string, Member>();
  readonly blobs = new Map<string, ArrayBuffer>();
  readonly refused: string[] = [];
  lease: string | null = null;
  changesHead = 0;
  /** Hold images back (an upload still under way). */
  holdMedia = false;
  private readonly held: { client: string; name: string }[] = [];

  private push(e: Omit<BridgeEntry, 'seq' | 'at'>): number {
    const entry = { ...e, seq: this.log.length + 1, at: T + this.log.length } as BridgeEntry;
    this.log.push(entry);
    if (entry.kind === 'changes') this.changesHead = entry.seq;
    for (const m of this.members.values()) queueMicrotask(() => m.session.entry(entry));
    return entry.seq;
  }

  /** A member joins: the log so far, then its own join, to it; its join to everybody else. */
  join(name: string, canEdit = true): Member {
    const n = this.members.size + 1;
    const me: BridgeMember = { client: `c${n}`, user: `filex-person-u${n}-`, name, indexUser: n, canEdit };
    const m = {} as Member;
    m.me = me;
    m.sent = [];
    m.out = [];
    m.notices = [];
    m.saves = 0;
    m.session = new RelaySession({
      me,
      out: (msg) => {
        m.out.push(msg);
        queueMicrotask(() => this.handle(m, msg));
      },
      notice: (w, d) => m.notices.push(`${w}: ${d}`),
    });
    m.bridge = new OfficeBridge({
      me,
      editorType: EDITOR_TYPE.document,
      build: { version: '9.4.0', number: 129 },
      documentUrls: { 'Editor.bin': 'blob:x' },
      host: m.session.host({ toEditor: (msg) => m.sent.push(msg as Msg), save: () => m.saves++ }),
    });
    for (const e of this.log) queueMicrotask(() => m.session.entry(e));
    this.members.set(me.client, m);
    this.push({ kind: 'join', client: me.client, member: me } as BridgeEntry);
    return m;
  }

  /** The editor connects and asks for its auth, the session starts. */
  open(m: Member): void {
    m.bridge.connect();
    m.bridge.fromEditor({ type: 'auth' });
    m.session.start({
      onEntry: (e) => m.bridge.onEntry(e),
      onLease: (g) => m.bridge.onLease(g),
      onCursor: (c, b) => m.bridge.onCursor(c, b),
      start: () => m.bridge.start(),
    });
  }

  leave(m: Member): void {
    this.members.delete(m.me.client);
    if (this.lease === m.me.client) this.lease = null;
    this.push({ kind: 'leave', client: m.me.client } as BridgeEntry);
  }

  releaseMedia(): void {
    this.holdMedia = false;
    for (const h of this.held.splice(0)) this.members.get(h.client)?.session.mediaStored(h.name, true);
  }

  private handle(m: Member, msg: FromFrame): void {
    const client = m.me.client;
    switch (msg.t) {
      case 'co-append': {
        if (msg.append.kind === 'changes' && this.lease !== client) {
          this.refused.push(`${client}: changes without the lease`);
          m.session.refused('changes', 'no_lease');
          return;
        }
        this.push({ ...msg.append, client } as BridgeEntry);
        return;
      }
      case 'co-lease': {
        if (msg.op === 'release') {
          if (this.lease === client) this.lease = null;
          return;
        }
        const granted = (this.lease === null || this.lease === client) && msg.seen === this.changesHead;
        if (granted) this.lease = client;
        m.session.leaseAnswer(msg.id, granted);
        return;
      }
      case 'co-cursor':
        for (const o of this.members.values()) if (o !== m) o.session.cursorFrom(client, msg.cursor);
        return;
      case 'co-media-put':
        this.blobs.set(`m.${msg.name}`, msg.bytes);
        if (this.holdMedia) this.held.push({ client, name: msg.name });
        else m.session.mediaStored(msg.name, true);
        return;
    }
  }
}

const last = (sent: Msg[], type: string) => [...sent].reverse().find((m) => m.type === type);

/** An editor's save of changes: the lease, the changes, as the editor sends them. */
async function change(m: Member, text: string): Promise<void> {
  m.bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: m.bridge.changeCount });
  await settle();
  expect(last(m.sent, 'saveLock')!.saveLock).toBe(false);
  m.bridge.fromEditor({ type: 'saveChanges', changes: JSON.stringify([text]), startSaveChanges: true, endSaveChanges: true, isCoAuthoring: true });
  await settle();
}

describe('RelaySession', () => {
  it('the bridge starts once its own join is read, with every change before it in its auth answer', async () => {
    const relay = new Relay();
    const a = relay.join('Ayşe');
    relay.open(a);
    await settle();
    expect(a.sent.map((m) => m.type)).toEqual(['license', 'auth', 'documentOpen']);
    await change(a, 'one');
    await change(a, 'two');
    const b = relay.join('Mehmet');
    // The log reaches B's session before its editor has connected: it waits.
    await settle();
    expect(b.sent).toEqual([]);
    relay.open(b);
    await settle();
    expect(b.sent.map((m) => m.type)).toEqual(['license', 'authChanges', 'auth', 'documentOpen']);
    expect(last(b.sent, 'authChanges')!.changes.map((c: { change: string }) => JSON.parse(c.change))).toEqual(['one', 'two']);
    expect(last(b.sent, 'auth')!.participants.map((p: { idOriginal: string }) => p.idOriginal)).toContain('filex-person-u1-');
    expect(b.session.joined).toBe(true);
  });

  it("its own changes come back from the log with their place: the editor's unSaveLock, the lease given back", async () => {
    const relay = new Relay();
    const a = relay.join('Ayşe');
    relay.open(a);
    await settle();
    await change(a, 'x');
    expect(last(a.sent, 'unSaveLock')).toMatchObject({ index: 0, syncChangesIndex: 1 });
    expect(a.session.changes).toBe(2);
    expect(a.session.head).toBe(2);
    expect(a.session.dirty).toBe(true);
    expect(relay.lease).toBeNull();
    // A save the log records clears it.
    a.session.entry({ seq: 3, at: T, client: 'c1', kind: 'saved', through: 2 });
    expect(a.session.dirty).toBe(false);
  });

  it('two editors through the relay hold the same changes, the same locks and the same people', async () => {
    const relay = new Relay();
    const a = relay.join('Ayşe');
    relay.open(a);
    const b = relay.join('Mehmet');
    relay.open(b);
    await settle();
    a.bridge.fromEditor({ type: 'getLock', block: ['para-1'] });
    await settle();
    await change(a, 'from A');
    b.bridge.fromEditor({ type: 'getLock', block: ['para-2'] });
    await settle();
    await change(b, 'from B');
    expect(a.bridge.changeCount).toBe(2);
    expect(b.bridge.changeCount).toBe(2);
    expect(a.bridge.lockSnapshot()).toEqual(b.bridge.lockSnapshot());
    expect(a.bridge.participants()).toEqual(b.bridge.participants());
    expect(relay.refused).toEqual([]);
    // B's changes reached A's editor as a Document Server sends them.
    expect(last(a.sent, 'saveChanges')!.changes.map((c: { change: string }) => JSON.parse(c.change))).toEqual(['from B']);
  });

  it('a lease the bridge did not ask for, or asked for twice, is not answered twice', async () => {
    const relay = new Relay();
    const a = relay.join('Ayşe');
    relay.open(a);
    await settle();
    const before = a.sent.filter((m) => m.type === 'saveLock').length;
    a.session.leaseAnswer(99, true);
    expect(a.sent.filter((m) => m.type === 'saveLock').length).toBe(before);
  });

  it('a change waits for the images inserted before it: no other member applies a change whose image is not kept', async () => {
    const relay = new Relay();
    relay.holdMedia = true;
    const a = relay.join('Ayşe');
    relay.open(a);
    await settle();
    const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
    a.session.imageInserted('image_fx0123456789abcdef.png', Promise.resolve(bytes));
    a.bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: 0 });
    await settle();
    a.bridge.fromEditor({ type: 'saveChanges', changes: JSON.stringify(['media/image_fx0123456789abcdef.png']), startSaveChanges: true, endSaveChanges: true });
    await settle();
    expect(a.out.map((m) => m.t)).toContain('co-media-put');
    expect(a.out.map((m) => m.t)).not.toContain('co-append');
    expect(relay.blobs.has('m.image_fx0123456789abcdef.png')).toBe(true);
    relay.releaseMedia();
    await settle();
    expect(a.out.map((m) => m.t)).toContain('co-append');
    expect(a.bridge.changeCount).toBe(1);
  });

  it('a lock request does not wait for an image (only changes show one)', async () => {
    const relay = new Relay();
    relay.holdMedia = true;
    const a = relay.join('Ayşe');
    relay.open(a);
    await settle();
    a.session.imageInserted('image_fx0123456789abcdef.png', new Uint8Array([1]).buffer);
    a.bridge.fromEditor({ type: 'getLock', block: ['p'] });
    await settle();
    expect(a.out.map((m) => m.t)).toContain('co-append');
  });

  it("another member's cursor reaches the editor; its own does not come back", async () => {
    const relay = new Relay();
    const a = relay.join('Ayşe');
    relay.open(a);
    const b = relay.join('Mehmet');
    relay.open(b);
    await settle();
    a.bridge.fromEditor({ type: 'cursor', cursor: 'pos-12' });
    await settle();
    expect(last(b.sent, 'cursor')!.messages[0]).toMatchObject({ cursor: 'pos-12', useridoriginal: 'filex-person-u1-' });
    expect(last(a.sent, 'cursor')).toBeUndefined();
  });

  it('one who leaves: the others see one person fewer, and its locks go', async () => {
    const relay = new Relay();
    const a = relay.join('Ayşe');
    relay.open(a);
    const b = relay.join('Mehmet');
    relay.open(b);
    await settle();
    b.bridge.fromEditor({ type: 'getLock', block: ['para-9'] });
    await settle();
    expect(Object.keys(a.bridge.lockSnapshot())).toHaveLength(1);
    relay.leave(b);
    await settle();
    expect(Object.keys(a.bridge.lockSnapshot())).toHaveLength(0);
    expect(a.bridge.participants().map((p) => p.connectionId)).toEqual(['filex-keeper', 'c1']);
  });

  it('an entry out of order stops the session rather than build another document', async () => {
    const relay = new Relay();
    const a = relay.join('Ayşe');
    relay.open(a);
    await settle();
    a.session.entry({ seq: 9, at: T, client: 'c1', kind: 'leave' });
    expect(a.notices.join()).toMatch(/order: entry 9 after 1/);
    a.bridge.fromEditor({ type: 'getLock', block: ['p'] });
    await settle();
    expect(a.out.map((m) => m.t)).not.toContain('co-append');
    // The lease is refused at once: nobody is there to answer it.
    a.bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: 0 });
    expect(last(a.sent, 'saveLock')!.saveLock).toBe(true);
  });

  it('a refusal from filex is said, not hidden', async () => {
    const relay = new Relay();
    const a = relay.join('Ayşe');
    relay.open(a);
    await settle();
    a.bridge.fromEditor({ type: 'saveChanges', changes: JSON.stringify(['x']), startSaveChanges: true, endSaveChanges: true });
    await settle();
    expect(relay.refused).toEqual(['c1: changes without the lease']);
    expect(a.notices.join()).toMatch(/refused: changes: no_lease/);
  });

  it('starts once', () => {
    const relay = new Relay();
    const a = relay.join('Ayşe');
    relay.open(a);
    expect(() => relay.open(a)).toThrow(/started/);
  });
});
