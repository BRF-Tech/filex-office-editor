# The Document Server and this app, row by row

What an ONLYOFFICE Document Server gives a filex installation, and whether
this app gives the same - in the browser, and without a browser, in
WebAssembly. Written for filex 0.57 (filex task #268), whose goal is that an
administrator can delete the Document Server container: the app does
everything the Document Server did for filex.

- **Sources:** filex `main` at `1d173630b` (the Document Server integration:
  `backend/internal/onlyoffice/`, `editkind`, `assoc`, `newdoc`,
  `thumb/office.go`, `server/office_engine.go`, `wasmplugin/office.go`,
  `pkg/pluginkit/officecmd`, `desktop/src/openwith.ts`), filex-convert's
  office edges (`internal/graph/edges.go`), ONLYOFFICE Docs 9.4.0.129 (the
  image this app's files come from) and this app's 0.4.0.
- **Measured** (2026-10-15/16): the server build of x2t and the page layout
  without a browser, both new in 0.4.0 - numbers, method and files in
  [SERVER.md](SERVER.md). The pinned Document Server image, in a throwaway
  container that never starts the server (its own `x2t` with doctrenderer),
  made the reference outputs.
- **Columns:** *DS* - what the Document Server does for filex. *App* -
  this app in the browser in 0.4.0, with the evidence. *Without a
  browser* - what 0.4.0 measured on the server (its `engine.zip`, which
  filex 0.57 runs). *0.57* - what is left and where: F1 is filex (the CSV
  fix, the save rules, the deploy files), F2 this app, F3 filex running
  the app's server engine.

Legend: **yes** - as the Document Server does it; **part** - some of it;
**no**; **n/a** - filex does not use it with the Document Server either.
**⚠** marks a row that still carries a risk worth knowing with 0.57;
**decided** marks a choice the owner made on 2026-10-16.

## Where filex uses the Document Server

1. **The editor in the browser** (`DocsAPI.DocEditor` in a frame,
   `onlyoffice/service.go BuildConfigForNode`, the save callback). This app
   replaces it since 0.1.0, editing together since 0.3.0.
2. **Conversions on the server**, through the Document Server's
   `ConvertService.ashx`: office **thumbnails** (`thumb/office.go`,
   `onlyoffice/purpose.go DrawThumbnail`) and the **office engine for apps**
   (`engines:office`, `wasmplugin/office.go`, `server/office_engine.go`),
   which the Convert app and MCP's `file_convert` use. 0.4.0 builds and
   measures the app's own (SERVER.md) and attaches it as `engine.zip`;
   filex 0.57 runs it (F3).
3. **The rules filex applies to what a save brings** (the callback): a CSV
   keeps its own delimiter, BOM and line ends; an edited `.doc`/`.xls`/`.ppt`
   is saved beside it as `.docx`/`.xlsx`/`.pptx`; a document changed under
   an open editor gets a conflict copy. These are filex's, not the Document
   Server's - F1 moves them where both paths reach them (`officesave`), and
   this app now asks for them (file.save's `beside` and `csv`, below).

## ⚠ The rows that need attention

| # | What | DS | App | Without a browser | 0.57 |
|---|---|---|---|---|---|
| A1 | **Office thumbnails** (320 px PNG of page 1; a sheet laid out 120 mm wide with grid lines) | yes - `ConvertService` thumbnail `{aspect:1, first:true, 320x320}` | n/a (a server job) | **yes, measured**: x2t-server -> Editor.bin, sdkjs in QuickJS lays it out (`asc_nativeGetPDF({saveFormat:"image"})`), x2t-server draws the PNG; letter.docx 247 x 320, report.xlsx 320 x 320 with that 120 mm layout (226 x 320, its own page, without it), slides.pptx 320 x 240, sample.pptx 320 x 180, the Document Server's sizes, no difference to the eye. A document with SVG pictures and the DS's sample.xlsx too since x2t `v9.4.0.129+3` (A14): sample.docx 226 x 320, sample.xlsx 247 x 320, the DS's sizes | F3: `thumb.OfficeDrawer` on the app's engine with the DS's `thumbParams`. **Decided:** the engine counts as the same drawer; existing pictures do not go stale (`handlersChanged`) |
| A2 | **Office conversions for apps** (`engines:office`: Convert's 47 office edges, MCP `file_convert`) | yes - every edge in `edges.go` 226-292, PDF/A as PDF/A-2a, CSV with the delimiter asked for | n/a | **yes**: every office-to-office edge measured (SERVER.md "The conversion matrix"); PDF through the layout (letter.docx: the DS's bytes, pixel for pixel; slides and the DS's sample.pptx: under 1.4 % of the pixels differ, the fonts); html the same bytes as the DS's; epub from that html with the DS's files (x2t's `doct_bin2epub`). PDF of a document with SVG pictures (sample.docx: 0.73 % of the pixels differ, the fonts; its SVG, EMF and WMF pictures drawn as the DS draws them) and sample.xlsx (24 pages as the DS's, 0.36 %), and md (tr.docx: the DS's 276 bytes) since x2t `v9.4.0.129+3` (A14) | F3: `wasmplugin.OfficeConverter` on the app's engine; `officecmd`, `engines:office`/`engines:libreoffice`, `<root>.<fmt>` and the error classes stay. ⚠ Slower than the DS's native x2t: 1.4-3x on ordinary documents without wazero's context watch, the layout 2-20 s a document (SERVER.md) |
| A3 | **Legacy and other formats open** (44 extensions edit in the DS) | yes, 44 (`editkind.Published`) | **yes (0.4.0)**: all 44 and csv (`src/kinds.ts`, the manifest's viewer rows); x2t told the editor's type (`m_nFormatTo`) - by the extension alone it refuses doc, xls, ppt and csv (88) | measured: doc (Word 97-2003, 0.03-6.2 MB), xls, ppt, rtf, odt/ods/odp, csv, and every format x2t writes read back (docm, dotx, dotm, ott, txt, xlsm, xltx, xltm, ots, xlsb, pptm, potx, potm, ppsx, ppsm, otp) with the Turkish text whole. A **Word 95** .doc (code page 1251, 96 pages) comes in as the DS reads it since x2t `v9.4.0.129+3` - 3,123 of its 3,124 paragraphs, the same 515,791 characters (it was 2 KB: ICU had no conversion tables, and core read a Word 95 paragraph table as Word 97's; patches 07 and the ICU data, SERVER.md "Pictures, HTML to md and the legacy code pages"). The .doc files with **EMF/WMF pictures** open (A14) | F2: done |
| A4 | **Saving a format x2t cannot write** (doc, xls, ppt, the WPS and StarOffice kinds, flat ODF) | the DS writes OOXML; filex saves it beside the file (`rapor.docx`, `rapor (2).docx`), for an editor allowed to create files there | **yes (0.4.0)**: the app saves the editor's OOXML with file.save's `beside` (`src/app/document.ts`), says where it went | n/a | **Decided:** an explicit `beside` option, the name chosen by filex. F1: `UISave` takes `beside: "docx"`/`"xlsx"`/`"pptx"`, applies `besideTarget`/`freeBeside`/the creator rule (`officesave`), answers `{saved, size, name}`, and keeps later saves of the opening on that file |
| A5 | **CSV** (open, edit, save keeping the file's dialect) | yes - sniffs 64 KiB (`, ; tab \|`, BOM, CRLF), UTF-8 with `codePage 65001`, other encodings through the DS's dialog; filex puts the dialect back (`RewriteCSV`/`KeepCSV`, #255) | **yes (0.4.0)**: opened in filex's `text_dialect` (or the same sniff, `src/csv.ts`) as UTF-8 - the browser decodes windows-1254 and the rest - saved in its delimiter with the dialect declared (file.save's `csv`) | x2t reads UTF-8 csv (`,`, `;`, tab; Turkish whole), and since x2t `v9.4.0.129+3` the legacy code pages too (ICU's tables): windows-1254 straight into x2t comes in whole, as the DS reads it, and is written whole (it was an empty sheet and `^ehir`). The app still hands x2t UTF-8 when it opens a csv (`src/csv.ts`); **Download as csv offers every code page of the editor's list**, as the DS's dialog does - each of the 54 measured writing a sample of its own script byte for byte as Python's codec does, and reading it back (`tests/x2t-wasm.test.ts` CSV_SAMPLES). Rows: 10,000 in 3.0 s, 50,000 in 10.4 s (DS 7.4), 100,000 in 17.4 s (DS 14.5) at 1.45 GiB, 200,000 in 45.3 s (DS 49) at 2.6 GiB | F1 (#255): `UISave` checks the declared dialect against the bytes, `KeepCSV`, re-encodes to the file's encoding (`x/text/charmap`), refuses a mismatch; FileInfo carries `text_dialect` |
| A6 | **Fonts** | the image's: core-fonts plus the Microsoft core fonts the image installs, and any the administrator adds (`onlyoffice-fonts` volume) | core-fonts only (the Microsoft fonts may not be handed on): Liberation, Carlito, Caladea with the same metrics; one CJK fallback | the same as the app; letter.docx pixel for pixel, tr.docx and slides.pptx the same lines in Liberation's glyphs where the DS drew Times/Arial | F3: an extra fonts directory both the engine and the editor read (filex serves it under the package, as `extra/dictionaries/`). ⚠ Until then an installation's own fonts are not used; CJK and Arabic documents need a measurement with real files |
| A7 | **Spell checking** | the DS's dictionaries (filex sets nothing; default on) | **yes (0.4.0)**: the spell checker runs in a worker of its own again (`src/frame/workers.ts`); the bundle carries the dictionaries of filex's interface languages - en_US, tr_TR, de_DE, es_ES, fr_FR and ar for the language packs: 18.4 MB zipped of the image's 227 MB (tr_TR alone 14.5) - and a language an administrator adds is read from the package's `extra/dictionaries/`. The release publishes the other 43 languages of the image (Hunspell `.aff`/`.dic`, `hyph_` patterns, their licences beside them) with a catalog (`dictionaries.json`, filex-extras/1) the manifest pins (`ui.extras`), so filex installs one with a click (`scripts/pack-dictionaries.mjs`) | n/a | **Decided:** interface languages in the bundle, more downloadable. F2: done (the editor lock is written again at release, `extract-editor.sh --update`; the bundle goes to about 118 of 128 MiB). F3: filex's Dictionaries section installs the catalog's languages or takes uploaded files (`extra/dictionaries/<lang>/<file>.txt`) |
| A8 | **Hyphenation** | the DS's patterns (`hyph_<lang>.dic`) | **yes (0.4.0)**, the same way: the editor page's own requests go to the bundle's or the added dictionaries | the layout worker reads the same files (`Hyphen_*` in fonts_ie.js) | as A7 |
| A9 | **A document changed while it is open** | the save becomes a conflict copy beside it (`name.filex-conflict-<time>.docx`), the editors are asked "mine / theirs" | 0.3.1: refused (`412 app_save_changed`). **0.4.0**: every save asks for a conflict copy (file.save's `conflict: 'copy'`; the frame sends the version filex's read named, `X-Filex-Version`), and the app says where the save went, in its own words | n/a | **Decided:** a conflict copy, as the DS path. F1: `UISave` writes the copy instead of answering 412, answers `{saved, conflict: name}`, and the opening goes on with that copy |
| A10 | **Password-protected documents** | the DS asks in the editor and opens it (`m_sPassword`); a save stays protected | **yes (0.4.0)**: the app page asks for the password (90: none given, 91: wrong) and opens it; the save keeps it (`m_sSavePassword`) - the page's x2t encrypts docx (CDFV2) and odt, measured | x2t-server opens a protected docx (90 / 91 / opens with the text whole), the DS's and the page's alike, and saves one protected (an encrypted odt in 1.4 s; CryptoPP reads the shim's `/dev/urandom`) | F2: done. The password never leaves the person's browser |
| A11 | **Desktop "Open with filex"** for a file outside a synced folder | uploads a working copy, opens the DS editor window (`/files/edit`), writes every save back; legacy formats save beside (#151) | the window opens filex's default editor, which is the app when it is the default for the kind | n/a | F1: the desktop opens the app's editor tab (`app=office-editor/editor`) when no DS is set. ⚠ Until then a desktop user without a DS gets a viewer |
| A12 | **Embeds** (work.brf.sh, fishapp) | work.brf.sh embeds `<filex-explorer>` (a vendored bundle); fishapp has **its own** Document Server integration (its own config, callback and fetch routes) | the embed shows the app where it shows filex's viewers (`onlyOfficeBase` is only a switch) | n/a | **Decided:** fishapp's own Document Server link is removed - a separate brf-mono task, not part of this work. work.brf.sh needs a vendored filex bundle that knows apps |
| A13 | **AGPL** | the DS is a separate AGPL program in its own container | the app is AGPL, installed as an app, never built into filex | the engine is AGPL too (x2t, sdkjs, fonts_ie.js); QuickJS-ng is MIT | F3: filex runs the engine as a separate WASI program - files in, files out, like running the DS's x2t - in a process of its own (SERVER.md), never linked into filex's binary or image; the engine comes with the app's release, its source at the app's tag. NOTICE items 5 and 6 |
| A14 | **x2t's picture code in WebAssembly** (found 2026-10-16, fixed in x2t `v9.4.0.129+3`) | the DS's native x2t does all of it | **yes since x2t `+3`** (0.3.1's x2t had it too): picture.doc, Bug47731.doc and Bug61268.doc (EMF/WMF pictures) open - Editor.bin 7,761, 80,533 and 6,899,264 bytes, the DS's sizes before its base64; a PDF - Download as, Print - of a document with SVG pictures (sample.docx, 1 page) and of sample.xlsx (24 pages) as the DS's; HTML to md, the DS's bytes | **yes**, the same bytes as the page's x2t | **Done (F4).** The cause, found with a build that keeps the function names (`build.sh --diag`): ONLYOFFICE's CSS calculator is built twice, for the SVG engine (graphics) and for HtmlFile2 with `CSS_CALCULATOR_WITH_XHTML` - another layout of the same classes (`NSCSS::CNode` 60/64 bytes, `CCssCalculator_Private` 76/100). CryptPad's recipe left graphics' copy out; in one module the SVG engine ran HtmlFile2's code and HtmlFile2 got graphics' `std::vector<NSCSS::CNode>` code, and every metafile x2t opened wrote past its block. `06-svg-css-namespace.patch` gives graphics' copy a namespace of its own, as each library has its own natively |
| A15 | **A document that names another server** (a .docx's linked picture, an HTML page's picture or style sheet; found 2026-10-16, fixed in x2t `v9.4.0.129+4`) | the DS's x2t downloads it when its configuration allows (`allowNetworkRequest`); with no network the picture is left out | **yes since x2t `+4`**: the page's x2t opens such a docx into the editor's format in 49 ms in Node (`+3` did not finish in 40 s) | **yes since `+4`**: nothing is fetched (no socket, and no wait now), the picture left out as the DS without a network leaves it - a linked .docx's thumbnail the same picture as the .docx's without the link, the PDF and the HTML page in the time of the same documents naming nothing elsewhere; `+3` ran to filex's deadline | **Done.** `patches/09-wasm-no-network.patch` (SERVER.md, "A document that names another server"); filex's `TestEngine_NoRemoteFetch` holds it: 0 requests to the server the documents name, each within twice its control's time and 10 s |

## Every row

### Opening and editing

| What | DS | App (0.4.0) | Without a browser | 0.57 |
|---|---|---|---|---|
| docx, xlsx, pptx, odt, ods, odp | yes | yes | yes (SERVER.md) | - |
| doc, xls, ppt | yes | yes, saved beside as OOXML; .doc with EMF/WMF pictures and Word 95 too since x2t `+3` (A14, A3) | yes (Word 97-2003 measured 0.03-6.2 MB, Word 95, EMF/WMF pictures) | F1 `beside` |
| docm, dotx, dotm, xlsm, xltx, xltm, xlsb, pptm, potx, potm, ppsx, ppsm, ott, ots, otp, rtf | yes | yes, saved in place (x2t writes them: measured) | yes | - |
| fodt, fods, fodp (flat ODF) | yes | yes, saved beside as OOXML (x2t writes no flat ODF: 88) | read not measured (no sample) | measure with a real file |
| wps, wpt, et, ett, dps, dpt, sxw, stw, sxc, sxi, dot, xlt, pot, pps, mht, mhtml | yes | yes, saved beside as OOXML | not measured (no samples) | measure with real files |
| csv | the DS or filex's table view | yes (A5) | yes, UTF-8 | F1 `csv`, `text_dialect` |
| txt, xml, html | filex's own text editor | n/a | n/a | - |
| pdf, xps, epub, djvu (view) | filex's own viewers, never the DS (`editkind.viewOnly`) | n/a | x2t reads xps/djvu (epub: 88 into the editor's format) | Convert edges could add xps/djvu to PDF (new, not a parity item) |
| PDF editing, forms (docxf, oform, pdf forms) | n/a - filex never sends them to the DS | n/a | n/a | - |
| iWork (pages, numbers, key), HWP, odg, vsdx | thumbnails only (`officeKinds`) | n/a | x2t-server links the iWork and HWP readers; vsdx needs the Visio editor, which the bundle leaves out | A1 for pages/numbers/key/hwp; vsdx stays without |
| Editing together | yes (Community Edition: 20 connections) | yes, filex's relay, no connection limit | n/a | - |
| Reading only | yes | yes (a watcher follows live) | n/a | - |
| Comments, review, track changes | yes; the author is the person's email | yes; the author is the name filex gives the app's interface - "filex" while filex gives none | n/a | **Decided:** the person's name; F1: `session.user.name` filled for app interfaces |
| Macros | the DS's default (they run, after a question) | **yes (0.4.0)**: on, with the editor's "run the macros?" question | n/a | **Decided** |
| ONLYOFFICE plugins | the DS's bundled plugins | off: most need the network, none is in the bundle | n/a | say so in the docs |
| Mail merge, compare, mentions, insert from storage, rename, the history API | n/a - filex implements none of these DS events | n/a | n/a | - |
| Version history | filex's versions | filex's versions | n/a | - |
| Saving | the callback, about 10 s after the last editor leaves | Save, Ctrl+S, every ten minutes while changed, the last writer leaving | n/a | - |
| A document changed while open | conflict copy | conflict copy (A9) | n/a | F1 |
| Password-protected | yes | yes (A10) | yes | - |
| New document | docx, xlsx, pptx, odt, ods, odp (filex's templates; needs a DS to open them) | **docx, xlsx, pptx, odt, ods, odp (0.4.0)**: odt/ods/odp start empty and open as their editor's blank | n/a | **Decided** |
| Editor language | the person's, or one fixed for everybody (`FILEX_ONLYOFFICE_LANG`, #214) | **0.4.0**: the fixed one when filex says it (`session.editor_lang`, given as ONLYOFFICE's list writes it: `pt-PT` stays Portugal's), else the person's language and region; the app's own words stay in the person's | n/a | F1: filex passes the fixed language to apps too |
| A phone | the Community Edition's phone editors read only | the same, with "Edit" to the folded editor | n/a | - |
| Encrypted folders, vaults | refused (415) | yes (0.2.0) | n/a | - |
| Desktop "Open with filex" | yes | partly (A11) | n/a | F1 |
| Embeds | yes | yes where the embed shows apps (A12) | n/a | brf-mono |

### Writing other formats (Download as, Print)

| What | DS | App | Without a browser | 0.57 |
|---|---|---|---|---|
| docx, docm, dotx, odt, ott, rtf, txt | yes | yes | yes | - |
| xlsx, xlsm, xltx, ods, ots, csv | yes | yes; csv in every code page of the editor's list (A5) | yes | - |
| pptx, pptm, potx, ppsx, odp, otp | yes | yes | yes | - |
| PDF, PDF/A | yes (doctrenderer) | yes, from the editor's own drawing, SVG pictures too since x2t `+3` (A14) | **yes** (the layout's pdf.bin, then x2t: letter.docx pixel for pixel the DS's; sample.docx with its SVG pictures) | F3 |
| html | yes (doctrenderer) | no | **yes**: the layout worker's `html` job - tr.docx the same 3,983 bytes as the DS's | **Decided:** in the worker; Download as offers it through filex once F3 runs the engine |
| epub | yes | no | **yes**: x2t reads the layout's html where doctrenderer would write it - the DS's files, the text whole | **Decided:** in the worker |
| md | yes (276 B for tr.docx) | no | **yes** since x2t `+3`: x2t's `html2md` on the layout's html, tr.docx the DS's 276 bytes (A14) | F3: through the layout's html, as epub |
| fb2 | yes | no | not built into x2t here | - |
| jpg, png (pages as images) | yes | no | **yes** (the thumbnail path, any size) | F3 |
| Print | yes | yes (`ui:print`) | n/a | - |

### Conversions on the server

| What | DS | App | Without a browser | 0.57 |
|---|---|---|---|---|
| Office thumbnails | yes | n/a | yes (A1) | F3 |
| `engines:office` / Convert's office edges | yes, 47 edges | n/a | yes (A2) | F3 |
| MCP `file_convert` | through the Convert app | n/a | as the Convert app | F3 |
| Sizes and limits | the DS's own; filex: thumbnails up to `thumbs.office_max_mb` (25 MB) | the browser's memory | the server build: an 8 MiB stack, memory from 320 MiB to 4 GiB (a 200,000-row csv: 2.6 GiB), capped by the host | F3: `FILEX_OFFICE_ENGINE_MAX_MB` (SERVER.md) |
| Speed | x2t native, doctrenderer with V8 snapshots: about 0.1-1.5 s a document, 7 s for a 96-page .doc to PDF | the browser | x2t without wazero's context watch: 0.02-1.2 s for ordinary documents, 1.4-3x the DS; the layout: a 2.4-4.8 s worker start, then 2-24 s a document, most of it the font engine in asm.js (SERVER.md) | F3 runs it in a process of its own, without the context watch (2-4.6x faster, measured); the native text measurer next (SERVER.md "Getting faster") |
| JWT, callback trust, the public fetch URL | needed | not needed | not needed: no network | - |

### Licence and notices

| What | DS | App | 0.57 |
|---|---|---|---|
| Licence | AGPL-3.0, a separate container | AGPL-3.0-or-later (one file AGPL-3.0-only), an installed app, its legal line under the editor | A13 |
| Third-party parts | the DS's own | NOTICE: ONLYOFFICE's files, CryptPad's x2t recipe, now the server build (item 5), the layout and QuickJS-ng (item 6) and the dictionaries' licences, which travel with them | - |
