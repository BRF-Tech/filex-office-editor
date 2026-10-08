// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The app page and the converter's worker (worker/x2t-worker.ts).

export interface WorkerFile {
  name: string;
  bytes: ArrayBuffer;
}

/** A document written in another format (x2t.ts X2tExport, with the buffers as transferable ArrayBuffers). */
export interface WorkerExport {
  bin: string;
  media: WorkerFile[];
  formatTo: number;
  ext: string;
  pdf?: ArrayBuffer;
  fonts?: WorkerFile[];
  json?: string;
}

export type WorkerRequest =
  /** Load x2t from `base` (the package's x2t/ folder, ending in "/"). */
  | { t: 'start'; base: string }
  /** Convert one document; an Editor.bin from the editor comes as its text. */
  | { t: 'convert'; id: number; from: string; to: string; bytes: ArrayBuffer | string; media?: WorkerFile[] }
  /** Write the editor's document in another format ("Download as", Print). */
  | ({ t: 'export'; id: number } & WorkerExport);

export type WorkerReply =
  | { t: 'ready'; ms: number }
  | { t: 'failed'; message: string }
  | { t: 'result'; id: number; bytes?: ArrayBuffer; media?: WorkerFile[]; ms?: number; error?: string; code?: number | null };
