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
  lock request, a released lock - it hands to filex, which seals it and sends
  it through its relay. The relay puts the sealed entries in one order
  without reading them, and every editor's bridge applies the same entries in
  the same order with the Document Server's lock rules (`src/locks.ts`), so
  the first request for a paragraph or a range wins everywhere.
- **The conversion** runs in the browser: x2t, ONLYOFFICE's converter,
  compiled to WebAssembly (`src/x2t.ts` drives it).

```
filex page (keys, network)              the app's frame (this repository)
+-----------------------------+  port   +--------------------------------+
| decrypts and encrypts       |<------->| bridge (the "Document Server") |
| seals and opens log entries |         |   ^ socket.io stand-in         |
| relay connection, saving    |         | ONLYOFFICE editor, unchanged   |
+--------------+--------------+         | x2t (WebAssembly)              |
               | sealed only            +--------------------------------+
               v
+-----------------------------+
| filex relay                 |   no Document Server: nothing reads
| order, lease, members,      |   the document, its changes, its
| sealed log, sealed blobs    |   images or its conversion
+-----------------------------+
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
| The editor loads the document from a `blob:` address | `connect-src 'none'` or the package | `ui.connect_blob` → `ui:connect-blob`: `connect-src` adds `blob:` |
| The plaintext of a document in an encrypted folder | apps are never given one | `files:e2e-plaintext`: the explorer decrypts and hands the bytes over, encrypts the save (a conditional write); a separate permission with a stern warning in the review |
| Editing together | - | `files:co-edit`: the relay's routes and WebSocket, its tables, the sealed blob store, and a bridge method for the app to append and read the log |
| `localStorage` (the editor keeps settings there) | an opaque frame has none; reading it throws | in the app: an in-memory stand-in loaded first in every page (`scripts/editor/storage.js`); still to be measured in every browser |
| No inline scripts | `script-src` is the package only | in the app: the build moves web-apps' inline scripts into files ([The editor bundle](#the-editor-bundle)) |
| A large package (measured: about 101 MiB zipped with x2t, 2,182 files, 309 MiB unpacked, 37 MiB for `x2t.wasm`) | 128 MiB zipped, 512 MiB unpacked, 20,000 files, 64 MiB a file; served uncompressed | serving the package's files compressed (`Content-Encoding`), cached by version |

## What is in this repository

| File | What it does |
|---|---|
| `src/bridge.ts` | `OfficeBridge`: answers the editor's Document Server protocol (license, auth, authChanges, documentOpen, getLock, isSaveLock, saveChanges, unLockDocument, cursor, forceSaveStart) and turns what has to be shared into entries of the session's log; applies the log's entries, in order, to its changes, locks and participants |
| `src/locks.ts` | The Document Server's lock rules (text, spreadsheet, presentation) and the spreadsheet's lock recalculation after inserted or deleted rows and columns, kept as Docs 9.4 has them |
| `src/shim.ts` | A `socket.io` stand-in served in place of `web-apps/vendor/socketio/socket.io.min.js`: the editor's socket is plugged into the bridge |
| `src/x2t.ts` | Drives x2t (WebAssembly) to turn a docx/xlsx/pptx into the editor's format and back |
| `src/protocol.ts` | The messages and numbers both sides use |
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
zip, gave the same `editor.zip` (SHA-256 `e8f8b2e1...0404771`, recorded in
the lock file). The image is pulled by digest, the generators give the same
bytes every time, and the zip is written sorted, with one date and no extra
fields, by `scripts/lib/zip.mjs` in the pinned Node image (deflate's bytes
depend on the zlib that makes them).

Measured with ONLYOFFICE Docs 9.4.0 (build 9.4.0.129), on an x86-64 Linux
machine (about three minutes, most of it the font and theme generators):

| Part | Files | Unpacked (MiB) | Zipped (MiB) |
|---|---:|---:|---:|
| Presentation themes (36, with thumbnails at 11 scales) | 540 | 29.5 | 22.5 |
| Web fonts (generated from core-fonts) | 157 | 38.5 | 19.4 |
| sdkjs `sdk-all.js` + `sdk-all-min.js` (word, cell, slide) | 6 | 94.7 | 15.7 |
| sdkjs images (font and theme thumbnails, cursors, icons) | 217 | 14.0 | 11.9 |
| web-apps: the three editors, common, vendor | 876 | 34.4 | 10.0 |
| web-apps locales (46 languages, three editors) | 138 | 43.8 | 8.3 |
| sdkjs common (font, zlib, hash, spell engines; SmartArt; charts) | 170 | 16.3 | 3.4 |
| Licenses, notices, `filex/` | 76 | 0.4 | 0.1 |
| **The editor bundle** | **2,180** | **271.6** | **91.8** |
| x2t (`x2t.wasm` + `x2t.js`, deflated) | 2 | 37.1 | 9.6 |
| **With x2t** | **2,182** | **308.7** | **101.4** |

filex's limits are 128 MiB zipped, 512 MiB unpacked, 20,000 files and
64 MiB a file; the largest files are `x2t.wasm` (37.0 MiB) and
`sdkjs/cell/sdk-all.js` (30.9 MiB). The editor part is 2,180 files, more
than the 2,000 aimed for: the per-theme thumbnails (396 files, 8.8 MiB) are the
first to go if the editor never asks for them (to be measured in the
browser).

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
  the editor's paths are not rewritten; ONLYOFFICE's `.license` files get a
  `.txt` extension so filex serves them. Their content is unchanged.
- `core-fonts-licenses/` carries each font family's license files and, in
  `FONTS.txt`, the copyright and license each font states in its own name
  table (several families ship without a license file).

Not yet in the bundle: the socket.io stand-in in place of
`web-apps/vendor/socketio/socket.io.min.js` (it needs the bridge, which the
app's page brings) and x2t, which joins the release bundle with the page.

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
   files - **built** ([The editor bundle](#the-editor-bundle)); still to
   come: the socket.io stand-in in place.
2. x2t built to WebAssembly from ONLYOFFICE core at the same version, run
   in a Worker - CryptPad's build is **pinned and passes the round trips**
   ([x2t, the converter](#x2t-the-converter)); this project's own build
   replaces it before 0.1.0.
3. The app's page: the editor frame, the port to filex, a single person
   editing (also in an unencrypted folder), saving as a new version.
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
