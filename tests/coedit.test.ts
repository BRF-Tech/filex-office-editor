// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// Editing together (filex 0.56): what filex says about a session in the
// bridge's words (src/coedit.ts), and the rules every member derives from
// the same log - who saves the ten-minute version, who is the last writer,
// which images a change needs.
import { describe, expect, it } from 'vitest';

import type { BridgeEntry } from '../src/bridge';
import {
  TOGETHER_AUTOSAVE_MS,
  autosaveDue,
  bridgeMember,
  editorIdOf,
  emptySaveState,
  foldSave,
  lastWriter,
  mediaBlobName,
  mediaNamesIn,
  saverOf,
  toBridgeEntry,
  unsaved,
  type SaveState,
} from '../src/coedit';
import { EDITOR_USER_ID } from '../src/frame-protocol';

describe('the images a change needs', () => {
  it('finds the names this app gives an inserted image, each once, in order', () => {
    const changes = [
      '{"t":"img","src":"media/image_fx0123456789abcdef.png"}',
      { nested: ['media/image_fxfedcba9876543210.jpg', 'media/image_fx0123456789abcdef.png'] },
    ];
    expect(mediaNamesIn(changes)).toEqual(['image_fx0123456789abcdef.png', 'image_fxfedcba9876543210.jpg']);
  });

  it("leaves the base document's own images and anything that only looks similar", () => {
    expect(mediaNamesIn(['media/image1.png', 'image_fx123.png', 'image_fx0123456789ABCDEF.png', 'image_fx0123456789abcdef.svg'])).toEqual([]);
    expect(mediaNamesIn(undefined)).toEqual([]);
  });

  it('keeps an image under "m." and its name', () => {
    expect(mediaBlobName('image_fx0123456789abcdef.png')).toBe('m.image_fx0123456789abcdef.png');
    expect(mediaBlobName('image_fx0123456789abcdef.png')).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  });
});

describe('a member in the bridge', () => {
  it("each member's editor user id differs, ends in a separator and is the editor's prefix", () => {
    const a = editorIdOf('3f9a');
    const b = editorIdOf('3f9b');
    expect(a).not.toBe(b);
    expect(a.startsWith(EDITOR_USER_ID)).toBe(true);
    expect(a.endsWith('-')).toBe(true);
    // Nothing of an id that could break the editor's "group<NBSP>name" or the lock ids.
    expect(editorIdOf(`a b${String.fromCharCode(160)}c/d`)).toBe(`${EDITOR_USER_ID}a_b_c_d-`);
  });

  it('maps filex\'s member to the bridge\'s', () => {
    expect(bridgeMember({ client: 'c2', user: 'u7', name: 'Mehmet', indexUser: 2, canEdit: true })).toEqual({
      client: 'c2',
      user: `${EDITOR_USER_ID}u7-`,
      name: 'Mehmet',
      indexUser: 2,
      canEdit: true,
    });
  });
});

describe('an entry from filex, as the bridge takes it', () => {
  const base = { seq: 3, at: 1_700_000_000_000, client: 'c1' };

  it('takes every kind filex hands over', () => {
    expect(toBridgeEntry({ ...base, kind: 'join', member: { client: 'c1', user: 'u1', name: 'A', indexUser: 1, canEdit: true } })).toMatchObject({ kind: 'join', member: { user: `${EDITOR_USER_ID}u1-` } });
    expect(toBridgeEntry({ ...base, kind: 'leave' })).toEqual({ ...base, kind: 'leave' });
    expect(toBridgeEntry({ ...base, kind: 'saved', through: 2 })).toEqual({ ...base, kind: 'saved', through: 2 });
    expect(toBridgeEntry({ ...base, kind: 'lock', body: { blocks: ['p1'] } })).toEqual({ ...base, kind: 'lock', body: { blocks: ['p1'] } });
    expect(toBridgeEntry({ ...base, kind: 'release', body: { deleteIndex: 4, locks: true } })).toEqual({ ...base, kind: 'release', body: { deleteIndex: 4, locks: true } });
    expect(
      toBridgeEntry({ ...base, kind: 'changes', body: { changes: ['x'], start: true, end: true, deleteIndex: null, releaseLocks: true, excel: false, coAuthoring: true, excelInfo: null } }),
    ).toEqual({ ...base, kind: 'changes', body: { changes: ['x'], start: true, end: true, deleteIndex: null, releaseLocks: true, excel: false, coAuthoring: true, excelInfo: null } });
  });

  it('refuses what is not one: a kind nobody writes, a body without its fields, a seq that is not a place', () => {
    expect(toBridgeEntry({ ...base, kind: 'exec' })).toBeNull();
    expect(toBridgeEntry({ ...base, kind: 'changes', body: { changes: 'x' } })).toBeNull();
    expect(toBridgeEntry({ ...base, kind: 'lock', body: {} })).toBeNull();
    expect(toBridgeEntry({ ...base, kind: 'join', member: { client: 'c1' } })).toBeNull();
    expect(toBridgeEntry({ ...base, seq: 0, kind: 'leave' })).toBeNull();
    expect(toBridgeEntry({ ...base, seq: 1.5, kind: 'leave' })).toBeNull();
    expect(toBridgeEntry(null)).toBeNull();
    expect(toBridgeEntry('leave')).toBeNull();
  });

  it('takes only the fields the bridge reads from a changes body', () => {
    const e = toBridgeEntry({ ...base, kind: 'changes', body: { changes: [], start: 'yes', end: 1, evil: true } });
    expect(e).toMatchObject({ body: { start: false, end: false, coAuthoring: true, excelInfo: null } });
    expect((e as unknown as { body: Record<string, unknown> }).body.evil).toBeUndefined();
  });
});

describe('who saves', () => {
  const T = 1_700_000_000_000;
  const join = (seq: number, client: string, canEdit = true): BridgeEntry => ({
    seq,
    at: T + seq,
    client,
    kind: 'join',
    member: { client, user: `${EDITOR_USER_ID}${client}-`, name: client, indexUser: seq, canEdit },
  });
  const changes = (seq: number, client: string, at = T + seq): BridgeEntry => ({
    seq,
    at,
    client,
    kind: 'changes',
    body: { changes: ['x'], start: true, end: true, deleteIndex: null, releaseLocks: false, excel: false, coAuthoring: true, excelInfo: null },
  });
  const fold = (...entries: BridgeEntry[]): SaveState => entries.reduce(foldSave, emptySaveState());

  it('the writer who joined first saves; a reader never does; the next oldest when the saver leaves', () => {
    const s = fold(join(1, 'r', false), join(2, 'a'), join(3, 'b'));
    expect(saverOf(s)).toBe('a');
    const s2 = foldSave(s, { seq: 4, at: T, client: 'a', kind: 'leave' });
    expect(saverOf(s2)).toBe('b');
    expect(saverOf(fold(join(1, 'r', false)))).toBeNull();
  });

  it('the last writer is the one with no other writer in (a reader does not count)', () => {
    const s = fold(join(1, 'a'), join(2, 'r', false));
    expect(lastWriter(s, 'a')).toBe(true);
    const s2 = foldSave(s, join(3, 'b'));
    expect(lastWriter(s2, 'a')).toBe(false);
    expect(lastWriter(foldSave(s2, { seq: 4, at: T, client: 'b', kind: 'leave' }), 'a')).toBe(true);
  });

  it('unsaved from the first change after a save, saved by a save that reaches the last change', () => {
    let s = fold(join(1, 'a'), changes(2, 'a', T + 100), changes(3, 'a', T + 500));
    expect(unsaved(s)).toBe(true);
    expect(s.dirtySince).toBe(T + 100);
    s = foldSave(s, { seq: 4, at: T + 600, client: 'a', kind: 'saved', through: 2 });
    expect(unsaved(s)).toBe(true);
    expect(s.dirtySince).toBe(T + 100);
    s = foldSave(s, { seq: 5, at: T + 700, client: 'a', kind: 'saved', through: 4 });
    expect(unsaved(s)).toBe(false);
    expect(s.dirtySince).toBeNull();
    // A save of an earlier point recorded late changes nothing.
    expect(foldSave(s, { seq: 6, at: T + 800, client: 'a', kind: 'saved', through: 1 })).toEqual(s);
  });

  it('the ten-minute version is due only for the saver, ten minutes after the first unsaved change', () => {
    const s = fold(join(1, 'a'), join(2, 'b'), changes(3, 'b', T));
    expect(autosaveDue(s, 'a', T + TOGETHER_AUTOSAVE_MS - 1)).toBe(false);
    expect(autosaveDue(s, 'a', T + TOGETHER_AUTOSAVE_MS)).toBe(true);
    expect(autosaveDue(s, 'b', T + TOGETHER_AUTOSAVE_MS * 2)).toBe(false);
    expect(autosaveDue(fold(join(1, 'a')), 'a', T + TOGETHER_AUTOSAVE_MS * 2)).toBe(false);
  });

  it('every member folds the same log into the same answer', () => {
    const log = [join(1, 'a'), join(2, 'b'), changes(3, 'b'), { seq: 4, at: T, client: 'a', kind: 'leave' } as BridgeEntry, join(5, 'c')];
    const one = log.reduce(foldSave, emptySaveState());
    const two = [...log].reduce(foldSave, emptySaveState());
    expect(one).toEqual(two);
    expect(saverOf(one)).toBe('b');
  });
});
