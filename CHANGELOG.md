# Changelog

All notable changes to filex-office-editor are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/). The version in
`filex-app.json` is the one a tag must match, and a version's section is its
release's notes - what filex shows an administrator when it offers the
update.

## [Unreleased]

Editing together, for filex 0.56.0 or later. **No ONLYOFFICE Document Server
is needed** - not to edit office documents, and not to edit them together:
this app with filex 0.56 is all it takes. filex keeps its Document Server
support, and it is optional (an instance that has one may stay connected).
What still needs one is what filex itself does with an office file on the
server through it (a conversion run there, an office thumbnail made there);
this app does neither - its Download as, PDF and Print run x2t in the
browser.

### Added

- **Documents in encrypted folders** (filex 0.56.0 or later). The manifest
  asks for `"encrypted_folders": {"open": true}` - filex derives the
  permission `files:e2e-plaintext`, whose reason the manifest gives in
  English and Turkish - and filex, in the person's browser, decrypts a
  document of an unlocked encrypted folder for the editor (`FileInfo`
  `encrypted: "folder"`, `plaintext: true`) and encrypts what it saves; the
  app reads and saves it through the SDK as any document, and the server
  sees only ciphertext - in a vault too (`encrypted: "vault"`: filex reads
  it from the vault and writes the save as the vault's next generation). A
  document filex does not hand over (filex 0.55, a `.fxe`, switched off by
  an administrator) is said in the app's words instead of asked for
  (`encryptedNotHanded`).
- **A save filex refuses is said in a person's words** (`saveRefusal`):
  somebody saved the document since it was opened (`changed`), somebody
  else is writing the vault (`vault_locked`), the vault's write lock ended
  before the save finished (`vault_lock_lost`) - nothing was written, the
  changes stay in the editor, and the message says what to do, in English
  and Turkish, instead of "could not be saved: changed (failed)".
- The measurement imitates filex 0.56 (`enc=folder`: the harness holds the
  document as filex encrypts it, decrypts it for the app and encrypts the
  save; `enc=055`: filex 0.55) and `npm run e2e` checks it once per engine
  (`encryptedRun`): only ciphertext reaches the server, nothing in the clear
  in any request, what the server holds decrypts to the typed text; on
  0.55 the app says the document is encrypted.
- **Editing together** (filex 0.56, `files:co-edit`): everyone who has a
  document open in the editor edits the same document, sees the others in
  the editor's list of people, their cursors, their locks and their changes
  as they make them, through filex's relay - filex seals what they share and
  puts it in one order; the app holds no key and talks to no server. The
  editor joins the document's session before it is configured (each member
  is its own user in the editor); the one who starts the session puts the
  document it opened as the session's base, and everyone after opens that
  base and the session's log, never the file. Every bridge applies the same
  entries in the same order with the Document Server's lock rules; changes
  go in only under filex's changes lease.
- **Images inserted while editing together** reach the others: the image is
  kept with the session before the change that shows it, and fetched by the
  others before they apply that change (also by someone who joins later).
- **Saving together**: a version every ten minutes while there are unsaved
  changes, written by one member (the writer who joined first and is still
  in); Save saves at once, by whoever pressed it; the last writer to leave
  saves what is not saved. Every save says how far into the session it
  reaches, and filex records it for everyone. filex asks about unsaved
  changes only the last writer, so closing while others edit asks nothing.
- When filex drops a member whose page was unreachable, the editor opens
  again in the session with everybody's changes, and the person is told;
  when a change from the session does not check out, editing together stops
  for that person and the document opens again alone, as last saved.
- **Following along, read-only**: a person who may only read the document
  joins its session as a watcher - the editor opens it to read (no
  "Edit"), and shows the others' changes as they land (ONLYOFFICE's live
  viewer); filex refuses whatever a watcher would write. With nobody
  editing it, there is nothing to follow and it opens as it is.
- **Changes kept through a lost connection**: filex 0.56 keeps every change
  in the browser until its relay placed it, sends it again when the
  connection is back, and sends what a closed tab left when the document
  is opened again (after asking, in filex's words, when somebody else
  changed the document since). The editor opens with them in it: its own
  member's changes before its start are part of the document it is given,
  not an answer to a save of its own.
- Editing together in an **end-to-end encrypted folder** (filex 0.56, with
  the app's `encrypted_folders` grant): the session's key is sealed with the
  folder key in the members' browsers; the app does nothing differently.
- The e2e harness has a stand-in for filex 0.56's relay, and the browser run
  opens one document in two browser contexts, then a third that may only
  read, and a reader alone - measured in Chromium, Firefox and WebKit: the
  watcher's editor, ONLYOFFICE's live viewer, shows what another person
  types before anybody saves (read from the editor's own document). The
  stand-in drops a member whose page went away, as filex does after 45 s
  (a closing tab does not always let its leave out).

### Changed

- x2t is `v9.4.0.129+2`: the same build with the frame anchor fix, its two
  files' SHA-256 pinned in `upstream/onlyoffice.json` (two builds from empty
  trees give the same bytes). No release has published its `x2t.zip` yet:
  `bash scripts/x2t/build.sh` makes it.
- **filex 0.56.0 or later** (`"filex": ">=0.56.0"`): 0.55 refuses a manifest
  with `encrypted_folders`.
- The description says encrypted folders again, and the `ui:connect-blob`
  reason the document the browser decrypted or converted.
- The manifest says `"co_edit": {"open": true}` (granted as
  `files:co-edit`, which filex derives from the block - it is not listed in
  `permissions`) and asks for filex `>=0.56.0` (filex 0.55 refuses a
  manifest with a block it does not know; servers on 0.55 keep 0.1.1).
  Where filex offers no editing together - an older filex, no grant, a
  vault, the phone's reading view, a person who may only read a document
  nobody is editing - the editor runs alone, exactly as in 0.1.1.

### Fixed

- **A document the converter stops on ends the opening, and says why, in
  every browser.** When x2t stopped on a document (an abort: a function its
  build does not have), the error was on the screen, but the page's state
  went back to "opening" as soon as the editor, loading beside the
  conversion, said it was ready - in Chromium nearly always, as x2t is
  ready first there - so filex and anything watching the opening waited for
  one that had ended, and the editor kept loading behind the message. The
  opening now stays failed, the editor is ended, and the person reads why,
  in their language: "The document could not be opened: the converter
  stopped on this document (missing function: COFDFile::COFDFile)" ("Belge
  açılamadı: dönüştürücü bu belgede durdu (...)"). A conversion that does
  not finish in time (a minute, and five seconds more per MiB) fails the
  same way. After either, the next conversion - a save, a Download as -
  starts a new converter instead of using the one that stopped.
- **A formula is where its sentence puts it.** An odt whose formula frame
  has no style (valid OpenDocument, written by producers other than
  LibreOffice) showed the formula at the top left of the page, in front of
  the sentence it ends: x2t read a frame's anchor only from its style.
  x2t now reads it from the frame (`scripts/x2t/patches/05-frame-anchor.patch`).
  Files LibreOffice writes give every formula a style and kept their place.

## [0.1.1] - 2026-10-10

A patch release: the converter, x2t, is now this project's own build, and
two faults of the converter 0.1.0 carried are gone with it. The same app
for the same filex (0.55.0 or later), asking for the same permissions
(`files:read`, `files:write`).

### Fixed

- **Documents with a formula open.** An odt, ods or odp with a formula as
  LibreOffice writes one stopped the converter, and the document did not
  open: 0.1.0's x2t (CryptPad's build) did not carry ONLYOFFICE's StarMath
  converter, which reads every such formula. The formula now comes into the
  document (and back out of it, in a docx, as OOXML math).
- **txt and csv in Download as, with every Turkish letter.** 0.1.0 left both
  out because its x2t cut every letter outside ASCII to its low byte
  ("Şifreli" became "^ifreli": its UnicodeConverter handed the text to ICU
  with `u_strFromWCS`, which fails on such letters in the WebAssembly
  build). A document now downloads as txt (UTF-8) and a workbook's sheet as
  csv (UTF-8, UTF-16 or UTF-32), through the editor's own dialog and with
  the delimiter chosen there. The dialog lists only the encodings x2t
  writes right here; another one is refused and the person is told.

### Changed

- **x2t is this project's own build, from ONLYOFFICE core at the editor
  files' tag** (`v9.4.0.129`), in place of CryptPad's `v9.3.2+3`: `bash
  scripts/x2t/build.sh` (`npm run x2t:build`) builds it in docker -
  emscripten 4.0.11's own image pinned by digest, the build tools from one
  day's Ubuntu snapshot, every source fetched by its pinned commit - with
  CryptPad's recipe and its changes for WebAssembly ported to 9.4
  (`scripts/x2t/patches/`), and checks it against the SHA-256 sums pinned
  in `upstream/onlyoffice.json` (`x2t` release `v9.4.0.129+1`). Two builds
  from empty trees gave the same bytes. The release attaches it as
  `x2t.zip` next to `ui.zip` (`scripts/fetch-x2t.mjs` downloads and checks
  it, or takes a build made elsewhere with `--dir` or `--from`). The
  documents x2t writes name their application `ONLYOFFICE/9.4.0.129`, as
  the Document Server's do.

## [0.1.0] - 2026-10-09

The first version: ONLYOFFICE's editor in filex, in the browser and without
a Document Server - one person editing a document in a folder that is not
encrypted, and saving it as a new version. A filex app for filex 0.55.0 or
later, in English and Turkish.

### Added

- **The editor in place of filex's preview** for `.docx`, `.xlsx`, `.pptx`,
  `.odt`, `.ods` and `.odp`: the app page reads the file through filex's SDK,
  converts it with x2t in a worker, starts ONLYOFFICE's editor in a frame of
  its own package (`ui.frame_package`) and hands it the document as bytes.
  The editor follows filex's language and region and its light or dark
  theme; a file that cannot be saved opens to read; an empty file opens as
  the blank document of its kind.
- **Saving**: the editor's Save (its button, Ctrl+S), filex's Save, and a
  save every ten minutes while there are changes write a new version of the
  file in its own format. filex is told about unsaved changes and asks
  before the person leaves them.
- **Download as**, without a Document Server: the File menu offers what x2t
  writes here (`src/formats.ts`) - docx, dotx, odt, ott, rtf (docm for a
  docm); xlsx, xltx, ods, ots (xlsm); pptx, ppsx, potx, odp, otp (pptm); PDF
  and PDF/A for all three - and filex hands the file to the person
  (`ui.download`). A PDF is made from the pages as the editor laid them out,
  with the fonts it drew them with. Left out because this x2t build cannot
  write them right: txt and csv (every letter outside ASCII is cut to its
  low byte), html, md, epub, fb2 and images.
- **Print**: the document goes to filex as a PDF (`ui.print`, the `ui:print`
  grant) and filex asks the person before it opens the browser's print
  dialog. Without that grant, or on a filex without `ui.print`, the PDF goes
  to the person as a download, and they are told so - a sandboxed frame may
  not open the print dialog itself.
- **New document**: the Document Server's blank docx, xlsx and pptx are in
  the bundle, and filex's New document dialog gets a document, a spreadsheet
  and a presentation row.
- **The editor's settings are kept between openings** in filex's store for
  the app (`state.set`, one value of at most 8 KiB): units, zoom, the ribbon
  folded or not, the "New" hints the person closed. filex keeps deciding the
  theme. The editor's start waits for the kept settings, at most 5 seconds.
- **On a narrow screen** (a frame under 600 px) the editor starts folded:
  the ribbon's tabs only, no rulers, the side panel closed.
- **On a phone** (a frame under 600 px on a touch screen) the document opens
  in ONLYOFFICE's phone app, to read: touch-sized, with its own search,
  navigation, settings, Download (through x2t, as on a computer) and Print.
  ONLYOFFICE's open-source phone apps do not edit, so **"Edit"** under them
  opens the editor, folded, with the document, and **"Reading view"** goes
  back with what was written, saving it first.
- **One person counts one**: the bridge's own participant (which keeps the
  editor sending its changes as it makes them) is in a group the editor is
  configured not to show. "Suggest a feature", which would open ONLYOFFICE's
  site, is off; plugins, macros, chat, the spell checker and help, which
  would reach a Document Server, are off too.
- **The legal notice** ONLYOFFICE's terms ask for, under the editor, in
  English and Turkish: based on ONLYOFFICE Docs by Ascensio System SIA, this
  version may have been modified, the Docs version and source tag, the AGPL
  and this repository at the app's tag (`/tree/v0.1.0`), the trademark line.
  The editor's own About is not touched.
- **The bridge that stands in for the Document Server** (`src/bridge.ts`,
  answering the editor as `DocsCoServer.js` of Docs 9.4 does), the Document
  Server's lock rules and the spreadsheet's lock recalculation
  (`src/locks.ts`), a socket.io stand-in for the editor's
  `socket.io.min.js`, the session's log for one person (`src/session.ts`)
  and a driver for x2t built to WebAssembly - moved here from filex (its
  commit 45e7bab7) with their history and their unit tests.
- **The editor bundle**, built by `scripts/extract-editor.sh` from
  ONLYOFFICE's official Document Server image, pinned by digest in
  `upstream/onlyoffice.json` (ONLYOFFICE Docs 9.4.0, build 9.4.0.129): the
  fonts generated from ONLYOFFICE's core-fonts, the document, spreadsheet
  and presentation editors with their phone apps, every page's inline
  scripts moved into files, an in-memory storage stand-in loaded first in
  every page. `upstream/editor.lock.json` records every file's SHA-256 and a
  build that differs from it fails.
- **x2t**: CryptPad's WebAssembly build `v9.3.2+3` (AGPL-3.0-or-later),
  pinned in `upstream/onlyoffice.json` by its SHA-512 and its files'
  SHA-256, fetched and checked by `scripts/fetch-x2t.mjs`.
- **The release bundle**, `ui.zip`, built by `npm run build`: 2,633 files,
  323.4 MiB unpacked, 98.2 MiB zipped (102,979,682 bytes), SHA-256
  `61a1a9db840c8ab0adad07760f190796ababecbff0fda0fe8c7c8aa0d6986ef6`, the
  value in `filex-app.json`. It is reproducible: two complete builds, from
  the image to the zip, gave the same bytes.
- **The manifest** (`filex-app.json`, `office-editor`, `filex >=0.55.0`):
  the permissions `files:read` and `files:write`, and the interface's
  `ui.package_fetch`, `ui.frame_package`, `ui.connect_blob`, `ui.download`,
  `ui.print`, `unsafe-eval` and `wasm-unsafe-eval`, each with its reason in
  English and Turkish.
- **A weekly upstream watch** (GitHub Actions, `scripts/upstream-watch.mjs`)
  that compares the pin with ONLYOFFICE's newest release and opens one issue
  per newer version, saying how to rebuild.
- **Tests**: unit tests in Node (vitest) for all of the above, `npm run
  test:x2t` (a docx, an xlsx and a pptx with Turkish text through the real
  x2t and back), and `npm run e2e`, the bundle served the way filex 0.55
  serves an app and measured in Chromium, Firefox and WebKit, on a computer
  and on a phone.
- **NOTICE**: the licensing, what is based on ONLYOFFICE and every change
  made to its files, with the dates, the legal notice, the trademark line.
  The project is licensed **AGPL-3.0-or-later**; `src/locks.ts`, a modified
  version of ONLYOFFICE Docs, is AGPL-3.0-only. "ONLYOFFICE" is Ascensio
  System SIA's trademark and appears only to say what the app is based on,
  never as the name of the repository or of the app.
