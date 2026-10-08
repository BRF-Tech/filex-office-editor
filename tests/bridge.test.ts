// SPDX-License-Identifier: AGPL-3.0-only
// Tests for packages/office-e2e (AGPL-3.0-only, see its README.md).
//
// The bridge (task #189): a Document Server for one ONLYOFFICE editor, whose
// "database" is the session's log. Two things are under test:
//
//   1. it answers the editor's messages the way DocsCoServer.js (Docs 9.4)
//      does - the order of the opening messages, the answers to a save, the
//      locks, who is in the document - because the editor runs unchanged and
//      was written against that server;
//   2. several bridges reading the same log end up with the same document,
//      the same locks and the same people, and no editor ever sends changes
//      built on a document that lacks somebody else's changes (the lease).
//
// The relay here is a stand-in with the real relay's rules
// (backend/internal/e2eoffice): one order, changes only under the lease, the
// lease only for a member that has seen every change.
import { describe, expect, it } from 'vitest';

import {
  KEEPER_INDEX,
  KEEPER_USER,
  OfficeBridge,
  type BridgeAppend,
  type BridgeEntry,
  type BridgeMember,
} from '../src/bridge';
import { EDITOR_TYPE, type EditorType, type ServerMessage, type StoredChange } from '../src/protocol';

type Msg = ServerMessage & Record<string, any>;

interface Editor {
  name: string;
  member: BridgeMember;
  bridge: OfficeBridge;
  inbox: Msg[];
  /** Every message the bridge sent this editor, in order. */
  seen: Msg[];
  /** The document's changes as this editor knows them, in the order it got them. */
  model: string[];
  pending: string[];
  asked: boolean;
  saving: boolean;
  saves: number;
}

const BUILD = { version: '9.4.0', number: 129 };

class Session {
  readonly log: BridgeEntry[] = [];
  readonly editors = new Map<string, Editor>();
  readonly queue: { client: string; a: BridgeAppend }[] = [];
  readonly paused = new Set<string>();
  readonly refused: string[] = [];
  readonly notices: { who: string; what: string; detail?: unknown }[] = [];
  /** Saves sent by an editor that did not know every change in the log. */
  readonly stale: string[] = [];
  holder: string | null = null;
  changesHead = 0;
  now = 1_000_000;
  private readonly delivered = new Map<string, number>();
  private n = 0;

  constructor(readonly editorType: EditorType = EDITOR_TYPE.document) {}

  private tick(): number {
    this.now += 1000;
    return this.now;
  }

  join(name: string, canEdit = true): Editor {
    this.n++;
    const member: BridgeMember = { client: `c${this.n}`, user: `u${this.n}-`, name, indexUser: this.n, canEdit };
    this.push({ seq: this.log.length + 1, at: this.tick(), client: member.client, kind: 'join', member });
    const ed: Editor = {
      name,
      member,
      bridge: undefined as unknown as OfficeBridge,
      inbox: [],
      seen: [],
      model: [],
      pending: [],
      asked: false,
      saving: false,
      saves: 0,
    };
    ed.bridge = new OfficeBridge({
      me: member,
      editorType: this.editorType,
      build: BUILD,
      documentUrls: { 'Editor.bin': 'blob:base', 'media/image1.png': 'blob:img' },
      docId: 'doc',
      now: () => this.now,
      host: {
        toEditor: (m) => {
          ed.inbox.push(m as Msg);
          ed.seen.push(m as Msg);
        },
        append: (a) => this.queue.push({ client: member.client, a }),
        lease: (op, seen) => {
          if (op === 'release') {
            if (this.holder === member.client) this.holder = null;
            return;
          }
          const granted = (this.holder === null || this.holder === member.client) && seen === this.changesHead;
          if (granted) this.holder = member.client;
          ed.bridge.onLease(granted);
        },
        cursor: (b) => {
          for (const o of this.editors.values()) if (o !== ed) o.bridge.onCursor(member.client, b);
        },
        save: () => {
          ed.saves++;
        },
        notice: (what, detail) => this.notices.push({ who: name, what, detail }),
      },
    });
    this.editors.set(member.client, ed);
    this.delivered.set(member.client, 0);
    this.deliver(member.client);
    ed.bridge.start();
    ed.bridge.connect();
    ed.bridge.fromEditor({ type: 'auth' });
    return ed;
  }

  leave(ed: Editor): void {
    this.editors.delete(ed.member.client);
    if (this.holder === ed.member.client) this.holder = null;
    this.push({ seq: this.log.length + 1, at: this.tick(), client: ed.member.client, kind: 'leave' });
  }

  /** The relay takes the queued appends in order. */
  flush(): void {
    while (this.queue.length > 0) {
      const { client, a } = this.queue.shift()!;
      if (!this.editors.has(client)) continue;
      if (a.kind === 'changes' && this.holder !== client) {
        this.refused.push(client);
        continue;
      }
      const seq = this.log.length + 1;
      this.push({ seq, at: this.tick(), client, ...a } as BridgeEntry);
      if (a.kind === 'changes') this.changesHead = seq;
    }
  }

  private push(e: BridgeEntry): void {
    this.log.push(e);
    for (const c of this.editors.keys()) this.deliver(c);
  }

  deliver(client: string): void {
    if (this.paused.has(client)) return;
    const ed = this.editors.get(client);
    if (!ed) return;
    let n = this.delivered.get(client) ?? 0;
    while (n < this.log.length) {
      ed.bridge.onEntry(this.log[n]);
      n++;
      this.delivered.set(client, n);
    }
  }

  resume(ed: Editor): void {
    this.paused.delete(ed.member.client);
    this.deliver(ed.member.client);
  }

  /** The document's changes in the log's order. */
  logChanges(): string[] {
    const out: string[] = [];
    for (const e of this.log) if (e.kind === 'changes') out.push(...(e.body.changes as string[]));
    return out;
  }

  /** An editor reads its messages the way sdkjs does, as far as these tests need. */
  process(ed: Editor): void {
    for (const m of ed.inbox.splice(0)) {
      switch (m.type) {
        case 'authChanges':
        case 'saveChanges':
          for (const c of m.changes as StoredChange[]) ed.model.push(JSON.parse(c.change) as string);
          break;
        case 'saveLock':
          ed.asked = false;
          if (m.saveLock === false && ed.pending.length > 0) this.send(ed);
          else if (m.saveLock === false) ed.bridge.fromEditor({ type: 'unSaveLock' });
          break;
        case 'unSaveLock':
          if (m.index !== -1 || m.syncChangesIndex !== -1) ed.saving = false;
          break;
      }
    }
    if (ed.pending.length > 0 && !ed.asked && !ed.saving) this.ask(ed);
  }

  ask(ed: Editor): void {
    ed.asked = true;
    ed.bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: ed.model.length });
  }

  /** Granted: send what is pending, in one or two chunks, as the editor does. */
  private send(ed: Editor): void {
    if (ed.model.length !== this.logChanges().length) this.stale.push(ed.name);
    const changes = ed.pending.splice(0);
    ed.model.push(...changes);
    ed.saving = true;
    const chunks = changes.length > 1 ? [changes.slice(0, 1), changes.slice(1)] : [changes];
    chunks.forEach((chunk, i) => {
      ed.bridge.fromEditor({
        type: 'saveChanges',
        changes: JSON.stringify(chunk),
        startSaveChanges: i === 0,
        endSaveChanges: i === chunks.length - 1,
        isCoAuthoring: true,
        isExcel: false,
        deleteIndex: null,
        excelAdditionalInfo: null,
        unlock: false,
        releaseLocks: i === chunks.length - 1,
      });
    });
  }

  type(ed: Editor, ...changes: string[]): void {
    ed.pending.push(...changes);
  }
}

const types = (ed: Editor) => ed.seen.map((m) => m.type);
const last = (ed: Editor, type: string) => [...ed.seen].reverse().find((m) => m.type === type);

describe('opening', () => {
  it('license on connect; on auth: authChanges, auth, documentOpen, in that order', () => {
    const s = new Session();
    const a = s.join('Ayşe');
    expect(types(a)).toEqual(['license', 'auth', 'documentOpen']);
    expect(a.seen[0].license).toMatchObject({ type: 3, buildVersion: '9.4.0', buildNumber: 129 });
    const auth = last(a, 'auth')!;
    expect(auth).toMatchObject({ result: 1, indexUser: 1, buildVersion: '9.4.0', buildNumber: 129, licenseType: 3, locks: {} });
    expect(last(a, 'documentOpen')!.data).toEqual({
      type: 'open',
      status: 'ok',
      data: { 'Editor.bin': 'blob:base', 'media/image1.png': 'blob:img' },
    });
  });

  it('the keeper is always in the list, so the editor never thinks it is alone', () => {
    const s = new Session();
    const a = s.join('Ayşe');
    const people = last(a, 'auth')!.participants as { id: string; idOriginal: string; indexUser: number; view: boolean }[];
    expect(people[0]).toMatchObject({ id: `${KEEPER_USER}${KEEPER_INDEX}`, indexUser: 0, view: false });
    expect(people[1]).toMatchObject({ id: 'u1-1', idOriginal: 'u1-', indexUser: 1, view: false });
  });

  it('an auth that comes before the log is read waits for it', () => {
    const member: BridgeMember = { client: 'c1', user: 'u1-', name: 'A', indexUser: 1, canEdit: true };
    const sent: Msg[] = [];
    const b = new OfficeBridge({
      me: member,
      editorType: EDITOR_TYPE.document,
      build: BUILD,
      documentUrls: { 'Editor.bin': 'blob:x' },
      host: { toEditor: (m) => sent.push(m as Msg), append: () => {}, lease: () => {}, cursor: () => {}, save: () => {} },
    });
    b.fromEditor({ type: 'auth' });
    expect(sent).toEqual([]);
    b.onEntry({ seq: 1, at: 1, client: 'c1', kind: 'join', member });
    b.start();
    expect(sent.map((m) => m.type)).toEqual(['auth', 'documentOpen']);
  });

  it('a late joiner gets every change so far as authChanges, and the locks held', () => {
    const s = new Session();
    const a = s.join('A');
    a.bridge.fromEditor({ type: 'getLock', block: ['p1'] });
    s.flush();
    s.process(a);
    s.type(a, 'a1', 'a2', 'a3');
    s.process(a);
    s.process(a);
    s.flush();
    s.process(a);
    const c = s.join('C');
    const auth = types(c);
    expect(auth.slice(0, 2)).toEqual(['license', 'authChanges']);
    const changes = c.seen.filter((m) => m.type === 'authChanges').flatMap((m) => m.changes as StoredChange[]);
    expect(changes.map((x) => JSON.parse(x.change))).toEqual(['a1', 'a2', 'a3']);
    expect(changes[0]).toMatchObject({ docid: 'doc', user: 'u1-1', useridoriginal: 'u1-' });
    // a's last chunk released its locks.
    expect(last(c, 'auth')!.locks).toEqual({});
  });

  it('cuts authChanges into chunks the way the server does', () => {
    const s = new Session();
    const a = s.join('A');
    s.type(a, ...Array.from({ length: 40 }, (_, i) => `change-${i}-${'x'.repeat(50)}`));
    s.process(a);
    s.process(a);
    s.flush();
    const member: BridgeMember = { client: 'c9', user: 'u9-', name: 'Z', indexUser: 9, canEdit: true };
    const sent: Msg[] = [];
    const b = new OfficeBridge({
      me: member,
      editorType: EDITOR_TYPE.document,
      build: BUILD,
      documentUrls: {},
      maxPayload: 500,
      host: { toEditor: (m) => sent.push(m as Msg), append: () => {}, lease: () => {}, cursor: () => {}, save: () => {} },
    });
    for (const e of s.log) b.onEntry(e);
    b.onEntry({ seq: s.log.length + 1, at: 1, client: 'c9', kind: 'join', member });
    b.start();
    b.fromEditor({ type: 'auth' });
    const chunks = sent.filter((m) => m.type === 'authChanges');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((m) => m.changes as StoredChange[])).toHaveLength(40);
  });
});

describe('locks', () => {
  it('a request goes into the log and its answer comes from there, to everybody who writes', () => {
    const s = new Session();
    const a = s.join('A');
    const b = s.join('B');
    a.bridge.fromEditor({ type: 'getLock', block: ['p1'] });
    expect(last(a, 'getLock')).toBeUndefined();
    s.flush();
    expect(last(a, 'getLock')!.locks.p1).toMatchObject({ user: 'u1-1', block: 'p1' });
    expect(last(b, 'getLock')!.locks.p1).toMatchObject({ user: 'u1-1' });
  });

  it('two editors asking for the same paragraph at once: exactly one gets it, and both are told which', () => {
    const s = new Session();
    const a = s.join('A');
    const b = s.join('B');
    b.bridge.fromEditor({ type: 'getLock', block: ['p1'] });
    a.bridge.fromEditor({ type: 'getLock', block: ['p1'] });
    s.flush();
    // b's request reached the relay first: b holds it, in both editors.
    expect(last(a, 'getLock')!.locks.p1.user).toBe('u2-2');
    expect(last(b, 'getLock')!.locks.p1.user).toBe('u2-2');
    expect(a.bridge.lockSnapshot()).toEqual(b.bridge.lockSnapshot());
  });

  it('unLockDocument releases the writer\'s locks for everybody', () => {
    const s = new Session();
    const a = s.join('A');
    const b = s.join('B');
    a.bridge.fromEditor({ type: 'getLock', block: ['p1', 'p2'] });
    s.flush();
    a.bridge.fromEditor({ type: 'unLockDocument', releaseLocks: true, isSave: false, deleteIndex: null });
    s.flush();
    for (const ed of [a, b]) {
      const rel = last(ed, 'releaseLock')!;
      expect((rel.locks as { block: string; changes: null }[]).map((l) => l.block)).toEqual(['p1', 'p2']);
      expect(ed.bridge.lockSnapshot()).toEqual({});
    }
  });

  it('a member that leaves takes its locks with it, and the others are told', () => {
    const s = new Session();
    const a = s.join('A');
    const b = s.join('B');
    b.bridge.fromEditor({ type: 'getLock', block: ['p7'] });
    s.flush();
    s.leave(b);
    const state = last(a, 'connectState')!;
    expect((state.participants as { id: string }[]).map((p) => p.id)).toEqual([`${KEEPER_USER}${KEEPER_INDEX}`, 'u1-1']);
    expect(last(a, 'releaseLock')!.locks[0]).toMatchObject({ block: 'p7', user: 'u2-2', changes: null });
    expect(a.bridge.lockSnapshot()).toEqual({});
  });
});

describe('saving changes', () => {
  it('isSaveLock is the lease: the first writer gets it, a second one is told to wait', () => {
    const s = new Session();
    const a = s.join('A');
    const b = s.join('B');
    a.bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: 0 });
    b.bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: 0 });
    expect(last(a, 'saveLock')!.saveLock).toBe(false);
    expect(last(b, 'saveLock')!.saveLock).toBe(true);
  });

  it('an editor that has not received every change is not synced and waits', () => {
    const s = new Session();
    const a = s.join('A');
    const b = s.join('B');
    s.type(a, 'a1');
    s.process(a);
    s.process(a);
    s.flush();
    // b's editor claims to know 0 changes while its bridge has passed it 1.
    b.bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: 0 });
    expect(last(b, 'saveLock')).toBeUndefined();
    b.bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: 5 });
    expect(last(b, 'saveLock')!.saveLock).toBe(true);
  });

  it('a writer whose bridge has not seen the latest changes does not get the lease', () => {
    const s = new Session();
    const a = s.join('A');
    const b = s.join('B');
    s.paused.add(b.member.client);
    s.type(a, 'a1');
    s.process(a);
    s.process(a);
    s.flush();
    s.process(a);
    expect(s.holder).toBeNull();
    s.ask(b);
    expect(last(b, 'saveLock')!.saveLock).toBe(true);
    s.resume(b);
    s.process(b);
    s.ask(b);
    expect(last(b, 'saveLock')!.saveLock).toBe(false);
  });

  it('answers each chunk as the server does: savePartChanges, then unSaveLock; the others get saveChanges', () => {
    const s = new Session();
    const a = s.join('A');
    const b = s.join('B');
    a.bridge.fromEditor({ type: 'getLock', block: ['p1'] });
    s.flush();
    s.type(a, 'a1', 'a2');
    s.process(a);
    s.process(a);
    s.flush();
    const part = a.seen.find((m) => m.type === 'savePartChanges')!;
    expect(part).toEqual({ type: 'savePartChanges', changesIndex: 0, syncChangesIndex: 1 });
    const done = last(a, 'unSaveLock')!;
    expect(done).toMatchObject({ index: -1, syncChangesIndex: 2 });
    expect(done.time % 1000).toBe(0);
    expect(s.holder).toBeNull();

    const got = b.seen.filter((m) => m.type === 'saveChanges');
    expect(got.map((m) => m.endSaveChanges)).toEqual([false, true]);
    expect(got[1]).toMatchObject({ changesIndex: 2, syncChangesIndex: 2 });
    expect(got[1].locks).toEqual([expect.objectContaining({ block: 'p1', user: 'u1-1', changes: null })]);
    expect(got.flatMap((m) => (m.changes as StoredChange[]).map((c) => JSON.parse(c.change)))).toEqual(['a1', 'a2']);
  });

  it('changes sent without the lease never land', () => {
    const s = new Session();
    const a = s.join('A');
    a.bridge.fromEditor({ type: 'saveChanges', changes: JSON.stringify(['x']), startSaveChanges: true, endSaveChanges: true });
    s.flush();
    expect(s.refused).toEqual([a.member.client]);
    expect(s.logChanges()).toEqual([]);
  });

  it('unLockDocument with isSave gives the lease back', () => {
    const s = new Session();
    const a = s.join('A');
    const b = s.join('B');
    a.bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: 0 });
    a.bridge.fromEditor({ type: 'unLockDocument', isSave: true });
    expect(last(a, 'unSaveLock')).toMatchObject({ index: -1, time: -1, syncChangesIndex: -1 });
    b.bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: 0 });
    expect(last(b, 'saveLock')!.saveLock).toBe(false);
  });

  it('Save: nothing to save is "not modified"; otherwise the frame saves and the editor hears the result', () => {
    const s = new Session();
    const a = s.join('A');
    a.bridge.fromEditor({ type: 'forceSaveStart' });
    expect(last(a, 'forceSaveStart')!.messages).toMatchObject({ code: 4 });
    s.type(a, 'a1');
    s.process(a);
    s.process(a);
    s.flush();
    a.bridge.fromEditor({ type: 'forceSaveStart' });
    const start = last(a, 'forceSaveStart')!.messages as { code: number; time: number };
    expect(start.code).toBe(0);
    expect(a.saves).toBe(1);
    a.bridge.saved(true);
    expect(last(a, 'forceSave')!.messages).toEqual({ type: 1, time: start.time, success: true });
    // The save is recorded in the log: nothing is unsaved any more.
    s.log.push({ seq: s.log.length + 1, at: s.now, client: a.member.client, kind: 'saved', through: s.log.length });
    s.deliver(a.member.client);
    expect(a.bridge.dirty).toBe(false);
  });
});

describe('people', () => {
  it('a join and a leave are connectState for the others', () => {
    const s = new Session();
    const a = s.join('A');
    s.join('B', false);
    const joined = last(a, 'connectState')!;
    expect(joined.waitAuth).toBe(false);
    expect((joined.participants as { id: string; view: boolean }[]).find((p) => p.id === 'u2-2')).toMatchObject({ view: true });
  });

  it('a cursor goes to the others, with its writer, and not back', () => {
    const s = new Session();
    const a = s.join('A');
    const b = s.join('B');
    a.bridge.fromEditor({ type: 'cursor', cursor: '1;2;3' });
    expect(last(b, 'cursor')!.messages).toEqual([{ cursor: '1;2;3', time: s.now, user: 'u1-1', useridoriginal: 'u1-' }]);
    expect(last(a, 'cursor')).toBeUndefined();
  });

  it('a member that may not write sends no lock, no change and no save', () => {
    const s = new Session();
    const v = s.join('V', false);
    v.bridge.fromEditor({ type: 'getLock', block: ['p1'] });
    v.bridge.fromEditor({ type: 'saveChanges', changes: '["x"]', startSaveChanges: true, endSaveChanges: true });
    v.bridge.fromEditor({ type: 'isSaveLock' });
    v.bridge.fromEditor({ type: 'forceSaveStart' });
    expect(s.queue).toEqual([]);
    expect(last(v, 'saveLock')!.saveLock).toBe(true);
    expect(last(v, 'forceSaveStart')!.messages).toMatchObject({ code: 3 });
    expect(s.notices.filter((n) => n.what === 'read-only')).toHaveLength(2);
  });
});

describe('what the bridge refuses to guess', () => {
  it('an entry out of order stops it', () => {
    const s = new Session();
    const a = s.join('A');
    expect(() => a.bridge.onEntry({ seq: 9, at: 1, client: 'c1', kind: 'leave' })).toThrow(/entry 9 after 1/);
  });

  it('an entry from somebody who never joined stops it', () => {
    const s = new Session();
    const a = s.join('A');
    expect(() => a.bridge.onEntry({ seq: 2, at: 1, client: 'c7', kind: 'lock', body: { blocks: ['p'] } })).toThrow(/never joined/);
  });

  it('says what it does not do yet instead of answering wrongly', () => {
    const s = new Session();
    const a = s.join('A');
    a.bridge.fromEditor({ type: 'openDocument', message: { c: 'imgurls' } });
    a.bridge.fromEditor({ type: 'saveChanges', changes: [1, 2, 3] });
    expect(s.notices.map((n) => [n.what, n.detail])).toEqual([
      ['unsupported', 'openDocument'],
      ['unsupported', 'binary changes'],
    ]);
  });
});

/** A small seeded generator, so a failing interleaving can be replayed. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('several editors, one document', () => {
  it.each([1, 2, 3, 4, 5])('converge whatever the interleaving (seed %i)', (seed) => {
    const rnd = prng(seed);
    const s = new Session();
    const eds = [s.join('A'), s.join('B'), s.join('C'), s.join('V', false)];
    const writers = eds.slice(0, 3);
    let k = 0;
    for (let step = 0; step < 400; step++) {
      const r = rnd();
      const ed = writers[Math.floor(rnd() * writers.length)];
      if (r < 0.2) {
        ed.bridge.fromEditor({ type: 'getLock', block: [`p${Math.floor(rnd() * 6)}`] });
      } else if (r < 0.45) {
        s.type(ed, `${ed.name}${k++}`);
      } else if (r < 0.55) {
        if (s.paused.has(ed.member.client)) s.resume(ed);
        else s.paused.add(ed.member.client);
      } else if (r < 0.8) {
        s.flush();
      } else {
        for (const e of eds) if (!s.paused.has(e.member.client)) s.process(e);
      }
    }
    for (const e of eds) s.resume(e);
    for (let round = 0; round < 500; round++) {
      s.flush();
      for (const e of eds) s.process(e);
      if (s.queue.length === 0 && eds.every((e) => e.pending.length === 0 && !e.asked && !e.saving)) break;
    }

    const all = s.logChanges();
    expect(all.length).toBe(k);
    expect(s.refused).toEqual([]);
    // No editor ever sent changes without having every change before them.
    expect(s.stale).toEqual([]);
    const late = s.join('Late', false);
    const fromAuth = late.seen
      .filter((m) => m.type === 'authChanges')
      .flatMap((m) => (m.changes as StoredChange[]).map((c) => JSON.parse(c.change) as string));
    expect(fromAuth).toEqual(all);
    for (const e of [...eds, late]) {
      expect(e.bridge.changeCount).toBe(all.length);
      // Everybody else's changes arrive in the log's order.
      const others = e.model.filter((c) => !c.startsWith(e.name));
      if (e !== late) expect(others).toEqual(all.filter((c) => !c.startsWith(e.name)));
      expect(e.bridge.lockSnapshot()).toEqual(eds[0].bridge.lockSnapshot());
      expect(e.bridge.participants()).toEqual(late.bridge.participants());
    }
  });
});
