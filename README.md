# filex-office-editor

The office editor app for [filex](https://github.com/BRF-Tech/filex), based
on ONLYOFFICE Docs: ONLYOFFICE's editor in the browser, **without a Document
Server**. Word, Excel and PowerPoint documents (and their OpenDocument kin)
open in the editor in place of filex's preview, alone or with other people -
and also **inside encrypted folders**, where the document is decrypted in
the browser, edited there and encrypted again before it is saved, so no
server ever reads it.

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

> **Status: prototype, not installable.** This repository holds the part of
> the design that runs next to the editor - the bridge that stands in for the
> Document Server, the Document Server's lock rules, a socket.io stand-in and
> the x2t driver - with their unit tests, and the builds of the two large
> pieces: the [editor bundle](#the-editor-bundle), taken from ONLYOFFICE's
> official image, and the pinned [x2t WebAssembly build](#x2t-the-converter).
> The app's page and the release bundle come with the next steps, and the
> app needs platform features filex gains in 0.55
> ([What filex provides](#what-filex-provides)). `filex-app.json` is a draft.
> The first release, 0.1.0, brings all of it at once ([Roadmap](#roadmap)).

| | |
|---|---|
| Based on | ONLYOFFICE Docs 9.4.0 (build 9.4.0.129) by Ascensio System SIA: the editor's files (web-apps, sdkjs, fonts) from the official Document Server image, pinned by digest in [`upstream/onlyoffice.json`](upstream/onlyoffice.json); the converter, x2t, built from ONLYOFFICE core (for now CryptPad's build, pinned under `x2t` in the same file) - see [NOTICE](NOTICE) |
| filex | **0.55.0** or later (draft: `"filex": ">=0.55.0"`) |
| License | **AGPL-3.0-or-later** ([LICENSE](LICENSE)); one file, `src/locks.ts`, AGPL-3.0-only ([NOTICE](NOTICE)) |

## What it is for

- **filex without a Document Server.** filex edits office documents through
  an ONLYOFFICE Document Server it is connected to. An instance without one
  installs this app and edits them in the browser instead.
- **Encrypted folders.** A Document Server reads the document it edits, so
  filex never offers it in an encrypted folder: there a document opens
  read-only today. With this app the document stays a docx, xlsx or pptx
  encrypted in the folder; only the browsers of the people editing it ever
  hold it in the clear.

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
  person (`src/session.ts`) the log stays in the page; editing together,
  filex seals each entry and sends it through its relay, which puts the
  sealed entries in one order without reading them, and every editor's
  bridge applies the same entries in the same order with the Document
  Server's lock rules (`src/locks.ts`), so the first request for a paragraph
  or a range wins everywhere.
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
document and seals what it sends. filex never runs the editor's code.

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
(`e2eofficeSave.ts`). Running this app also needs platform features filex
does not have yet. Their names below are proposals; filex decides them.

| The app needs | filex today | Proposed (filex 0.55) |
|---|---|---|
| ONLYOFFICE's `DocsAPI.DocEditor` opens the editor page in a frame of its own | `frame-src 'none'` | `ui.frame_package` → permission `ui:frame-package`: frames from the app's own package only, in the same sandbox |
| The editor page may be framed by the app page | package pages carry `frame-ancestors *` | ⚠ **measured, Chromium:** `*` never matches an opaque origin, so the editor page is refused ("Framing ... violates frame-ancestors *"); a package page needs no `frame-ancestors` at all (filex's own page decides what it frames) |
| The editor loads the document from a `blob:` address | `connect-src 'none'` or the package | `ui.connect_blob` → `ui:connect-blob`: `connect-src` adds `blob:` |
| The plaintext of a document in an encrypted folder | apps are never given one | `files:e2e-plaintext`: the explorer decrypts and hands the bytes over, encrypts the save (a conditional write); a separate permission with a stern warning in the review |
| Editing together | - | `files:co-edit`: the relay's routes and WebSocket, its tables, the sealed blob store, and a bridge method for the app to append and read the log |
| `localStorage` (the editor keeps settings there) | an opaque frame has none; reading it throws | in the app: an in-memory stand-in loaded first in every page (`scripts/editor/storage.js`) - **measured in Chromium, Firefox and WebKit**: none of them gives the sandboxed pages storage, the stand-in takes its place in both pages and the editor's settings land in it ([Measured in the browsers](#measured-in-the-browsers)) |
| No inline scripts | `script-src` is the package only | in the app: the build moves web-apps' inline scripts into files ([The editor bundle](#the-editor-bundle)) |
| A large package (measured: 92.7 MiB zipped with x2t, 1,889 files, 300.5 MiB unpacked, 37 MiB for `x2t.wasm`) | 128 MiB zipped, 512 MiB unpacked, 20,000 files, 64 MiB a file; served uncompressed | serving the package's files compressed (`Content-Encoding`), cached by version |

## What is in this repository

| File | What it does |
|---|---|
| `src/bridge.ts` | `OfficeBridge`: answers the editor's Document Server protocol (license, auth, authChanges, documentOpen, getLock, isSaveLock, saveChanges, unLockDocument, cursor, forceSaveStart) and turns what has to be shared into entries of the session's log; applies the log's entries, in order, to its changes, locks and participants |
| `src/locks.ts` | The Document Server's lock rules (text, spreadsheet, presentation) and the spreadsheet's lock recalculation after inserted or deleted rows and columns, kept as Docs 9.4 has them |
| `src/shim.ts` | A `socket.io` stand-in: the editor's socket is plugged into the bridge |
| `src/session.ts` | `LocalSession`: the session's log for one person, in the editor page, with the relay's rules (one order, changes only under the lease, the lease only for a member that has seen every change) |
| `src/x2t.ts` | Drives x2t (WebAssembly) to turn a docx/xlsx/pptx (or odt/ods/odp) into the editor's format and back |
| `src/protocol.ts` | The messages and numbers both sides use |
| `src/app/` | The app page (`index.html`'s script): filex's SDK, x2t's worker client, the editor's configuration (`config.ts`), saving, the legal notice ([The app](#the-app)) |
| `src/frame/` | The editor page's script, served in place of `web-apps/vendor/socketio/socket.io.min.js`: the shim, the bridge and the session, and the few things the editor needs under filex's sandbox ([The app](#the-app)) |
| `src/frame-protocol.ts`, `src/origin.ts` | What the two pages say to each other; the editor's messages under opaque origins |
| `src/worker/x2t-worker.ts` | The converter's worker |
| `app/` | The app page itself: `index.html` and `filex/app.css` |
| `scripts/build-app.mjs` | Builds the app's bundle, `dist/ui/` and `dist/ui.zip`, from the editor files (checked against the lock), x2t (checked against the pin) and the app ([The app](#the-app)) |
| `e2e/` | The browser measurement: a stand-in for filex 0.55 that serves the bundle the way filex serves an app (`e2e/harness/`), and the run in Chromium, Firefox and WebKit (`e2e/run.mjs`) ([Measured in the browsers](#measured-in-the-browsers)) |
| `upstream/onlyoffice.json` | The one place the upstream versions are pinned: the ONLYOFFICE Docs release the editor files are taken from (version, build, image tag and digest, source tag, the date it was pinned) and, under `x2t`, the converter build (release, address, SHA-512, each file's SHA-256) |
| `upstream/editor.lock.json` | What the editor bundle built from that release holds: every file with its SHA-256 and size, what was left out and why, what was changed and why, the zip's size and SHA-256 |
| `scripts/extract-editor.sh` | Builds the editor bundle from the pinned image ([The editor bundle](#the-editor-bundle)); `scripts/editor/` holds its steps: `in-image.sh` (in the image), `rules.mjs` (what is kept, filex's limits), `html.mjs` (no inline code), `storage.js` (the storage stand-in), `bundle.mjs`, `fontnames.mjs`, `config.mjs` |
| `scripts/fetch-x2t.mjs` | Fetches the pinned x2t build and checks it ([x2t, the converter](#x2t-the-converter)) |
| `scripts/lib/zip.mjs` | A reproducible zip writer and a reader, on `node:zlib` alone |
| `scripts/upstream-watch.mjs` | The weekly check against ONLYOFFICE's newest release ([Keeping up with ONLYOFFICE](#keeping-up-with-onlyoffice)) |
| `tests/` | Unit tests for all of the above (vitest, in Node); `tests/x2t-wasm.test.ts` runs the real x2t build |
| `filex-app.json` | The app's manifest - a **draft** until the platform features above exist |

```bash
npm install
npm test              # vitest run (the x2t round trips are skipped without the build)
npm run typecheck     # tsc
npm run test:x2t      # fetch the pinned x2t build (39 MB, checked), then its round trips
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
   web-apps' document, spreadsheet and presentation editors, sdkjs, the
   fonts, ONLYOFFICE's license files. It leaves out the help pages (533 MiB),
   the PDF and Visio editors and engines, the mobile, embedded and forms
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
| **The editor bundle** | **1,880** | **263.3** | **83.0** |
| **The app's bundle** (`ui.zip`: with x2t, 37.1 MiB unpacked, and the app) | **1,889** | **300.5** | **92.7** |

filex's limits are 128 MiB zipped, 512 MiB unpacked, 20,000 files and
64 MiB a file; the largest files are `x2t.wasm` (37.0 MiB) and
`sdkjs/cell/sdk-all.js` (30.9 MiB). The editor part is within the 2,000
files and 100 MB aimed for.

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
  in-memory one instead.
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

The converter is pinned under `x2t` in `upstream/onlyoffice.json`. Until
this project builds its own from ONLYOFFICE core at the editor's tag (a
requirement for 0.1.0), it is **CryptPad's build**:
[onlyoffice-x2t-wasm](https://github.com/cryptpad/onlyoffice-x2t-wasm)
`v9.3.2+3` (AGPL-3.0-or-later), pinned like CryptPad pins it, by the
release's SHA-512, and by each file's SHA-256. `node scripts/fetch-x2t.mjs`
downloads it (or takes a zip with `--from`), checks all three hashes and
puts `x2t.js` and `x2t.wasm` in `dist/x2t/`.

`npm run test:x2t` then drives it with `src/x2t.ts`, in Node, through
three documents built in the test with Turkish text (ğ Ğ ı İ ş Ş ç ö ü):
a Word document with bold and italic runs and a table, a workbook with a
sheet named in Turkish, numbers and a formula, a presentation. Measured:

| | In | Editor.bin | Back | Same Editor.bin twice | Second save changes |
|---|---:|---:|---:|---|---|
| docx | 1,425 B | 1,612 B (`DOCY;v10`) | 8,809 B | yes | `word/theme/theme1.xml` once, then nothing |
| xlsx | 2,477 B | 1,328 B (`XLSY;v10`) | 6,825 B | not always (below) | nothing |
| pptx | 4,598 B | 2,076 B (`PPTY;v10`) | 10,901 B | yes | nothing |

Every text comes back exactly, with its bold and italic, the table's four
cells, the sheet's name, its numbers and its `SUM` formula. Each conversion
takes 6-28 ms; the module starts in about 120 ms. The first save adds what
x2t always writes (styles, settings, a theme, document properties); from
the second save on, opening and saving again changes nothing. One finding:
the **workbook's Editor.bin is not byte-for-byte the same** from one
conversion to the next - x2t writes a block of it from memory it never
cleared (10 different Editor.bin files in 12 conversions of one workbook,
with other documents converted in between) -
while the workbook made from any of them is the same. The test checks the
workbooks, not those bytes; editing together does not depend on it either
(everyone opens the one sealed Editor.bin its first editor made). The
build's documents also name their application `ONLYOFFICE/2.5.565.0`, not
the release; both are for this project's own build to look at.

## The app

`npm run build` (`node scripts/build-app.mjs`) makes the bundle filex
installs, `dist/ui.zip` (and the tree, `dist/ui/`): the editor files from
`dist/editor/`, each checked against `upstream/editor.lock.json`; x2t from
`dist/x2t/`, checked against the pin; this project's three scripts, bundled
with esbuild (pinned in `package-lock.json`); the app page; `LICENSE` and
`NOTICE`. It checks filex's limits, that the app page has no inline code
and that every file `filex-app.json` names is in it.

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
   `theme-night`), a file that cannot be saved opens to read. Everything
   that would reach a Document Server is off: plugins, macros, chat, the
   spell checker, help, and - until x2t does them here - Download as and
   Print.
4. It hands the editor page the converted document over a `MessagePort`,
   as bytes (transferred, not copied).
5. It saves: the editor's Save (its button, Ctrl+S in the editor), filex's
   Save (and Ctrl+S outside the editor, through the SDK), and every ten
   minutes while there are changes. A save asks the editor page for the
   document as the editor holds it (`asc_nativeGetFile`, with its images),
   converts it back to the file's own format with x2t and writes it as a
   new version (`file.save`). filex is told "unsaved changes" while there
   are and asks before the person leaves them.
6. It shows, under the editor, the notice ONLYOFFICE's terms ask for: based
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

The editor still shows one person besides the one editing, named "filex":
the bridge's keeper, which keeps the editor sending its changes as it makes
them (an editor that thinks it is alone does not). The editor's settings
live in the storage stand-in for as long as the page lives, so its "New"
feature tips show at every opening.

## Measured in the browsers

`npm run e2e` (`node e2e/run.mjs`, `--shots` for screenshots) serves the
built bundle the way filex 0.55 serves an app's interface - the address
shape, the headers and the policy built from the grant
(`backend/internal/wasmplugin/uipolicy.go` on filex's branch
`feat/189-p1-app-frame`), filex's bootstrap first in every page - with a
host page that draws the sandboxed frame and answers the app's bridge the
way filex's `AppFrame` does (`e2e/harness/`). Then, headless, in Chromium,
Firefox and WebKit: it opens a blank docx, xlsx and pptx (the ones filex's
New menu makes) and the Turkish documents of the x2t smoke test, types
`Merhaba dünya: ğüşıöç İĞÜŞÖÇ` into each, saves with the editor's Ctrl+S
and with filex's Save, and reads the written files back.

Measured on 2026-10-08 (Playwright 1.59: Chromium 147.0.7727.15, Firefox
148.0.2, WebKit 26.4; Windows, headless; the harness's own page and file
reads aside):

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| Opens (from the host page's load to the document on screen) | 1.6-2.1 s | 4.0-4.6 s | 3.6-5.7 s |
| docx, xlsx, pptx: typed text in both saves, the Turkish documents' text kept | 6/6 | 6/6 | 6/6 |
| "Unsaved changes" on typing, off after the save | yes | yes | yes |
| Requests outside the package (and its own `blob:` addresses) | 0 | 0 | 0 |
| Package files missing (404) | 0 | 0 | 0 |
| Storage given to the sandboxed pages | none: the stand-in takes its place in both pages, works, and holds the editor's settings (`ui-theme`, zoom, recent languages, comment order) | the same | the same |
| Screenshots, 1280 and 390 px, light and dark | 4/4 | 4/4 | 4/4 |

Firefox splits a typed line into one run per letter outside ASCII in the
saved docx (the text is whole; Playwright types those letters as text
input). Every page logs one error that is the editor's own and harmless:
its service worker cannot register in a sandboxed page; WebKit adds, for a
presentation, that fullscreen is not allowed (filex's policy turns it off).
At 390 px the editor is ONLYOFFICE's desktop one, its toolbar folded
("More"): usable, not made for a phone. The harness differs
from filex 0.55 in one line, on purpose: it sends no `frame-ancestors`
(see [What filex provides](#what-filex-provides); `FX_FRAME_ANCESTORS=star`
puts it back and Chromium refuses the editor page).

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
`src/bridge.ts` are compared with the new server and sdkjs). It opens one
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

The first release, **0.1.0**, brings all of the following at once - there
is no earlier, partial release:

1. The editor bundle: ONLYOFFICE web-apps + sdkjs from the official Document
   Server image (`upstream/onlyoffice.json`), without help pages,
   dictionaries and the PDF and diagram editors; inline scripts moved to
   files - **built** ([The editor bundle](#the-editor-bundle)).
2. x2t built to WebAssembly from ONLYOFFICE core at the same version, run
   in a Worker - CryptPad's build is **pinned, passes the round trips and
   runs in the app's worker** ([x2t, the converter](#x2t-the-converter));
   this project's own build replaces it before 0.1.0.
3. The app's page: the editor frame, the port to filex, a single person
   editing (also in an unencrypted folder), saving as a new version -
   **built and measured in Chromium, Firefox and WebKit** against a
   stand-in for filex 0.55 ([The app](#the-app),
   [Measured in the browsers](#measured-in-the-browsers)); still to come:
   in filex 0.55 itself, at 390 px (the editor is ONLYOFFICE's desktop
   one), keeping the editor's settings between openings, Download as and
   Print through x2t.
4. Encrypted folders (filex's `files:e2e-plaintext`).
5. Editing together (filex's `files:co-edit` and the relay).
6. A release bundle pinned by its SHA-256, the legal notice in the editor,
   the store listing.

The platform features it needs ([What filex provides](#what-filex-provides))
come with filex 0.55.

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
