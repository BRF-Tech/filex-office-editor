// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// What the editor bundle keeps of ONLYOFFICE's Document Server image, and
// the limits filex holds an app's interface bundle to. One place for both:
// scripts/editor/in-image.sh takes FONT_EXCLUDE from here, bundle.mjs
// classifies every file with classify(), and the tests read the same rules.

/**
 * ONLYOFFICE's core-fonts the bundle leaves out (122 MB of 158 MB):
 *   - the four large CJK families and Noto Sans KR - DroidSansFallbackFull,
 *     which stays, covers Chinese, Japanese and Korean as a fallback;
 *   - GNU FreeFont and Tibetan Machine Uni, which ship without a license
 *     file and whose scripts other families cover (FreeFont's Latin, Greek
 *     and Cyrillic are in DejaVu, Liberation and Noto).
 * Every other family stays: Latin with Turkish, Cyrillic, Greek, Arabic,
 * Hebrew, Indic, Khmer, Ethiopic, Myanmar, historic scripts, math and
 * symbols, and the Microsoft-metric stand-ins (Liberation for Arial, Times
 * New Roman and Courier New; Carlito for Calibri; Caladea for Cambria).
 */
export const FONT_EXCLUDE = ['arphic-ukai', 'wqy-zenhei', 'takao-gothic', 'nanum', 'noto/Noto_Sans_KR', 'freefont', 'tibetan-machine'];

/** The editors the app opens; the others (PDF, Visio) are left out. */
export const EDITORS = ['documenteditor', 'spreadsheeteditor', 'presentationeditor'];

/**
 * The apps of each editor the bundle carries: "main", the editor a computer
 * gets, and "mobile", ONLYOFFICE's phone app (Framework7, its own pages
 * under web-apps/apps/<editor>/mobile/, the same sdkjs and the same
 * socket.io address as "main"). The embedded viewer and the forms app are
 * left out (the app never opens them).
 *
 * ⚠ The phone app in ONLYOFFICE's Document Server image is the open-source
 * build: it opens documents to READ only. Its editing controller is a stub
 * (`isSupportEditFeature()` returns false in all three bundles of 9.4.0.129,
 * read 2026-10-08), and in edit mode it says so ("Using the free Community
 * version, you can open documents for viewing only. To access mobile web
 * editors, a commercial license is required."). The app opens it in view
 * mode, and a phone edits with "main", folded (src/app/config.ts).
 */
export const APPS = ['main', 'mobile'];

/**
 * The date of the changes this project makes to ONLYOFFICE's files (the
 * HTML pages, see html.mjs), for the notice ONLYOFFICE's terms ask for. It
 * is part of the build's input, not the clock, so two builds agree: change
 * it together with html.mjs, storage.js or the rules below.
 */
export const CHANGES_DATED = '2026-10-08';

/**
 * Rules, first match wins. `drop` leaves a file out (`why` is counted in the
 * lock file), `rename` serves it under another name (the content is
 * unchanged). Everything not matched is kept as it is.
 */
const RULES = [
  { re: /\.(gz|br)$/, drop: 'pre-compressed copies (filex compresses what it serves)' },
  { re: /^web-apps\/apps\/(pdfeditor|visioeditor)\//, drop: 'the PDF and Visio editors' },
  // The phone apps ("mobile") stay: see APPS above.
  { re: /^web-apps\/apps\/[^/]+\/(embed|forms)\//, drop: 'the embedded-viewer and forms apps' },
  { re: /\/resources\/help\//, drop: 'the help pages' },
  { re: /^web-apps\/apps\/api\/wopi\//, drop: "the WOPI host's server templates" },
  { re: /^web-apps\/vendor\/monaco\//, drop: 'the macro editor (macros are off)' },
  { re: /^sdkjs\/(pdf|visio)\//, drop: 'the PDF and Visio engines' },
  { re: /^sdkjs\/[^/]+\/sdk-all\.bin$/, drop: "the server's script snapshot (doctrenderer)" },
  { re: /^sdkjs\/slide\/themes\/src\//, drop: 'the theme sources (the generated themes stay)' },
  { re: /^sdkjs\/slide\/themes\/[^/]+\/Image__[^/]*$/, drop: "the theme generator's temporary files" },
  {
    // Measured 2026-10-08 (9.4.0.129, Chromium, network log): the editor asks for none of them, opening a
    // presentation or its Design tab; the theme gallery is sdkjs/common/Images/themes_thumbnail*.png.
    re: /^sdkjs\/slide\/themes\/theme\d+\/thumbnail(@[\d.]+x)?\.png$/,
    drop: "the per-theme thumbnails (the editor's theme gallery uses one sprite, sdkjs/common/Images/themes_thumbnail)",
  },
  { re: /\.mem$/, drop: 'asm.js memory images (the WebAssembly builds are used)' },
  {
    re: /^sdkjs\/common\/[^/]+\/[^/]+\/[^/]+_ie\.js$/,
    drop: 'asm.js builds for browsers without WebAssembly (sdkjs loads them only then)',
  },
  {
    re: /^web-apps\/apps\/api\/documents\/api\.js\.tpl$/,
    rename: () => 'web-apps/apps/api/documents/api.js',
    why: "api.js is api.js.tpl, as the Document Server's first start makes it, with the cache tag left as a placeholder (so the editor's paths are not rewritten)",
  },
  {
    // ⚠ Not built into the apps (measured 2026-10-08, 9.4.0.129: the editor
    // pages ask for them with RequireJS's text! plugin while they run, and
    // stop with "HTTP status: 404" without them). filex does not serve
    // .template, so they are served as .template.txt and the editor page's
    // script (src/frame/text.ts) asks for that name.
    re: /^web-apps\/apps\/[^/]+\/main\/(app|lib)\/template\/[^/]+\.template$/,
    rename: (p) => `${p}.txt`,
    why: "an interface template the editor page loads while it runs (RequireJS text!), renamed with .txt so filex serves it (content unchanged; the editor page's script asks for this name)",
  },
  {
    re: /^document-templates\/new\/default\/new\.(docx|xlsx|pptx)$/,
    rename: (p) => `${p}.bin`,
    why: "a blank document filex's New menu copies (filex-app.json new_documents), renamed with .bin so filex serves it (content unchanged)",
  },
  {
    re: /^(license|core-fonts-licenses)\/.+$/,
    rename: (p) => (servedType(p) ? null : `${p}.txt`),
    why: 'a license file, renamed with .txt so filex serves it (content unchanged)',
  },
];

/**
 * classify(path) → { action: 'keep' } | { action: 'drop', why } |
 * { action: 'rename', to, why }. `path` is relative to the extracted image
 * files (web-apps/..., sdkjs/..., fonts/...).
 */
export function classify(path) {
  for (const r of RULES) {
    if (!r.re.test(path)) continue;
    if (r.drop) return { action: 'drop', why: r.drop };
    const to = r.rename(path);
    if (to === null) continue;
    return { action: 'rename', to, why: r.why };
  }
  return { action: 'keep' };
}

// filex's interface bundle rules (backend/internal/wasmplugin/uibundle.go
// and uimanifest.go, filex 0.54). A bundle that breaks one is refused at
// install, so the build checks them first.
export const LIMITS = {
  zipBytes: 128 * 1024 * 1024,
  unpackedBytes: 512 * 1024 * 1024,
  files: 20000,
  fileBytes: 64 * 1024 * 1024,
  htmlBytes: 8 * 1024 * 1024,
  pathLength: 512,
};

// What this project aims for with the editor part (the x2t build and the
// app's page come on top): the build reports against it, without refusing.
export const BUDGET = { zipBytes: 100 * 1000 * 1000, files: 2000 };

// filex's served list (uibundle.go uiTypes): a file with another extension
// is refused at install; a file without one is served as text.
const SERVED = new Set([
  '.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json', '.map', '.webmanifest', '.wasm',
  '.txt', '.md', '.csv', '.xml', '.xsl', '.properties',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp', '.cur',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.ogg', '.oga', '.wav', '.flac', '.m4a', '.mp4', '.webm', '.ogv',
  '.glb', '.gltf', '.bin', '.pdf',
]);

// Go's path.Ext: from the last dot of the last element ("" without one).
function extOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot).toLowerCase();
}

/** Whether filex serves a file of this name. */
export function servedType(path) {
  const ext = extOf(path);
  return ext === '' || SERVED.has(ext);
}

/** filex's uiPathOK: a relative path with forward slashes and nothing to normalise. */
export function pathOK(p) {
  if (!p || p.length > LIMITS.pathLength || p.startsWith('/')) return false;
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c || c === 0x3a) return false;
  }
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

export const isHtml = (p) => /\.html?$/i.test(p);

/**
 * Checks a bundle against filex's limits. `entries` is [{ name, size }] and
 * `zipBytes` the zip's size. Returns the problems (empty: filex accepts it).
 */
export function checkBundle(entries, zipBytes) {
  const problems = [];
  if (zipBytes > LIMITS.zipBytes) problems.push(`the zip is ${zipBytes} bytes, over ${LIMITS.zipBytes}`);
  if (entries.length > LIMITS.files) problems.push(`${entries.length} files, over ${LIMITS.files}`);
  let unpacked = 0;
  const folded = new Map();
  for (const e of entries) {
    unpacked += e.size;
    if (!pathOK(e.name)) problems.push(`${e.name}: not a clean relative path`);
    if (!servedType(e.name)) problems.push(`${e.name}: filex does not serve this extension`);
    if (e.size > LIMITS.fileBytes) problems.push(`${e.name}: ${e.size} bytes, over ${LIMITS.fileBytes}`);
    if (isHtml(e.name) && e.size > LIMITS.htmlBytes) problems.push(`${e.name}: an HTML page over ${LIMITS.htmlBytes} bytes`);
    const low = e.name.toLowerCase();
    if (folded.has(low)) problems.push(`${folded.get(low)} and ${e.name} differ only in case`);
    folded.set(low, e.name);
  }
  if (unpacked > LIMITS.unpackedBytes) problems.push(`unpacks to ${unpacked} bytes, over ${LIMITS.unpackedBytes}`);
  return problems;
}
