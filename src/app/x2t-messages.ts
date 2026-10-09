// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The app page and the converter's worker (worker/x2t-worker.ts).

import type { TextOptions } from '../formats';

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
  /** For txt and csv: the encoding and the delimiter (formats.ts textOptions). */
  text?: TextOptions;
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
  /** x2t could not start (the reason, in English). */
  | { t: 'failed'; message: string }
  /**
   * x2t stopped after it started (an abort, a trap, the stack or memory
   * running out: x2t.ts stopsX2t), with why (x2t.ts x2tStopReason). The
   * module cannot be used again: the page ends the worker and starts another
   * for the next conversion. Comes before the result of the conversion that
   * stopped it.
   */
  | { t: 'stopped'; message: string }
  | { t: 'result'; id: number; bytes?: ArrayBuffer; media?: WorkerFile[]; ms?: number; error?: string; code?: number | null };
