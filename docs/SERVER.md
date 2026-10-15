# The app on a server: conversions and page layout without a browser

The app's converter and layout run in the person's browser. filex also needs
them **on the server, with no browser**: office thumbnails, the office engine
apps convert with (`engines:office`, the Convert app, MCP's `file_convert`) -
what a Document Server does for filex today ([PARITY.md](PARITY.md), rows A1
and A2). This page is the measurement of filex task #268: both run here as
WebAssembly under [wazero](https://wazero.io) - the runtime filex already
runs its apps with - and neither needs JavaScript from a browser or native
code of ONLYOFFICE's.

```
 document ──x2t-server.wasm──> Editor.bin ──QuickJS + sdkjs──> pdf.bin ──x2t-server.wasm──> PDF / PNG
 (docx, doc, odt, xlsx, csv...)  (+ media/)   (worker.js:         (the pages as        (+ the fonts the pages
                                               doctrenderer's     drawing commands)      were drawn with)
                                               part)
 document ──x2t-server.wasm──> docx, odt, xlsx, ods, csv, pptx, odp, rtf, txt ...   (no layout needed)
```

That is the Document Server's own pipeline (x2t, doctrenderer, x2t), with
doctrenderer's V8 replaced by QuickJS compiled to WebAssembly and its native
objects by `server/layout/worker.js`.

## What is here

| Path | What |
|---|---|
| `scripts/x2t/build.sh --server` | Links the server build, `x2t-server.wasm`, from the same libraries as the page's x2t (`steps.sh` `x2t_server`) |
| `server/x2t/` | Runs x2t-server.wasm with wazero: a new instance per conversion, a directory of its own mounted at `/w`, `params.xml` as a Document Server writes it; the few imports emscripten still makes (`env.go`) |
| `server/layout/` | `worker.js` (doctrenderer's part, in JavaScript) and `layout.go` (a warm QuickJS worker per kind of document, fed one job per line) |
| `server/cmd/x2t-run` | One conversion with x2t-server.wasm, measured |
| `server/cmd/office-convert` | The whole pipeline: a document to PDF or to a thumbnail |
| `server/cmd/wasi-run` | Any WASI command under wazero, measured (the layout spike) |

## x2t on a server

The page's x2t (`dist/x2t/x2t.js` + `x2t.wasm`) leans on emscripten's
JavaScript: an in-memory file system, 24 system calls, 13 `invoke_*`
functions, minified import names, closure-compiled glue. The server build is
the same 28 libraries linked a second time (`steps.sh x2t_server`):

- `-sSTANDALONE_WASM`: files, clock and exit go through WASI, which wazero
  provides; x2t's own `main` runs with the `params.xml` as its argument, as
  a Document Server runs x2t;
- no closure compiler, import names kept;
- `-sDYNCALLS` and three exports (`setThrew`, `emscripten_stack_get_current`,
  `_emscripten_stack_restore`): setjmp/longjmp (libpng, libjpeg, FreeType)
  still goes through `invoke_<sig>`, which `server/x2t/env.go` answers the
  way emscripten's JavaScript does, calling the module's own `dynCall_<sig>`
  so `-sEMULATE_FUNCTION_POINTER_CASTS` keeps working;
- `--profiling-funcs`: a trap names the function it stopped in;
- everything else - the patches, the compile flags, ICU, the 86 undefined
  functions (README.md "x2t, the converter") - as in the page's build. A
  conversion that reaches an undefined function ends with `missing function:
  <name>` (`x2t.MissingFunction`), the browser's "Aborted(missing
  function: ...)".

TBD-M: the build's size, imports, memory, and the measured matrix.

## Page layout without a browser

x2t has no layout of its own: a Document Server runs sdkjs, the editor's
JavaScript, in V8 (doctrenderer) to lay the document out, and x2t turns the
drawing into a PDF or an image. In the browser the editor is that layout. On
a server, `server/layout/worker.js` runs the same sdkjs in **QuickJS-ng
0.17.0** (`qjs-wasi.wasm` from its release, MIT, SHA-256 `42a732a6...`) under
wazero:

- the scripts doctrenderer loads, in its order (core
  `DesktopEditor/doctrenderer/editors.cpp`): `native.js`,
  `jquery_native.js`, `xregexp-all-min.js`, `sdk-all-min.js`, the font
  engine, `sdk-all.js`, `AllFonts.js`, then `InitNativeEditors()`;
- `native` and `CreateEmbedObject` answered as doctrenderer's embedded
  objects answer them (`embed/NativeControlEmbed.cpp`): the file, the fonts
  (the package's web fonts, their 32-byte obfuscation undone), the images'
  sizes, the length of the drawing (`Save_End`);
- the font engine is **`fonts_ie.js`** - FreeType and HarfBuzz compiled to
  asm.js, which doctrenderer loads when it has no native shaper (the
  bundle leaves it out; it comes from the same Document Server release, as
  `xregexp-all-min.js` does) - in place of doctrenderer's native text
  measurer: QuickJS has no WebAssembly, asm.js is plain JavaScript;
- a job is what doctrenderer does for a PDF or an image (`doctrenderer.cpp`,
  `DoctRendererFormat::PDF` / `IMAGE`): `NativeOpenFileData`,
  `asc_nativeCalculateFile`, `asc_nativePrintPagesCount`, `asc_nativeGetPDF`
  (`{saveFormat: "image"}` for a picture), with the Document Server's
  `m_sJsonParams` (a sheet's page layout for a thumbnail, `printPages`...);
- a worker keeps its context and takes job after job (`Asc.editor` is
  emptied before each document, so each gets its own api, as in a new
  context).

### Measured

2026-10-15, WSL2 (Ubuntu 24.04, 12 of an AMD Ryzen 7 3800X's threads) on a
Windows PC, Go 1.25.5, wazero 1.9.0 (its compiler), Node 22.22 for the
page's x2t; the reference is the pinned Document Server image's own x2t and
doctrenderer (allfontsgen run as on its first start, the server never
started). TBD-M: clean numbers (the first ones were taken while the x2t
build ran beside them).

| Document | Pages | Load the scripts (once per worker) | Open | Calculate (of it: the font engine) | Drawing | Same as the Document Server |
|---|---:|---:|---:|---:|---:|---|
| letter.docx (filex's e2e fixture) | 3 | 9.2-11.4 s | 2.0 s | 1.4 s (1.2 s) | 0.3 s | PDF: the same text, the same 3 pages, **identical pixels** at 60 dpi on every page; thumbnail: 247 x 320, as the DS's |
| tr.docx (Turkish, Times New Roman) | 1 | | 1.0 s | 0.2 s | 0.02 s | the same text and lines; Liberation Serif where the DS drew Times New Roman (the image's Microsoft font) |
| slides.pptx | 8 | | 1.7 s | 7.2 s | 0.5 s | the same text on 8 pages; Liberation Sans where the DS drew Arial |
| report.xlsx | 2 | | 0.9 s | - | 0.8 s | same fonts (Carlito); the DS wrote "Category" in every header cell, this layout the file's own headers |

- The scripts are most of the cost: parsing alone (QuickJS's
  `compile_only`) took 11.2 s, of it `sdk-all.js` 6.1 s and `fonts_ie.js`
  4.4 s. A worker pays it once.
- A warm worker took the next documents in 1.4-4.7 s each (open, calculate,
  drawing); the second run of letter.docx gave the same pdf.bin, byte for
  byte, as the first and as a one-shot run.
- Memory: the QuickJS instance grew to 346-392 MiB; the process (Go, wazero,
  the compiled module) peaked at 1.0-1.4 GB resident.
- The Document Server's own x2t + doctrenderer took about 1 s per document
  (0.85-1.3 s), 7.0 s for a 96-page .doc to PDF, with V8 and its snapshots.

### Getting faster

- **Bytecode instead of source.** QuickJS can keep a compiled script
  (`JS_WriteObject` / `JS_ReadObject`); a small host of our own around
  quickjs-ng (in place of its `qjs` command) would load sdkjs as bytecode
  and skip most of the 11 s.
- **The native text measurer.** doctrenderer's `CTextMeasurerEmbed` is a thin
  layer over FreeType and HarfBuzz (core `fontengine/TextShaper.cpp`), which
  x2t's libraries already carry. Compiled into the same module as QuickJS,
  it would replace `fonts_ie.js` (4.4 s of parsing, most of the
  calculation).
- **doctrenderer itself on QuickJS.** doctrenderer talks to its engine
  through `js_internal/js_base.h` (about 60 virtual methods; V8 and
  JavaScriptCore each implement it in some 1,100-1,800 lines) and generates
  its embedded objects' bindings (`embed/embed.py`). A QuickJS
  implementation would put the real doctrenderer, with every native object,
  into x2t-server.wasm - the Document Server's pipeline in one module.
  The JavaScript stand-ins here show what it has to answer.

## How filex runs it (F3)

A proposal, for the filex side of task #268; nothing here is built into
filex yet.

**Where the engine lives: in the app's release, not in filex.** The engine
is ONLYOFFICE's code (x2t, sdkjs, `fonts_ie.js`) and AGPL; filex is MIT and
never links it. A release attaches an `engine.zip` beside `ui.zip` -
`x2t-server.wasm`, `layout-host.wasm` and `layout/` (worker.js,
`fonts_ie.js`, `xregexp-all-min.js`) - named in the manifest with its
SHA-256, as `ui.bundle` is. sdkjs and the fonts are already in `ui.zip`; the
engine mounts the installed package's files read-only, so they are not
carried twice. A browser never downloads `engine.zip`. A new manifest block
(say `"engines": {"office": {"bundle": {...}}}`) derives a permission the
install review shows ("converts office documents for filex on the server");
filex 0.57 knows the block, so the app's release that carries it asks for
`filex >= 0.57.0`.

**How it runs: a second kind of module, beside Extism.** Extism plugins
talk through Extism's ABI and get no file system (`wasmplugin/runtime.go`);
the engine is two WASI commands that read and write files. filex runs them
with wazero directly (the version it already has, 1.9.0), through a
runner of its own in `wasmplugin`:

| | Extism apps today | The office engine |
|---|---|---|
| Module | the app's `plugin.wasm`, at most 64 MiB (`registry.go`) | `x2t-server.wasm` 40.2 MB, `layout-host.wasm` 1.6 MB - within 64 MiB each |
| Memory | `MaxMemoryPages` 4096 (256 MiB, `manifest.go`) | x2t starts at 284 MiB (4545 pages) and grew to 873 MiB on a 200,000-row csv; the layout worker 100-420 MiB: a cap of its own, `FILEX_OFFICE_ENGINE_MAX_MB`, default 2048 |
| Files | none | a directory per job, mounted at `/w` (or an in-memory `experimental/sys.FS`), the package read-only at `/e`, the bytecode cache at `/c` |
| Network | allowed hosts only | none (WASI here has no sockets) |
| Compile | at install | `x2t-server.wasm` took **4 min 43 s** to compile (wazero's optimizing compiler, once per release and machine; the compilation cache then loads it in about 1 s, 149 MB on disk) - compile at install or upgrade, in the background, and say "preparing" until it is ready |
| Time | `MaxJobTimeout` 900 s | per job, from `engines.go` (`engineDefaultTimeout` 120 s); `WithCloseOnContextDone` stops a runaway conversion |

**The contract stays.** `wasmplugin.OfficeConverter` (`Ready`, `Convert`)
gets a second implementation beside the Document Server's; `officecmd`,
the permission names `engines:office` / `engines:libreoffice`, the output
name `<root>.<fmt>` and the error classes stay, with x2t's return codes
mapped as the DS's are (`ClassOf`): 89/90/91 - password, 80/84/86 -
corrupt, the memory cap - too large, the deadline - timeout. Which one runs
when both exist is the administrator's (Default apps); the app's when only
it is installed.

**Thumbnails.** `thumb.OfficeDrawer` on the same engine: the job is the
Document Server's (`m_oThumbnail` 320 x 320, aspect 1, first page; a sheet's
`spreadsheetLayout` in the json) and the result its size. ⚠ `handlersChanged`
marks every office picture stale when the drawer changes; since the pictures
match, the engine could keep the Document Server's handler identity - a
decision for F3.

**Concurrency.** x2t: an instance per job (instantiating takes 25-80 ms).
The layout: one worker per kind kept warm while jobs come (one at a time
each), ended after a few idle minutes; with `layout-host.wasm` and its
bytecode a cold start is about 3 s, so a worker per job is possible too.
`thumbs.office_slots` stays the limit.

**What the app still has to do for it** (this repository): attach
`engine.zip` and pin its files (`upstream/onlyoffice.json`, as x2t's are),
build `layout-host.wasm` reproducibly, keep `fonts_ie.js` and
`xregexp-all-min.js` in the bundle's lock, and carry the engine's licences
in NOTICE (QuickJS-ng is MIT).
