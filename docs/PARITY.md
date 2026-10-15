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
  image this app's files come from) and this app at 0.3.1 plus this branch.
- **Measured** (2026-10-15): the server build of x2t and the page layout
  without a browser, both new on this branch - numbers, method and files in
  [SERVER.md](SERVER.md). A Document Server 9.4.0.129 (the pinned image, in a
  throwaway container that never starts the server: its own `x2t` with
  doctrenderer) made the reference outputs.
- **Columns:** *DS* - what the Document Server does for filex today. *App
  today* - this app at 0.3.1 (in the browser), with the evidence. *Without a
  browser* - what this branch measured. *0.57* - how the gap closes, in which
  part of the work (F1: filex, the CSV fix and the deploy files; F2: this
  app; F3: filex runs the app's server engine), how hard, and the risk.

Legend: **yes** - as the Document Server does it; **part** - some of it;
**no**; **n/a** - filex does not use it with the Document Server either.
**⚠** marks a row that needs a decision or carries a risk worth knowing
before 0.57 ships; they come first.

## Where filex uses the Document Server

1. **The editor in the browser** (`DocsAPI.DocEditor` in a frame,
   `onlyoffice/service.go BuildConfigForNode`, the save callback). This app
   replaces it since 0.1.0, editing together since 0.3.0.
2. **Conversions on the server**, through the Document Server's
   `ConvertService.ashx`: office **thumbnails** (`thumb/office.go`,
   `onlyoffice/purpose.go DrawThumbnail`) and the **office engine for apps**
   (`engines:office`, `wasmplugin/office.go`, `server/office_engine.go`),
   which the Convert app and MCP's `file_convert` use. Nothing in the app
   does this today; this branch builds and measures it (SERVER.md), F3 wires
   it into filex.
3. **The rules filex applies to what the Document Server saves** (the
   callback): a CSV keeps its own delimiter, BOM and line ends; an edited
   `.doc`/`.xls`/`.ppt` is saved beside it as `.docx`/`.xlsx`/`.pptx`; a
   document changed under an open editor gets a conflict copy. These are
   filex's, not the Document Server's - F1 moves them where both paths reach
   them (`officesave`).

## ⚠ The rows that need attention

| # | What | DS | App today | Without a browser | 0.57 | Effort / risk |
|---|---|---|---|---|---|---|
| A1 | **Office thumbnails** (320 px PNG of page 1; a sheet laid out 120 mm wide with grid lines) | yes - `ConvertService` `thumbnail {aspect:1, first:true, 320x320}`, one slot by default, retries 2 m ... 8 h | no | **yes, measured**: x2t-server makes the Editor.bin, sdkjs in QuickJS lays it out (`asc_nativeGetPDF({saveFormat:"image"})`), x2t-server draws the PNG; letter.docx 247x320, report.xlsx 226x320, slides.pptx 320x240 - the Document Server's sizes; side by side with its PNG no difference shows | F3: a `thumb.OfficeDrawer` on the app's engine, the same `thumbParams` (the sheet layout goes in the job's json as the Document Server gets it) | Medium. A warm layout worker holds ~350-400 MiB and takes 9-15 s to start; one document 1-5 s after that (SERVER.md). ⚠ `handlersChanged`: if the engine registers as a new handler, every office picture goes stale at once - decide whether the app's engine counts as the same drawer (the outputs match) |
| A2 | **Office conversions for apps** (`engines:office`: the Convert app's 47 office edges, MCP `file_convert`) | yes - every edge in `edges.go` 226-292, PDF/A as PDF/A-2a, CSV with the delimiter asked for, UTF-8 + BOM | no | **yes for the office-to-office edges, measured** with x2t-server (SERVER.md "The conversion matrix"); **PDF** through the layout worker (letter.docx: the same pages and pixels as the Document Server's PDF at 60 dpi) | F3: `wasmplugin.OfficeConverter` implemented by the app's engine; `officecmd`, the permission names (`engines:office`, `engines:libreoffice`), `<root>.<fmt>` and the error classes stay | Medium. The engine is a WASI command, not an Extism plugin: filex needs a second kind of module runner (wazero directly, a memory cap of its own - x2t asks for TBD-M MiB at least, filex caps app modules at 256 MiB) |
| A3 | **Legacy formats open** (doc, xls, ppt, rtf, dot*, xlt*, pot*, pps*, odf templates, fodt/fods/fodp, xlsb, wps, et, dps ... - 44 extensions edit in the DS) | yes, 44 extensions (`editkind.Published`) | no - the manifest opens 6 (docx, xlsx, pptx, odt, ods, odp) | x2t reads them: TBD-M (SERVER.md) | F2: `ui-viewer` rows for every kind x2t reads (src/x2t.ts `X2tFormat` widened), and F1: the save rule below | Low for opening; the save is A4 |
| A4 | **Saving a legacy format** | the DS writes OOXML (it cannot write doc/xls/ppt); filex saves it beside the file as `.docx`/`.xlsx`/`.pptx` (`rapor (2).docx` when taken), only for an editor allowed to create files there (`callback_format.go`) | n/a (does not open them) | x2t cannot write doc/xls/ppt either (no writer, as in the DS) | F1+F2: the app saves the converted OOXML, filex's `UISave` applies the same `besideTarget`/`freeBeside`/creator rule (moved to `officesave`) when the target format differs from the file's | ⚠ Decision: the app asks to "save beside" explicitly (a new `file.save` option) or filex infers it from the format - recommend the explicit option, with filex choosing the name |
| A5 | **CSV** (open, edit, save keeping the file's dialect) | yes - sniffs the first 64 KiB (delimiter `, ; tab |`, BOM, CRLF), opens UTF-8 with `codePage 65001`, other encodings show the DS's dialog; saves comma + BOM + LF and filex puts the dialect back (`RewriteCSV`/`KeepCSV`, #255 is the Docs 10 regression) | no - csv is not opened; Download as writes csv in UTF-8/16/32 only | x2t-server reads a UTF-8 csv with the delimiter given: TBD-M; **windows-1254 and every other code page: TBD-M** (emscripten's ICU has no conversion tables, README.md "txt and csv"); 200,000 rows: TBD-M | F1 (#255): `officesave.KeepCSV` with the dialect declared by the producer; filex transcodes a non-UTF-8 csv to UTF-8 for the app and back on save (`x/text/charmap`); F2: csv viewer row, `fx.save(..., {csv: dialect})` | ⚠ Medium. The alternative to transcoding in filex is ICU's conversion data in the server build (a few MB) - it does not help the browser, so transcoding in filex is the one fix for both |
| A6 | **Fonts** | the image's fonts: core-fonts plus the Microsoft core fonts the image installs (Arial, Times New Roman...), and any the administrator adds (`onlyoffice-fonts` volume in filex's compose) | ONLYOFFICE's core-fonts only (the Microsoft fonts may not be handed on): Liberation, Carlito, Caladea stand in with the same metrics; one CJK fallback | the same fonts as the app; the layout matched the DS page for page (letter.docx: identical pixels; tr.docx, slides.pptx: the same text and line breaks, Liberation's glyphs where the DS drew Times/Arial) | F2: document it; F3: an optional extra fonts directory the engine and the editor both read (filex serves it to the app) | ⚠ An installation that added its own fonts to the DS loses them until the extra fonts directory exists. CJK/Arabic documents rely on the fallback - measure with real documents before announcing |
| A7 | **Spell checking** | the DS's spellchecker with its dictionaries (default on, filex sets nothing) | off: the spell engine's worker is a no-op (`src/frame/workers.ts`), no dictionaries in the bundle | n/a | F2: start the spell worker from a `blob:` address and carry Hunspell dictionaries (tr, en at least) | ⚠ Size: the bundle is 98.3 of 128 MiB; all of ONLYOFFICE's dictionaries do not fit, a chosen few do |
| A8 | **Hyphenation** | the DS's hyphenation dictionaries (`<dictionaries>` in DoctRenderer.config) | none (dictionaries are never copied) | none | F2: carry the hyphenation patterns the spell work adds | A document with automatic hyphenation breaks lines differently here than in the DS, so its PDF and thumbnail differ too |
| A9 | **A document changed while it is open** | the save becomes a conflict copy beside it (`name.filex-conflict-<time>.docx`), the editors are asked "mine / theirs" (`session_base.go`) | the save is refused, `412 app_save_changed`; the changes stay in the editor and the person is told | n/a | F1+F2: the app offers "save as a copy beside" on 412 | ⚠ Decision (the person sees it): recommend the same conflict copy as the DS path, so nothing differs with the engine |
| A10 | **Password-protected documents** | the DS asks for the password in the editor and opens it (`m_sPassword`) | not measured in the app; the bridge has no password step | x2t-server with `m_sPassword`: TBD-M | F2: the editor's password prompt answered through the bridge (documentOpen fails with the DS's "password" code, the app converts again with the password) | Medium |
| A11 | **Desktop "Open with filex"** for a file outside a synced folder | uploads a working copy and opens the DS editor window (`/files/edit`), writes every save back; a legacy format saves beside (#151) | the window opens filex's default editor, which is the app only if the app is the default for the kind | n/a | F1: the desktop opens the app's editor tab (`app=office-editor/<view>`) when no DS is set | ⚠ Without it, a desktop user without a DS gets a viewer, not an editor |
| A12 | **Embeds of filex** (work.brf.sh, fishapp) | work.brf.sh embeds `<filex-explorer>` (a vendored bundle); **fishapp has its own Document Server integration** (brf-mono `Modules/FishApp`: its own config, callback and fetch routes, `FISHAPP_ONLYOFFICE_URL`, default `https://docs.brf.sh`) | the embed shows the app where it shows filex's viewers (`onlyOfficeBase` is only a switch) | n/a | outside these repositories: fishapp needs its own move before docs.brf.sh is retired | ⚠ Retiring docs.brf.sh with 0.57 breaks fishapp's office editing; the vendored filex bundle in work.brf.sh must be one that knows apps |
| A13 | **AGPL** | the DS is a separate AGPL program in its own container | the app is AGPL, installed as an app, never built into filex (README.md "License") | the engine is AGPL too (x2t, sdkjs, fonts_ie.js) and QuickJS-ng is MIT | F3: filex runs the engine as a separate WASI program - files in, files out, like running the DS's x2t - never linked into filex's binary or image; the engine comes with the app's release, so its source is the app's tag. NOTICE lists the new parts | ⚠ Keep it that way: no ONLYOFFICE code compiled into filex, the engine's files only from the app's package |

## Every row

### Opening and editing

| What | DS | App today | Without a browser | 0.57 |
|---|---|---|---|---|
| docx, xlsx, pptx, odt, ods, odp | yes | yes (0.1.0) | x2t-server reads and writes them (SERVER.md) | - |
| doc, xls, ppt and the other legacy kinds | yes (44 extensions) | no | TBD-M | A3, A4 |
| docm, xlsm, pptm (macros kept) | yes, macros off unless the DS allows | Download as writes them; does not open them | TBD-M | A3; macros: below |
| dotx/xltx/potx, ott/ots/otp templates | yes | written by Download as; not opened | TBD-M | A3 |
| fodt, fods, fodp (flat ODF) | yes | no | TBD-M | A3 |
| xlsb | yes | no | TBD-M | A3 |
| rtf | yes | written by Download as | TBD-M | A3 |
| txt, csv, xml, html | filex opens txt/xml/html in its own text editor; csv in the DS or as a table | csv no | csv: A5 | A5 |
| pdf, xps, epub, djvu (view) | filex shows them in its own viewers, never in the DS (`editkind.viewOnly`) | n/a | x2t converts xps/djvu/epub to PDF without layout (its own readers) | Convert edges could add them (new, not a DS parity item) |
| PDF editing, forms (docxf, oform, pdf forms) | n/a - filex never sends them to the DS (`fillForms` is never set; docxf/oform are not in `DocumentType`) | n/a | n/a | - |
| iWork (pages, numbers, key), HWP, odg, vsdx | thumbnails only (`thumb/office.go officeKinds`) | n/a | x2t-server links the iWork and HWP readers; vsdx needs the Visio editor, which the bundle leaves out | A1: thumbnails for pages/numbers/key/hwp through the same engine; vsdx stays without |
| Editing together | yes, through the DS (Community Edition: 20 connections) | yes, filex's relay, no connection limit (0.3.0) | n/a | - |
| Reading only (no `files.modify`, read-only token, trash/versions) | yes (`mode: "view"`) | yes (filex says `canEdit: false`; a watcher follows live) | n/a | - |
| Comments, review, track changes | yes (`comment`/`review` = can edit) | yes (`permissions.comment/review`) - but the author shows as "filex": filex hands an app's interface no name (README.md "Measured in filex 0.56") | n/a | F1: filex passes the person's name to the app |
| Macros | the DS default (macros run in the editor) | off (`customization.macros: false`) | n/a | ⚠ Decision: macros run inside the app's sandbox, so turning them on is safe for filex; recommend on, with the DS's own "run macros?" prompt |
| ONLYOFFICE plugins | the DS default (its bundled plugins) | off (`plugins: false`, no plugin files, no network) | n/a | Not offered: most plugins need the network; say so in the docs |
| Mail merge | n/a - filex never implemented `onRequestMailMergeRecipients` | n/a | n/a | - |
| Compare documents, insert from storage, mentions, rename, save as, history API | n/a - filex implements none of these DS events | n/a | n/a | - |
| Version history | filex's own versions (`writehook.BeforeOverwrite`), not the DS's | the same: each save is a filex version | n/a | - |
| Saving | the callback (status 2/6), about 10 s after the last editor leaves; force-save if the operator turns it on | Save, Ctrl+S, every ten minutes while changed, and the last writer leaving (0.3.0) | n/a | - |
| A document changed while open | conflict copy | 412 | n/a | A9 |
| Password-protected | yes | no | TBD-M | A10 |
| New document | docx, xlsx, pptx, odt, ods, odp (`newdoc`, filex's own templates; needs a DS to open them) | docx, xlsx, pptx (`ui-new`) | n/a | F2: odt, ods, odp rows too (the blank documents from the bundle, written by x2t) |
| Editor language | the person's, or one fixed for everybody (`FILEX_ONLYOFFICE_LANG`, admin card, #214) | the person's language and region (`src/app/config.ts editorLang`) | n/a | F1: filex passes the fixed language to apps too |
| A phone | the DS Community Edition's phone editors read only (editing is commercial) | the same phone app to read, with "Edit" to the folded editor (0.1.0) | n/a | - |
| Encrypted folders, vaults | refused (415 `file is e2e-encrypted`) | yes - the browser decrypts, the app edits, the save is encrypted (0.2.0) | n/a (the server never holds the plaintext) | - |
| Desktop "Open with filex" | yes | partly | n/a | A11 |
| Embeds | yes | yes where the embed shows apps | n/a | A12 |

### Writing other formats (Download as, Print)

| What | DS | App today | Without a browser | 0.57 |
|---|---|---|---|---|
| docx, docm, dotx, odt, ott, rtf, txt | yes | yes (src/formats.ts) | TBD-M | - |
| xlsx, xlsm, xltx, ods, ots, csv | yes | yes; csv in UTF-8/16/32 only | TBD-M | A5 |
| pptx, pptm, potx, ppsx, odp, otp | yes | yes | TBD-M | - |
| PDF, PDF/A | yes (doctrenderer) | yes, from the editor's own drawing (`pdf.bin`) | **yes**: the layout worker's `pdf.bin`, then x2t-server (SERVER.md) | F3 |
| html, md, mht, fb2, epub | yes (doctrenderer's `asc_nativeGetHtml` and x2t) | no | not yet: the layout worker does PDF and images; the HTML path is the same worker calling `asc_nativeGetHtml` | F2/F3: add the HTML job to the worker |
| jpg, png (pages as images) | yes | no | **yes** (the thumbnail path, any size) | F3 |
| Print | yes | yes, a PDF through filex's print page (`ui:print`) | n/a | - |

### Conversions on the server

| What | DS | App today | Without a browser | 0.57 |
|---|---|---|---|---|
| Office thumbnails | yes | no | yes (A1) | F3 |
| `engines:office` / Convert's office edges | yes, 47 edges | no | A2 | F3 |
| MCP `file_convert` | through the Convert app | no | as the Convert app | F3 |
| Sizes and limits | the DS's own input limits; filex: thumbnails up to `thumbs.office_max_mb` (25 MB), engine outputs up to the job's `MaxBytes` | the browser's memory | x2t-server grows to TBD-M; a 96-page .doc: TBD-M; 200,000-row csv: TBD-M (SERVER.md) | F3: the engine's memory cap is a setting |
| Speed | x2t native, doctrenderer with V8 snapshots: about 1 s a document, 7 s for the 96-page .doc to PDF (measured in the pinned image) | the browser | SERVER.md | - |
| JWT, callback trust, the public fetch URL | needed (the DS reaches filex over the network) | not needed: nothing leaves the browser | not needed: the engine runs inside filex's process, no network | - |

### Licence and notices

| What | DS | App | 0.57 |
|---|---|---|---|
| Licence | AGPL-3.0, a separate container | AGPL-3.0-or-later (one file AGPL-3.0-only), an installed app, its legal line under the editor | A13 |
| Third-party parts | the DS's own | NOTICE: ONLYOFFICE's files, CryptPad's x2t recipe | NOTICE adds QuickJS-ng (MIT), fonts_ie.js and xregexp from the same DS release, the server build of x2t |
