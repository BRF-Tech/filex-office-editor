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
- `upstream/onlyoffice.json` pins the ONLYOFFICE Docs release the editor
  files are taken from: 9.4.0 (build 9.4.0.129), the official Document
  Server image `onlyoffice/documentserver:9.4.0.1` by its digest.
- A weekly GitHub Actions workflow, the upstream watch
  (`scripts/upstream-watch.mjs`), compares the pin with ONLYOFFICE's newest
  release and opens one issue per newer version, never a second one for the
  same version. It uses only the run's own `GITHUB_TOKEN` (issues: write).

### Changed

- The project is named **filex-office-editor** (it started as
  filex-onlyoffice). "ONLYOFFICE" is Ascensio System SIA's trademark and
  grants no rights, so it appears only to say what the app is based on,
  never in the name of the repository or of the app.
- The license is **AGPL-3.0-or-later** (the prototype said AGPL-3.0-only).
  `src/locks.ts` stays AGPL-3.0-only: it is a modified version of ONLYOFFICE
  Docs, which is licensed under the AGPL version 3 only.
