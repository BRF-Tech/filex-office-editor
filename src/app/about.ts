// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The notice ONLYOFFICE's terms ask for (strings.ts legal), as the app page
// shows it: behind the "About this editor" button in the corner of the
// editor's frame (index.html #fx-about), at every opening; a click or a key
// opens a panel with the notice, whole, the source address in it as plain
// text to select and copy. Pure: the page (main.ts) draws it, the tests read
// it.

import { sourceOf, type LegalFacts, type Strings } from './strings';

/** A run of the notice: text, the source address marked as such. */
export interface LegalPart {
  text: string;
  /** The source address: drawn apart so that it is easy to select, never a link. */
  source?: true;
}

/**
 * The notice as runs of text, the source address (this app's tag, or the
 * repository for a build between releases) a run of its own. The runs
 * joined are the notice, unchanged.
 *
 * The address is not a link: filex draws the app's page in a sandbox that
 * may open no tab, so a link there would do nothing when clicked. The
 * person selects the address and copies it, as any text.
 */
export function legalParts(t: Strings, o: LegalFacts): LegalPart[] {
  const text = t.legal(o);
  const source = sourceOf(o.app);
  const at = text.indexOf(source);
  if (at < 0) return [{ text }];
  const parts: LegalPart[] = [{ text: text.slice(0, at) }, { text: source, source: true }, { text: text.slice(at + source.length) }];
  return parts.filter((p) => p.text !== '');
}
