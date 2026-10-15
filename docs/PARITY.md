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
  image this app's files come from) and this app on this branch.
- **Measured** (2026-10-15/16): the server build of x2t and the page layout
  without a browser, both new on this branch - numbers, method and files in
  [SERVER.md](SERVER.md). The pinned Document Server image, in a throwaway
  container that never starts the server (its own `x2t` with doctrenderer),
  made the reference outputs.
- **Columns:** *DS* - what the Document Server does for filex today. *App* -
  this app in the browser after this branch (0.4.0), with the evidence.
  *Without a browser* - what this branch measured. *0.57* - what is left and
  where: F1 is filex (the CSV fix, the save rules, the deploy files), F2
  this app, F3 filex running the app's server engine.

Legend: **yes** - as the Document Server does it; **part** - some of it;
**no**; **n/a** - filex does not use it with the Document Server either.
**⚠** marks a row that still carries a risk worth knowing before 0.57 ships;
**decided** marks a choice the owner made on 2026-10-16.

## Where filex uses the Document Server

1. **The editor in the browser** (`DocsAPI.DocEditor` in a frame,
   `onlyoffice/service.go BuildConfigForNode`, the save callback). This app
   replaces it since 0.1.0, editing together since 0.3.0.
2. **Conversions on the server**, through the Document Server's
   `ConvertService.ashx`: office **thumbnails** (`thumb/office.go`,
   `onlyoffice/purpose.go DrawThumbnail`) and the **office engine for apps**
   (`engines:office`, `wasmplugin/office.go`, `server/office_engine.go`),
   which the Convert app and MCP's `file_convert` use. This branch builds
   and measures the app's own (SERVER.md); F3 runs it in filex.
3. **The rules filex applies to what a save brings** (the callback): a CSV
   keeps its own delimiter, BOM and line ends; an edited `.doc`/`.xls`/`.ppt`
   is saved beside it as `.docx`/`.xlsx`/`.pptx`; a document changed under
   an open editor gets a conflict copy. These are filex's, not the Document
   Server's - F1 moves them where both paths reach them (`officesave`), and
   this app now asks for them (file.save's `beside` and `csv`, below).

## ⚠ The rows that need attention

| # | What | DS | App | Without a browser | 0.57 |
|---|---|---|---|---|---|
| A1 | **Office thumbnails** (320 px PNG of page 1; a sheet laid out 120 mm wide with grid lines) | yes - `ConvertService` thumbnail `{aspect:1, first:true, 320x320}` | n/a (a server job) | **yes, measured**: x2t-server -> Editor.bin, sdkjs in QuickJS lays it out (`asc_nativeGetPDF({saveFormat:"image"})`), x2t-server draws the PNG; letter.docx 247 x 320, report.xlsx 226 x 320, slides.pptx 320 x 240, the Document Server's sizes, no difference to the eye | F3: `thumb.OfficeDrawer` on the app's engine with the DS's `thumbParams`. **Decided:** the engine counts as the same drawer; existing pictures do not go stale (`handlersChanged`) |
| A2 | **Office conversions for apps** (`engines:office`: Convert's 47 office edges, MCP `file_convert`) | yes - every edge in `edges.go` 226-292, PDF/A as PDF/A-2a, CSV with the delimiter asked for | n/a | **yes**: every office-to-office edge measured (SERVER.md "The conversion matrix"); PDF through the layout (letter.docx: the DS's pages, pixel for pixel); html the same bytes as the DS's; md and epub from that html (x2t's own `html2md`, `doct_bin2epub`) | F3: `wasmplugin.OfficeConverter` on the app's engine; `officecmd`, `engines:office`/`engines:libreoffice`, `<root>.<fmt>` and the error classes stay. ⚠ Slower than the DS's native x2t on large documents (2-12x; SERVER.md) |
| A3 | **Legacy and other formats open** (44 extensions edit in the DS) | yes, 44 (`editkind.Published`) | **yes (0.4.0)**: all 44 and csv (`src/kinds.ts`, the manifest's viewer rows); x2t told the editor's type (`m_nFormatTo`) - by the extension alone it refuses doc, xls, ppt and csv (88) | measured: doc (Word 97-2003, 0.03-6.2 MB), xls, ppt, rtf, odt/ods/odp, csv, and every format x2t writes read back (docm, dotx, dotm, ott, txt, xlsm, xltx, xltm, ots, xlsb, pptm, potx, potm, ppsx, ppsm, otp) with the Turkish text whole. ⚠ A **Word 95** .doc (code page 1251) opens nearly empty (2 KB of a 96-page document; the DS: 292 KB) - the conversion tables ICU lacks here (A5) | F2: done. ⚠ Word 95 and the other non-Unicode legacy files need ICU's conversion data in x2t (both builds; SERVER.md "What x2t still lacks") |
| A4 | **Saving a format x2t cannot write** (doc, xls, ppt, the WPS and StarOffice kinds, flat ODF) | the DS writes OOXML; filex saves it beside the file (`rapor.docx`, `rapor (2).docx`), for an editor allowed to create files there | **yes (0.4.0)**: the app saves the editor's OOXML with file.save's `beside` (`src/app/document.ts`), says where it went | n/a | **Decided:** an explicit `beside` option, the name chosen by filex. F1: `UISave` takes `beside: "docx"`/`"xlsx"`/`"pptx"`, applies `besideTarget`/`freeBeside`/the creator rule (`officesave`), answers `{saved, size, name}`, and keeps later saves of the opening on that file |
| A5 | **CSV** (open, edit, save keeping the file's dialect) | yes - sniffs 64 KiB (`, ; tab \|`, BOM, CRLF), UTF-8 with `codePage 65001`, other encodings through the DS's dialog; filex puts the dialect back (`RewriteCSV`/`KeepCSV`, #255) | **yes (0.4.0)**: opened in filex's `text_dialect` (or the same sniff, `src/csv.ts`) as UTF-8 - the browser decodes windows-1254 and the rest - saved in its delimiter with the dialect declared (file.save's `csv`) | x2t reads UTF-8 csv (`,`, `;`, tab; Turkish whole). **windows-1254 straight into x2t: an empty sheet** (the DS reads it) and written: `^ehir` - so the app never hands x2t anything but UTF-8. Rows: 10,000 in 3.0 s, 50,000 in 10.4 s (DS 7.4), 100,000 in 17.4 s (DS 14.5) at 1.45 GiB; 200,000: SERVER.md | F1 (#255): `UISave` checks the declared dialect against the bytes, `KeepCSV`, re-encodes to the file's encoding (`x/text/charmap`), refuses a mismatch; FileInfo carries `text_dialect` |
| A6 | **Fonts** | the image's: core-fonts plus the Microsoft core fonts the image installs, and any the administrator adds (`onlyoffice-fonts` volume) | core-fonts only (the Microsoft fonts may not be handed on): Liberation, Carlito, Caladea with the same metrics; one CJK fallback | the same as the app; letter.docx pixel for pixel, tr.docx and slides.pptx the same lines in Liberation's glyphs where the DS drew Times/Arial | F3: an extra fonts directory both the engine and the editor read (filex serves it under the package, as `extra/dictionaries/`). ⚠ Until then an installation's own fonts are not used; CJK and Arabic documents need a measurement with real files |
| A7 | **Spell checking** | the DS's dictionaries (filex sets nothing; default on) | **yes (0.4.0)**: the spell checker runs in a worker of its own again (`src/frame/workers.ts`); the bundle carries the dictionaries of filex's interface languages - en_US, tr_TR, de_DE, es_ES, fr_FR and ar for the language packs: 18.4 MB zipped of the image's 227 MB (tr_TR alone 14.5) - and a language an administrator adds is read from the package's `extra/dictionaries/` | n/a | **Decided:** interface languages in the bundle, more downloadable. F2: done (the editor lock is written again at release, `extract-editor.sh --update`; the bundle goes to about 117 of 128 MiB). F3: filex's "add a dictionary" (any of the image's 50, as files of the app, served at `extra/dictionaries/<lang>/<file>.txt`) |
| A8 | **Hyphenation** | the DS's patterns (`hyph_<lang>.dic`) | **yes (0.4.0)**, the same way: the editor page's own requests go to the bundle's or the added dictionaries | the layout worker reads the same files (`Hyphen_*` in fonts_ie.js) | as A7 |
| A9 | **A document changed while it is open** | the save becomes a conflict copy beside it (`name.filex-conflict-<time>.docx`), the editors are asked "mine / theirs" | 0.3.1: refused (`412 app_save_changed`). **0.4.0**: the app takes filex's `conflict` answer and says where the save went | n/a | **Decided:** a conflict copy, as the DS path. F1: `UISave` writes the copy instead of answering 412, answers `{saved, conflict: name}`, and the opening goes on with that copy |
| A10 | **Password-protected documents** | the DS asks in the editor and opens it (`m_sPassword`); a save stays protected | **yes (0.4.0)**: the app page asks for the password (90: none given, 91: wrong) and opens it; the save keeps it (`m_sSavePassword`) - the page's x2t encrypts docx (CDFV2) and odt, measured | x2t-server opens a protected docx (90 / 91 / opens with the text whole); saving it protected needs `/dev/urandom` for CryptoPP, which the shim now gives (SERVER.md) | F2: done. The password never leaves the person's browser |
| A11 | **Desktop "Open with filex"** for a file outside a synced folder | uploads a working copy, opens the DS editor window (`/files/edit`), writes every save back; legacy formats save beside (#151) | the window opens filex's default editor, which is the app when it is the default for the kind | n/a | F1: the desktop opens the app's editor tab (`app=office-editor/editor`) when no DS is set. ⚠ Until then a desktop user without a DS gets a viewer |
| A12 | **Embeds** (work.brf.sh, fishapp) | work.brf.sh embeds `<filex-explorer>` (a vendored bundle); fishapp has **its own** Document Server integration (its own config, callback and fetch routes) | the embed shows the app where it shows filex's viewers (`onlyOfficeBase` is only a switch) | n/a | **Decided:** fishapp's own Document Server link is removed - a separate brf-mono task, not part of this work. work.brf.sh needs a vendored filex bundle that knows apps |
| A13 | **AGPL** | the DS is a separate AGPL program in its own container | the app is AGPL, installed as an app, never built into filex | the engine is AGPL too (x2t, sdkjs, fonts_ie.js); QuickJS-ng is MIT | F3: filex runs the engine as a separate WASI program - files in, files out, like running the DS's x2t - in a process of its own (SERVER.md), never linked into filex's binary or image; the engine comes with the app's release, its source at the app's tag. NOTICE items 5 and 6 |

## Every row

### Opening and editing

| What | DS | App (0.4.0) | Without a browser | 0.57 |
|---|---|---|---|---|
| docx, xlsx, pptx, odt, ods, odp | yes | yes | yes (SERVER.md) | - |
| doc, xls, ppt | yes | yes, saved beside as OOXML | yes (Word 97-2003 measured 0.03-6.2 MB; ⚠ Word 95: A3) | F1 `beside` |
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
| Editor language | the person's, or one fixed for everybody (`FILEX_ONLYOFFICE_LANG`, #214) | the person's language and region | n/a | F1: filex passes the fixed language to apps too |
| A phone | the Community Edition's phone editors read only | the same, with "Edit" to the folded editor | n/a | - |
| Encrypted folders, vaults | refused (415) | yes (0.2.0) | n/a | - |
| Desktop "Open with filex" | yes | partly (A11) | n/a | F1 |
| Embeds | yes | yes where the embed shows apps (A12) | n/a | brf-mono |

### Writing other formats (Download as, Print)

| What | DS | App | Without a browser | 0.57 |
|---|---|---|---|---|
| docx, docm, dotx, odt, ott, rtf, txt | yes | yes | yes | - |
| xlsx, xlsm, xltx, ods, ots, csv | yes | yes; csv in UTF-8/16/32 (x2t's ICU) | yes | - |
| pptx, pptm, potx, ppsx, odp, otp | yes | yes | yes | - |
| PDF, PDF/A | yes (doctrenderer) | yes, from the editor's own drawing | **yes** (the layout's pdf.bin, then x2t) | F3 |
| html | yes (doctrenderer) | no | **yes**: the layout worker's `html` job - tr.docx the same 3,983 bytes as the DS's | **Decided:** in the worker; Download as offers it through filex once F3 runs the engine |
| md, epub, fb2 | yes | no | md: x2t's `html2md` from the layout's html; epub: x2t reads the html where doctrenderer would write it (SERVER.md); fb2 is not built | **Decided:** in the worker |
| jpg, png (pages as images) | yes | no | **yes** (the thumbnail path, any size) | F3 |
| Print | yes | yes (`ui:print`) | n/a | - |

### Conversions on the server

| What | DS | App | Without a browser | 0.57 |
|---|---|---|---|---|
| Office thumbnails | yes | n/a | yes (A1) | F3 |
| `engines:office` / Convert's office edges | yes, 47 edges | n/a | yes (A2) | F3 |
| MCP `file_convert` | through the Convert app | n/a | as the Convert app | F3 |
| Sizes and limits | the DS's own; filex: thumbnails up to `thumbs.office_max_mb` (25 MB) | the browser's memory; ⚠ the page's x2t has a 128 KiB stack, which three .doc files of 0.9-6 MB ran out of on the server build (SERVER.md) | the server build: an 8 MiB stack, memory to 4 GiB, capped by the host | F2: the page's x2t with a larger stack (a new pinned build) |
| Speed | x2t native, doctrenderer with V8 snapshots: about 0.1-1.5 s a document, 7 s for a 96-page .doc to PDF | the browser | x2t: 0.1-4 s for ordinary documents, 2-12x the DS on large ones; the layout: a 3 s worker start, then 1-5 s a document (SERVER.md) | F3 runs it in a process of its own, without wazero's context watch (2.8x faster, measured) |
| JWT, callback trust, the public fetch URL | needed | not needed | not needed: no network | - |

### Licence and notices

| What | DS | App | 0.57 |
|---|---|---|---|
| Licence | AGPL-3.0, a separate container | AGPL-3.0-or-later (one file AGPL-3.0-only), an installed app, its legal line under the editor | A13 |
| Third-party parts | the DS's own | NOTICE: ONLYOFFICE's files, CryptPad's x2t recipe, now the server build (item 5), the layout and QuickJS-ng (item 6) and the dictionaries' licences, which travel with them | - |
