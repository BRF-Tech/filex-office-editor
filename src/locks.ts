// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 BRF Tech. Part of filex-onlyoffice, the office editor
// app for filex (see README.md and NOTICE).
// Portions Copyright (C) Ascensio System SIA (ONLYOFFICE Docs).
//
// The Document Server's lock rules, carried over from ONLYOFFICE Docs 9.4
// (server DocService/sources/DocsCoServer.js: getLock, _checkLockExcel,
// _checkLockPresentation, compareExcelBlock, comparePresentationBlock,
// _recalcLockArray, _addRecalcIndex, CRecalcIndex; the in-memory
// editorData's addLocksNX).
//
// This file is based on ONLYOFFICE Docs by Ascensio System SIA and is a
// modified version of it: those functions were translated to TypeScript and
// changed to run on the session's log instead of the server's database by
// BRF Tech on 2026-10-08. ONLYOFFICE licenses that code under the GNU AGPL
// version 3 only, with the additional terms of its section 7 (NOTICE), so
// this file is AGPL-3.0-only while the rest of the repository is
// AGPL-3.0-or-later. No trademark rights in ONLYOFFICE are granted.
//
// Nobody arbitrates locks centrally here. Every editor's bridge reads the
// same lock requests in the same order (the relay's log) and runs these
// rules on the same table, so every bridge answers every request the same
// way: the first request for a block wins, as on a Document Server. The
// rules are kept as the server has them, quirks included, because the editor
// was written against them; a "fix" here would make an editor see something
// no Document Server shows it.

import {
  EDITOR_TYPE,
  LOCK_ELEM,
  LOCK_PRESENTATION,
  LOCK_SUBTYPE,
  type EditorType,
  type Lock,
  type LockBlock,
} from './protocol';

/** The fields a spreadsheet or presentation block may carry. */
interface Block {
  guid?: unknown;
  type?: unknown;
  subType?: unknown;
  sheetId?: unknown;
  rangeOrObjectId?: unknown;
  val?: unknown;
  slideId?: unknown;
  objId?: unknown;
}

/** A range's corners, compared the way the server compares them. */
interface Range {
  c1?: unknown;
  c2?: unknown;
  r1?: unknown;
  r2?: unknown;
}

// The server compares whatever it was sent with < and >; so does this, with
// the same JavaScript semantics. `num` only tells TypeScript so.
function num(v: unknown): number {
  return v as number;
}

function asBlock(b: LockBlock): Block {
  return typeof b === 'object' && b !== null ? (b as Block) : {};
}

/**
 * The key a lock is stored under: a text document's block itself, the
 * others' guid (the server writes `block.guid || block`). null for a block
 * that has neither, which no editor sends.
 */
export function lockKey(block: unknown): string | null {
  if (typeof block === 'string') return block || null;
  if (block && typeof block === 'object') {
    const g = (block as Block).guid;
    if (typeof g === 'string' && g) return g;
    if (typeof g === 'number') return String(g);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Spreadsheet rules
// ---------------------------------------------------------------------------

function isInterSection(range1: Range, range2: Range): boolean {
  if (
    num(range2.c1) > num(range1.c2) ||
    num(range2.c2) < num(range1.c1) ||
    num(range2.r1) > num(range1.r2) ||
    num(range2.r2) < num(range1.r1)
  ) {
    return false;
  }
  return true;
}

/** compareExcelBlock: does an existing lock keep a new block from being locked? */
export function compareExcelBlock(newBlock: Block, oldBlock: Block): boolean {
  // A lock that inserts or deletes rows or columns. (As on the server: an
  // absent subType is not null, so it counts.)
  if (newBlock.subType !== null && oldBlock.subType !== null) return true;
  // A ChangeProperties lock does not hold anything but a sheet.
  if (
    (oldBlock.subType === LOCK_SUBTYPE.ChangeProperties && newBlock.type !== LOCK_ELEM.Sheet) ||
    (newBlock.subType === LOCK_SUBTYPE.ChangeProperties && oldBlock.type !== LOCK_ELEM.Sheet)
  ) {
    return false;
  }
  let resultLock = false;
  if (newBlock.type === LOCK_ELEM.Range) {
    if (oldBlock.type === LOCK_ELEM.Range) {
      if (oldBlock.subType === LOCK_SUBTYPE.InsertRows || oldBlock.subType === LOCK_SUBTYPE.InsertColumns) {
        resultLock = false;
      } else if (isInterSection(newBlock.rangeOrObjectId as Range, oldBlock.rangeOrObjectId as Range)) {
        resultLock = true;
      }
    } else if (oldBlock.type === LOCK_ELEM.Sheet) {
      resultLock = true;
    }
  } else if (newBlock.type === LOCK_ELEM.Sheet) {
    resultLock = true;
  } else if (newBlock.type === LOCK_ELEM.Object) {
    if (oldBlock.type === LOCK_ELEM.Sheet) {
      resultLock = true;
    } else if (oldBlock.type === LOCK_ELEM.Object && oldBlock.rangeOrObjectId === newBlock.rangeOrObjectId) {
      resultLock = true;
    }
  }
  return resultLock;
}

function checkLockExcel(table: Map<string, Lock>, newLocks: Map<string, Lock>, blocks: LockBlock[], userId: string): boolean {
  let isLock = false;
  let isExistInArray = false;
  for (let i = 0; i < blocks.length && isLock === false; ++i) {
    const blockRange = asBlock(blocks[i]);
    for (const [key, documentLock] of table) {
      if (newLocks.has(key)) continue; // just added
      const held = asBlock(documentLock.block);
      // The same user sent a lock on the same object again.
      if (
        documentLock.user === userId &&
        blockRange.sheetId === held.sheetId &&
        blockRange.type === LOCK_ELEM.Object &&
        held.type === LOCK_ELEM.Object &&
        held.rangeOrObjectId === blockRange.rangeOrObjectId
      ) {
        isExistInArray = true;
        break;
      }
      if (blockRange.type === LOCK_ELEM.Sheet && held.type === LOCK_ELEM.Sheet) {
        if (documentLock.user === userId) {
          if (blockRange.sheetId === held.sheetId) {
            isExistInArray = true;
            break;
          }
          continue; // a new sheet
        }
        // Somebody holds a sheet: nobody else locks sheets (or all of them
        // could be deleted).
        isLock = true;
        break;
      }
      if (documentLock.user === userId || !documentLock.block || blockRange.sheetId !== held.sheetId) continue;
      isLock = compareExcelBlock(blockRange, held);
      if (isLock) break;
    }
  }
  if (blocks.length === 0) isLock = true;
  return !isLock && !isExistInArray;
}

// ---------------------------------------------------------------------------
// Presentation rules
// ---------------------------------------------------------------------------

/** comparePresentationBlock: does an existing lock keep a new block from being locked? */
export function comparePresentationBlock(newBlock: Block, oldBlock: Block): boolean {
  switch (newBlock.type) {
    case LOCK_PRESENTATION.Presentation:
      return oldBlock.type === LOCK_PRESENTATION.Presentation && newBlock.val === oldBlock.val;
    case LOCK_PRESENTATION.Slide:
      if (oldBlock.type === LOCK_PRESENTATION.Slide) return newBlock.val === oldBlock.val;
      if (oldBlock.type === LOCK_PRESENTATION.Object) return newBlock.val === oldBlock.slideId;
      return false;
    case LOCK_PRESENTATION.Object:
      if (oldBlock.type === LOCK_PRESENTATION.Slide) return newBlock.slideId === oldBlock.val;
      if (oldBlock.type === LOCK_PRESENTATION.Object) return newBlock.objId === oldBlock.objId;
      return false;
  }
  return false;
}

function checkLockPresentation(table: Map<string, Lock>, newLocks: Map<string, Lock>, blocks: LockBlock[], userId: string): boolean {
  let isLock = false;
  for (let i = 0; i < blocks.length && isLock === false; ++i) {
    const blockRange = asBlock(blocks[i]);
    for (const [key, documentLock] of table) {
      if (newLocks.has(key)) continue;
      if (documentLock.user === userId || !documentLock.block) continue;
      isLock = comparePresentationBlock(blockRange, asBlock(documentLock.block));
      if (isLock) break;
    }
  }
  if (blocks.length === 0) isLock = true;
  return !isLock;
}

// ---------------------------------------------------------------------------
// Spreadsheet index recalculation (CRecalcIndex, _addRecalcIndex)
// ---------------------------------------------------------------------------

const RECALC_ADD = 1;
const RECALC_REMOVE = 2;

interface RecalcElement {
  recalcType: number;
  position: number;
  saveIndex: boolean;
}

/** The part of CRecalcIndex the server uses: getLockMe2. */
export class RecalcIndex {
  private readonly elements: RecalcElement[] = [];

  add(recalcType: number, position: number, count: number, saveIndex: boolean): void {
    for (let i = 0; i < count; ++i) this.elements.push({ recalcType, position, saveIndex });
  }

  /** getLockMe2: a position after other people's inserted or deleted rows/columns. */
  lockMe2(position: number): number {
    let p = position;
    for (let i = this.elements.length - 1; i >= 0; --i) {
      const e = this.elements[i];
      const inc = e.recalcType === RECALC_ADD ? -1 : +1;
      if (e.saveIndex === true && !(p < e.position)) p = p + inc;
    }
    return p;
  }
}

/**
 * _addRecalcIndex: the editor's record of inserted/deleted rows or columns,
 * turned round for the other editors' locks. ⚠ As on the server, the
 * element index is NOT reset between sheets: a second sheet's list is read
 * from where the first one's ended.
 */
export function recalcFromInfo(info: unknown): Record<string, RecalcIndex> | null {
  if (info === null || info === undefined || typeof info !== 'object') return null;
  const out: Record<string, RecalcIndex> = {};
  let n = 0;
  for (const sheetId of Object.keys(info)) {
    if (!Object.prototype.hasOwnProperty.call(out, sheetId)) out[sheetId] = new RecalcIndex();
    const arr = ((info as Record<string, unknown>)[sheetId] as { _arrElements?: unknown } | null)?._arrElements;
    if (!Array.isArray(arr)) continue;
    for (; n < arr.length; ++n) {
      const el = (arr[n] ?? {}) as Record<string, unknown>;
      if (el.m_bIsSaveIndex === true) continue;
      const type = el._recalcType === RECALC_ADD ? RECALC_REMOVE : RECALC_ADD;
      out[sheetId].add(type, num(el._position), typeof el._count === 'number' ? el._count : 0, true);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** The document's locks, as every bridge holds them after the same entries. */
export class LockTable {
  private readonly table = new Map<string, Lock>();

  constructor(private readonly editorType: EditorType) {}

  /**
   * getLock: `userId` asks for `blocks` at `time`. Blocks nobody holds are
   * added (addLocksNX). When a requested key is already held, the editor's
   * rule decides about the rest: a text document keeps them, a spreadsheet
   * or presentation request that collides with somebody else's lock adds
   * nothing. (As in 9.4, those rules run only when a key is already held.)
   * Returns the whole table, which is what the server answers everybody.
   */
  request(userId: string, blocks: LockBlock[], time: number): Record<string, Lock> {
    const wanted = new Map<string, Lock>();
    for (const block of blocks) {
      const key = lockKey(block);
      if (key !== null) wanted.set(key, { time, user: userId, block });
    }
    const added: string[] = [];
    let conflict = false;
    for (const [key, lock] of wanted) {
      if (this.table.has(key)) {
        conflict = true;
      } else {
        this.table.set(key, lock);
        added.push(key);
      }
    }
    if (conflict && !this.check(wanted, blocks, userId)) {
      for (const key of added) this.table.delete(key);
    }
    return this.snapshot();
  }

  private check(wanted: Map<string, Lock>, blocks: LockBlock[], userId: string): boolean {
    switch (this.editorType) {
      case EDITOR_TYPE.document:
        return true; // _checkLockWord
      case EDITOR_TYPE.spreadsheet:
        return checkLockExcel(this.table, wanted, blocks, userId);
      default:
        return checkLockPresentation(this.table, wanted, blocks, userId);
    }
  }

  /** removeUserLocks: everything `userId` holds goes; returns what went. */
  releaseUser(userId: string): Lock[] {
    const out: Lock[] = [];
    for (const [key, lock] of this.table) {
      if (lock.user === userId) {
        out.push(lock);
        this.table.delete(key);
      }
    }
    return out;
  }

  /**
   * _recalcLockArray: after `userId` inserted or deleted rows or columns
   * (its last chunk's excelAdditionalInfo), move the other people's range
   * locks on those sheets.
   */
  recalcExcel(userId: string, excelAdditionalInfo: string): void {
    let info: Record<string, unknown>;
    try {
      info = JSON.parse(excelAdditionalInfo) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!info || typeof info !== 'object') return;
    const cols = recalcFromInfo(info.indexCols);
    const rows = recalcFromInfo(info.indexRows);
    if (!cols && !rows) return;
    for (const lock of this.table.values()) {
      if (lock.user === userId) continue;
      const el = asBlock(lock.block);
      if (el.type !== LOCK_ELEM.Range || el.subType === LOCK_SUBTYPE.InsertColumns || el.subType === LOCK_SUBTYPE.InsertRows) {
        continue;
      }
      const sheetId = String(el.sheetId);
      const r = el.rangeOrObjectId as Record<string, unknown> | undefined;
      if (!r || typeof r !== 'object') continue;
      if (cols && Object.prototype.hasOwnProperty.call(cols, sheetId)) {
        r.c1 = cols[sheetId].lockMe2(num(r.c1));
        r.c2 = cols[sheetId].lockMe2(num(r.c2));
      }
      if (rows && Object.prototype.hasOwnProperty.call(rows, sheetId)) {
        r.r1 = rows[sheetId].lockMe2(num(r.r1));
        r.r2 = rows[sheetId].lockMe2(num(r.r2));
      }
    }
  }

  /** The table as the server sends it: an object keyed by lock key. */
  snapshot(): Record<string, Lock> {
    return Object.fromEntries(this.table);
  }

  /** The table as auth sends it: a text document's as an object, the others' as a list. */
  forAuth(): Record<string, Lock> | Lock[] {
    return this.editorType === EDITOR_TYPE.document ? this.snapshot() : [...this.table.values()];
  }

  get size(): number {
    return this.table.size;
  }
}
