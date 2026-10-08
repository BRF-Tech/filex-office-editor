// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The one change the bundle makes to ONLYOFFICE's HTML pages: no code
// inline. filex serves an app's pages with `script-src <its package>` and a
// hash for its own bootstrap - no 'unsafe-inline' - so an inline <script>
// or an onload="..." attribute would simply not run. Each inline script
// moves, byte for byte, into a file next to its page and is loaded from
// there at the same place (a classic script with a src runs in document
// order, as the inline one did, and may still document.write). The one
// inline handler web-apps uses - a stylesheet loaded with media="print"
// and switched to "all" on load - becomes a plain media="all" stylesheet.
// Anything else inline (another handler, a javascript: address) stops the
// build, so a new upstream page cannot slip through unnoticed.
//
// The page also gets, as its first script, the in-memory storage stand-in
// (scripts/editor/storage.js): in filex's sandboxed frame the browser
// refuses localStorage, which the editor keeps its settings in.
//
// Not a full HTML parser: it reads what web-apps' pages hold - tags,
// attributes (quoted or not), comments, and raw-text elements whose content
// is never markup (script, style, textarea, title).

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster']);

/** Whether a <script type="..."> runs as JavaScript (HTML's "JavaScript MIME type", or a module). */
export function isExecutableType(type) {
  if (type === undefined) return true;
  const t = type.trim().toLowerCase();
  return (
    t === '' ||
    t === 'module' ||
    /^(text|application)\/(x-)?(javascript|ecmascript)$/.test(t) ||
    /^text\/javascript1\.[0-5]$/.test(t) ||
    t === 'text/jscript' ||
    t === 'text/livescript'
  );
}

function indexOfCI(s, needle, from) {
  return s.toLowerCase().indexOf(needle, from);
}

/** Reads the tag that starts at s[i] === '<'. */
function readTag(s, i) {
  let j = i + 1;
  while (j < s.length && !/[\s/>]/.test(s[j])) j++;
  const name = s.slice(i + 1, j).toLowerCase();
  const attrs = [];
  for (;;) {
    while (j < s.length && /[\s/]/.test(s[j])) j++;
    if (j >= s.length) return { name, attrs, end: s.length };
    if (s[j] === '>') return { name, attrs, end: j + 1 };
    const start = j;
    while (j < s.length && !/[\s/>=]/.test(s[j])) j++;
    const attrName = s.slice(start, j).toLowerCase();
    let k = j;
    while (k < s.length && /\s/.test(s[k])) k++;
    let value = null;
    let valueStart = -1;
    let valueEnd = -1;
    if (s[k] === '=') {
      k++;
      while (k < s.length && /\s/.test(s[k])) k++;
      const q = s[k];
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, k + 1);
        const e = close < 0 ? s.length : close;
        valueStart = k + 1;
        valueEnd = e;
        value = s.slice(valueStart, valueEnd);
        j = close < 0 ? s.length : close + 1;
      } else {
        valueStart = k;
        while (k < s.length && !/[\s>]/.test(s[k])) k++;
        valueEnd = k;
        value = s.slice(valueStart, valueEnd);
        j = k;
      }
    }
    attrs.push({ name: attrName, value, start, end: j, valueStart, valueEnd });
  }
}

/** The document's comments, tags and script elements, in order. */
function* tokens(s) {
  let i = 0;
  while (i < s.length) {
    const j = s.indexOf('<', i);
    if (j < 0) return;
    if (s.startsWith('<!--', j)) {
      const e = s.indexOf('-->', j + 4);
      const end = e < 0 ? s.length : e + 3;
      yield { kind: 'comment', start: j, end };
      i = end;
    } else if (/[a-zA-Z]/.test(s[j + 1] ?? '')) {
      const tag = readTag(s, j);
      if (RAW_TEXT.has(tag.name)) {
        const close = indexOfCI(s, `</${tag.name}`, tag.end);
        const bodyEnd = close < 0 ? s.length : close;
        const gt = close < 0 ? -1 : s.indexOf('>', close);
        const end = gt < 0 ? s.length : gt + 1;
        yield { kind: tag.name === 'script' ? 'script' : 'tag', start: j, tag, bodyEnd, end };
        i = end;
      } else {
        yield { kind: 'tag', start: j, tag, end: tag.end };
        i = tag.end;
      }
    } else {
      const gt = s.indexOf('>', j);
      i = s[j + 1] === '/' || s[j + 1] === '!' || s[j + 1] === '?' ? (gt < 0 ? s.length : gt + 1) : j + 1;
    }
  }
}

const attrOf = (tag, name) => tag.attrs.find((a) => a.name === name);

// web-apps' asynchronous stylesheet: <link rel="stylesheet" media="print" onload="this.media='all'">.
function isStylesheetSwap(tag, attr) {
  if (tag.name !== 'link' || attr.name !== 'onload') return false;
  const v = (attr.value ?? '').replace(/\s+/g, '').replace(/;$/, '');
  const media = attrOf(tag, 'media');
  return (v === "this.media='all'" || v === 'this.media="all"') && media?.value?.trim().toLowerCase() === 'print';
}

function problemsOfTag(tag, where) {
  const out = [];
  for (const a of tag.attrs) {
    if (/^on[a-z]/.test(a.name) && !isStylesheetSwap(tag, a)) {
      out.push(`${where}: an inline event handler (${a.name}) on <${tag.name}>`);
    }
    if (URL_ATTRS.has(a.name) && /^\s*javascript:/i.test(a.value ?? '')) {
      out.push(`${where}: a javascript: address in ${a.name} on <${tag.name}>`);
    }
  }
  return out;
}

/**
 * The inline code left in a page: executable inline scripts, inline event
 * handlers, javascript: addresses. Empty means filex's CSP runs all of it.
 * (The stylesheet swap above counts too: its handler would not run either.)
 */
export function inlineCodeIn(html, where = 'page') {
  const out = [];
  for (const t of tokens(html)) {
    if (t.kind === 'comment') continue;
    for (const a of t.tag.attrs) {
      if (/^on[a-z]/.test(a.name)) out.push(`${where}: an inline event handler (${a.name}) on <${t.tag.name}>`);
      if (URL_ATTRS.has(a.name) && /^\s*javascript:/i.test(a.value ?? '')) out.push(`${where}: a javascript: address on <${t.tag.name}>`);
    }
    if (t.kind === 'script' && !attrOf(t.tag, 'src') && isExecutableType(attrOf(t.tag, 'type')?.value ?? undefined)) {
      if (html.slice(t.tag.end, t.bodyEnd).trim() !== '') out.push(`${where}: an inline <script>`);
    }
  }
  return out;
}

/**
 * Moves a page's inline code out (see the top of the file). `name` is the
 * page's file name (index.html), which names the scripts taken out of it
 * (index.inline-1.js, ...); `storage` is the address of the storage
 * stand-in relative to the page, or null for none. Returns the new page,
 * the scripts to write next to it, and what changed, in words. Throws on
 * inline code it does not know how to move.
 */
export function transformHtml(html, { name, storage = null }) {
  const base = name.replace(/\.html?$/i, '');
  const problems = [];
  const scripts = [];
  const changes = [];
  let out = '';
  let at = 0;
  let storageDone = storage === null;
  let swapped = 0;
  for (const t of tokens(html)) {
    if (t.kind === 'comment') continue;
    problems.push(...problemsOfTag(t.tag, name));
    if (t.kind === 'script' && !storageDone) {
      out += html.slice(at, t.start) + `<script src="${storage}"></script>`;
      at = t.start;
      storageDone = true;
      changes.push('the in-memory storage stand-in is loaded first');
    }
    const swap = t.tag.attrs.find((a) => isStylesheetSwap(t.tag, a));
    if (swap) {
      const media = attrOf(t.tag, 'media');
      const pieces = [
        [swap.start, swap.end, ''],
        [media.valueStart, media.valueEnd, 'all'],
      ].sort((a, b) => b[0] - a[0]);
      let tagText = html.slice(t.start, t.tag.end);
      for (const [s, e, r] of pieces) tagText = tagText.slice(0, s - t.start) + r + tagText.slice(e - t.start);
      tagText = tagText.replace(/\s+>$/, '>').replace(/\s{2,}/g, ' ');
      out += html.slice(at, t.start) + tagText;
      at = t.tag.end;
      swapped++;
    }
    if (t.kind !== 'script') continue;
    if (attrOf(t.tag, 'src')) continue;
    if (!isExecutableType(attrOf(t.tag, 'type')?.value ?? undefined)) continue;
    const body = html.slice(t.tag.end, t.bodyEnd);
    if (body.trim() === '') continue;
    const file = `${base}.inline-${scripts.length + 1}.js`;
    scripts.push({ file, body });
    const open = html.slice(t.start, t.tag.end).replace(/\s*\/?>$/, '');
    out += html.slice(at, t.start) + `${open} src="${file}"></script>`;
    at = t.end;
  }
  if (problems.length) throw new Error(`inline code the build cannot move:\n  ${problems.join('\n  ')}`);
  out += html.slice(at);
  if (scripts.length) {
    changes.unshift(
      scripts.length === 1
        ? `its inline script moved to ${scripts[0].file}`
        : `its ${scripts.length} inline scripts moved to ${base}.inline-1.js ... ${base}.inline-${scripts.length}.js`,
    );
  }
  if (swapped) changes.push(`${swapped === 1 ? 'a stylesheet' : `${swapped} stylesheets`} loaded with media="all" instead of an onload handler`);
  return { html: out, scripts, changes };
}
