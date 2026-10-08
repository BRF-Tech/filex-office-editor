# filex office-e2e (prototype)

The editor side of editing an end-to-end encrypted office document with
ONLYOFFICE in the browser: the code that runs next to the ONLYOFFICE editor,
in a frame of its own, and stands in for the Document Server, so the
document, its changes, its locks and its images never reach any server in the
clear. The design, what the server sees, and the status are in
[E2E-OFFICE.md](../../docs/E2E-OFFICE.md).

> **Status: prototype.** Nothing in filex loads this package yet. It has unit
> tests (`web/tests/officeE2e/`) and no build: the frame that serves it, the
> editor files and the x2t build come with the next step.

## License

**AGPL-3.0-only** ([LICENSE](LICENSE)), unlike the rest of filex (MIT). Two
reasons: the bridge carries the Document Server's lock rules over from its
source (ONLYOFFICE Docs, AGPL-3.0), and the shim runs inside the ONLYOFFICE
editor (AGPL-3.0). It is kept apart from the filex core on purpose: the core,
the server and the filex page talk to it only through messages (a
`MessagePort` between two frames), and it is shipped as a package of its own,
not inside the filex binary or image. Whoever serves it serves its source
with it, and the editor's "About" stays as ONLYOFFICE wrote it.

## What is in it

| File | What it does |
|---|---|
| `src/bridge.ts` | `OfficeBridge`: answers the editor's Document Server protocol (license, auth, authChanges, documentOpen, getLock, isSaveLock, saveChanges, unLockDocument, cursor, forceSaveStart) and turns what has to be shared into entries of the session's log; applies the log's entries, in order, to its changes, locks and participants |
| `src/locks.ts` | The Document Server's lock rules (text, spreadsheet, presentation) and the spreadsheet's lock recalculation after inserted or deleted rows and columns, kept as Docs 9.4 has them |
| `src/shim.ts` | A `socket.io` stand-in to serve in place of `web-apps/vendor/socketio/socket.io.min.js`: the editor's socket is plugged into the bridge |
| `src/x2t.ts` | Drives ONLYOFFICE's converter (x2t, built to WebAssembly) to turn a docx/xlsx/pptx into the editor's format and back |
| `src/protocol.ts` | The messages and numbers both sides use |

## How the pieces meet

```
filex page (keys, network)            editor frame (this package)
+---------------------------+  Port   +-------------------------------+
| seals and opens entries   |<------->| OfficeBridge (the "server")   |
| relay connection (server) |         |   ^ shim: socket.io stand-in  |
| saves the file            |         | ONLYOFFICE editor, unchanged  |
+---------------------------+         | x2t (WebAssembly, a Worker)   |
                                      +-------------------------------+
```

The bridge never sees a key or the network: it gets the log's entries opened
and checked, and hands back what it wants appended. The filex page never runs
the editor's code. The two halves of the protocol that the filex side owns
(MIT) are in `packages/core/src/lib/e2eoffice.ts` (keys, sealed entries, the
check that the log is the one the editors wrote), `e2eofficeSave.ts` (who
saves when) and `backend/internal/e2eoffice` (the relay).
