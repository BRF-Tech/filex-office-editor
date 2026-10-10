// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Editing together (filex 0.56, `coedit.*`): what filex says about a session,
// in the bridge's words, and the rules every member derives from the same log
// without asking anybody - who saves, who is the last writer, which images a
// change needs. Pure: no window, no filex, so the tests read it as it is.
//
// filex seals what a member appends, orders it through its relay and hands
// every member the same entries in the same order (`coedit.entry`); the app
// never holds a key (filex docs/APP-PLUGINS-API.md → Editing together). The
// bridge (bridge.ts) was written against exactly that log, so an entry from
// filex becomes a BridgeEntry with nothing added but the editor's user id.

import type { BridgeEntry, BridgeMember, ChangesBody, LockBody, ReleaseBody } from './bridge';
import { EDITOR_USER_ID } from './frame-protocol';

/** A member of the session, as filex says it (CoEditMember, filex 0.55+). */
export interface CoEditMember {
  /** The relay's id for the connection. */
  client: string;
  /** An opaque id of the person in this session; never an account id. */
  user: string;
  name: string;
  /** The editor's per-session user index: given once, never twice. */
  indexUser: number;
  canEdit: boolean;
}

/** What `coedit.join` answers (CoEditHello; `created` is filex 0.56's). */
export interface CoEditHello {
  session: string;
  me: CoEditMember;
  head: number;
  changesHead: number;
  savedThrough: number;
  /**
   * This member started the session: it puts the base document - exactly
   * the bytes it opened - before anybody else can join. A member that did
   * not start it opens the base, never the file.
   */
  created: boolean;
}

/** One entry of the session's log, opened and checked by filex (CoEditEntry). */
export type CoEditEntry =
  | { seq: number; at: number; client: string; kind: 'changes'; body: ChangesBody }
  | { seq: number; at: number; client: string; kind: 'lock'; body: LockBody }
  | { seq: number; at: number; client: string; kind: 'release'; body: ReleaseBody }
  | { seq: number; at: number; client: string; kind: 'join'; member: CoEditMember }
  | { seq: number; at: number; client: string; kind: 'leave' }
  | { seq: number; at: number; client: string; kind: 'saved'; through: number };

/** Another member's cursor (`coedit.cursor` event). */
export interface CoEditCursor {
  client: string;
  cursor: unknown;
}

/**
 * filex stopped handing entries over (`coedit.dropped`): `gone` - the
 * membership ended, join again; `broken` - an entry did not check out, stop
 * editing together.
 */
export interface CoEditDropped {
  from: number;
  reason?: 'gone' | 'broken' | string;
}

/** The base document's name among the session's blobs. */
export const BASE_BLOB = 'base';

/** The blob an inserted image is kept under: "m." and its name in the document. */
export function mediaBlobName(name: string): string {
  return `m.${name}`;
}

/**
 * The names this app gives an image a person inserts (frame/images.ts
 * randomName): `image_fx` and 16 hex digits. Only these travel between the
 * members as blobs - every other image is in the base document already.
 */
export const INSERTED_IMAGE = /image_fx[0-9a-f]{16}\.(?:png|jpg|gif|bmp|tiff)/g;

/** The inserted images a batch of changes refers to, each once, in order. */
export function mediaNamesIn(changes: unknown): string[] {
  let text: string;
  try {
    text = typeof changes === 'string' ? changes : JSON.stringify(changes ?? '');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const m of text.matchAll(INSERTED_IMAGE)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

/**
 * The id the editor is configured with for this member, and the bridge's
 * idOriginal for it: every member's must differ (the editor builds its own
 * user id, and its objects' ids, from it), and end in a separator (the
 * editor appends its indexUser).
 */
export function editorIdOf(user: string): string {
  const safe = String(user ?? '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
  return `${EDITOR_USER_ID}${safe}-`;
}

/** A member as the bridge lists it. */
export function bridgeMember(m: CoEditMember): BridgeMember {
  return {
    client: String(m.client),
    user: editorIdOf(m.user),
    name: String(m.name ?? ''),
    indexUser: Number(m.indexUser),
    canEdit: m.canEdit === true,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * An entry filex handed over, as the bridge takes it; null for anything that
 * is not one (a kind nobody writes, a member without its fields). filex has
 * checked the seal, the order and the counters; what is checked here is the
 * shape, so a member that writes nonsense breaks nobody's bridge.
 */
export function toBridgeEntry(e: unknown): BridgeEntry | null {
  if (!isObject(e)) return null;
  const seq = e.seq;
  const at = e.at;
  const client = e.client;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return null;
  if (typeof at !== 'number' || typeof client !== 'string') return null;
  const base = { seq, at, client };
  switch (e.kind) {
    case 'join': {
      const m = e.member;
      if (!isObject(m) || typeof m.client !== 'string' || typeof m.user !== 'string' || typeof m.indexUser !== 'number') return null;
      return { ...base, kind: 'join', member: bridgeMember(m as unknown as CoEditMember) };
    }
    case 'leave':
      return { ...base, kind: 'leave' };
    case 'saved':
      return typeof e.through === 'number' ? { ...base, kind: 'saved', through: e.through } : null;
    case 'changes': {
      const b = e.body;
      if (!isObject(b) || !Array.isArray(b.changes)) return null;
      return {
        ...base,
        kind: 'changes',
        body: {
          changes: b.changes,
          start: b.start === true,
          end: b.end === true,
          deleteIndex: typeof b.deleteIndex === 'number' ? b.deleteIndex : null,
          releaseLocks: b.releaseLocks === true,
          excel: b.excel === true,
          coAuthoring: b.coAuthoring !== false,
          excelInfo: typeof b.excelInfo === 'string' ? b.excelInfo : null,
        },
      };
    }
    case 'lock': {
      const b = e.body;
      if (!isObject(b) || !Array.isArray(b.blocks)) return null;
      return { ...base, kind: 'lock', body: { blocks: b.blocks as LockBody['blocks'] } };
    }
    case 'release': {
      const b = e.body;
      if (!isObject(b)) return null;
      return { ...base, kind: 'release', body: { deleteIndex: typeof b.deleteIndex === 'number' ? b.deleteIndex : null, locks: b.locks === true } };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Who saves (the #189 policy, filex core lib/e2eofficeSave.ts, kept here)
// ---------------------------------------------------------------------------

/** A version every ten minutes while there are unsaved changes. */
export const TOGETHER_AUTOSAVE_MS = 10 * 60 * 1000;

/** One member, as the log says it joined. */
export interface SaveMember {
  client: string;
  /** The seq of its join entry: the earlier, the older. */
  joinSeq: number;
  canEdit: boolean;
}

/** What every member derives from the log, the same everywhere. */
export interface SaveState {
  members: SaveMember[];
  /** The seq of the last changes entry. */
  changesHead: number;
  /** The last entry the file holds (the last saved entry's `through`). */
  savedThrough: number;
  /** When (relay time, ms) the first change after the last save landed; null when saved. */
  dirtySince: number | null;
}

export function emptySaveState(): SaveState {
  return { members: [], changesHead: 0, savedThrough: 0, dirtySince: null };
}

/** The state after one more entry. Pure: the same log gives the same state. */
export function foldSave(s: SaveState, e: BridgeEntry): SaveState {
  switch (e.kind) {
    case 'join':
      return {
        ...s,
        members: [...s.members.filter((m) => m.client !== e.member.client), { client: e.member.client, joinSeq: e.seq, canEdit: e.member.canEdit }],
      };
    case 'leave':
      return { ...s, members: s.members.filter((m) => m.client !== e.client) };
    case 'changes':
      return { ...s, changesHead: e.seq, dirtySince: s.dirtySince ?? e.at };
    case 'saved': {
      if (e.through < s.savedThrough) return s;
      const clean = e.through >= s.changesHead;
      return { ...s, savedThrough: e.through, dirtySince: clean ? null : s.dirtySince };
    }
    default:
      return s;
  }
}

/** The log holds changes no save has. */
export function unsaved(s: SaveState): boolean {
  return s.changesHead > s.savedThrough;
}

/** The writer online who joined first: the one who writes the ten-minute versions. */
export function saverOf(s: SaveState): string | null {
  let best: SaveMember | null = null;
  for (const m of s.members) if (m.canEdit && (!best || m.joinSeq < best.joinSeq)) best = m;
  return best ? best.client : null;
}

/** Nobody else who may write is in the session: closing would leave its unsaved changes to nobody. */
export function lastWriter(s: SaveState, me: string): boolean {
  return !s.members.some((m) => m.canEdit && m.client !== me);
}

/** Whether `me` writes a version now (relay time `now`): it is the saver, and the changes are ten minutes old. */
export function autosaveDue(s: SaveState, me: string, now: number): boolean {
  return unsaved(s) && s.dirtySince !== null && saverOf(s) === me && now - s.dirtySince >= TOGETHER_AUTOSAVE_MS;
}
