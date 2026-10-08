// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The bridge: a Document Server for one editor, in the editor's frame.
//
// The ONLYOFFICE editor talks to its Document Server over socket.io. Here the
// socket is the shim (shim.ts) and the server is this class: it answers the
// editor's messages the way DocsCoServer.js (Docs 9.4) does, but everything
// that has to reach the other editors goes into the session's log instead of
// a database - sealed by the filex page, ordered by the relay - and comes back
// as entries, in the same order for everybody. Every bridge applies the same
// entries with the same rules, so they all reach the same document, the same
// lock table and the same participant list without a server that can read
// any of it.
//
// What goes into the log: change batches (saveChanges), lock requests
// (getLock), lock releases (unLockDocument). What does not: cursors (passed
// on, not kept), the save lock (the relay's lease: only a member that has
// seen every change gets it, as isSaveLock), the license and the auth answer
// (made here).
//
// A pseudo participant, the keeper, is always in the list: an editor that
// sees itself alone stops sending its changes as it makes them, and somebody
// may join at any moment. CryptPad's bridge does the same ("History").

import { LockTable } from './locks';
import {
  COMMAND_NO_ERROR,
  COMMAND_NOT_MODIFIED,
  COMMAND_UNKNOWN_ERROR,
  FORCE_SAVE_BUTTON,
  LICENSE_SUCCESS,
  RIGHTS_EDIT,
  editorUserId,
  type EditorMessage,
  type EditorType,
  type Lock,
  type LockBlock,
  type Participant,
  type ReleasedLock,
  type ServerMessage,
  type StoredChange,
} from './protocol';

/** A member of the session, as the relay's join entry gives it. */
export interface BridgeMember {
  /** The relay's id for the connection. */
  client: string;
  /**
   * The editor's configured user id (the Document Server's idOriginal). The
   * editor appends its indexUser to it, so it should end in a separator:
   * "u5-" + 12 and "u51-" + 2 stay apart.
   */
  user: string;
  name: string;
  /** Given by the relay, never twice in a session. */
  indexUser: number;
  canEdit: boolean;
}

/** One chunk of an editor's changes. */
export interface ChangesBody {
  /** The changes, as the editor serialised each one. */
  changes: unknown[];
  start: boolean;
  end: boolean;
  /** Where to cut the document's changes before these (the editor's undo of unsent work). */
  deleteIndex: number | null;
  releaseLocks: boolean;
  excel: boolean;
  coAuthoring: boolean;
  /** A spreadsheet's inserted/deleted rows and columns (last chunk). */
  excelInfo: string | null;
}

/** A lock request. */
export interface LockBody {
  blocks: LockBlock[];
}

/** A release of the writer's locks, and/or a cut of the document's changes. */
export interface ReleaseBody {
  deleteIndex: number | null;
  locks: boolean;
}

/** What a bridge asks to have appended to the log. */
export type BridgeAppend =
  | { kind: 'changes'; body: ChangesBody }
  | { kind: 'lock'; body: LockBody }
  | { kind: 'release'; body: ReleaseBody };

interface EntryBase {
  seq: number;
  /** The relay's time, Unix ms. */
  at: number;
  client: string;
}

/** One entry of the session's log, opened and checked by the filex page. */
export type BridgeEntry =
  | (EntryBase & BridgeAppend)
  | (EntryBase & { kind: 'join'; member: BridgeMember })
  | (EntryBase & { kind: 'leave' })
  | (EntryBase & { kind: 'saved'; through: number });

/** What the bridge needs from the frame around it. */
export interface BridgeHost {
  /** Hand a message to the editor (through the shim's socket). */
  toEditor(msg: ServerMessage): void;
  /**
   * Seal this and put it in the log. It comes back through onEntry once the
   * relay placed it; a conflict is the host's to retry, never the bridge's.
   */
  append(entry: BridgeAppend): void;
  /** Ask for (or give back) the changes lease. The answer comes to onLease. */
  lease(op: 'acquire' | 'release', changesSeen: number): void;
  /** Pass a cursor to the others (not kept). */
  cursor(body: { cursor: unknown }): void;
  /** The person pressed Save: write the file now. The result comes to saved(). */
  save(): void;
  /** Something the bridge does not do (yet), for the frame's diagnostics. */
  notice?(what: string, detail?: unknown): void;
}

export interface BridgeOptions {
  me: BridgeMember;
  editorType: EditorType;
  /** The editor's own build, which a Document Server would announce (auth, license). */
  build: { version: string; number: number };
  /** documentOpen's map: 'Editor.bin' and every 'media/<name>', as addresses the editor can load. */
  documentUrls: Record<string, string>;
  host: BridgeHost;
  /** The editor cuts its change batches at this many bytes (sdkjs default 1.5 MB). */
  maxPayload?: number;
  /** The name the keeper shows in the editor's list of people. */
  keeperName?: string;
  /** The document id the editor was configured with. */
  docId?: string;
  now?: () => number;
}

/** The keeper's ids. Its index is 0: the relay starts members at 1. */
export const KEEPER_USER = 'filex-keeper-';
export const KEEPER_INDEX = 0;

const DEFAULT_MAX_PAYLOAD = 1572864;
/** The Document Server's image limits (limits_image_size; no SVG, which can carry script). */
const IMAGE_MAX_BYTES = 26214400;
const IMAGE_TYPES = 'jpg;jpeg;jpe;png;gif;bmp;tiff;tif';

function releasedShape(l: Lock, time: number): ReleasedLock {
  return { block: l.block, user: l.user, time, changes: null };
}

/** The Document Server's change time: its clock, to the second. */
function changeTime(at: number): number {
  return Math.floor(at / 1000) * 1000;
}

export class OfficeBridge {
  private readonly locks: LockTable;
  private readonly members = new Map<string, BridgeMember>();
  /** Every change since the base, in the shape authChanges carries. */
  private readonly changes: StoredChange[] = [];
  private lastSeq = 0;
  /** The seq of the last changes entry: what the lease is asked with. */
  private changesSeq = 0;
  private savedThrough = 0;
  private open = false;
  private authPending = false;
  private authed = false;
  private awaitingLease = false;
  private saveTime: number | null = null;
  private readonly now: () => number;

  constructor(private readonly o: BridgeOptions) {
    this.locks = new LockTable(o.editorType);
    this.now = o.now ?? (() => Date.now());
  }

  private get me(): BridgeMember {
    return this.o.me;
  }

  private send(msg: ServerMessage): void {
    this.o.host.toEditor(msg);
  }

  /** Live messages wait until the editor is authorised; the auth answer carries the state up to then. */
  private live(msg: ServerMessage): void {
    if (this.authed) this.send(msg);
  }

  private notice(what: string, detail?: unknown): void {
    this.o.host.notice?.(what, detail);
  }

  // -------------------------------------------------------------------------
  // The frame
  // -------------------------------------------------------------------------

  /** The editor's socket connected: a Document Server's first word is the license. */
  connect(): void {
    this.send({
      type: 'license',
      license: {
        type: LICENSE_SUCCESS,
        light: false,
        mode: 0,
        rights: RIGHTS_EDIT,
        buildVersion: this.o.build.version,
        buildNumber: this.o.build.number,
        protectionSupport: false,
        isAnonymousSupport: true,
        liveViewerSupport: false,
        branding: false,
        customization: false,
      },
    });
  }

  /**
   * The log up to now has been read (onEntry for every entry before this
   * member joined and its own join): an editor waiting for its auth answer
   * gets it now, with all of it.
   */
  start(): void {
    this.open = true;
    this.answerAuth();
  }

  /** The relay's answer to lease(). */
  onLease(granted: boolean): void {
    if (!this.awaitingLease) {
      // Nobody asked any more: do not sit on it.
      if (granted) this.o.host.lease('release', this.changesSeq);
      return;
    }
    this.awaitingLease = false;
    this.send({ type: 'saveLock', saveLock: !granted });
  }

  /** The save the person asked for is written (or failed). */
  saved(success: boolean): void {
    if (this.saveTime === null) return;
    const time = this.saveTime;
    this.saveTime = null;
    this.send({ type: 'forceSave', messages: { type: FORCE_SAVE_BUTTON, time, success } });
  }

  /** Another member's cursor. */
  onCursor(client: string, body: { cursor?: unknown }): void {
    const m = this.members.get(client);
    if (!m || client === this.me.client) return;
    this.live({
      type: 'cursor',
      messages: [{ cursor: body.cursor, time: this.now(), user: editorUserId(m.user, m.indexUser), useridoriginal: m.user }],
    });
  }

  /** True when the log holds changes no save has. */
  get dirty(): boolean {
    return this.changesSeq > this.savedThrough;
  }

  /** The participants as the editor lists them, the keeper first. */
  participants(): Participant[] {
    const keeper: Participant = {
      id: editorUserId(KEEPER_USER, KEEPER_INDEX),
      idOriginal: KEEPER_USER,
      username: this.o.keeperName ?? 'filex',
      indexUser: KEEPER_INDEX,
      view: false,
      connectionId: 'filex-keeper',
      isCloseCoAuthoring: false,
    };
    const people = [...this.members.values()].map((m) => ({
      id: editorUserId(m.user, m.indexUser),
      idOriginal: m.user,
      username: m.name,
      indexUser: m.indexUser,
      view: !m.canEdit,
      connectionId: m.client,
      isCloseCoAuthoring: false,
    }));
    return [keeper, ...people];
  }

  /** How many changes the document has had since the base. */
  get changeCount(): number {
    return this.changes.length;
  }

  /** The lock table as this bridge holds it (diagnostics: every bridge's must be the same). */
  lockSnapshot(): Record<string, Lock> {
    return this.locks.snapshot();
  }

  // -------------------------------------------------------------------------
  // The editor
  // -------------------------------------------------------------------------

  /** A message from the editor (through the shim). */
  fromEditor(msg: EditorMessage): void {
    switch (msg.type) {
      case 'auth':
        this.authPending = true;
        this.answerAuth();
        return;
      case 'getLock':
        this.onGetLock(msg);
        return;
      case 'isSaveLock':
        this.onIsSaveLock(msg);
        return;
      case 'saveChanges':
        this.onSaveChanges(msg);
        return;
      case 'unSaveLock':
        // An emergency release without saving.
        this.o.host.lease('release', this.changesSeq);
        this.send({ type: 'unSaveLock', index: -1, time: -1, syncChangesIndex: -1 });
        return;
      case 'unLockDocument':
        this.onUnlockDocument(msg);
        return;
      case 'cursor':
        if (this.me.canEdit) this.o.host.cursor({ cursor: msg.cursor });
        return;
      case 'forceSaveStart':
        this.onForceSaveStart();
        return;
      case 'authChangesAck':
      case 'clientLog':
      case 'extendSession':
      case 'close':
      case 'getMessages':
      case 'message':
        // Acknowledged, logged or idle-tracked by a Document Server; chat is off.
        return;
      default:
        // openDocument (images by address), rpc: not in the prototype.
        this.notice('unsupported', msg.type);
    }
  }

  private answerAuth(): void {
    if (!this.authPending || !this.open) return;
    this.authPending = false;
    this.authed = true;
    const max = this.o.maxPayload ?? DEFAULT_MAX_PAYLOAD;
    // authChanges in chunks the way the server cuts them.
    let from = 0;
    while (from < this.changes.length) {
      let to = from;
      let bytes = 0;
      while (to < this.changes.length && bytes < max) {
        bytes += JSON.stringify(this.changes[to]).length + 24;
        to++;
      }
      this.send({ type: 'authChanges', changes: this.changes.slice(from, to) });
      from = to;
    }
    this.send({
      type: 'auth',
      result: 1,
      sessionId: this.me.client,
      sessionTimeConnect: this.now(),
      participants: this.participants(),
      locks: this.locks.forAuth(),
      indexUser: this.me.indexUser,
      buildVersion: this.o.build.version,
      buildNumber: this.o.build.number,
      licenseType: LICENSE_SUCCESS,
      settings: {
        websocketMaxPayloadSize: max,
        limits_image_size: IMAGE_MAX_BYTES,
        limits_image_types_upload: IMAGE_TYPES,
      },
    });
    this.send({ type: 'documentOpen', data: { type: 'open', status: 'ok', data: { ...this.o.documentUrls } } });
  }

  /** A member that may not write sends nothing that writes (the server would drop it). */
  private refuse(what: string): boolean {
    if (this.me.canEdit) return false;
    this.notice('read-only', `${what} from a member that may not write`);
    return true;
  }

  private onGetLock(msg: EditorMessage): void {
    if (this.refuse('getLock')) return;
    const blocks = Array.isArray(msg.block) ? (msg.block as LockBlock[]) : [];
    this.o.host.append({ kind: 'lock', body: { blocks } });
  }

  private onIsSaveLock(msg: EditorMessage): void {
    if (!this.me.canEdit) {
      this.send({ type: 'saveLock', saveLock: true });
      return;
    }
    // An editor that has not received every change is not synced: it waits
    // (the server's "unsynced" answer), it does not get to write.
    const sync = typeof msg.syncChangesIndex === 'number' ? msg.syncChangesIndex : 0;
    if (sync && sync !== this.changes.length) {
      this.send({ type: 'saveLock', saveLock: true });
      return;
    }
    this.awaitingLease = true;
    this.o.host.lease('acquire', this.changesSeq);
  }

  private onSaveChanges(msg: EditorMessage): void {
    if (this.refuse('saveChanges')) return;
    if (typeof msg.changes !== 'string') {
      this.notice('unsupported', 'binary changes');
      return;
    }
    let changes: unknown;
    try {
      changes = JSON.parse(msg.changes);
    } catch {
      this.notice('malformed', 'saveChanges');
      return;
    }
    if (!Array.isArray(changes)) {
      this.notice('malformed', 'saveChanges');
      return;
    }
    this.o.host.append({
      kind: 'changes',
      body: {
        changes,
        start: msg.startSaveChanges === true,
        end: msg.endSaveChanges === true,
        deleteIndex: typeof msg.deleteIndex === 'number' ? msg.deleteIndex : null,
        releaseLocks: msg.releaseLocks === true,
        excel: msg.isExcel === true,
        coAuthoring: msg.isCoAuthoring !== false,
        excelInfo: typeof msg.excelAdditionalInfo === 'string' ? msg.excelAdditionalInfo : null,
      },
    });
  }

  private onUnlockDocument(msg: EditorMessage): void {
    const deleteIndex = typeof msg.deleteIndex === 'number' ? msg.deleteIndex : null;
    const releaseLocks = msg.releaseLocks === true;
    if (this.me.canEdit && (releaseLocks || (deleteIndex !== null && deleteIndex !== -1))) {
      this.o.host.append({ kind: 'release', body: { deleteIndex, locks: releaseLocks } });
    }
    if (msg.isSave === true) {
      this.o.host.lease('release', this.changesSeq);
      this.send({ type: 'unSaveLock', index: -1, time: -1, syncChangesIndex: -1 });
    }
  }

  private onForceSaveStart(): void {
    if (!this.me.canEdit) {
      this.send({ type: 'forceSaveStart', messages: { code: COMMAND_UNKNOWN_ERROR, time: null } });
      return;
    }
    if (!this.dirty) {
      this.send({ type: 'forceSaveStart', messages: { code: COMMAND_NOT_MODIFIED, time: null, inProgress: false } });
      return;
    }
    const time = this.now();
    this.saveTime = time;
    this.send({ type: 'forceSaveStart', messages: { code: COMMAND_NO_ERROR, time, inProgress: false } });
    this.o.host.save();
  }

  // -------------------------------------------------------------------------
  // The log
  // -------------------------------------------------------------------------

  /**
   * The next entry of the session's log, opened and checked. Entries come in
   * order, each once; anything else is a bug in the frame, and the bridge
   * says so rather than build a different document from the others.
   */
  onEntry(e: BridgeEntry): void {
    if (e.seq !== this.lastSeq + 1) {
      throw new Error(`office-e2e: entry ${e.seq} after ${this.lastSeq}`);
    }
    this.lastSeq = e.seq;
    switch (e.kind) {
      case 'join':
        this.applyJoin(e.member, e.at);
        return;
      case 'leave':
        this.applyLeave(e.client, e.at);
        return;
      case 'saved':
        this.savedThrough = Math.max(this.savedThrough, e.through);
        return;
    }
    const author = this.members.get(e.client);
    if (!author) {
      // The relay writes a member's join before its first entry; no join, no
      // author to attribute the entry to.
      throw new Error(`office-e2e: entry ${e.seq} from ${e.client}, who never joined`);
    }
    switch (e.kind) {
      case 'changes':
        this.applyChanges(e.seq, e.at, author, e.body);
        return;
      case 'lock':
        this.applyLock(e.at, author, e.body);
        return;
      case 'release':
        this.applyRelease(e.at, author, e.body);
        return;
    }
  }

  private isMine(m: BridgeMember): boolean {
    return m.client === this.me.client;
  }

  private cut(deleteIndex: number | null): boolean {
    if (deleteIndex === null || deleteIndex === -1) return false;
    if (deleteIndex >= 0 && deleteIndex < this.changes.length) this.changes.length = deleteIndex;
    return true;
  }

  /** saveChanges, as DocsCoServer.js does it, with the relay's order for its database. */
  private applyChanges(seq: number, at: number, author: BridgeMember, b: ChangesBody): void {
    const authorId = editorUserId(author.user, author.indexUser);
    const cut = b.start && this.cut(b.deleteIndex);
    const startIndex = this.changes.length;
    const time = changeTime(at);
    const fresh: StoredChange[] = [];
    for (const c of b.changes) {
      const stored = { docid: this.o.docId ?? '', change: JSON.stringify(c), time, user: authorId, useridoriginal: author.user };
      fresh.push(stored);
      this.changes.push(stored);
    }
    const total = this.changes.length;
    const changesIndex = !cut && b.start ? startIndex : -1;
    this.changesSeq = seq;
    const mine = this.isMine(author);
    if (b.end) {
      if (b.excel && b.coAuthoring && b.excelInfo) this.locks.recalcExcel(authorId, b.excelInfo);
      const released = b.releaseLocks ? this.locks.releaseUser(authorId) : [];
      if (mine) {
        this.send({ type: 'unSaveLock', index: changesIndex, time, syncChangesIndex: total });
        this.o.host.lease('release', seq);
        return;
      }
      this.live({
        type: 'saveChanges',
        changes: fresh,
        changesIndex: total,
        syncChangesIndex: total,
        endSaveChanges: true,
        locks: released.map((l) => releasedShape(l, at)),
        excelAdditionalInfo: b.excelInfo ?? undefined,
      });
      return;
    }
    if (mine) {
      this.send({ type: 'savePartChanges', changesIndex, syncChangesIndex: total });
      return;
    }
    this.live({
      type: 'saveChanges',
      changes: fresh,
      changesIndex: total,
      syncChangesIndex: total,
      endSaveChanges: false,
      locks: [],
    });
  }

  /** getLock: the same rules on the same table everywhere; the answer goes to everybody who may write. */
  private applyLock(at: number, author: BridgeMember, b: LockBody): void {
    const table = this.locks.request(editorUserId(author.user, author.indexUser), b.blocks, at);
    if (this.isMine(author) || this.me.canEdit) this.live({ type: 'getLock', locks: table });
  }

  /** unLockDocument: cut the changes and/or release the writer's locks. */
  private applyRelease(at: number, author: BridgeMember, b: ReleaseBody): void {
    this.cut(b.deleteIndex);
    if (!b.locks) return;
    const removed = this.locks.releaseUser(editorUserId(author.user, author.indexUser));
    if (removed.length > 0 && (this.isMine(author) || this.me.canEdit)) {
      this.live({ type: 'releaseLock', locks: removed.map((l) => releasedShape(l, at)) });
    }
  }

  private applyJoin(m: BridgeMember, at: number): void {
    this.members.set(m.client, m);
    if (m.client === this.me.client) return;
    this.live({ type: 'connectState', participantsTimestamp: at, participants: this.participants(), waitAuth: false });
  }

  /** closeDocument: the others learn who left, and its locks go. */
  private applyLeave(client: string, at: number): void {
    const m = this.members.get(client);
    if (!m || client === this.me.client) return;
    this.members.delete(client);
    const removed = this.locks.releaseUser(editorUserId(m.user, m.indexUser));
    this.live({ type: 'connectState', participantsTimestamp: at, participants: this.participants(), waitAuth: false });
    if (removed.length > 0 && this.me.canEdit) {
      this.live({ type: 'releaseLock', locks: removed.map((l) => releasedShape(l, at)) });
    }
  }
}
