// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The app page and the converter's worker (worker/x2t-worker.ts).

export interface WorkerFile {
  name: string;
  bytes: ArrayBuffer;
}

export type WorkerRequest =
  /** Load x2t from `base` (the package's x2t/ folder, ending in "/"). */
  | { t: 'start'; base: string }
  /** Convert one document; an Editor.bin from the editor comes as its text. */
  | { t: 'convert'; id: number; from: string; to: string; bytes: ArrayBuffer | string; media?: WorkerFile[] };

export type WorkerReply =
  | { t: 'ready'; ms: number }
  | { t: 'failed'; message: string }
  | { t: 'result'; id: number; bytes?: ArrayBuffer; media?: WorkerFile[]; ms?: number; error?: string; code?: number | null };
