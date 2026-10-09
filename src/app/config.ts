// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// What the app page tells ONLYOFFICE's editor (DocsAPI.DocEditor's
// configuration), from what filex tells the app (session.get). Pure: no
// document, no window, so the tests read it as it is.

import { personName } from '../bridge';
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

/**
 * What filex says of the file's encryption (FileInfo, filex 0.55 and 0.56):
 * `encrypted` - "folder", "vault" or "file" for a file the server holds only
 * as ciphertext; `plaintext` - filex 0.56 hands it to this app in the clear
 * (the person's browser decrypts it for `file.read` and encrypts what
 * `file.save` hands back; the manifest's `encrypted_folders`). Read off the
 * object as it came: the SDK version the app builds with may not name them.
 */
export interface EncryptionInfo {
  encrypted?: unknown;
  plaintext?: unknown;
}

/**
 * The file is encrypted and filex does not hand it over: an older filex, an
 * administrator who turned it off, a vault or a single encrypted file - the
 * app says so instead of asking for bytes filex refuses. A file filex hands
 * over in the clear is edited like any other.
 */
export function encryptedNotHanded(info: object | null | undefined): boolean {
  if (!info) return false;
  const { encrypted, plaintext } = info as EncryptionInfo;
  return (encrypted === 'folder' || encrypted === 'vault' || encrypted === 'file') && plaintext !== true;
}

/**
 * Why filex did not take a save, when it says which (filex 0.56, a document
 * it hands over in the clear): `changed` - somebody saved the file after the
 * editor opened it (in an encrypted folder or a vault); `vault_locked` -
 * somebody else is writing the vault right now; `vault_lock_lost` - this
 * session's write lock on the vault ended before the save was committed.
 * Nothing was written in any of them, and the editor still holds the
 * changes. null: any other failure, said with its reason.
 */
export type SaveRefusal = 'changed' | 'vault_locked' | 'vault_lock_lost';

const SAVE_REFUSALS: readonly string[] = ['changed', 'vault_locked', 'vault_lock_lost'];

/** The refusal a failed save carries (the SDK's FilexError: `failed` and the word), or null. */
export function saveRefusal(e: unknown): SaveRefusal | null {
  const code = (e as { code?: unknown } | null)?.code;
  const message = (e as { message?: unknown } | null)?.message;
  if (code !== 'failed' || typeof message !== 'string') return null;
  return SAVE_REFUSALS.includes(message) ? (message as SaveRefusal) : null;
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

/**
 * The phone editors' light and dark themes: they know only theme-light,
 * theme-dark, default-light and default-dark (their page's supportedThemes,
 * 9.4), and fall back to the browser's colour scheme for anything else.
 */
export const PHONE_THEME_LIGHT = 'theme-light';
export const PHONE_THEME_DARK = 'theme-dark';

/**
 * What the app shows: "editor" is ONLYOFFICE's editor (its "main" app, folded
 * on a narrow frame); "reader" is ONLYOFFICE's phone app, which in its
 * open-source build opens a document to read only (see phoneLayout).
 */
export type View = 'reader' | 'editor';

export interface ConfigInput {
  kind: Kind;
  title: string;
  /** The document's key for this opening (the editor's docId). */
  key: string;
  locale: string;
  dark: boolean;
  userName: string;
  canEdit: boolean;
  /** filex hands the person a file (the app's ui:download grant): "Download as" is on. */
  canDownload?: boolean;
  /** Print is on (it needs filex's print, or a download to fall back to). */
  canPrint?: boolean;
  /** The app's frame is a phone's width: the editor starts folded (see narrowLayout). */
  narrow?: boolean;
  /** Open ONLYOFFICE's phone app, to read (see phoneLayout); `narrow` is then not used. */
  phone?: boolean;
  /** The events the app page listens to. */
  events?: Record<string, (e: { data?: unknown }) => void>;
}

/** Narrower than this (CSS px), the app's frame is a phone's: the editor starts folded. */
export const NARROW_PX = 600;

/**
 * The editor on a narrow screen: a narrow window on a computer, and a phone
 * once the person taps "Edit" in ONLYOFFICE's phone app (which only reads,
 * see phoneLayout). It is the desktop editor, folded where its own options
 * allow: the ribbon shows its tabs only (a tap on one opens it), no rulers,
 * the side panel closed. Every one of them stays the person's to change,
 * and the editor keeps their choice (settings.ts) over this.
 *
 * Measured at 390 px (2026-10-08, Chromium): compactHeader puts the tabs
 * behind two arrows with no name showing, and a page fitted to the width
 * (zoom -2) is drawn at 32 % - unreadable - so neither is used; the page
 * stays at the person's zoom and scrolls sideways.
 */
export function narrowLayout(): Record<string, unknown> {
  return {
    compactToolbar: true,
    toolbarHideFileName: true,
    hideRulers: true,
    hideRightMenu: true,
  };
}

/**
 * Whether the app opens on a phone: a frame narrower than NARROW_PX on a
 * touch screen. A narrow window on a computer (a mouse, no touch) keeps the
 * folded editor; a wide tablet keeps the editor as on a computer.
 */
export function isPhone(o: { width: number; coarsePointer: boolean; touchPoints: number }): boolean {
  return o.width > 0 && o.width < NARROW_PX && (o.coarsePointer || o.touchPoints > 0);
}

/**
 * ONLYOFFICE's phone app (each editor's "mobile" app, type "mobile"):
 * touch-sized, with its own search, navigation, settings, Download and
 * Print (and, for a text document, its "mobile view", the text reflowed to
 * the screen).
 *
 * ⚠ It opens to READ only. The build in ONLYOFFICE's Document Server image
 * is the open-source one, whose editing controller is a stub: in edit mode
 * it shows "Using the free Community version, you can open documents for
 * viewing only. To access mobile web editors, a commercial license is
 * required." and stays read-only (all three phone apps of 9.4.0.129, read
 * 2026-10-08). So the app opens it in view mode, and the person edits on
 * the phone with the editor, folded (narrowLayout): the app page's "Edit"
 * switches over with the document, "Reading view" switches back (main.ts).
 *
 * `disableForceDesktop`: api.js would otherwise read a "desktop" choice the
 * person made earlier from the page's storage - the switch is the app's.
 */
export function phoneLayout(): Record<string, unknown> {
  return {
    mobile: { forceView: true, disableForceDesktop: true },
  };
}

/**
 * DocsAPI.DocEditor's configuration. The editor runs as against a Document
 * Server, in "fast" co-editing (changes go to the bridge as they are made),
 * with Save asking the bridge (forcesave). Everything that would reach a
 * server the bridge does not answer is off: plugins, macros, chat, the
 * spell checker's server, the help pages (not in the bundle), the feedback,
 * "suggest a feature" and "go back" links. Download as and Print are x2t's
 * in the browser (frame/export.ts) and on when filex can hand the result
 * over. The editor lists only people without a group, which hides the
 * bridge's keeper (bridge.ts). ONLYOFFICE's logo and About stay (its terms
 * ask the logo to be kept; About names the version and its authors).
 */
export function editorConfig(o: ConfigInput): Record<string, unknown> {
  const phone = o.phone === true;
  // The phone app only reads (phoneLayout): editing is the editor's.
  const edit = o.canEdit && !phone;
  const theme = phone ? (o.dark ? PHONE_THEME_DARK : PHONE_THEME_LIGHT) : o.dark ? THEME_DARK : THEME_LIGHT;
  return {
    type: phone ? 'mobile' : 'desktop',
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
        download: o.canDownload === true,
        print: o.canPrint === true,
        copy: true,
        chat: false,
        protect: false,
        // Show only people without a group: everyone but the keeper.
        userInfoGroups: [''],
      },
    },
    editorConfig: {
      mode: edit ? 'edit' : 'view',
      lang: editorLang(o.locale),
      region: editorRegion(o.locale),
      user: { id: EDITOR_USER_ID, name: personName(o.userName) },
      coEditing: { mode: 'fast', change: false },
      plugins: { autostart: [], pluginsData: [] },
      customization: {
        forcesave: true,
        autosave: true,
        uiTheme: theme,
        comments: true,
        help: false,
        feedback: false,
        suggestFeature: false,
        goback: false,
        plugins: false,
        macros: false,
        mentionShare: false,
        features: { spellcheck: { mode: false, change: false } },
        ...(phone ? phoneLayout() : o.narrow ? narrowLayout() : {}),
      },
    },
    events: o.events ?? {},
  };
}
