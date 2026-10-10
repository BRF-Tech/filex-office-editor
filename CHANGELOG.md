# Changelog

All notable changes to filex-office-editor are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/). The version in
`filex-app.json` is the one a tag must match, and a version's section is its
release's notes - what filex shows an administrator when it offers the
update.

## [Unreleased]

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

### Changed

- x2t is `v9.4.0.129+2`: the same build with the frame anchor fix, its two
  files' SHA-256 pinned in `upstream/onlyoffice.json` (two builds from empty
  trees give the same bytes). No release has published its `x2t.zip` yet:
  `bash scripts/x2t/build.sh` makes it.

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
