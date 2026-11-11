// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The notice ONLYOFFICE's terms ask for (strings.ts legal), as the app page
// shows it: behind the "About this editor" button in the corner of the
// editor's frame (index.html #fx-about), at every opening; a click or a key
// opens a panel with the notice, whole, the source as a link. Pure: the
// page (main.ts) draws it, the tests read it.

import { sourceOf, type LegalFacts, type Strings } from './strings';

/** A run of the notice: text, or the source address as a link. */
export interface LegalPart {
  text: string;
  href?: string;
}

/**
 * The notice as runs of text, the source address (this app's tag, or the
 * repository for a build between releases) as a link. The runs joined are
 * the notice, unchanged.
 */
export function legalParts(t: Strings, o: LegalFacts): LegalPart[] {
  const text = t.legal(o);
  const source = sourceOf(o.app);
  const at = text.indexOf(source);
  if (at < 0) return [{ text }];
  const parts: LegalPart[] = [{ text: text.slice(0, at) }, { text: source, href: `https://${source}` }, { text: text.slice(at + source.length) }];
  return parts.filter((p) => p.text !== '');
}
