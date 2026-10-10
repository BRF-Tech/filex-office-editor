# filex-office-editor

The office editor app for [filex](https://github.com/BRF-Tech/filex), based
on ONLYOFFICE Docs: ONLYOFFICE's editor in the browser, **without a Document
Server**. Word, Excel and PowerPoint documents (and their OpenDocument kin)
open in the editor in place of filex's preview, and saving writes a new
version of the file. Nothing of the editor runs on the server: its files come
from the app's package and the document is converted in the browser.

It goes further with filex 0.56: documents **inside encrypted folders**,
decrypted in the browser, edited there and encrypted again before they are
saved, so no server ever reads them ([In an encrypted folder](#in-an-encrypted-folder),
0.2.0, not released yet). **Editing together** through filex's relay comes
with a later release, as filex gains what it needs ([Roadmap](#roadmap)).

> **ONLYOFFICE.** This app is based on ONLYOFFICE Docs by Ascensio System
> SIA, the original developer of the editor it runs, and this version may
> have been modified. The ONLYOFFICE code it carries or builds on is
> Copyright © Ascensio System SIA and licensed under the GNU Affero General
> Public License version 3, with the additional terms of its section 7 (see
> [License](#license) and [NOTICE](NOTICE)).
>
> ONLYOFFICE® and ONLYOFFICE Docs™ are registered trademarks or trademarks
> of Ascensio System SIA. This project is not affiliated with, endorsed by
> or sponsored by Ascensio System SIA. The names appear here only to say
> what the app is based on, never as the name of the repository or of the
> app (in filex it is the "Office editor").

> **Status: 0.1.1.** One person edits a document in a folder that is not
> encrypted and saves it as a new version; Download as and Print go through
> filex; the editor's settings are kept; New document gets three rows; on a
> phone the document opens in ONLYOFFICE's phone view to read, with "Edit".
> 0.1.1 carries this project's own x2t: a document with a formula opens,
> and txt and csv are in Download as with every Turkish letter. Measured in
> a real filex 0.55.0 ([Measured in filex 0.55](#measured-in-filex-055)).
> filex 0.55 opens no app on an encrypted file, so in an encrypted folder
> filex keeps its own read-only preview.
>
> **Unreleased (0.2.0): documents in encrypted folders**, for filex 0.56 or
> later - filex decrypts the document for the editor in the person's
> browser and encrypts the save, and no server reads it
> ([In an encrypted folder](#in-an-encrypted-folder)). Built and measured
> in Chromium, Firefox and WebKit against a stand-in for filex 0.56; not
> yet measured in a real filex 0.56; not released.

| | |
|---|---|
| Based on | ONLYOFFICE Docs 9.4.0 (build 9.4.0.129) by Ascensio System SIA: the editor's files (web-apps, sdkjs, fonts) from the official Document Server image, pinned by digest in [`upstream/onlyoffice.json`](upstream/onlyoffice.json); the converter, x2t, built by this project from ONLYOFFICE core at the same tag (`scripts/x2t/`, pinned under `x2t` in the same file; 0.1.0 carried CryptPad's build) - see [NOTICE](NOTICE) |
| filex | 0.1.1: **0.55.0** or later. The next release (encrypted folders, the manifest's `encrypted_folders` block, granted as `files:e2e-plaintext`): **0.56.0** or later (`"filex": ">=0.56.0"`) - filex 0.55 refuses a manifest with a block it does not know, and keeps 0.1.1 |
| Release | **0.1.1** (tag `v0.1.1`): `ui.zip`, 98.3 MiB, SHA-256 `7cd9c42c00e839f6970a7bc55f0fd76c180cb0b9c714d130fbaa911633aea06b`; `x2t.zip`, the converter alone ([Installing](#installing), [Building a release](#building-a-release)) |
| License | **AGPL-3.0-or-later** ([LICENSE](LICENSE)); one file, `src/locks.ts`, AGPL-3.0-only ([NOTICE](NOTICE)) |

## Installing

In filex 0.55.0 or later, as an administrator: **Admin → Plugins → Apps →
Install an app → GitHub repository**, `BRF-Tech/filex-office-editor`, tag
`v0.1.1`. filex reads `filex-app.json` at that tag, downloads the release's
`ui.zip` and refuses it unless its SHA-256 is the one the manifest names.
The review lists what the app asks for: `files:read` and `files:write` (the
file it was opened with, and its new versions), and what its interface is
allowed - its own package, frames of its own package, `blob:` addresses it
made, the script-policy exceptions ONLYOFFICE's editor and x2t need
(`ui:eval`, `ui:wasm-eval`), handing the person a file (`ui:download`) and
a PDF to print (`ui:print`), the six kinds it opens and the three rows it
adds to New document. A store that lists the app installs the same release
through the same review. On a server that downloads nothing, **Upload
files** with the release's `filex-app.json` and `ui.zip` does the same.

Once installed, a `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods` or `.odp`
opens in the editor, and **New → New document** offers a document, a
spreadsheet and a presentation under Apps.

## What it is for

- **filex without a Document Server.** filex edits office documents through
  an ONLYOFFICE Document Server it is connected to. An instance without one
  installs this app and edits them in the browser instead.
- **Encrypted folders** (a later release, [Roadmap](#roadmap)). A Document
  Server reads the document it edits, so filex never offers it in an
  encrypted folder: there a document opens read-only. With this app the
  document is to stay a docx, xlsx or pptx encrypted in the folder, and only
  the browsers of the people editing it hold it in the clear. That needs a
  filex that hands an app the plaintext of a file in an encrypted folder
  (`files:e2e-plaintext`); filex 0.55 refuses every app at the door of an
  encrypted file.

## How it works

ONLYOFFICE's editor is a browser program. A Document Server gives it two
things: its files, and a socket.io connection over which the editor sends
its changes, asks for locks and hears about the other people. It also
converts the document (x2t) into the editor's own format before the editor
opens it, and back when it is saved.

This app gives the editor all of that in the browser:

- **The editor's files** come from the app's own package. The build takes
  them from ONLYOFFICE's official Document Server image, at the version and
  digest pinned in `upstream/onlyoffice.json`, and leaves them as ONLYOFFICE
  ships them except where the app has to: the socket.io client is replaced
  by a stand-in (`src/shim.ts`) and inline scripts move into files. NOTICE
  lists every file changed, with the date.
- **The "server"** is a bridge in the editor's frame (`src/bridge.ts`). It
  answers every message the way the Document Server does (Docs 9.4,
  `DocsCoServer.js`); whatever the other people need - a batch of changes, a
  lock request, a released lock - goes into the session's log. With one
  person (`src/session.ts`, what 0.1.0 runs) the log stays in the page.
  Editing together (a later release), filex is to seal each entry and send
  it through its relay, which puts the sealed entries in one order without
  reading them, and every editor's bridge applies the same entries in the
  same order with the Document Server's lock rules (`src/locks.ts`), so the
  first request for a paragraph or a range wins everywhere.
- **The conversion** runs in the browser: x2t, ONLYOFFICE's converter,
  compiled to WebAssembly, in a worker (`src/x2t.ts` drives it).

```
filex page (keys, network)        the app: two sandboxed pages (this repository)
+---------------------------+port +-------------------------------------------+
| reads and saves the file  |<--->| app page (index.html): x2t in a worker,   |
| (decrypts and encrypts    |     |   api.js, saving, the legal notice        |
|  it in encrypted folders; |     |      | port (bytes, never addresses)      |
|  seals and opens the log  |     |      v                                    |
|  entries, editing         |     | editor page: ONLYOFFICE's editor as it    |
|  together)                |     |   ships; in socket.io's place the bridge  |
+-------------+-------------+     |   and the session                         |
              | sealed only       +-------------------------------------------+
              v
+---------------------------+
| filex relay (editing      |   no Document Server: nothing reads
| together): order, lease,  |   the document, its changes, its
| sealed log, sealed blobs  |   images or its conversion
+---------------------------+
```

The app never holds a key and never touches the network: filex hands it the
document and seals what it sends. filex never runs the editor's code. In
0.1.0 the left column is the plain one - filex reads and saves a file that
is not encrypted, and there is no relay; the sealed path is the design the
later releases follow.

This is the model [CryptPad](https://github.com/cryptpad/cryptpad) uses for
its office documents, measured against a Document Server 9.4 before it was
designed: the editor's unchanged files, with only the socket.io file
replaced, opened a document converted in the browser; two tabs edited it
together and ended with byte-identical documents; the result went back to
docx with its formatting and its Turkish characters, and the Document Server
received no document, no change and no connection. Two things differ from
CryptPad on purpose: the lock and save rules are the Document Server's (not
a stand-in that always answers "nobody is saving"), and the file stays a
docx, xlsx or pptx - the session's log is temporary.

The design in full - keys, the order, the lease, saving, what the server
sees - is filex's
[E2E-OFFICE.md](https://github.com/BRF-Tech/filex/blob/main/docs/E2E-OFFICE.md).

## What filex provides

The half of the protocol filex owns is MIT and lives in filex: the relay
(`backend/internal/e2eoffice`), the session keys and the log reader
(`packages/core/src/lib/e2eoffice.ts`), who saves when
(`e2eofficeSave.ts`). Running the app needs platform features filex 0.55
added for it (0.1.0 uses them); encrypted folders and editing together need
more, which later filex releases bring.

| The app needs | filex 0.55 | Used by |
|---|---|---|
| ONLYOFFICE's `DocsAPI.DocEditor` opens the editor page in a frame of its own | `ui.frame_package` → permission `ui:frame-package`: frames from the app's own package only, in the same sandbox | 0.1.0 |
| The editor page may be framed by the app page | a package page carries no `frame-ancestors` (⚠ measured in Chromium before 0.55: `*` never matches an opaque origin, and the editor page was refused) | 0.1.0 |
| The editor loads the document from a `blob:` address | `ui.connect_blob` → `ui:connect-blob`: `connect-src` adds `blob:` | 0.1.0 |
| The plaintext of a document in an encrypted folder | not given in 0.55: every door an app reaches a file through refuses an encrypted one (`403 encrypted`), and the file's row says how it is encrypted (`encrypted: "folder"`, `"vault"`, `"file"`). **filex 0.56:** the manifest's `encrypted_folders: {"open": true}` → the derived permission `files:e2e-plaintext` (a stern sentence in the review): the person's browser decrypts the document for the app (`FileInfo.plaintext`) and encrypts the save, written only over the file as it was opened | 0.2.0 ([In an encrypted folder](#in-an-encrypted-folder)) |
| Editing together | the SDK's `coedit.*` methods are defined, and answer `unavailable`: the relay has no routes yet | a later release, with filex's `files:co-edit`: the relay's routes and WebSocket, its tables, the sealed blob store |
| `localStorage` (the editor keeps settings there) | an opaque frame has none; reading it throws | in the app: an in-memory stand-in loaded first in every page (`scripts/editor/storage.js`) - **measured in Chromium, Firefox and WebKit**: none of them gives the sandboxed pages storage, the stand-in takes its place in both pages and the editor's settings land in it ([Measured in the browsers](#measured-in-the-browsers)) |
| The editor's settings from one opening to the next | `state.get` / `state.set`: a small store per person and app, in the person's preferences (8 KiB a value, 16 KiB an app, enforced by the server since 0.54) | used as it is: the app keeps the editor's settings under one key (`src/settings.ts`) |
| Download as | `ui.download` (`ui:download`): filex hands the person a file, on a gesture or after asking | used as it is |
| Print (a sandboxed frame without `allow-modals` may not open the browser's print dialog: measured, in the app's frame `window.print()` does nothing in Chromium - "Ignored call to 'print()'. The document is sandboxed, and the 'allow-modals' keyword is not set" - nor in Firefox) | `ui.print` in the manifest → permission `ui:print`: the app hands filex a PDF (`ui.print {name, data, mime}`), filex asks the person every time, and its own print page (`/_print/`, a frame of a `blob:` PDF) opens the print dialog on their Allow | 0.1.0; without the grant, or on a filex that does not have it (`unknown_method`, `unavailable`), the app hands the PDF over as a download and says so |
| No inline scripts | `script-src` is the package only | 0.1.0: the build moves web-apps' inline scripts into files ([The editor bundle](#the-editor-bundle)) |
| A large package (0.1.0: 98.2 MiB zipped with x2t and the phone apps, 2,633 files, 323.4 MiB unpacked, 37 MiB for `x2t.wasm`) | 128 MiB zipped, 512 MiB unpacked, 20,000 files, 64 MiB a file; served uncompressed | a later filex: serving the package's files compressed (`Content-Encoding`), cached by version |

## What is in this repository

| File | What it does |
|---|---|
| `src/bridge.ts` | `OfficeBridge`: answers the editor's Document Server protocol (license, auth, authChanges, documentOpen, getLock, isSaveLock, saveChanges, unLockDocument, cursor, forceSaveStart) and turns what has to be shared into entries of the session's log; applies the log's entries, in order, to its changes, locks and participants |
| `src/locks.ts` | The Document Server's lock rules (text, spreadsheet, presentation) and the spreadsheet's lock recalculation after inserted or deleted rows and columns, kept as Docs 9.4 has them |
| `src/shim.ts` | A `socket.io` stand-in: the editor's socket is plugged into the bridge |
| `src/session.ts` | `LocalSession`: the session's log for one person, in the editor page, with the relay's rules (one order, changes only under the lease, the lease only for a member that has seen every change) |
| `src/x2t.ts` | Drives x2t (WebAssembly) to turn a docx/xlsx/pptx (or odt/ods/odp) into the editor's format and back, and to write the editor's document in another format (Download as, PDF) |
| `src/formats.ts` | What Download as and Print can make here: the formats x2t writes, by the editor's file type, the encodings it writes a txt or csv in, and what was measured to be left out |
| `src/settings.ts` | Which of the editor's settings are kept between openings, and how they fit in filex's store |
| `src/protocol.ts` | The messages and numbers both sides use |
| `src/app/` | The app page (`index.html`'s script): filex's SDK, x2t's worker client, the editor's configuration (`config.ts`: the editor, folded or not, or the phone app), saving, the switch between the phone app and the editor, the legal notice ([The app](#the-app)) |
| `src/frame/` | The editor page's script, served in place of `web-apps/vendor/socketio/socket.io.min.js`: the shim, the bridge and the session, Download as and Print (`export.ts`), the storage watcher (`storage.ts`), the phone app's wait for the kept settings (`hold.ts`), and the few things the editor needs under filex's sandbox ([The app](#the-app)) |
| `src/frame-protocol.ts`, `src/origin.ts` | What the two pages say to each other; the editor's messages under opaque origins |
| `src/worker/x2t-worker.ts` | The converter's worker: loads x2t and converts one document at a time; when x2t stops it says so once, with why, and converts nothing more - the app page's client (`src/app/x2t-client.ts`) then starts a new one, and ends one that does not finish in time ([When x2t stops](#when-x2t-stops)) |
| `app/` | The app page itself: `index.html` and `filex/app.css` |
| `scripts/build-app.mjs` | Builds the app's bundle, `dist/ui/` and `dist/ui.zip`, from the editor files (checked against the lock), x2t (checked against the pin) and the app ([The app](#the-app)) |
| `e2e/` | The browser measurement: a stand-in for filex 0.55 that serves the bundle the way filex serves an app (`e2e/harness/`), and the run in Chromium, Firefox and WebKit (`e2e/run.mjs`) ([Measured in the browsers](#measured-in-the-browsers)) |
| `upstream/onlyoffice.json` | The one place the upstream versions are pinned: the ONLYOFFICE Docs release the editor files are taken from (version, build, image tag and digest, source tag, the date it was pinned) and, under `x2t`, the converter build (release, address, SHA-512, each file's SHA-256) |
| `upstream/editor.lock.json` | What the editor bundle built from that release holds: every file with its SHA-256 and size, what was left out and why, what was changed and why, the zip's size and SHA-256 |
| `scripts/extract-editor.sh` | Builds the editor bundle from the pinned image ([The editor bundle](#the-editor-bundle)); `scripts/editor/` holds its steps: `in-image.sh` (in the image), `rules.mjs` (what is kept, filex's limits), `html.mjs` (no inline code), `storage.js` (the storage stand-in), `bundle.mjs`, `fontnames.mjs`, `config.mjs` |
| `scripts/x2t/` | Builds x2t from ONLYOFFICE core at the editor's tag ([x2t, the converter](#x2t-the-converter)): `build.sh` (the host's side, docker only), `Dockerfile` (the toolchain), `steps.sh` (the build, in its container), `patches/` (the changes to core), `main1.cpp` and `pre-js.js` (x2t's entry for the page) |
| `scripts/fetch-x2t.mjs` | Puts an x2t build made elsewhere in `dist/x2t/` (`--dir`, `--from`), checked against the pin |
| `scripts/lib/zip.mjs` | A reproducible zip writer and a reader, on `node:zlib` alone |
| `scripts/upstream-watch.mjs` | The weekly check against ONLYOFFICE's newest release ([Keeping up with ONLYOFFICE](#keeping-up-with-onlyoffice)) |
| `tests/` | Unit tests for all of the above (vitest, in Node); `tests/x2t-wasm.test.ts` runs the real x2t build |
| `filex-app.json` | The app's manifest: what filex 0.55 installs ([Installing](#installing)); `tests/app-bundle.test.ts` holds it to filex 0.55's fields and permissions |

```bash
npm install
npm test              # vitest run (the x2t round trips are skipped without the build)
npm run typecheck     # tsc
npm run x2t:build     # bash scripts/x2t/build.sh: x2t from ONLYOFFICE core (needs docker, about 20 minutes)
npm run test:x2t      # the x2t in dist/x2t (checked against the pin), then its round trips
npm run editor        # bash scripts/extract-editor.sh: the editor bundle (needs docker)
npm run build         # node scripts/build-app.mjs: the app's bundle, dist/ui.zip
npm run e2e           # node e2e/run.mjs: the bundle in Chromium, Firefox and WebKit
```

## The editor bundle

`bash scripts/extract-editor.sh` builds the editor part of the app's
bundle - `dist/editor/`, `dist/editor.zip` and `dist/editor.lock.json` -
from ONLYOFFICE's official Document Server image, pulled by the digest in
`upstream/onlyoffice.json`. It needs bash and docker, nothing else, and runs
in three containers, none of them with network access after the pull:

1. **In the image** (`scripts/editor/in-image.sh`), as a throwaway
   container that never starts the server: it does what the image does on
   its first start - the font list (`AllFonts.js`), the web fonts, the font
   and theme thumbnails, the presentation themes - from ONLYOFFICE's own
   [core-fonts](https://github.com/ONLYOFFICE/core-fonts), and copies the
   editor's files out. The system fonts are not used: the image carries
   Microsoft's core fonts, whose license does not allow handing them on;
   core-fonts has the metric-compatible stand-ins (Liberation for Arial,
   Times New Roman and Courier New, Carlito for Calibri, Caladea for
   Cambria).
2. **The bundle** (`scripts/editor/bundle.mjs`, in a Node image pinned by
   its digest) keeps what the three editors need (`scripts/editor/rules.mjs`):
   web-apps' document, spreadsheet and presentation editors - each with its
   phone app (`mobile`, see [On a phone](#on-a-phone)) - sdkjs, the
   fonts, ONLYOFFICE's license files. It leaves out the help pages (533 MiB),
   the PDF and Visio editors and engines, the embedded and forms
   apps, the macro editor, the server's script snapshots, the theme
   sources, the asm.js builds for browsers without WebAssembly, the large
   CJK fonts (a fallback CJK font stays) and pre-compressed copies;
   dictionaries are never copied. Every HTML page loses its inline code
   (`scripts/editor/html.mjs`, below).
3. **The checks**: every file is one filex serves (its extension, a clean
   path, no two names that differ only in case), no HTML page holds inline
   code, and the zip is within filex's limits for an app's bundle. Then the
   lock file is compared with the committed `upstream/editor.lock.json`; a
   difference fails the build, and `--update` writes it.

The build is **reproducible**: two complete runs, from the image to the
zip, gave the same `editor.zip` (the first measurement, SHA-256
`e8f8b2e1...0404771`; the lock file records the current one). The image is
pulled by digest, the generators give the same bytes every time, and the
zip is written sorted, with one date and no extra fields, by
`scripts/lib/zip.mjs` in the pinned Node image (deflate's bytes depend on
the zlib that makes them).

Measured with ONLYOFFICE Docs 9.4.0 (build 9.4.0.129), on an x86-64 Linux
machine (about three minutes, most of it the font and theme generators),
after the browser measurement of 2026-10-08 (the interface templates in,
the per-theme thumbnails out, below):

| Part | Files | Unpacked (MiB) | Zipped (MiB) |
|---|---:|---:|---:|
| Web fonts (generated from core-fonts) | 157 | 38.5 | 19.4 |
| sdkjs `sdk-all.js` + `sdk-all-min.js` (word, cell, slide) | 6 | 94.7 | 15.7 |
| Presentation themes (36) | 144 | 20.7 | 13.8 |
| sdkjs images (font and theme thumbnails, cursors, icons) | 217 | 14.0 | 11.9 |
| web-apps: the three editors, common, vendor, the interface templates | 969 | 34.9 | 10.0 |
| web-apps locales (46 languages, three editors) | 138 | 43.8 | 8.3 |
| sdkjs common (font, zlib, hash, spell engines; SmartArt; charts) | 170 | 16.3 | 3.4 |
| Licenses, notices, `filex/`, the three blank documents | 79 | 0.4 | 0.1 |
| The three phone apps (`web-apps/apps/*/mobile`, with their pages' moved inline scripts) | 743 | 22.9 | 5.5 |
| **The editor bundle** | **2,623** | **286.1** | **88.5** |
| **The app's bundle** (`ui.zip` of 0.1.1: with x2t, 37.1 MiB unpacked, and the app; built in the pinned Node image; 0.1.0's was 98.2 MiB) | **2,633** | **323.4** | **98.3** |

filex's limits are 128 MiB zipped, 512 MiB unpacked, 20,000 files and
64 MiB a file; the largest files are `x2t.wasm` (37.0 MiB) and
`sdkjs/cell/sdk-all.js` (30.9 MiB). The editor part was within the 2,000
files and 100 MB aimed for; with the phone apps it stays under 100 MB
(92.8 MB) and goes over the file count (2,623), which the build
only notes - filex's limits are what refuse.

Two corrections came from the browser measurement (2026-10-08):

- **The interface templates are not built into the apps.** The editor
  pages load 93 of them while they run (RequireJS's `text!`
  `.../template/ParagraphSettings.template`) and stopped with "HTTP status:
  404" without them. filex serves no `.template` file, so they are carried
  as `.template.txt` and the editor page's script asks for that name
  (`src/frame/text.ts`, through the text plugin's own `createXhr` setting).
- **The per-theme thumbnails are never asked for** (396 files at 11
  scales): opening a presentation and its Design tab fetches one sprite,
  `sdkjs/common/Images/themes_thumbnail.png`, and no code in web-apps or
  sdkjs names the per-theme files. They are left out.

**What the bundle changes in ONLYOFFICE's files**, every change listed in
the lock file (`changed`, `added`) and in the bundle itself
(`editor/filex/CHANGES.txt`):

- **Inline code moves into files.** filex serves an app's pages without
  `'unsafe-inline'`, so an inline `<script>` would not run. Each one (the
  three editors' pages have ten each) moves byte for byte into a file next
  to its page - `index.inline-1.js` ... - loaded from the same place, so
  the order and `document.write` stay as they were. The one inline handler
  web-apps uses, a stylesheet loaded as `media="print"` and switched to
  `all` on load, becomes a plain `media="all"` stylesheet. Any other inline
  code (a handler, a `javascript:` address) stops the build.
- **The storage stand-in** (`filex/storage.js`) is the first script of
  every page: in filex's sandboxed frame the browser refuses
  `localStorage`, where the editor keeps its settings; the page gets an
  in-memory one instead. It also takes `navigator.serviceWorker` away where
  reading it throws (Chromium, in a sandboxed page): ONLYOFFICE's phone
  apps read it while Framework7 starts, and the throw stopped them before
  anything showed (measured 2026-10-08); the editors ask
  `'serviceWorker' in navigator` first and now go on without one.
- `web-apps/apps/api/documents/api.js` is `api.js.tpl`, as the Document
  Server's first start makes it, with the cache tag left as a placeholder so
  the editor's paths are not rewritten; ONLYOFFICE's `.license` files and
  the interface templates get a `.txt` extension, and the Document Server's
  three blank documents (`document-templates/new/default/new.docx` ...,
  what filex's New menu copies) a `.bin` one, so filex serves them. Their
  content is unchanged.
- `core-fonts-licenses/` carries each font family's license files and, in
  `FONTS.txt`, the copyright and license each font states in its own name
  table (several families ship without a license file).

The app's build ([The app](#the-app)) then makes one more change, and only
in the app's bundle: `web-apps/vendor/socketio/socket.io.min.js`, ONLYOFFICE's
copy of the socket.io client, is replaced by the editor page's script, and
an empty `themes.json` (the Document Server's list of custom themes, which
the editor asks for on every opening) is added. `editor/filex/CHANGES.txt`
in the bundle says so.

## x2t, the converter

x2t is ONLYOFFICE's converter: a Document Server runs it as a program to
turn a docx, xlsx or pptx into the editor's format and back, and to write
the other formats of Download as. Here it is the same program, from
ONLYOFFICE core, compiled to WebAssembly and run in a worker (`src/x2t.ts`
drives it). It is **this project's own build, from ONLYOFFICE core at the
editor files' tag** - `v9.4.0.129`, commit `a016fc28` - released here as
**`v9.4.0.129+2`** and pinned under `x2t` in
[`upstream/onlyoffice.json`](upstream/onlyoffice.json): how it is built,
every source by its commit, and the SHA-256 of `x2t.js` and `x2t.wasm`.
Release 0.1.0 carried CryptPad's build
([onlyoffice-x2t-wasm](https://github.com/cryptpad/onlyoffice-x2t-wasm)
`v9.3.2+3`, whose core came from Euro-Office's copy of ONLYOFFICE core at
9.3.2).

### Building it

```bash
bash scripts/x2t/build.sh     # or: npm run x2t:build - needs bash and docker only
#   --cpus N --memory SIZE    the build container's share (default 8 and 16g)
#   --work DIR                the build tree (default .x2t-build/, about 4.5 GB)
#   --out DIR                 where x2t.js and x2t.wasm go (default dist/x2t)
```

`build.sh` builds the toolchain image (`scripts/x2t/Dockerfile`:
emscripten's own image, `emscripten/emsdk:4.0.11`, pinned by digest, with
qmake and autotools from Ubuntu's snapshot of 2026-10-01, so the same
packages come every time) and runs the build in a container of it
(`scripts/x2t/steps.sh`) with the CPUs and memory it is given. It then
checks the two files against the sums pinned in `upstream/onlyoffice.json`
and puts them in `dist/x2t/`; a build that gives other bytes fails and
says so. Every step leaves a stamp, so a build that stopped goes on from
where it stopped; an empty `--work` builds everything. In the container:

1. every source is fetched by the commit pinned in `x2t.build.sources` -
   ONLYOFFICE core and build_tools at `v9.4.0.129`, hyphen, OpenSSL
   1.1.1f (its headers only) - and Boost 1.84.0 by its tarball's SHA-256;
   core's own fetch scripts bring the rest of its third-party code
   (harfbuzz, brotli, gumbo, katana, md4c, the iWork readers), each at the
   commit it names;
2. the patches in `scripts/x2t/patches/` are applied to core (below);
3. Boost's date_time and regex and emscripten's ICU port are compiled;
4. the 28 libraries x2t links - core's qmake projects, from
   UnicodeConverter and the kernel to the OOXML, Microsoft binary, ODF,
   RTF, txt, PDF, HTML, EPUB, XPS, DjVu, iWork and HWP readers and writers -
   are built one after another with `emcc -Os` and CryptPad's flags;
5. x2t is linked: `main1` exported (the page calls it with the path of a
   `params.xml`, as the Document Server calls x2t), `ccall` and the
   in-memory file system, CryptPad's `pre-js.js`. The documents it writes
   name their application `ONLYOFFICE/9.4.0.129`, as the Document Server's
   do (CryptPad's build wrote `ONLYOFFICE/2.5.565.0`).

The recipe is CryptPad's - its Dockerfile and `embuild.sh` at commit
`7debf5e6` - carried over to 9.4, with the libraries built in one container
instead of a Docker stage each. The patches, each saying what it changes
and why:

- `01-cryptpad-wasm.patch`: CryptPad's changes to ONLYOFFICE core for
  WebAssembly - its `core/` at tag `v9.3.0+0` against core `v9.3.0.140`,
  the commit it was pulled from - applied to `v9.4.0.129` three-way. Kept:
  the build files of the libraries (emscripten's ICU instead of core's, no
  second zlib, no library linked into another twice, the text shaper on),
  doctrenderer without a JavaScript engine (CryptPad's stand-ins), two
  functions of HtmlFile2 renamed, no FB2 converter, no memory limit,
  `pdf.bin` read from beside the document. Left out, as 9.4 does not need
  them: CryptPad's older copy of `Common/base.pri`, a binary reader moved
  into its header, boost_regex unlinked (it is built here), a list of
  headers, a renamed test file.
- `02-wasm-link-flags.patch`: two linker flags emscripten's linker does not
  know, and no HEIF pictures (libheif is not built for WebAssembly).
- `03-unicode-utf32.patch`: the Turkish letters of a txt or csv
  ([below](#txt-and-csv)).
- `04-starmath.patch`: ONLYOFFICE's StarMath converter linked. CryptPad's
  build leaves it out, and the ODF reader converts every formula LibreOffice
  writes with it: an odt, ods or odp with a formula stopped the module
  ("Aborted(missing function: ...CStarMathConverter...)", measured on
  CryptPad's `v9.3.2+3`, the x2t of release 0.1.0). Now the formula comes in
  as OOXML math.
- `05-frame-anchor.patch`: a frame's anchor (`text:anchor-type`) is read
  from the frame whether or not it has a graphic style. The ODF reader read
  it only from inside the style's block, so a frame without
  `draw:style-name` - valid OpenDocument, written by producers other than
  LibreOffice - lost its anchor and became a floating shape at the top left
  of the page's margin: a formula "as-char" at the end of a sentence was
  drawn in front of it (#220, measured on `v9.4.0.129+1`). LibreOffice gives
  every frame a style (a formula's has the parent "Formula"), and its files
  kept their place.

What x2t still does without, as CryptPad's build does: the link lists 86
functions it does not have, and a conversion that reached one would stop
the module - OpenSSL's (signing a document, checking a signature), the
JavaScript engine's (doctrenderer runs none here; html, md and the images,
which need it, end with x2t's error 80, measured, not with a stop) and the
OFD reader's (an OFD package, whatever its name: x2t knows a file by what it
holds). FB2 and HEIF are not built. The app tells the person when x2t
stops, and starts it again for the next conversion ([When x2t
stops](#when-x2t-stops)).

**Measured** (2026-10-10, an x86-64 Linux machine, `--cpus 6 --memory 7g`):
two builds from empty trees, each from a fresh clone of this branch, the
second with the toolchain image built again without Docker's cache (another
image id), gave the same `x2t.js` (133,782 bytes, SHA-256 `9f2f65ac...`)
and `x2t.wasm` (38,763,076 bytes, `8f643075...`) of `v9.4.0.129+1`; so did
the build the recipe was written with, resumed from its stamps again and
again. About 20 minutes each - fetching the sources 3 minutes, Boost and
emscripten's ICU 3, the graphics library 4.5, the link 2 - and a 4.5 GB
build tree. `v9.4.0.129+2` (patch 05; 2026-10-10, an x86-64 Linux
machine, `--cpus 6 --memory 7g`): two builds from empty trees gave the
same `x2t.js` (133,782 bytes, SHA-256 `9f2f65ac...`, the same as
`v9.4.0.129+1`'s: only the module changed) and `x2t.wasm` (38,763,027
bytes, `cabaa6e3...`), the sums pinned; 18.6 and 17.4 minutes.

### txt and csv

CryptPad's build wrote a txt or csv with **every letter outside ASCII cut
to its low byte** - "Şifreli belge" came out as `^ifreli belge` (Ş is
U+015E, `^` is 0x5E) - so 0.1.0 left both out of Download as. The cause,
measured, is UnicodeConverter, the part of core that writes text in an
encoding: it hands the text (C++ `wchar_t`, UTF-32 on Linux and in
WebAssembly) to ICU with `u_strFromWCS`. ICU knows that `wchar_t` is UTF-32
on Linux, but not on emscripten: there it goes through the C library's
`wcstombs` in the current locale, and in the "C" locale every letter outside
ASCII fails (`U_ILLEGAL_ARGUMENT_ERROR`, measured with a small program
against emscripten 4.0.11's ICU, which converts the same text with
`u_strFromUTF32`). On the failure UnicodeConverter keeps each character's
low byte. `03-unicode-utf32.patch` has it use ICU's UTF-32 functions
wherever `wchar_t` holds more than 16 bits (Windows keeps `u_strFromWCS`).

Download as offers **txt** for a document and **csv** for a workbook again.
Both go through the editor's own dialog (the encoding; for a csv the
delimiter too), and its choice reaches x2t as a Document Server passes it
(`m_nCsvTxtEncoding`, `m_nCsvDelimiter`, `m_nCsvDelimiterChar`). The dialog
lists only what x2t writes right here, measured code page by code page
(`src/formats.ts`, `TEXT_ENCODINGS`):

| | Offered | Not offered, measured |
|---|---|---|
| csv | UTF-8, UTF-16, UTF-16 big endian (each with its byte order mark), UTF-32 and UTF-32 big endian (without one) | every other code page: emscripten's ICU (68.2) has no conversion tables, so windows-1254, ISO-8859-9, windows-1252... do not open and the text came out cut to its low bytes; ISO-8859-1 opens and has no Ş, Ğ or İ |
| txt | UTF-8 | x2t's txt writer writes UTF-8 for any code page but its "Unicode" (50) and "big endian" (51), and those as UTF-16 with the text left out wherever `wchar_t` is 32 bits - ONLYOFFICE's own, not this build's |

An encoding outside the list that reaches the app anyway is refused, and
the person is told. `tests/x2t-wasm.test.ts` writes the Turkish document as
txt and the workbook as csv in each encoding offered and with each
delimiter: red on CryptPad's build, green on this one.

### The round trips

`npm run test:x2t` drives the build with `src/x2t.ts`, in Node, through
three documents built in the test with Turkish text (ğ Ğ ı İ ş Ş ç ö ü): a
Word document with bold and italic runs and a table, a workbook with a
sheet named in Turkish, numbers and a formula, a presentation; and two odts
with a LibreOffice formula at the end of a sentence and between two words,
one with the frame style LibreOffice gives a formula, one without
(`tests/fixtures/office.ts` `odtWithFormula`). Measured on `v9.4.0.129+2`:

| | In | Editor.bin | Back | Same Editor.bin twice | Second save changes |
|---|---:|---:|---:|---|---|
| docx | 1,425 B | 1,612 B (`DOCY;v10`) | 8,811 B | yes | `word/theme/theme1.xml` once, then nothing |
| xlsx | 2,477 B | 1,328 B (`XLSY;v10`) | 6,827 B | not always (below) | nothing |
| pptx | 4,598 B | 2,076 B (`PPTY;v10`) | 10,902 B | yes | nothing |

Every text comes back exactly, with its bold and italic, the table's four
cells, the sheet's name, its numbers and its `SUM` formula; each odt's
formula (`a + b`, MathML with its StarMath annotation) comes back in a docx
as OOXML math (`<m:oMath>`) in the line where its frame is - "Iğdır: a+b",
"Önce a+b sonra metin." - and not as a floating shape (Editor.bin 1,515 B
either way; without the style `v9.4.0.129+1` made both formulas shapes at
the top left of the margin). Each conversion
takes 12-40 ms; the module starts in about 180 ms. The first save adds what
x2t always writes (styles, settings, a theme, document properties); from
the second save on, opening and saving again changes nothing. As in
CryptPad's build, the **workbook's Editor.bin is not byte-for-byte the
same** from one conversion to the next - x2t writes a block of it from
memory it never cleared (609 bytes differed between two conversions of one
workbook here) - while the workbook made from any of them is the same. The
test checks the workbooks, not those bytes; editing together does not
depend on it either (everyone opens the one sealed Editor.bin its first
editor made).

**Download as** (`src/formats.ts`, `x2tExport`): from the editor's document
the same test writes every format the app offers, each as its own type
(x2t needs the type, `m_nFormatTo`: by the file name alone it writes a
plain docx for a .dotx), with the Turkish text whole - docx, docm, dotx,
odt, ott, rtf, txt; xlsx, xlsm, xltx, ods, ots, csv; pptx, pptm, potx,
ppsx, odp, otp, in 4-51 ms each. PDF is made in the browser from the pages
as the editor lays them out (its renderer's drawing, `pdf.bin` beside the
document) and the fonts it drew them with: x2t has no layout of its own,
and without them it writes nothing. Left out, measured again on this
build: html, md, mht, fb2 and the images (jpg, png), which need the
Document Server's renderer; and epub, which stops the module.

### When x2t stops

x2t can stop - emscripten's `abort()`, for a document that needs one of the
functions the build leaves out (an OFD package under a .docx name does,
measured), or a trap, or the stack or the memory running out - and the
module cannot be used again. The worker (`src/worker/x2t-worker.ts`) says
so once, with why in a line (`x2tStopReason` in `src/x2t.ts`, the C++ name
made readable: "missing function: COFDFile::COFDFile"), and converts
nothing more. The page (`src/app/x2t-client.ts`) fails what waits, ends
the worker and starts a new one for the next conversion, so a save after a
Download as that stopped x2t still converts; a conversion that does not
finish in time (a minute, and five seconds more per MiB) and a worker that
dies (its `error` or `messageerror`) are handled the same way. The person
reads it in their language: "The document could not be opened: the
converter stopped on this document (missing function: COFDFile::COFDFile)",
"Belge açılamadı: dönüştürücü bu belgede durdu (...)"; a save or a Download
as says it in filex's toast.

Measured (2026-10-10, #220): the abort reaches the worker the same way in
Chromium, Firefox and WebKit - `Module.onAbort`, then a
`WebAssembly.RuntimeError` out of `ccall`. What looked like Chromium
hanging on a document 0.1.0's x2t stopped on ([Measured in filex
0.55](#measured-in-filex-055)) was the page's phase (`data-fx-phase`): the
error was on the screen, but the editor, loading beside the conversion,
said it was ready after the conversion had failed and took the page out of
"failed" - x2t is ready before the editor in Chromium nearly always, in
Firefox often - so anything watching the phase waited for an opening that
had ended, and the editor went on loading behind the message. "failed" now
stays until the editor is started again, and an opening that failed ends
the editor. `npm run e2e` opens such a document in each browser
(`stops.docx`) and reads the page six seconds after it failed: still
"failed", the Turkish message, no editor (red on the 0.1.1 bundle in all
three browsers, green now).

## The app

`npm run build` (`node scripts/build-app.mjs`) makes the bundle filex
installs, `dist/ui.zip` (and the tree, `dist/ui/`): the editor files from
`dist/editor/`, each checked against `upstream/editor.lock.json`; x2t from
`dist/x2t/`, checked against the pin; this project's three scripts, bundled
with esbuild (pinned in `package-lock.json`); the app page; `LICENSE` and
`NOTICE`. It checks filex's limits, that the app page has no inline code
and that every file `filex-app.json` names is in it.

### Building a release

A release's `ui.zip` is built from its tag with docker alone, every step
pinned - the Document Server image and the Node image by digest, the npm
packages by `package-lock.json`, x2t by its hashes - so anyone can make the
same bytes and compare them with `ui.bundle.sha256` in `filex-app.json`:

```bash
git clone --branch v0.1.1 https://github.com/BRF-Tech/filex-office-editor
cd filex-office-editor
bash scripts/extract-editor.sh        # the editor files, checked against upstream/editor.lock.json
docker run --rm -v "$PWD:/src" -w /src \
  docker.io/library/node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 \
  sh -c 'npm ci && node scripts/fetch-x2t.mjs && node scripts/build-app.mjs'
sha256sum dist/ui.zip                 # the value in filex-app.json
```

`fetch-x2t.mjs` takes x2t from the release's `x2t.zip`, checked by the
SHA-512 and the two SHA-256 sums in `upstream/onlyoffice.json`. To make x2t
too rather than take it, run `bash scripts/x2t/build.sh` first (about 20
minutes, [x2t, the converter](#x2t-the-converter)): it puts the same two
files in `dist/x2t/`, and `fetch-x2t.mjs` then finds them in place. The
release's `x2t.zip` is `node scripts/fetch-x2t.mjs --pack dist/x2t.zip`,
run in the same Node image.

Measured for 0.1.1 (2026-10-10, an x86-64 Linux machine): two complete
builds in two fresh checkouts, from the image to the zip, each with its own
build of x2t (the two of [x2t, the converter](#x2t-the-converter)), gave the
same `ui.zip` - 103,087,642 bytes, 2,633 files, SHA-256
`7cd9c42c00e839f6970a7bc55f0fd76c180cb0b9c714d130fbaa911633aea06b` - the
same `x2t.zip` - 10,221,381 bytes, SHA-512 `4a5ba87a...f9f77335` (and so
did `--pack` under Node 22.12 on Windows) - and the same `editor.zip` as
the lock file; about four minutes each from the image to the zip.

Measured for 0.1.0 (2026-10-09, an x86-64 Linux machine): two complete
builds in two fresh checkouts, from the image to the zip, gave the same
`ui.zip` - 102,979,682 bytes, 2,633 files, SHA-256
`61a1a9db840c8ab0adad07760f190796ababecbff0fda0fe8c7c8aa0d6986ef6` - and the
same `editor.zip` as the lock file (`ce74fb00...e3be116`); about two minutes
each. The app's build alone, run again on the final tree, gave the same
bytes in the pinned Node image (22.23.3) and in Playwright's image (Node
24.14.1, the same zlib, 1.3.1-e00f703); deflate's bytes follow the zlib. The release attaches that `ui.zip`; the repository does not carry it.
The bundle names its version in the legal line under the editor, so a
release's source is the tag the line links to.

Under filex both pages of the app are sandboxed, each an opaque origin of
its own (`sandbox allow-scripts`): neither can reach into the other, a
`blob:` address one makes the other may not read, and neither has storage.

**The app page** (`index.html`, `src/app/`) is what filex opens:

1. It connects to filex with filex's SDK (`@brftech/filex-app-ui`) and reads
   the file. An empty file opens as the blank document of its kind.
2. It starts x2t in a worker - from a `blob:` address whose one line imports
   the worker from the package, the only way an opaque origin may start one
   - and converts the file to the editor's format while the editor loads.
3. It loads ONLYOFFICE's `api.js` from the package and starts
   `DocsAPI.DocEditor`, which frames the editor page. The configuration
   (`src/app/config.ts`) follows filex: the person's language and region,
   filex's light or dark theme (ONLYOFFICE's `theme-white` /
   `theme-night`), a file that cannot be saved opens to read, a frame
   narrower than 600 px starts the editor folded and, on a touch screen,
   opens ONLYOFFICE's phone app instead ([On a phone](#on-a-phone)).
   Everything that
   would reach a Document Server is off: plugins, macros, chat, the spell
   checker, help, "suggest a feature". Download as and Print are on when
   filex can hand a file over (the app's `ui:download` grant).
4. It hands the editor page the converted document over a `MessagePort`,
   as bytes (transferred, not copied).
5. It saves: the editor's Save (its button, Ctrl+S in the editor), filex's
   Save (and Ctrl+S outside the editor, through the SDK), and every ten
   minutes while there are changes. A save asks the editor page for the
   document as the editor holds it (`asc_nativeGetFile`, with its images),
   converts it back to the file's own format with x2t and writes it as a
   new version (`file.save`). filex is told "unsaved changes" while there
   are and asks before the person leaves them.
6. **Download as and Print.** The editor page hands over what the editor
   asked for (below); x2t writes it in the worker - the formats in
   `src/formats.ts`, and PDF from the pages as the editor laid them out
   with the fonts it drew them with - and filex hands the file to the
   person (`ui.download`, named after the document) or prints the PDF
   (`ui.print`, filex 0.55, with the `ui:print` grant: a sandboxed frame may
   not open the browser's print dialog, so filex prints it from its own
   page). Without that grant, or on a filex without `ui.print`, the PDF goes
   to the person as a download, and they are told so.
7. **The editor's settings** (units, zoom, the ribbon folded or not, the
   "New" hints the person closed...) are kept in filex's store for this app
   (`state.set`, under one key, at most 8 KiB, `src/settings.ts`) a moment
   after the editor writes them, and given back at the next opening. The
   theme is not kept: filex decides it.
8. It shows, under the editor, the notice ONLYOFFICE's terms ask for: based
   on ONLYOFFICE Docs by Ascensio System SIA, this version may have been
   modified, the Docs version and ONLYOFFICE's source tag, the AGPL and this
   repository at the app's tag, the trademark line. The editor's own About
   is not touched.

**The editor page** is ONLYOFFICE's, as it ships. Its script
(`src/frame/main.ts`) is served at the address the editor page loads
socket.io from, so it is the editor's socket: the shim, the bridge and, for
one person, the session (`src/session.ts`) - a Document Server answered in
the page. It makes the editor's `blob:` addresses itself, from the bytes it
was handed. It also does what the editor needs under filex's sandbox, each
measured in the browser before it was written:

| What | Why | How |
|---|---|---|
| The two pages hear each other | `api.js` and the editor's Gateway take a message only from the origin of the other's address; a sandboxed page's messages carry the origin `"null"`, so the editor never got its configuration | `src/origin.ts`: a message that comes from the one window it should come from is handed on with the origin they expect (the window is a stronger check than the origin was); everything else is left as it is |
| The interface templates | served as `.template.txt` (above) | `src/frame/text.ts`: the text plugin's `createXhr` setting |
| The spell checker | an opaque origin may not start a worker from an address; the exception came inside the editor's answer to the server's auth and stopped the document from opening; spell checking has no dictionaries here anyway | `src/frame/workers.ts`: the spell engine gets a worker that does nothing; any other worker from the package starts from a `blob:` address |
| The presentation themes | the editor loads `sdkjs/slide/themes//themes.js`; nginx merges the two slashes, filex refuses an empty path segment | `src/frame/themes-path.ts`: the editor is given its themes folder without the trailing slash |
| Save while the editor hands over its changes | the editor's Save does nothing while a hand-over runs, and keeps nothing for later (sdkjs `asc_Save`); a Ctrl+S right after typing was lost | `src/frame/save-retry.ts`: the Save is kept until the editor has started it, and asked again when the editor is free |
| Inserting a picture from the computer | the editor uploads it to the Document Server | `src/frame/images.ts`: the picture stays in the page as a `blob:` address under a new `media/` name, and goes into the next save like every other picture |
| Download as and Print | the editor posts the document to the Document Server, which converts it and answers with an address | `src/frame/export.ts`: the editor's last step (`_downloadAsUsingServer`) goes to the app page instead, with the document, its pictures and - for PDF - the pages the editor drew and the font files it holds (read through `getFontStream`: a font the engine has taken in is only a pointer into its memory in `g_fonts_streams`, and a PDF made from those came out in a single face); the editor waits as it would for the server. The File menu's Download as lists only what x2t writes here |
| The editor's settings between openings | the stand-in forgets them with the page, so the "New" hints showed at every opening | `src/frame/storage.ts` watches the stand-in and reports what the editor writes; the kept settings are the app page's first word, and the editor's start waits for them (a RequireJS loader plugin holds the `socketio` module the editor's code depends on, at most 5 s) |
| The phone app's start waits for the kept settings | the phone apps have no RequireJS, so the hold above does not reach them; they load their scripts one after another and create the editor when sdkjs has loaded | `src/frame/hold.ts`: sdkjs's scripts appended to the phone app's page wait until the kept settings are in (at most the same 5 s), then go in, in order; the page's `appendChild` is put back |
| One person counts one | the bridge's keeper is a participant (it keeps the editor sending its changes as it makes them: an editor that thinks it is alone does not), and the editor showed "2" | the keeper's name carries a group of its own (the editor's `group<NBSP>name` form) and the editor shows only people without a group (`permissions.userInfoGroups: [""]`) |

### On a phone

A phone - a frame narrower than 600 px on a touch screen (`isPhone`,
`src/app/config.ts`) - opens the document in **ONLYOFFICE's phone app**,
the `mobile` app each of the three editors has (Framework7, its own pages
under `web-apps/apps/<editor>/mobile/`, on the same sdkjs and loading
socket.io from the same address, so the same editor-page script answers
it). It is made for a phone: touch-sized, with its own search, navigation,
settings, Download and Print, which go through x2t to filex like the
editor's (a format it lists that x2t does not write here is refused, and
the person is told).

**It reads; it does not edit.** The phone apps in ONLYOFFICE's Document
Server image are the open-source build, whose editing controller is a stub
(`isSupportEditFeature()` returns false in all three bundles of 9.4.0.129).
In edit mode they show "Using the free Community version, you can open
documents for viewing only. To access mobile web editors, a commercial
license is required." and stay read-only: editing in the phone apps is a
commercial ONLYOFFICE feature, not in the open-source code. So the app
opens them in view mode, and for editing:

- **"Edit"**, under the phone app (the app page's own button, next to the
  legal line), replaces it with the editor - the desktop one, folded as on
  any narrow screen: the ribbon shows its tabs only (a tap opens one), no
  rulers, the side panel closed, at the person's zoom (measured at 390 px
  before the phone apps came in: a page fitted to the width is drawn at
  32 % and the tab names disappear in the compact header, so neither is
  used). The document goes over as it is; nothing was changed in the phone
  app.
- **"Reading view"** goes back: changes are saved first (a new version, as
  with Save), then the editor's document is converted through x2t again and
  the phone app opens it.

The switch is decided at the opening (a phone turned sideways keeps what it
opened with), and it is the app's: the phone app's own "switch to desktop"
choice is off (`customization.mobile.disableForceDesktop`). The phone app's
theme follows filex's at the opening (it knows `theme-light` and
`theme-dark` only); a change of filex's theme while it is open shows at the
next opening. Its settings, all under `mobile-` in its storage, are kept
with the editor's in the one value (`src/settings.ts`), and its start waits
for them like the editor's (`src/frame/hold.ts`).

## In an encrypted folder

0.2.0 (on `main`, not released; filex **0.56.0** or later). The manifest
says `"encrypted_folders": {"open": true}`, and filex derives the permission
`files:e2e-plaintext` from it - the install review says what it means: the
app sees every document opened with it in an encrypted folder; the server
still holds only encrypted data. The app's reason is in `filex-app.json`
(English and Turkish).

With the folder unlocked in the person's browser, filex offers the editor on
a document there. filex does both halves of the encryption, in the browser
(the CryptPad model):

- **Opening:** filex reads the ciphertext the server holds through the app's
  own door, decrypts it with the folder key and hands the app the plaintext
  (`FileInfo` says `encrypted: "folder"`, `plaintext: true`). The app reads it
  through the SDK as it reads any document - `fx.open(0).bytes()` - and x2t
  converts it in the app's worker, inside the sandbox.
- **Saving:** the editor's Save, filex's Save and the ten-minute save hand
  the document to the SDK's `save()` as always; filex encrypts it with the
  folder key before anything leaves the browser and writes it as a new
  version, only over the file as the editor opened it.
- **Download as and Print** still hand the person a copy on their click, as
  filex's own decrypted download does.
- **In a vault** (filex 0.56): the same - `FileInfo` says `encrypted:
  "vault"`, `plaintext: true`; filex reads the document from the vault and
  writes the save as the vault's next generation. One person writes a vault
  at a time: a save filex refuses because somebody else is writing it
  (`vault_locked`), because the vault's write lock ended before the save
  finished (`vault_lock_lost`), or because somebody saved the document since
  it was opened (`changed`, in a folder too) writes nothing, and the app says
  so in a person's words (`src/app/config.ts` `saveRefusal`, `saveRefused`
  in `src/app/strings.ts`) - the changes stay in the editor.
- **Not here:** a single encrypted file (`.fxe`), or filex 0.55 and older -
  filex does not hand the document over (`encrypted` without `plaintext`),
  and the app says so instead of asking for it (`src/app/config.ts`
  `encryptedNotHanded`).
- **Lock** in filex closes the editor with the folder (save first).

The measurement imitates filex 0.56 (`e2e/harness/host.js`, `enc=folder`):
the harness holds the document as filex's explorer encrypts it (the
`filexe2e` one-shot format), decrypts it for the app and encrypts the save;
`npm run e2e` then checks, in each engine, that the server receives only
ciphertext, that no request carries a document in the clear, and that what
the server holds decrypts to a document with the typed text - and that on
filex 0.55 (`enc=055`) the app says the document is encrypted
(`encryptedRun`).

Measured on 2026-10-10 in Chromium 147, Firefox 148 and WebKit 26.4 (Linux,
Playwright 1.59's image, Node 24.14.1, headless; on a Windows PC's docker;
x2t `v9.4.0.129+2`), in each browser: the document of the encrypted folder
opened (2.1 s, 3.4 s, 5.7 s), the typed text saved, the server received
only `filexe2e` ciphertext (25,831 / 25,870 / 25,832 bytes) and no request
the pages sent carried a document in the clear; what the server holds,
decrypted with the folder key, holds the typed text and the Turkish
document's own; on filex 0.55 the app said, in the run's Turkish, that the
document is encrypted and that filex does not hand it to this app there,
asked for nothing, and nothing was saved. In the same run the rest passed
again: 36 of 36, no request outside the package, no failed request, 63
screenshots ([Measured in the browsers](#measured-in-the-browsers)). Not
yet measured in a real filex 0.56.

## Measured in the browsers

`npm run e2e` (`node e2e/run.mjs`, `--shots` for screenshots) serves the
built bundle the way filex 0.55 serves an app's interface - the address
shape, the headers and the policy built from the grant
(`backend/internal/wasmplugin/uipolicy.go`, as filex 0.55 has it), filex's
bootstrap first in every page - with a
host page that draws the sandboxed frame and answers the app's bridge the
way filex's `AppFrame` does (`e2e/harness/`: `state.get/set` with filex
0.54's limits, `ui.download`, and `ui.print` as filex 0.55 checks it - the
`ui:print` grant, a PDF - recording the PDF instead of printing it).
Then, headless, in Chromium, Firefox and WebKit: it opens a blank docx, xlsx
and pptx (the ones filex's New menu makes) and the Turkish documents of the
x2t smoke test, types `Merhaba dünya: ğüşıöç İĞÜŞÖÇ` into each, saves with
the editor's Ctrl+S and with filex's Save, and reads the written files back.
For the Turkish documents it then opens File → Download as, checks what is
offered, downloads the OpenDocument copy and the PDF, and prints. Once per
browser, in one browser context, it closes the editor's "New" hint, reopens
the document, and prints where filex has no print (`print=none`) and,
reopened, where the app has no `ui:print` grant. Once per browser it also
opens the two odts with a formula and reads, in the editor's own document,
that each formula is in its line (`formulaRun`), and opens a document x2t
stops on (`stopRun`, [When x2t stops](#when-x2t-stops)).

Measured on 2026-10-08 (Playwright 1.59: Chromium 147.0.7727.15, Firefox
148.0.2, WebKit 26.4; Windows, headless; the harness's own page and file
reads aside), 21 of 21:

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| Opens (from the host page's load to the document on screen) | 1.5-2.0 s | 3.2-4.9 s | 3.5-4.0 s |
| docx, xlsx, pptx: typed text in both saves, the Turkish documents' text kept | 6/6 | 6/6 | 6/6 |
| "Unsaved changes" on typing, off after the save | yes | yes | yes |
| People the editor counts (one person editing) / the header's "2" | 1 / gone | 1 / gone | 1 / gone |
| Download as offers (docx · xlsx · pptx) | DOCX PDF ODT DOTX PDF/A OTT RTF · XLSX ODS PDF XLTX OTS PDF/A · PPTX PPSX PDF ODP POTX PDF/A OTP | the same | the same |
| The OpenDocument copy: its type, the typed text in it | odt, ods, odp: yes | yes | yes |
| The PDF: pages, embedded fonts (docx · xlsx · pptx) | 1, 3 · 1, 1 · 1, 2 | the same | the same |
| Print: a PDF handed to filex to print | 3/3 | 3/3 | 3/3 |
| A closed "New" hint, next opening: kept, not shown | yes | yes | yes |
| Print where filex has no print: the PDF downloaded, the person told | yes | yes | yes |
| Requests outside the package (and its own `blob:` addresses) | 0 | 0 | 0 |
| Package files missing (404) | 0 | 0 | 0 |
| Storage given to the sandboxed pages | none: the stand-in takes its place in both pages and holds the editor's settings; the app keeps them in filex's store | the same | the same |
| Screenshots, 1280 and 390 px, light and dark | 4/4 | 4/4 | 4/4 |

**The release, 0.1.0** (its `ui.zip`, run on 2026-10-09 on Linux in
Playwright 1.59's image, Node 24.14.1): `npm run e2e -- --shots` 24 of 24 -
the 21 above and the phone run below in each browser - with no request
outside the package and no failed request; openings 1.1-1.4 s in Chromium,
1.7-2.1 s in Firefox, 2.6-3.4 s in WebKit; 54 screenshots. In the same
run: `npm test` 212 of 212, `npm run typecheck` clean, `npm run test:x2t`
9 of 9.

**With this project's x2t** (`v9.4.0.129+1`, 2026-10-10; Windows,
headless; the Turkish documents, `--no-settings --no-phone`), 9 of 9 in
Chromium 147, Firefox 148 and WebKit 26.4: Download as offers TXT after RTF
for a document and CSV after ODS for a workbook; the editor's own dialog
offers UTF-8 alone for a txt and UTF-8, UTF-16 and UTF-32 for a csv; the
txt (382 B) and the csv (106 B) come to filex in UTF-8 with every Turkish
letter and the typed text; the OpenDocument copy, the PDF and Print as
before; no request outside the package.

**The release, 0.1.1** (its `ui.zip`, run on 2026-10-10; Windows,
headless, Playwright 1.59): `npm run e2e -- --shots` 24 of 24 - the 21
and the phone run in each browser - with no request outside the package
and no failed request; the txt (382 B) and the csv (106 B) in each engine;
openings 1.6-2.3 s in Chromium, 3.3-4.7 s in Firefox, 3.4-4.1 s in WebKit;
54 screenshots. In the same run: `npm test` 221 of 221 (the one test of a
built `dist/editor` skipped there), `npm run typecheck` clean, `npm run
test:x2t` 11 of 11.

**x2t stopping and the formula's place** (#220; x2t `v9.4.0.129+2`,
2026-10-10; Windows, headless, Playwright 1.59): `npm run e2e` 33 of 33 -
the 24 and, in each browser, the two odts with a formula (each formula in
its line in the editor's own document, nothing floating) and `stops.docx`
(still "failed" six seconds on, the Turkish message, no editor left);
openings 1.5-1.9 s in Chromium, 3.2-3.8 s in Firefox, 3.3-4.0 s in
WebKit. On the 0.1.1 bundle `stops.docx` fails in all three (Chromium and Firefox: the phase back to the editor's;
all three: emscripten's raw text, the editor still loading) and, with
x2t `v9.4.0.129+1`, `formula-nostyle.odt` in all three (two floating
shapes). In the same tree: `npm test` 237 of 237, `npm run typecheck`
clean, `npm run test:x2t` 13 of 13.

**Encrypted folders** (the next release, 0.2.0, on the tree above with x2t
`v9.4.0.129+2`; run on 2026-10-10 on Linux in Playwright 1.59's image,
Node 24.14.1, on a Windows PC's docker): `npm run e2e -- --shots` 36 of
36 - the 33 above and, in each browser, a document of an encrypted folder
through a stand-in for filex 0.56
([In an encrypted folder](#in-an-encrypted-folder)) - with no request
outside the package and no failed request; openings 2.0-2.6 s in Chromium,
3.4-3.8 s in Firefox, 4.8-5.5 s in WebKit; 63 screenshots. In the same
tree on Windows: `npm test` 245 of 245 (the `dist/editor` and `dist/ui`
tests included), `npm run typecheck` clean, `npm run test:x2t` 13 of 13.

The PDFs were also read with MuPDF: the Turkish text is whole, the docx's
title bold, its body regular, its italic line italic (Liberation Serif in
three faces), the workbook's total `39,5` as the Turkish locale writes it.
Firefox splits a typed line into one run per letter outside ASCII in the
saved docx (the text is whole; Playwright types those letters as text
input). Every page logged one error that is the editor's own and harmless:
its service worker cannot register in a sandboxed page. Since the phone
apps, the storage stand-in takes the service worker away where reading it
throws (Chromium), so there the editor no longer tries and logs nothing;
Firefox, where reading it does not throw, still logs the failed
registration. WebKit adds, for a presentation, that fullscreen is not
allowed (filex's policy turns it off).
At 390 px on a computer (a mouse, no touch) the editor is ONLYOFFICE's
desktop one, folded (the ribbon's tabs only, no rulers, at 100 %): usable,
not made for a phone.

**On a phone** (measured 2026-10-08 on Linux, in Playwright 1.59's image:
Chromium 147, Firefox 148, WebKit 26.4; 390 x 844, a phone's user agent,
touch; [On a phone](#on-a-phone)), 3 of 3, in a run that passed the 21
above again as well (24 of 24):

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| The Turkish docx opens in the phone app, to read, with "Edit" (from the host page's load) | 1.1 s | 1.7 s | 2.2 s |
| The phone app's "commercial license" message | not shown | not shown | not shown |
| Its Download (PDF) and Print reach filex; FB2, which x2t does not write here, is refused and the person told | yes | yes | yes |
| "Edit": the folded editor with the document; typed text saved (Ctrl+S) and in the file | yes | yes | yes |
| "Reading view": back in the phone app, nothing left unsaved | yes | yes | yes |
| The xlsx and pptx open in their phone apps | yes | yes | yes |
| Requests outside the package / failed requests | 0 / 0 | 0 / 0 | 0 / 0 |
| Screenshots: the phone app light and dark, the editor, the way back, xlsx, pptx | 7/7 | 7/7 | 7/7 |

Two things the browsers showed before it passed, both fixed in this
project's own files: Chromium refuses even to read `navigator.serviceWorker`
in a sandboxed page, and Framework7 reads it while it starts, so the phone
app stopped before showing anything (the storage stand-in now takes the
attribute away there); and filex's bootstrap makes
`Node.prototype.appendChild` read-only, so the phone app's held start
(`src/frame/hold.ts`) defines its `appendChild` on `<body>` instead of
assigning it. The phone app draws the page fitted to the screen; the
editor after "Edit" shows its "New" hints to a person who has not closed
them yet, as on a computer. Like filex 0.55, the harness sends no
`frame-ancestors` on a package page (see
[What filex provides](#what-filex-provides); `FX_FRAME_ANCESTORS=star`
puts back the `frame-ancestors *` filex sent before, and Chromium refuses the
editor page).

## Measured in filex 0.55

The release, measured in the real thing (2026-10-09): filex 0.55.0's own
image (`ghcr.io/brf-tech/filex:v0.55.0`) in a throwaway container on an
x86-64 Linux machine, a local storage, the app installed with the
administrator's API exactly as the wizard does it (`POST
/api/admin/app-plugins` with the release's `filex-app.json` and `ui.zip`, a
dry run first, then the install granting what the review listed), and
English documents - a report with a table, a budget with formulas, a
roadmap slide - opened from the explorer by a double-click in Playwright
1.59 (Chromium 147, Firefox 148, WebKit 26.4; headless, 1440 x 900, English
interface).

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| The install: dry run, review, install | 200, 19 rows (`files:read`, `files:write` and the 17 the `ui` block, the viewers and the New rows derive), `compat` ok for 0.55.0; installed `running`, its `ui.zip` SHA-256 checked against the manifest's | - | - |
| docx, xlsx, pptx open in the editor in place of the preview (from the explorer's load, a 0.7 s pause before the double-click included) | 2.1-2.4 s | 3.4-3.9 s | 4.6-5.0 s |
| Typed text, Ctrl+S in the editor: filex's save answers 200, the file on disk holds the text and what it held, the bytes it replaced are a version (`.versions/<node>/<n>`) | 3/3 | 3/3 | 3/3 |
| The legal line under the editor names the source at `/tree/v0.1.0` | yes | yes | yes |
| Download as (File menu, ODT): the file comes to the person | filex opens Chromium's save dialog (`showSaveFilePicker`), which a headless run cannot answer: not measured | `Quarterly report.odt` | `Quarterly report.odt` |
| Print (the editor's Print): filex asks ("Office editor (office-editor) wants to print “Quarterly report.pdf”."), Allow, the question goes | yes | yes | yes |
| The "New" hints closed in one opening do not show in the next (the settings kept in filex's store) | yes | yes | yes |
| New document: the dialog's Apps group offers Document (.docx), Spreadsheet (.xlsx), Presentation (.pptx); the new docx opens in the editor, typed text saves (200) | yes | not measured | not measured |
| A phone (390 x 844, touch, Chromium's Pixel 7): the phone app opens the docx to read, with "Edit"; "Edit" opens the folded editor, a save answers 200; "Reading view" goes back with the saved text | yes | not measured | not measured |
| Requests outside filex / failed requests | 0 / 0 | 0 / 0 | 0 / 1: filex's print page's `blob:` PDF frame ("Frame load interrupted", headless WebKit hands the PDF over as a download) |

The manifest drafted before 0.1.0 is what filex 0.55 refuses, measured the
same way: `400 manifest_invalid`, `json: unknown field "encrypted_folders"`;
without that block, `unknown permission "files:e2e-plaintext"`. 0.1.0 asks
for neither. On a phone, filex's viewer keeps its previous and next buttons
beside the app, so the app's frame is about 306 px wide at 390 px.

**0.1.1 in filex 0.55** (2026-10-10, the same filex image, a throwaway
container on the loopback with its data and its files in memory;
Playwright 1.59 on Windows, headless, 1440 x 900): 0.1.0 installed from its
release, then 0.1.1 over it with filex's upgrade (`POST
/api/admin/app-plugins/{id}/upgrade`, a dry run first: the same 19 rows,
`compat` ok for 0.55.0; installed `running`, its `ui.zip` SHA-256 checked
against the manifest's; the viewer says "Office editor was updated to
0.1.1."):

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| An odt with a LibreOffice formula, with 0.1.0 | never opens (nothing for 2 minutes) | "The document could not be opened: Aborted(missing function: _ZN8StarMath18CStarMathConverterC1Ev)" | the same |
| The same odt, with 0.1.1 | opens in 2.8 s, the formula on the page | 6.2 s | 5.3 s |
| The Turkish document as txt, through the editor's dialog (it offers UTF-8 alone) | filex opens Chromium's save dialog (`showSaveFilePicker`), which a headless run cannot answer: not measured | 339 B, UTF-8, every Turkish letter | the same |
| The Turkish workbook as csv (the dialog offers UTF-8, UTF-16 and UTF-32) | not measured, as above | 59 B, UTF-8, `Şehir,Sıcaklık` | the same |
| Requests outside filex / failed requests | 0 / 0 | 0 / 0 | 0 / 0 |

Chromium's "never opens" was not a hang: its error was on the screen (the
screenshot shows it), while the page's phase, which the measurement read,
had gone back to the editor's - fixed since ([When x2t
stops](#when-x2t-stops)).

## Keeping up with ONLYOFFICE

The editor files come from one ONLYOFFICE Docs release, written down in
[`upstream/onlyoffice.json`](upstream/onlyoffice.json): the version and
build, the official image's tag and its digest (`docker pull
onlyoffice/documentserver@<digest>` gets exactly those files), and the
source tag of ONLYOFFICE's repositories that matches them.

Once a week the [upstream watch](.github/workflows/upstream-watch.yml)
compares that with the newest release on Docker Hub. When ONLYOFFICE has
published a newer one, it opens an issue with what changed and what an
update involves (the lock rules in `src/locks.ts` and the protocol in
`src/bridge.ts` are compared with the new server and sdkjs, and the phone
apps are checked: how they load sdkjs, and that they still only read). It
opens one
issue per version and never a second one, even after the first is closed;
a version announced on GitHub whose image is not out yet waits for the
image. The workflow uses only its own `GITHUB_TOKEN`, with permission to
write issues. Run it by hand from the Actions tab (with "dry run" to only
look), or on your machine:

```bash
node scripts/upstream-watch.mjs --dry-run
```

The pin changes only together with a bundle built from the new release:
put the new release in `upstream/onlyoffice.json`, run
`bash scripts/extract-editor.sh --update` and commit the pin with the new
`upstream/editor.lock.json`, whose diff shows every file that changed.

## Roadmap

**0.1.0** (2026-10-09) and **0.1.1** (2026-10-10, this project's own x2t),
for filex 0.55.0 or later, are what works today:

1. The editor bundle from ONLYOFFICE's official Document Server image
   (`upstream/onlyoffice.json`), the three editors and their phone apps,
   inline scripts moved to files ([The editor bundle](#the-editor-bundle)).
2. x2t in a worker: in 0.1.0 CryptPad's WebAssembly build, since 0.1.1
   this project's own, from ONLYOFFICE core at the editor's tag - with txt
   and csv back in Download as and ODF formulas read
   ([x2t, the converter](#x2t-the-converter)).
3. The app: one person editing a document in a folder that is not
   encrypted, saving it as a new version; Download as and Print through
   filex; the editor's settings kept between openings; New document rows;
   on a phone, ONLYOFFICE's phone app to read with "Edit" to the folded
   editor; the legal notice ([The app](#the-app)).
4. A release bundle anyone can rebuild to the same SHA-256
   ([Building a release](#building-a-release)), measured in the three
   browsers against a stand-in for filex
   ([Measured in the browsers](#measured-in-the-browsers)) and in filex
   0.55 itself ([Measured in filex 0.55](#measured-in-filex-055)).

Next - the numbers are a plan, and each waits for what filex has to give it
([What filex provides](#what-filex-provides)):

- **0.2.0, encrypted folders**: one person editing a document in an
  encrypted folder, with filex 0.56's `encrypted_folders` /
  `files:e2e-plaintext` (filex decrypts the document for the app and
  encrypts what it saves) - built on `main`
  ([In an encrypted folder](#in-an-encrypted-folder)) and measured in the
  three browsers against a stand-in for filex 0.56; released once filex
  0.56 is, after its measurement in filex 0.56 itself.
- **0.3.0, editing together**: several people in one document, in an
  encrypted folder or a plain one, through filex's relay and its
  `files:co-edit` (planned for filex 0.57 or later).
- **In any release before those**: a corpus of real documents compared
  with what a Document Server makes of them; and, when filex serves an
  app's package compressed, a lighter download for the browser.

## License

**AGPL-3.0-or-later** ([LICENSE](LICENSE)), unlike filex itself (MIT). The
app runs inside ONLYOFFICE's editor and carries over the Document Server's
lock rules (`src/locks.ts`, a modified version of ONLYOFFICE Docs and
therefore AGPL-3.0-only, as ONLYOFFICE licenses it). It is kept apart from
filex on purpose: filex talks to it only through messages, and it is
installed as an app, never built into the filex binary or image.

Whoever serves this app serves its source with it: the editor's "About"
stays as ONLYOFFICE wrote it, and the app shows a legal notice that names
ONLYOFFICE as the original developer, says this version may have been
modified, and links to this repository at the exact tag it was built from
([NOTICE](NOTICE)).

The ONLYOFFICE code is Copyright © Ascensio System SIA, licensed under the
GNU AGPL version 3 with the additional terms of its section 7. ONLYOFFICE®
and ONLYOFFICE Docs™ are registered trademarks or trademarks of Ascensio
System SIA. This project is not affiliated with, endorsed by or sponsored
by Ascensio System SIA.
