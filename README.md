# filex-onlyoffice

The office editor app for [filex](https://github.com/BRF-Tech/filex):
ONLYOFFICE's editor in the browser, **without a Document Server**. Word,
Excel and PowerPoint documents (and their OpenDocument kin) open in the
editor in place of filex's preview, alone or with other people - and also
**inside encrypted folders**, where the document is decrypted in the
browser, edited there and encrypted again before it is saved, so no server
ever reads it.

> **Status: prototype, not installable.** This repository holds the part of
> the design that runs next to the editor - the bridge that stands in for the
> Document Server, the Document Server's lock rules, a socket.io stand-in and
> the x2t driver - with their unit tests. The editor files, the x2t
> WebAssembly build, the app's page and the release bundle come with the next
> steps, and the app needs platform features filex gains in 0.55
> ([What filex provides](#what-filex-provides)). `filex-app.json` is a draft.

| | |
|---|---|
| Based on | ONLYOFFICE Docs 9.4 (editor: web-apps + sdkjs; converter: x2t from ONLYOFFICE core), by Ascensio System SIA - see [NOTICE](NOTICE) |
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

- **The editor's files** come from the app's own package, as ONLYOFFICE
  builds them from source at a pinned tag, unchanged except one: the
  socket.io client is replaced by a stand-in (`src/shim.ts`).
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
| `localStorage` (the editor keeps settings there) | an opaque frame has none; reading it throws | in the app: an in-memory stand-in, measured in every browser |
| No inline scripts | `script-src` is the package only | in the app: the build moves web-apps' inline scripts into files |
| A large package (about 80-95 MB zipped, 1,400 files, 38.8 MB for `x2t.wasm`) | 128 MiB zipped, 20,000 files, 64 MiB a file; served uncompressed | serving the package's files compressed (`Content-Encoding`), cached by version |

## What is in this repository

| File | What it does |
|---|---|
| `src/bridge.ts` | `OfficeBridge`: answers the editor's Document Server protocol (license, auth, authChanges, documentOpen, getLock, isSaveLock, saveChanges, unLockDocument, cursor, forceSaveStart) and turns what has to be shared into entries of the session's log; applies the log's entries, in order, to its changes, locks and participants |
| `src/locks.ts` | The Document Server's lock rules (text, spreadsheet, presentation) and the spreadsheet's lock recalculation after inserted or deleted rows and columns, kept as Docs 9.4 has them |
| `src/shim.ts` | A `socket.io` stand-in served in place of `web-apps/vendor/socketio/socket.io.min.js`: the editor's socket is plugged into the bridge |
| `src/x2t.ts` | Drives x2t (WebAssembly) to turn a docx/xlsx/pptx into the editor's format and back |
| `src/protocol.ts` | The messages and numbers both sides use |
| `tests/` | Unit tests for all of the above (vitest, in Node) |
| `filex-app.json` | The app's manifest - a **draft** until the platform features above exist |

```bash
npm install
npm test            # vitest run
npm run typecheck   # tsc
```

## Roadmap

1. The editor bundle: ONLYOFFICE web-apps + sdkjs built from source at a
   pinned tag, without help pages, dictionaries and the PDF and diagram
   editors; inline scripts moved to files; the socket.io stand-in in place.
2. x2t built to WebAssembly from ONLYOFFICE core at the same tag, run in a
   Worker.
3. The app's page: the editor frame, the port to filex, a single person
   editing (also in an unencrypted folder), saving as a new version.
4. Encrypted folders (filex's `files:e2e-plaintext`).
5. Editing together (filex's `files:co-edit` and the relay).
6. A release bundle pinned by its SHA-256, the legal notice in the editor,
   the store listing.

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

"ONLYOFFICE" is a trademark of Ascensio System SIA. This project is not
affiliated with, endorsed by or sponsored by Ascensio System SIA.
