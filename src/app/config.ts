// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// What the app page tells ONLYOFFICE's editor (DocsAPI.DocEditor's
// configuration), from what filex tells the app (session.get). Pure: no
// document, no window, so the tests read it as it is.

import { EDITOR_USER_ID } from '../frame-protocol';

export type DocumentType = 'word' | 'cell' | 'slide';

export interface Kind {
  /** The file's format, as x2t names it. */
  ext: 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp';
  documentType: DocumentType;
  /** The bridge's EditorType: 0 text, 1 spreadsheet, 2 presentation. */
  editorType: 0 | 1 | 2;
  mime: string;
  /** The blank document of this kind in the package (an empty file opens as one). */
  blank: string;
}

const KINDS: Record<string, Kind> = {
  docx: {
    ext: 'docx',
    documentType: 'word',
    editorType: 0,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    blank: 'editor/document-templates/new/default/new.docx.bin',
  },
  xlsx: {
    ext: 'xlsx',
    documentType: 'cell',
    editorType: 1,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    blank: 'editor/document-templates/new/default/new.xlsx.bin',
  },
  pptx: {
    ext: 'pptx',
    documentType: 'slide',
    editorType: 2,
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    blank: 'editor/document-templates/new/default/new.pptx.bin',
  },
  odt: {
    ext: 'odt',
    documentType: 'word',
    editorType: 0,
    mime: 'application/vnd.oasis.opendocument.text',
    blank: '',
  },
  ods: {
    ext: 'ods',
    documentType: 'cell',
    editorType: 1,
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    blank: '',
  },
  odp: {
    ext: 'odp',
    documentType: 'slide',
    editorType: 2,
    mime: 'application/vnd.oasis.opendocument.presentation',
    blank: '',
  },
};

/** The kind of document a file is, by its extension (with or without the dot); null: not one the app opens. */
export function kindOf(ext: string | undefined | null): Kind | null {
  const e = String(ext ?? '')
    .replace(/^\./, '')
    .toLowerCase();
  return Object.prototype.hasOwnProperty.call(KINDS, e) ? KINDS[e] : null;
}

/** The languages the app's own words come in. */
export type UiLang = 'en' | 'tr';

/** "tr-TR", "tr", "TR" → "tr"; anything else this app has no words for → "en". */
export function uiLang(locale: string | undefined | null): UiLang {
  return /^tr(?:[-_]|$)/i.test(String(locale ?? '')) ? 'tr' : 'en';
}

/**
 * The editor's language: the locale's language part, when it is a plain
 * one ("de-AT" → "de"). The editor falls back to English for a language it
 * has no translation of.
 */
export function editorLang(locale: string | undefined | null): string {
  const m = /^([a-z]{2,3})(?:[-_]([A-Za-z]{2}))?/i.exec(String(locale ?? ''));
  return m ? m[1].toLowerCase() : 'en';
}

/** The editor's region (number and date formats): "tr" → "tr-TR". */
export function editorRegion(locale: string | undefined | null): string {
  const m = /^([a-z]{2,3})(?:[-_]([A-Za-z]{2}))?$/i.exec(String(locale ?? ''));
  if (!m) return 'en-US';
  const lang = m[1].toLowerCase();
  if (m[2]) return `${lang}-${m[2].toUpperCase()}`;
  return lang === 'en' ? 'en-US' : `${lang}-${lang.toUpperCase()}`;
}

/** ONLYOFFICE's default light and dark themes (9.x). */
export const THEME_LIGHT = 'theme-white';
export const THEME_DARK = 'theme-night';

export interface ConfigInput {
  kind: Kind;
  title: string;
  /** The document's key for this opening (the editor's docId). */
  key: string;
  locale: string;
  dark: boolean;
  userName: string;
  canEdit: boolean;
  /** The events the app page listens to. */
  events?: Record<string, (e: { data?: unknown }) => void>;
}

/**
 * DocsAPI.DocEditor's configuration. The editor runs as against a Document
 * Server, in "fast" co-editing (changes go to the bridge as they are made),
 * with Save asking the bridge (forcesave). Everything that would reach a
 * server the bridge does not answer is off: plugins, macros, chat, the
 * spell checker's server, the help pages (not in the bundle), the feedback
 * and "go back" links, and - for now - Download as and Print (a Document
 * Server converts for both). ONLYOFFICE's logo and About stay (its terms ask the
 * logo to be kept; About names the version and its authors).
 */
export function editorConfig(o: ConfigInput): Record<string, unknown> {
  const edit = o.canEdit;
  return {
    type: 'desktop',
    width: '100%',
    height: '100%',
    documentType: o.kind.documentType,
    document: {
      fileType: o.kind.ext,
      key: o.key,
      title: o.title,
      // Required by api.js; the editor never fetches it (the bridge hands it
      // the document), and it is no address a request could go to.
      url: 'filex:document',
      permissions: {
        edit,
        review: edit,
        comment: edit,
        fillForms: edit,
        modifyFilter: edit,
        modifyContentControl: edit,
        download: false,
        // A Document Server prints by converting to PDF on the server; here
        // that is x2t's job, which the app does not do yet.
        print: false,
        copy: true,
        chat: false,
        protect: false,
      },
    },
    editorConfig: {
      mode: edit ? 'edit' : 'view',
      lang: editorLang(o.locale),
      region: editorRegion(o.locale),
      user: { id: EDITOR_USER_ID, name: o.userName },
      coEditing: { mode: 'fast', change: false },
      plugins: { autostart: [], pluginsData: [] },
      customization: {
        forcesave: true,
        autosave: true,
        uiTheme: o.dark ? THEME_DARK : THEME_LIGHT,
        comments: true,
        help: false,
        feedback: false,
        goback: false,
        plugins: false,
        macros: false,
        mentionShare: false,
        features: { spellcheck: { mode: false, change: false } },
      },
    },
    events: o.events ?? {},
  };
}
