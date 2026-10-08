# Changelog

All notable changes to filex-office-editor are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/). The version in
`filex-app.json` is the one a tag must match, and a version's section is its
release's notes - what filex shows an administrator when it offers the
update.

## [Unreleased]

### Added

- The protocol prototype, moved here from filex (`packages/office-e2e` and
  `web/tests/officeE2e`, filex commit 45e7bab7, task #189) with its history:
  the bridge that answers the ONLYOFFICE editor as the Document Server
  (`DocsCoServer.js`, Docs 9.4) does and turns what the other editors need
  into entries of a session log; the Document Server's lock rules and the
  spreadsheet's lock recalculation; a socket.io stand-in for the editor's
  `socket.io.min.js`; a driver for x2t built to WebAssembly; their unit
  tests (vitest, in Node).
- A draft `filex-app.json` (`office-editor`, filex 0.55.0 or later): a
  viewer for docx, xlsx, pptx, odt, ods and odp, New document rows for docx,
  xlsx and pptx, and the platform permissions the app will ask filex for.
- `NOTICE`: the licensing, what is based on ONLYOFFICE, the legal notice
  the editor will show, the trademark line.
- ONLYOFFICE's credit, in the README, NOTICE and the manifest's
  description: the ONLYOFFICE code is Copyright © Ascensio System SIA under
  the AGPL version 3; ONLYOFFICE® and ONLYOFFICE Docs™ are registered
  trademarks or trademarks of Ascensio System SIA, and this project is not
  affiliated with or endorsed by it.
- `upstream/onlyoffice.json` pins the ONLYOFFICE Docs release the editor
  files are taken from: 9.4.0 (build 9.4.0.129), the official Document
  Server image `onlyoffice/documentserver:9.4.0.1` by its digest.
- A weekly GitHub Actions workflow, the upstream watch
  (`scripts/upstream-watch.mjs`), compares the pin with ONLYOFFICE's newest
  release and opens one issue per newer version, never a second one for the
  same version. It uses only the run's own `GITHUB_TOKEN` (issues: write).
  The issue says how to rebuild: the new pin, `bash
  scripts/extract-editor.sh --update`, the lock file's diff.
- The editor bundle's build, `scripts/extract-editor.sh`: from the pinned
  Document Server image (by digest, no network after the pull) it generates
  the fonts from ONLYOFFICE's core-fonts, keeps the document, spreadsheet
  and presentation editors, moves every HTML page's inline scripts into
  files, loads an in-memory storage stand-in first, checks filex's limits
  for an app's bundle and writes a reproducible zip. Measured for 9.4.0:
  2,180 files, 271.6 MiB unpacked, 91.8 MiB zipped; two builds give the
  same zip. `upstream/editor.lock.json` records every file's SHA-256; a
  build that differs from it fails.
- x2t: CryptPad's WebAssembly build `v9.3.2+3`, pinned under `x2t` in
  `upstream/onlyoffice.json` by its SHA-512 and its files' SHA-256, fetched
  and checked by `scripts/fetch-x2t.mjs`. `npm run test:x2t` takes a docx,
  an xlsx and a pptx with Turkish text through it to Editor.bin and back
  with `src/x2t.ts`; nothing is lost.
- The app (plan step A3): `npm run build` (`scripts/build-app.mjs`) makes
  `dist/ui.zip`, the bundle filex installs - the locked editor files, the
  pinned x2t, the app page and the editor page's script in place of
  socket.io (92.7 MiB zipped, 1,889 files). The app page reads the file
  through filex's SDK, converts it with x2t in a worker, starts
  ONLYOFFICE's editor in its own frame and hands it the document; one
  person edits it, the session's log stays in the page
  (`src/session.ts`), and the editor's Save, filex's Save and a save every
  ten minutes while there are changes write a new version of the file in
  its own format. filex is told about unsaved changes. The editor follows
  filex's language and light or dark theme; a file that cannot be saved
  opens to read; an empty file opens as a blank one. The legal notice
  ONLYOFFICE's terms ask for is shown under the editor, in English and
  Turkish.
- New documents: the Document Server's blank docx, xlsx and pptx are in the
  bundle (`editor/document-templates/new/default/new.*.bin`), and
  `filex-app.json` names them.
- `npm run e2e` (`e2e/run.mjs`): the bundle, served the way filex 0.55
  serves an app (`e2e/harness/`), opened in Chromium, Firefox and WebKit;
  blank and Turkish docx, xlsx and pptx are typed in and saved twice, and
  the written files read back. All pass in all three; no request leaves
  the package; the storage stand-in takes the place of the storage none of
  the three gives the sandboxed pages.

- **Download as**, without a Document Server: the File menu offers what x2t
  writes here (`src/formats.ts`) - docx, dotx, odt, ott, rtf (docm for a
  docm); xlsx, xltx, ods, ots (xlsm); pptx, ppsx, potx, odp, otp (pptm); PDF
  and PDF/A for all three - and filex hands the file to the person
  (`ui.download`). A PDF is made from the pages as the editor laid them out,
  with the fonts it drew them with. Left out because this x2t build cannot
  write them right: txt and csv (every letter outside ASCII is cut to its
  low byte), html, md, epub, fb2 and images.
- **Print**: the document as a PDF, handed to filex to print (`ui.print`,
  proposed for filex 0.55); a filex without it gets the PDF as a download,
  and the person is told so - a sandboxed frame may not open the browser's
  print dialog.
- **The editor's settings are kept between openings** in filex's store for
  the app (`state.set`, one value of at most 8 KiB): units, zoom, the
  ribbon folded or not, the "New" hints the person closed. filex keeps
  deciding the theme. The editor's start waits for the kept settings, at
  most 5 seconds.
- On a narrow screen (a frame under 600 px) the editor starts folded: the
  ribbon's tabs only, no rulers, the side panel closed.
- `npm run e2e` measures all of it in the three browsers: the people the
  editor counts, Download as from the File menu (the offered formats, an
  OpenDocument copy holding the typed text, a PDF with pages and fonts),
  Print, a closed hint not showing at the next opening, and Print handed
  over as a download where filex has no print.

### Fixed

- One person editing was shown as two: the bridge's own participant (which
  keeps the editor sending its changes as it makes them) is now in a group
  of its own that the editor is configured not to show
  (`permissions.userInfoGroups`). A no-break space in a person's name, which
  the editor would read as a group, becomes a space.
- "Suggest a feature" in the File menu, which opened ONLYOFFICE's site (the
  sandbox cannot), is off.
- The bridge told an editor that had not yet received every change it
  could save when it said it knew none (`isSaveLock` with
  `syncChangesIndex` 0): 0 is now checked like any other count. The
  Document Server lets 0 through "for compatibility"; the pinned editor
  always sends its count.
- The editor's interface templates are kept (as `.template.txt`): they are
  not built into the apps, and the editor stopped without them. The
  per-theme thumbnails, which the editor never asks for, are left out.

### Changed

- The project is named **filex-office-editor** (it started as
  filex-onlyoffice). "ONLYOFFICE" is Ascensio System SIA's trademark and
  grants no rights, so it appears only to say what the app is based on,
  never in the name of the repository or of the app.
- The license is **AGPL-3.0-or-later** (the prototype said AGPL-3.0-only).
  `src/locks.ts` stays AGPL-3.0-only: it is a modified version of ONLYOFFICE
  Docs, which is licensed under the AGPL version 3 only.
