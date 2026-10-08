// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The messages between the ONLYOFFICE editor (sdkjs common/docscoapi.js) and
// a Document Server (server DocService/sources/DocsCoServer.js, 9.4), as far
// as the bridge has to speak them. Names and numbers are the editor's: the
// bridge answers in the Document Server's words so the editor needs no
// change at all.

/** The editor's type, as its auth message sends it (DocsCoServer EditorTypes). */
export const EDITOR_TYPE = {
  document: 0,
  spreadsheet: 1,
  presentation: 2,
  diagram: 3,
} as const;
export type EditorType = (typeof EDITOR_TYPE)[keyof typeof EDITOR_TYPE];

/** A spreadsheet lock's element (c_oAscLockTypeElem). */
export const LOCK_ELEM = { Range: 1, Object: 2, Sheet: 3 } as const;

/** A spreadsheet lock's subtype (c_oAscLockTypeElemSubType). */
export const LOCK_SUBTYPE = {
  DeleteColumns: 1,
  InsertColumns: 2,
  DeleteRows: 3,
  InsertRows: 4,
  ChangeProperties: 5,
} as const;

/** A presentation lock's element (c_oAscLockTypeElemPresentation). */
export const LOCK_PRESENTATION = { Object: 1, Slide: 2, Presentation: 3 } as const;

/** The license result the editor takes as "licensed" (c_LR.Success). */
export const LICENSE_SUCCESS = 3;
/** The editing right a Document Server grants (RIGHTS.Edit). */
export const RIGHTS_EDIT = 1;
/** c_oAscServerCommandErrors.NoError / NotModified / UnknownError. */
export const COMMAND_NO_ERROR = 0;
export const COMMAND_UNKNOWN_ERROR = 3;
export const COMMAND_NOT_MODIFIED = 4;
/** c_oAscForceSaveTypes.Button: a save the person asked for. */
export const FORCE_SAVE_BUTTON = 1;

/**
 * What one lock covers. A text document's block is a string (a paragraph's
 * or an object's id); a spreadsheet's and a presentation's is an object that
 * carries its own `guid`.
 */
export type LockBlock = string | Record<string, unknown>;

/** One held lock, in the Document Server's shape. */
export interface Lock {
  /** When it was taken: the relay's time of the lock entry, the same for everyone. */
  time: number;
  /** The holder's editor user id (its id + its indexUser). */
  user: string;
  block: LockBlock;
}

/** A held lock as releaseLock and saveChanges carry it. */
export interface ReleasedLock {
  block: LockBlock;
  user: string;
  time: number;
  changes: null;
}

/** One participant, the way the editor lists them (asc_CUser). */
export interface Participant {
  id: string;
  idOriginal: string;
  username: string;
  indexUser: number;
  view: boolean;
  connectionId: string;
  isCloseCoAuthoring: boolean;
}

/** One stored change, the way saveChanges and authChanges carry it. */
export interface StoredChange {
  docid: string;
  /** The change itself, JSON-encoded once more (the server stores it so). */
  change: string;
  time: number;
  user: string;
  useridoriginal: string;
}

/** Anything the editor sends; the bridge reads the fields it needs. */
export type EditorMessage = { type?: unknown } & Record<string, unknown>;

/** Anything the bridge sends the editor. */
export type ServerMessage = { type: string } & Record<string, unknown>;

/** The id the editor gives itself: the configured user id and its indexUser. */
export function editorUserId(idOriginal: string, indexUser: number): string {
  return `${idOriginal}${indexUser}`;
}
