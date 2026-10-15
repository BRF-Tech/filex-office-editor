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
                                               part)        └───> HTML ──x2t-server.wasm──> md, epub
 document ──x2t-server.wasm──> docx, odt, xlsx, ods, csv, pptx, odp, rtf, txt ...   (no layout needed)
```

That is the Document Server's own pipeline (x2t, doctrenderer, x2t), with
doctrenderer's V8 replaced by QuickJS compiled to WebAssembly and its native
objects by `server/layout/worker.js`.

## What is here

| Path | What |
|---|---|
| `scripts/x2t/build.sh --server` | Links the server build, `x2t-server.wasm`, from the same libraries as the page's x2t (`steps.sh` `x2t_server`) |
| `scripts/x2t/server/` | What the server build adds: `wasi-fs.c` (the file calls of emscripten's standalone libc, over WASI; `/dev/urandom`) and `dyncalls.py` (the module's own indirect calls for setjmp/longjmp) |
| `server/x2t/` | Runs x2t-server.wasm with wazero: a new instance per conversion, a directory of its own mounted at `/w`, `params.xml` as a Document Server writes it; the imports emscripten still makes (`env.go`) |
| `server/layout/` | `worker.js` (doctrenderer's part, in JavaScript), `layout.go` (a warm QuickJS worker per kind of document, fed one job per line) and `host/` (`layout-host.wasm`: quickjs-ng that keeps sdkjs as bytecode) |
| `server/cmd/x2t-run` | One conversion with x2t-server.wasm, measured |
| `server/cmd/office-convert` | The whole pipeline: a document to PDF, a thumbnail, HTML, md or epub |
| `server/cmd/wasi-run` | Any WASI command under wazero, measured (the layout spike) |

```bash
bash scripts/x2t/build.sh --server              # dist/x2t/x2t-server.wasm (needs docker)
bash server/layout/host/build.sh                # dist/layout/layout-host.wasm (needs docker)
cd server && go test ./...                       # the Go tests; X2T_SERVER_WASM, LAYOUT_* run the real modules
go run ./cmd/office-convert -x2t ../dist/x2t/x2t-server.wasm -qjs ../dist/layout/layout-host.wasm \
   -engine <dir with sdkjs/, fonts/, layout/> -bytecode /tmp/qbc -in report.docx -to pdf -out report.pdf
```

## x2t on a server

The page's x2t (`dist/x2t/x2t.js` + `x2t.wasm`) leans on emscripten's
JavaScript: an in-memory file system, 24 system calls, 13 `invoke_*`
functions, minified import names, closure-compiled glue. The server build is
the same 28 libraries linked a second time (`steps.sh x2t_server`):

- **`-sSTANDALONE_WASM`**: arguments, clock, environment and exit through
  WASI, which wazero provides; x2t's own `main` runs with the `params.xml`
  as its argument, as a Document Server runs x2t.
- **Files through WASI** (`wasi-fs.c`). emscripten's standalone libc opens no
  file but the standard streams: its system calls are weak stand-ins that
  answer EPERM or ENOSYS (`system/lib/standalone/standalone.c`, "TODO: full
  file support for WASI"). The shim defines the 18 the page's build imports
  - open, stat and friends, directories, getcwd/chdir, truncate, utimensat -
  over the directories the host preopens, plus `mmap` of a file and
  `/dev/urandom` (CryptoPP reads it to encrypt a protected document).
- **setjmp/longjmp** (libpng, libjpeg, FreeType) still goes through
  `invoke_<sig>`, answered by the host the way emscripten's JavaScript does.
  The indirect call is made inside the module (`fx_dyncall_<sig>`, written by
  `dyncalls.py` from a first link's imports, then linked in): with
  `-sEMULATE_FUNCTION_POINTER_CASTS` every table entry has binaryen's one
  signature, and a call by the import's signature - what wazero's own
  emscripten package does - traps ("indirect call type mismatch",
  measured). Each `fx_dyncall` keeps the stack pointer it was called with;
  after a longjmp the host calls `fx_unwind`.
- **An 8 MiB stack** (the page's 128 KiB ran out on three .doc files of
  0.9-6 MB), **memory from 320 MiB up to 4 GiB** (a 200,000-row csv passed
  2 GiB), no closure compiler, names kept (`--profiling-funcs`).
- Everything else - the patches, the compile flags, ICU, the 86 undefined
  functions (README.md "x2t, the converter") - as in the page's build. A
  conversion that reaches an undefined function ends with `missing
  function: <name>` (`x2t.MissingFunction`).

`x2t-server.wasm` is 40.2 MB, its imports 26 WASI functions, 13 `invoke_*`,
two emscripten ones and the 87 undefined. It is not pinned yet:
`build.sh --server` prints its SHA-256; two links of the same tree gave the
same bytes (`f7499294...`, before the stack and memory change).

### What the Go side learnt (server/x2t/env.go)

- wazero makes a new callable, with a stack of its own, at every
  `ExportedFunction`, and x2t goes through `invoke_*` millions of times in a
  document with pictures (2,575,815 for sample.docx to odt): the functions
  are looked up once per instance.
- Built with `WithCloseOnContextDone`, every call into the module starts a
  goroutine that watches the context, and the compiled loops check for it:
  sample.docx to odt took 9.4 s with it, 3.3 s without (the page's x2t in
  Node: 2.5 s; the Document Server's native x2t: 0.4 s). Without it a
  conversion can only be stopped by ending its process - which is how F3
  runs it (below).
- A warm worker's stdin is an OS pipe: with an `io.Pipe` wazero read the
  first job and never the second.

### The conversion matrix

2026-10-15/16, WSL2 (Ubuntu 24.04) on a Windows PC with an AMD Ryzen 7 3800X
(12 threads seen), Go 1.25.5, wazero 1.9.0 (compiler); the machine ran other
builds at the same time (a load of 15-40), so the times are an upper bound.
The reference is the pinned Document Server image's own x2t, in a throwaway
container. `run` is x2t's run in the module (instantiating took 25-80 ms
more); the module compiles once per machine and release: **4 min 10 s - 4 min
43 s**, then about 1 s from wazero's cache (149 MB on disk).

Into the editor's format (`-format-to` the editor's type), with the context
watch:

| Document | Size | run | Memory | Note |
|---|---:|---:|---:|---|
| tr.docx (Turkish) | 1.4 KB | 85 ms | 284 MiB | |
| letter.docx | 38 KB | 0.56 s | 284 MiB | |
| sample.docx (the DS's sample, pictures) | 410 KB | 1.7 s | 293 MiB | 5 pictures out |
| SampleDoc.doc, Lists.doc (Word 97-2003) | 27 KB | 0.11-0.14 s | 284 MiB | |
| Bug46220.doc (four pictures) | 1.1 MB | 0.29 s | 284 MiB | |
| Bug61268.doc, picture.doc, Bug47731.doc | 0.9-6.2 MB | TBD-M | | ran out of the 128 KiB stack before the 8 MiB build |
| Bug50955.doc (Word 95, code page 1251, 96 pages) | 603 KB | 4.7 s | 303 MiB | ⚠ 2 KB out: the text is lost (ICU, below) |
| notes.odt | 43 KB | 0.38 s | 284 MiB | |
| tr.xlsx / sample.xlsx | 2.5 / 77 KB | 0.87 / 2.8 s | 287 MiB | |
| SampleSS.xls | 17 KB | 1.6 s | 287 MiB | |
| budget.ods | 33 KB | 2.5 s | 290 MiB | |
| tr.pptx / slides.pptx / sample.pptx | 5 / 35 / 87 KB | 0.08 / 0.48 / 4.2 s | 284-291 MiB | |
| basic_test_ppt_file.ppt | 15 KB | 0.94 s | 284 MiB | |
| csv, UTF-8 `;` | 116 B | 0.17 s | 284 MiB | |
| csv, windows-1254 | 96 B | 0.32 s | 284 MiB | ⚠ an empty sheet |
| book.epub | 4 KB | - | | 88 (the DS: 88 too) |

Between formats (wasm `run` / the Document Server's whole x2t run):

| Conversion | wasm | DS | Same output |
|---|---:|---:|---|
| tr.docx -> odt | 77 ms | 1,977 ms | yes, 3,352 B, the Turkish text whole |
| letter.docx -> odt | 0.62 s | - | 7,535 B, as the DS's |
| sample.docx -> odt | 9.4 s (3.3 s without the watch) | 0.39 s | 369,221 B, the DS's size |
| notes.odt -> docx | 0.37 s | 0.11 s | 11,290 B, the DS's size |
| tr.xlsx -> ods, sample.xlsx -> ods | 0.09, 1.1 s | 0.07, 0.19 s | 3,393 / 18,799 B, the DS's sizes |
| budget.ods -> xlsx | 0.59 s | 0.13 s | 15,430 B (DS 15,432) |
| SampleDoc.doc -> docx | 80 ms | 85 ms | 6,424 B (DS 6,600) |
| Bug61268.doc (6.2 MB) -> docx | 19.8 s | 1.5 s | 3,377,344 B (DS 3,377,392) |
| picture.doc / Bug47731.doc / Bug46220.doc -> docx | 1.7 / 0.54 / 0.66 s | 0.19 / 0.13 / - s | the DS's sizes within a few bytes |
| SampleSS.xls -> xlsx, basic ppt -> pptx | 0.14, 0.25 s | 0.06, 0.08 s | 11,231 / 23,736 B |
| tr.pptx -> odp, sample.pptx -> odp | 0.11, 3.4 s | -, 0.27 s | 3,384 / 48,374 B (DS 48,374) |
| tr.docx -> rtf, txt | 0.91, 0.27 s | 0.07 s | 2,488 B (DS 2,488) / 339 B |
| tr.xlsx -> csv `,` `;` `\|` | 0.7-1.1 s | | UTF-8 with a BOM, the delimiter asked for |
| tr.xlsx -> csv windows-1254 | | | ⚠ `^ehir`: no conversion tables |
| tr.docx -> epub, html (x2t alone) | trap / 80 | 1.0 s each | need the layout: below |

Every format x2t writes, read back into the editor's format and out to
OOXML with the Turkish text whole: docm, dotx, dotm, ott, rtf, txt, xlsm,
xltx, xltm, ots, xlsb, pptm, potx, potm, ppsx, ppsm, otp (17-620 ms each).
fodt, fods and fodp: x2t writes no flat ODF (88).

A csv by rows (no watch; the DS in brackets): 10,000 in 3.0 s, 50,000 in
10.4 s (7.4 s) at 404 MiB, 100,000 in 17.4 s (14.5 s) at 1.45 GiB, 200,000
TBD-M (49 s).

Password-protected (a docx the Document Server protected with
`m_sSavePassword`): no password 90, a wrong one 91, the right one opens it
with the text whole (3.3 s). Saving one protected: TBD-M. (A docx encrypted
by msoffcrypto-tool is opened by neither x2t, the DS's included.)

### What x2t still lacks here

- **ICU's conversion tables.** emscripten's ICU port carries none, so
  everything in a code page other than UTF-8/16/32 is lost: a windows-1254
  csv reads as an empty sheet and writes as `^ehir`, a Word 95 document's
  text disappears (both builds). The app turns a csv into UTF-8 before x2t
  sees it (src/csv.ts); for legacy binary documents x2t needs the data:
  ICU's `icudt` with the converters, loaded by x2t at start
  (`udata_setCommonData`) - a patch to both builds.
- **The page's x2t has a 128 KiB stack**: the three .doc files that ran out
  of it here would stop the page's x2t too. A larger stack there means a new
  pinned build.
- What doctrenderer does - PDF, images, HTML - is the layout's (below).

## Page layout without a browser

x2t has no layout of its own: a Document Server runs sdkjs, the editor's
JavaScript, in V8 (doctrenderer) to lay the document out, and x2t turns the
drawing into a PDF or an image. In the browser the editor is that layout. On
a server, `server/layout/worker.js` runs the same sdkjs in **QuickJS-ng
0.17.0** under wazero:

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
- a job is what doctrenderer does (`doctrenderer.cpp`): `NativeOpenFileData`,
  `asc_nativeCalculateFile`, `asc_nativePrintPagesCount`, then
  `asc_nativeGetPDF` for a PDF (`{saveFormat: "image"}` for a picture) or
  `asc_nativeGetHtml` for HTML, with the Document Server's `m_sJsonParams`;
- a worker keeps its context and takes job after job (`Asc.editor` emptied
  before each document, so each gets its own api, as in a new context);
- **`layout-host.wasm`** (`server/layout/host`): quickjs-ng with
  `compileScript`/`runBytecode`, so the worker keeps sdkjs as QuickJS
  bytecode (without the functions' source text) and does not parse it again.

### Measured

Same machine and load as above. The reference is the pinned Document
Server image's x2t + doctrenderer (allfontsgen run as on its first start).

| Document | Pages | Open | Calculate (of it: the font engine) | Drawing | Same as the Document Server |
|---|---:|---:|---:|---:|---|
| letter.docx | 3 | 2.0 s | 1.4 s (1.2 s) | 0.3 s | PDF: the same text, the same 3 pages, **identical pixels** at 60 dpi on every page; the same 70,870 bytes; thumbnail 247 x 320, as the DS's |
| tr.docx (Turkish, Times New Roman) | 1 | 1.0 s | 0.2 s | 0.02 s | the same text and lines; Liberation Serif where the DS drew Times New Roman (the image's Microsoft font). HTML: **the same 3,983 bytes** |
| slides.pptx | 8 | 1.7 s | 7.2 s | 0.5 s | the same text on 8 pages; Liberation Sans where the DS drew Arial; thumbnail 320 x 240 |
| report.xlsx | 2 | 0.9 s | - | 0.8 s | the same fonts (Carlito); the DS wrote "Category" in every header cell, this layout the file's own headers; thumbnail 226 x 320 |

TBD-M: the whole pipeline (office-convert) on the same documents and on the
Document Server's samples, PDF and PNG, after the 8 MiB build.

- **Starting a worker**: parsing sdkjs is most of it - QuickJS's
  `compile_only` took 11.2 s (`sdk-all.js` 6.1 s, `fonts_ie.js` 4.4 s); a
  worker on `qjs-wasi.wasm` started in 9-13 s at 352 MiB. **With
  `layout-host.wasm` and its bytecode it starts in about 3 s at 103 MiB**
  (the bytecode, compiled by the first worker: 23 MB; with the functions'
  source text it was 140 MB and 286 MiB).
- A warm worker took the next documents in 1.4-4.7 s each; the second run of
  letter.docx gave the same pdf.bin, byte for byte, as the first and as a
  one-shot run.
- The Document Server's own x2t + doctrenderer: about 1 s for these
  documents (0.85-1.3 s), 3.4-9.8 s for its own samples to PDF, 7 s for a
  96-page .doc - V8 with its snapshots and native FreeType.

### Getting faster

- **The native text measurer.** doctrenderer's `CTextMeasurerEmbed` is a thin
  layer over FreeType and HarfBuzz (core `fontengine/TextShaper.cpp`), which
  x2t's libraries already carry. Compiled into `layout-host.wasm` beside
  QuickJS it would replace `fonts_ie.js` (most of the calculation).
- **doctrenderer itself on QuickJS.** doctrenderer talks to its engine
  through `js_internal/js_base.h` (about 60 virtual methods; V8 and
  JavaScriptCore each implement it in some 1,100-1,800 lines) and generates
  its embedded objects' bindings (`embed/embed.py`). A QuickJS
  implementation would put the real doctrenderer, with every native object,
  into x2t-server.wasm - the Document Server's pipeline in one module.
  `worker.js` shows what it has to answer.

## How filex runs it (F3)

The design, from these measurements, for the filex side of task #268.

**Where the engine lives: in the app's release, never in filex.** The engine
is ONLYOFFICE's code (x2t, sdkjs, `fonts_ie.js`) and AGPL; filex is MIT and
never links it. A release attaches an `engine.zip` beside `ui.zip` -
`x2t-server.wasm` (40.2 MB), `layout-host.wasm` (1.6 MB) and `layout/`
(`worker.js`, `fonts_ie.js`, `xregexp-all-min.js`) - named in the manifest
with its SHA-256, as `ui.bundle` is (a new block, `engines.office`, whose
derived permission the install review shows). sdkjs and the fonts are in
`ui.zip` already: the engine mounts the installed package read-only. A
browser never downloads `engine.zip`, and `ui.zip` keeps its room under
filex's 128 MiB (about 122 MiB with the dictionaries and the macro editor).

**The runner: a process of its own, wazero without the context watch.**
filex starts `filex office-engine` (a hidden command of its own binary) and
talks to it over stdin/stdout, one JSON job per line:

- in that process: one wazero runtime compiled **without**
  `WithCloseOnContextDone` (2.8x faster on x2t, and QuickJS's interpreter
  loop runs without wazero's checks), the compiled x2t-server (an instance
  per job: 25-80 ms) and a warm layout worker per kind;
- a job's deadline (`engines.go`'s 120 s default, 900 s at most) is kept by
  filex: it kills the process and starts another - the only way to stop a
  module compiled without the watch, and the right one anyway: x2t's memory
  (284 MiB at the least, 1.45 GiB for a 100,000-row csv) and a trap stay out
  of filex's own heap and go back to the system with the process;
- memory: each instance capped with `WithMemoryLimitPages`
  (`FILEX_OFFICE_ENGINE_MAX_MB`, default 2048, 4096 at most - x2t's own
  maximum), the process ended after a few idle minutes;
- concurrency: one process per slot - `thumbs.office_slots` (1-4) for
  thumbnails, the same for conversions; a process takes one job at a time;
- files: a directory per job in the process's temporary directory, mounted
  at `/w` (wazero's `experimental/sys.FS` can make it memory instead); the
  package read-only at `/e`; the bytecode cache at `/c`; no network.

**Compiling.** wazero compiles x2t-server in 4-5 minutes; its cache (149 MB,
in filex's data directory, keyed by the module, wazero's version and the
machine) loads it in about 1 s in every engine process after that. filex
compiles at install and upgrade, in the background, and says "preparing the
office engine" until it is ready (`Ready()` false: a Document Server, if
there is one, takes the jobs meanwhile).

**The contract stays.** `wasmplugin.OfficeConverter` (`Ready`, `Convert`)
gets a second implementation beside the Document Server's; `officecmd`,
`engines:office` / `engines:libreoffice`, the output name `<root>.<fmt>` and
the error classes stay, x2t's return codes mapped as the DS's are
(`ClassOf`): 90 and 91 - password, 80/84/86 - corrupt, the memory cap - too
large, the deadline - timeout. Which engine runs when both exist is the
administrator's (Default apps); the app's when only it is installed.

**Thumbnails.** `thumb.OfficeDrawer` on the same engine: the Document
Server's job (`m_oThumbnail` 320 x 320, aspect 1, first page; a sheet's
`spreadsheetLayout` in the json), the same sizes. Decided: the engine counts
as the same drawer - existing pictures do not go stale.

**What the app's release still adds:** `engine.zip` and its pins
(`upstream/onlyoffice.json`, as x2t's), `layout-host.wasm` built
reproducibly, the page's x2t with a larger stack (a new pinned build), and
the editor lock written again for the dictionaries and the macro editor.
