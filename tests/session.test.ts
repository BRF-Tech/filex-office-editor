// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// The single-person session (src/session.ts) with the real bridge: the
// relay's rules - one order, changes only under the lease, the lease only
// for a member that has seen every change - kept for one member, so the
// editor gets the answers it would get with others (plan step A3).
import { describe, expect, it } from 'vitest';

import { OfficeBridge, type BridgeMember } from '../src/bridge';
import { EDITOR_TYPE, type ServerMessage } from '../src/protocol';
import { LocalSession } from '../src/session';

type Msg = ServerMessage & Record<string, any>;

function setup() {
  const queue: (() => void)[] = [];
  const defer = (run: () => void) => queue.push(run);
  const flush = () => {
    while (queue.length) queue.shift()!();
  };
  const me: BridgeMember = { client: 'local', user: 'filex-person-', name: 'Ayşe', indexUser: 1, canEdit: true };
  const notices: string[] = [];
  const session = new LocalSession({ me, defer, now: () => 1_700_000_000_000, notice: (w, d) => notices.push(`${w}: ${d}`) });
  const sent: Msg[] = [];
  let saves = 0;
  const bridge = new OfficeBridge({
    me,
    editorType: EDITOR_TYPE.document,
    build: { version: '9.4.0', number: 129 },
    documentUrls: { 'Editor.bin': 'blob:x' },
    host: session.host({ toEditor: (m) => sent.push(m as Msg), save: () => saves++ }),
  });
  bridge.connect();
  bridge.fromEditor({ type: 'auth' });
  session.start(bridge);
  return { session, bridge, sent, flush, notices, saves: () => saves };
}

const last = (sent: Msg[], type: string) => [...sent].reverse().find((m) => m.type === type);

describe('LocalSession', () => {
  it('opens like a server: license, then auth and the document once the member has joined', () => {
    const { sent } = setup();
    expect(sent.map((m) => m.type)).toEqual(['license', 'auth', 'documentOpen']);
    expect(last(sent, 'auth')).toMatchObject({ result: 1, indexUser: 1 });
  });

  it('a save of changes: the lease, the changes in the log, unSaveLock with the count', () => {
    const { bridge, session, sent, flush } = setup();
    bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: 0 });
    flush();
    expect(last(sent, 'saveLock')!.saveLock).toBe(false);
    bridge.fromEditor({ type: 'saveChanges', changes: JSON.stringify(['a', 'b']), startSaveChanges: true, endSaveChanges: true, isCoAuthoring: true });
    flush();
    expect(last(sent, 'unSaveLock')).toMatchObject({ index: 0, syncChangesIndex: 2 });
    expect(session.changes).toBe(session.head);
    expect(session.dirty).toBe(true);
    expect(bridge.dirty).toBe(true);
    // The next hand-over gets the lease again (it was given back).
    bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: 2 });
    flush();
    expect(last(sent, 'saveLock')!.saveLock).toBe(false);
  });

  it('a save of the file clears "dirty" up to where its snapshot was taken, not past it', () => {
    const { bridge, session, flush } = setup();
    const change = (c: string, sync: number) => {
      bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: sync });
      flush();
      bridge.fromEditor({ type: 'saveChanges', changes: JSON.stringify([c]), startSaveChanges: true, endSaveChanges: true, isCoAuthoring: true });
      flush();
    };
    change('a', 0);
    const snapshotAt = session.head;
    change('b', 1);
    session.saved(snapshotAt);
    flush();
    expect(session.dirty).toBe(true);
    expect(bridge.dirty).toBe(true);
    session.saved(session.head);
    flush();
    expect(session.dirty).toBe(false);
    expect(bridge.dirty).toBe(false);
  });

  it('the editor Save with changes asks the frame to write; without changes it is "not modified"', () => {
    const { bridge, sent, flush, saves } = setup();
    bridge.fromEditor({ type: 'forceSaveStart' });
    expect(last(sent, 'forceSaveStart')!.messages).toMatchObject({ code: 4 });
    bridge.fromEditor({ type: 'isSaveLock', syncChangesIndex: 0 });
    flush();
    bridge.fromEditor({ type: 'saveChanges', changes: JSON.stringify(['a']), startSaveChanges: true, endSaveChanges: true, isCoAuthoring: true });
    flush();
    bridge.fromEditor({ type: 'forceSaveStart' });
    expect(saves()).toBe(1);
    bridge.saved(true);
    expect(last(sent, 'forceSave')!.messages).toMatchObject({ type: 1, success: true });
  });

  it('refuses changes sent without the lease, and says so', () => {
    const { bridge, session, flush, notices } = setup();
    bridge.fromEditor({ type: 'saveChanges', changes: JSON.stringify(['x']), startSaveChanges: true, endSaveChanges: true });
    flush();
    expect(session.changes).toBe(0);
    expect(notices.join()).toMatch(/without the lease/);
  });

  it('starts once', () => {
    const { session, bridge } = setup();
    expect(() => session.start(bridge)).toThrow(/started/);
  });
});
