// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-onlyoffice (see README.md and NOTICE).
//
// The Document Server's lock rules, as every bridge runs them on the same
// sequence of requests (task #189). The point of carrying them over is that
// the first request for a block wins and the second is told so - the race
// CryptPad's bridge leaves open, where both editors can believe they hold
// the same paragraph.
import { describe, expect, it } from 'vitest';

import {
  LockTable,
  RecalcIndex,
  compareExcelBlock,
  comparePresentationBlock,
  lockKey,
  recalcFromInfo,
} from '../src/locks';
import { EDITOR_TYPE, LOCK_ELEM, LOCK_PRESENTATION, LOCK_SUBTYPE } from '../src/protocol';

const range = (guid: string, sheetId: string, c1: number, r1: number, c2: number, r2: number, subType: number | null = null) => ({
  guid,
  sheetId,
  type: LOCK_ELEM.Range,
  subType,
  rangeOrObjectId: { c1, r1, c2, r2 },
});

describe('lockKey', () => {
  it("is a text block itself, the others' guid", () => {
    expect(lockKey('_p_123')).toBe('_p_123');
    expect(lockKey({ guid: 'g1', type: 1 })).toBe('g1');
    expect(lockKey({ type: 1 })).toBeNull();
    expect(lockKey('')).toBeNull();
  });
});

describe('a text document', () => {
  it('the first request for a block wins; the second sees it held', () => {
    const t = new LockTable(EDITOR_TYPE.document);
    const first = t.request('a1', ['p1', 'p2'], 1000);
    expect(first.p1.user).toBe('a1');
    const second = t.request('b2', ['p2', 'p3'], 2000);
    // p2 stays a1's; b2 gets p3 (a text document keeps the rest).
    expect(second.p2).toEqual({ time: 1000, user: 'a1', block: 'p2' });
    expect(second.p3).toEqual({ time: 2000, user: 'b2', block: 'p3' });
  });

  it('every bridge that applies the same requests in the same order has the same table', () => {
    const requests: [string, string[]][] = [
      ['a1', ['p1']],
      ['b2', ['p1', 'p4']],
      ['c3', ['p4', 'p5']],
      ['a1', ['p5', 'p6']],
    ];
    const run = () => {
      const t = new LockTable(EDITOR_TYPE.document);
      let last = {};
      requests.forEach(([u, blocks], i) => {
        last = t.request(u, blocks, i);
      });
      return JSON.stringify(last);
    };
    expect(run()).toBe(run());
    const t = new LockTable(EDITOR_TYPE.document);
    requests.forEach(([u, blocks], i) => t.request(u, blocks, i));
    const held = t.snapshot();
    expect(held.p1.user).toBe('a1');
    expect(held.p4.user).toBe('b2');
    expect(held.p5.user).toBe('c3');
    expect(held.p6.user).toBe('a1');
  });

  it('releaseUser frees everything one user holds and nothing else', () => {
    const t = new LockTable(EDITOR_TYPE.document);
    t.request('a1', ['p1', 'p2'], 1);
    t.request('b2', ['p3'], 2);
    const gone = t.releaseUser('a1');
    expect(gone.map((l) => l.block)).toEqual(['p1', 'p2']);
    expect(Object.keys(t.snapshot())).toEqual(['p3']);
    expect(t.request('b2', ['p1'], 3).p1.user).toBe('b2');
  });

  it('auth lists a text document\'s locks as an object, the others\' as a list', () => {
    const doc = new LockTable(EDITOR_TYPE.document);
    doc.request('a1', ['p1'], 1);
    expect(Array.isArray(doc.forAuth())).toBe(false);
    const sheet = new LockTable(EDITOR_TYPE.spreadsheet);
    sheet.request('a1', [range('g1', 's1', 0, 0, 1, 1)], 1);
    expect(sheet.forAuth()).toEqual([{ time: 1, user: 'a1', block: range('g1', 's1', 0, 0, 1, 1) }]);
  });
});

describe('a spreadsheet', () => {
  it("a request that collides with another's lock adds nothing, not even its free blocks", () => {
    const t = new LockTable(EDITOR_TYPE.spreadsheet);
    t.request('a1', [range('g1', 's1', 10, 10, 12, 12), range('g0', 's1', 0, 0, 3, 3)], 1);
    // b2 asks for g1 (held: the rules run) and g2, which overlaps a1's g0:
    // nothing of b2's is added, g1 stays a1's.
    const after = t.request('b2', [range('g1', 's1', 10, 10, 12, 12), range('g2', 's1', 2, 2, 5, 5)], 2);
    expect(Object.keys(after).sort()).toEqual(['g0', 'g1']);
    expect(after.g1.user).toBe('a1');
  });

  it('as in Docs 9.4: without a held key in the request, the range rules do not run', () => {
    // Kept on purpose: the editor was written against this server. Two
    // overlapping ranges under different keys are both granted.
    const t = new LockTable(EDITOR_TYPE.spreadsheet);
    t.request('a1', [range('g0', 's1', 0, 0, 3, 3)], 1);
    const after = t.request('b2', [range('g2', 's1', 2, 2, 5, 5)], 2);
    expect(Object.keys(after).sort()).toEqual(['g0', 'g2']);
  });

  it('a held sheet keeps everybody else from locking sheets', () => {
    const sheet = (guid: string, sheetId: string) => ({ guid, sheetId, type: LOCK_ELEM.Sheet, subType: null, rangeOrObjectId: null });
    const t = new LockTable(EDITOR_TYPE.spreadsheet);
    t.request('a1', [sheet('sa', 's1'), range('rx', 's9', 0, 0, 0, 0)], 1);
    // rx is held, so b2's request is checked: its sheet s2 meets a1's sheet.
    const after = t.request('b2', [range('rx', 's9', 0, 0, 0, 0), sheet('sb', 's2')], 2);
    expect(after.sb).toBeUndefined();
    expect(Object.keys(after).sort()).toEqual(['rx', 'sa']);
  });

  it('compareExcelBlock: ranges that intersect collide, insert locks do not, a sheet holds everything', () => {
    const a = range('g1', 's1', 0, 0, 3, 3);
    expect(compareExcelBlock(range('g2', 's1', 3, 3, 5, 5), a)).toBe(true);
    expect(compareExcelBlock(range('g2', 's1', 4, 4, 5, 5), a)).toBe(false);
    expect(compareExcelBlock(range('g2', 's1', 0, 0, 1, 1), range('g3', 's1', 0, 0, 9, 9, LOCK_SUBTYPE.InsertRows))).toBe(false);
    // Two row/column operations always collide.
    expect(
      compareExcelBlock(range('g2', 's1', 0, 0, 1, 1, LOCK_SUBTYPE.DeleteRows), range('g3', 's1', 5, 5, 6, 6, LOCK_SUBTYPE.InsertRows)),
    ).toBe(true);
    expect(compareExcelBlock(range('g2', 's1', 0, 0, 1, 1), { ...range('g3', 's1', 0, 0, 9, 9), subType: null })).toBe(true);
    const insert = { ...range('g3', 's1', 0, 0, 9, 9), subType: LOCK_SUBTYPE.InsertColumns };
    expect(compareExcelBlock({ ...range('g2', 's1', 0, 0, 1, 1) }, insert)).toBe(false);
    expect(compareExcelBlock(range('g2', 's1', 0, 0, 1, 1), { guid: 's', sheetId: 's1', type: LOCK_ELEM.Sheet, subType: null })).toBe(true);
  });

  it('recalculates the other people\'s range locks after inserted rows, not the writer\'s own', () => {
    const t = new LockTable(EDITOR_TYPE.spreadsheet);
    t.request('a1', [range('mine', 's1', 0, 10, 0, 12)], 1);
    t.request('b2', [range('theirs', 's1', 5, 10, 5, 12)], 2);
    // a1 inserted one row at 5 (an "add" in its record; the server turns it
    // round for the others).
    const info = JSON.stringify({ indexRows: { s1: { _arrElements: [{ _recalcType: 1, _position: 5, _count: 1, m_bIsSaveIndex: false }] } } });
    t.recalcExcel('a1', info);
    const held = t.snapshot();
    expect((held.theirs.block as { rangeOrObjectId: { r1: number; r2: number } }).rangeOrObjectId).toMatchObject({ r1: 11, r2: 13 });
    expect((held.mine.block as { rangeOrObjectId: { r1: number; r2: number } }).rangeOrObjectId).toMatchObject({ r1: 10, r2: 12 });
  });
});

describe('RecalcIndex and recalcFromInfo', () => {
  it("getLockMe2 moves a position at or after an other's insert, and back for a delete", () => {
    const r = new RecalcIndex();
    r.add(2, 5, 1, true); // a remove in the turned-round record = an insert by the writer
    expect(r.lockMe2(4)).toBe(4);
    expect(r.lockMe2(5)).toBe(6);
    const d = new RecalcIndex();
    d.add(1, 5, 1, true);
    expect(d.lockMe2(7)).toBe(6);
    const own = new RecalcIndex();
    own.add(2, 5, 1, false);
    expect(own.lockMe2(9)).toBe(9);
  });

  it('as on the server, the element index is not reset between sheets', () => {
    const info = {
      s1: { _arrElements: [{ _recalcType: 1, _position: 1, _count: 1 }] },
      s2: { _arrElements: [{ _recalcType: 1, _position: 1, _count: 1 }, { _recalcType: 1, _position: 2, _count: 1 }] },
    };
    const out = recalcFromInfo(info)!;
    // s2's first element is skipped: the index stood at 1 after s1.
    expect(out.s2.lockMe2(1)).toBe(1);
    expect(out.s2.lockMe2(2)).toBe(3);
    expect(recalcFromInfo(null)).toBeNull();
  });
});

describe('a presentation', () => {
  it('a slide holds its objects and an object its slide', () => {
    const slide = { type: LOCK_PRESENTATION.Slide, val: 'slide1' };
    const object = { type: LOCK_PRESENTATION.Object, slideId: 'slide1', objId: 'o1' };
    expect(comparePresentationBlock(slide, object)).toBe(true);
    expect(comparePresentationBlock(object, slide)).toBe(true);
    expect(comparePresentationBlock({ ...object, objId: 'o2' }, object)).toBe(false);
    expect(comparePresentationBlock({ type: LOCK_PRESENTATION.Presentation, val: 'theme' }, { type: LOCK_PRESENTATION.Presentation, val: 'theme' })).toBe(true);
  });

  it("a colliding request adds nothing of the requester's", () => {
    const t = new LockTable(EDITOR_TYPE.presentation);
    t.request('a1', [
      { guid: 's1', type: LOCK_PRESENTATION.Slide, val: 'slide1' },
      { guid: 'ox', type: LOCK_PRESENTATION.Object, slideId: 'slide9', objId: 'ox' },
    ], 1);
    // ox is held, so b2's request is checked: its object sits on a1's slide.
    const after = t.request('b2', [
      { guid: 'ox', type: LOCK_PRESENTATION.Object, slideId: 'slide9', objId: 'ox' },
      { guid: 'o', type: LOCK_PRESENTATION.Object, slideId: 'slide1', objId: 'o1' },
    ], 2);
    expect(Object.keys(after).sort()).toEqual(['ox', 's1']);
  });
});
