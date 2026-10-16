// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// How the opened file goes into the editor and back: what x2t is told on the
// way in and on the way out, and what filex is asked to write. Pure: the app
// page and the tests read it as it is (docs/PARITY.md rows A3, A4, A5, A10).

import { csvText, writtenDialect, type CsvDialect } from '../csv';
import { CANVAS, besideKind, type Kind } from '../kinds';
import type { ConvertOptions } from '../x2t';

/** The opened document: its kind, a csv's dialect, the password it opened with. */
export interface OpenedDocument {
  kind: Kind;
  csv: CsvDialect | null;
  password?: string;
}

/** x2t's options for the way in: the editor's type (by the extension alone x2t refuses doc, xls, ppt and csv), a csv's delimiter, the password. */
export function openOptions(d: OpenedDocument): ConvertOptions {
  const o: ConvertOptions = { formatTo: CANVAS[d.kind.documentType] };
  if (d.csv) o.text = csvText(d.csv);
  if (d.password) o.password = d.password;
  return o;
}

/** Where a save goes: the file's own format, or OOXML beside it when x2t cannot write the file's own. */
export interface SaveTarget {
  ext: string;
  mime: string;
  formatTo: number;
  /** filex writes the save beside the file, and names it. */
  beside: boolean;
}

export function saveTarget(k: Kind): SaveTarget {
  const b = besideKind(k);
  if (b) return { ext: b.ext, mime: b.mime, formatTo: b.writes ?? 0, beside: true };
  return { ext: k.ext, mime: k.mime, formatTo: k.writes ?? 0, beside: false };
}

/** x2t's options for the way out: the target's type, a csv's delimiter, the password the file stays protected with. */
export function saveOptions(d: OpenedDocument): ConvertOptions {
  const o: ConvertOptions = { formatTo: saveTarget(d.kind).formatTo };
  if (d.csv) o.text = csvText(d.csv);
  if (d.password) o.savePassword = d.password;
  return o;
}

/**
 * What file.save is asked beyond the bytes (filex 0.57): `beside` - write it
 * next to the file, in this format, under a name filex chooses (the file
 * itself is left as it is); `csv` - the dialect the bytes are in, which
 * filex checks against them and turns into the file's own; `conflict:
 * 'copy'` - when the file was changed by someone else after it was read,
 * the save becomes a conflict copy beside it (`<name>.filex-conflict-<time>`,
 * named in the answer) instead of a refusal, as a Document Server's save
 * does (docs/PARITY.md A9). filex notices the change against the version
 * its read answered with (X-Filex-Version), which the frame sends with the
 * save itself; for a file of an encrypted folder or a vault the option has
 * no effect (a changed file is refused there as before).
 */
export function saveExtra(d: OpenedDocument, bytes: Uint8Array): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const target = saveTarget(d.kind);
  if (target.beside) out.beside = target.ext;
  if (d.csv) out.csv = writtenDialect(bytes, d.csv.delimiter);
  out.conflict = 'copy';
  return out;
}

/** x2t's return codes for a protected document (AVS_FILEUTILS_ERROR_CONVERT_DRM, _PASSWORD): one without a password, or the wrong one. */
export const NEEDS_PASSWORD = 90;
export const WRONG_PASSWORD = 91;

/** The conversion failed for want of the (right) password. */
export function wantsPassword(code: number | null | undefined): boolean {
  return code === NEEDS_PASSWORD || code === WRONG_PASSWORD;
}
