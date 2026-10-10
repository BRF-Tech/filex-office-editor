// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor (see README.md and NOTICE).
//
// The host page of the harness: filex's AppFrame for one file, as far as the
// app uses it. It draws the frame the way filex does (sandbox before src,
// no-referrer, no `allow`), takes the app's hello only from that frame,
// answers the bridge's requests and keeps what the measurement reads in
// window.__fx. The query string chooses the file and the person's setup:
//
//   ?doc=<name>&locale=tr&theme=dark&ro=1&tag=<run>&print=none&grants=-ui:download,-ui:print
//
// The app's store (state.get/set) is filex's as 0.54 keeps it - 8 KiB a
// value, 16 KiB an app as JSON - and lasts across the pages of one browser
// context (this page's own localStorage stands in for the person's
// preferences). ui.download records the file with the server (/__file).
// ui.print answers as filex 0.55's AppFrame does (the ui:print grant, a
// name, a PDF - "%PDF-" - and {printed, size}) but records the PDF the same
// way instead of printing it; print=none answers unknown_method, as filex
// 0.54 and older do.
//
// enc=folder is filex 0.56 with a document of an unlocked encrypted folder
// (FileInfo `encrypted: "folder"`, `plaintext: true`): what "the server"
// holds is the document encrypted the way filex's explorer encrypts it (the
// `filexe2e` one-shot format: a random DEK sealed with the folder key, the
// content under the DEK, AES-GCM), the folder key lives in this page only,
// file.read decrypts it here and hands the app the plaintext, and file.save
// encrypts what the app hands over before it goes to the server - which
// receives and keeps only that ciphertext. enc=055 is filex 0.55 with the
// same file: `encrypted: "folder"`, read-only, and its read refused.
//
// Editing together (filex 0.56): with ?co=<room>&who=<id>&uname=<name> the
// page grants files:co-edit and answers coedit.* the way filex 0.56's
// AppFrame does - through the harness's relay (relay.mjs), which two browser
// contexts share - and a save that carries `through` goes into the session's
// log. filex seals the entries; nothing here does, because the app never
// sees that. Without ?co the coedit.* methods are unknown_method, as in
// filex 0.55 and older, and the app edits alone.
'use strict';

(function () {
  const q = new URLSearchParams(location.search);
  const name = q.get('doc') || 'blank.docx';
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const locale = q.get('locale') || 'en';
  const mode = q.get('theme') === 'dark' ? 'dark' : 'light';
  const readOnly = q.get('ro') === '1';
  const tag = q.get('tag') || 'run';
  const canPrint = q.get('print') !== 'none';
  const enc = q.get('enc') || '';
  const GRANTS = ['files:read', 'files:write', 'ui', 'ui:eval', 'ui:wasm-eval', 'ui:package-fetch', 'ui:frame-package', 'ui:connect-blob', 'ui:download', 'ui:print', 'files:e2e-plaintext'];
  const without = (q.get('grants') || '').split(',').filter((g) => g.startsWith('-')).map((g) => g.slice(1));
  const room = q.get('co') || '';
  const who = q.get('who') || 'a';
  const personName = q.get('uname') || 'Ayşe Yılmaz';
  if (room) GRANTS.push('files:co-edit');
  const grants = GRANTS.filter((g) => !without.includes(g));
  const STATE = 'fx-app-state:office-editor';
  const STATE_VALUE_MAX = 8 << 10;
  const STATE_APP_MAX = 16 << 10;
  const APP = '/_appui/office-editor/0123456789abcdef/index.html';
  const MIME = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  const TOKENS = {
    light: { '--fe-bg': '#ffffff', '--fe-text': '#1f2328', '--fe-text-muted': '#656d76', '--fe-border': '#d0d7de', '--fe-accent': '#0969da' },
    dark: { '--fe-bg': '#16171b', '--fe-text': '#e6edf3', '--fe-text-muted': '#8d96a0', '--fe-border': '#30363d', '--fe-accent': '#4493f8' },
  };

  if (mode === 'dark') document.documentElement.classList.add('dark');
  document.getElementById('name').textContent = name;

  const fx = (window.__fx = { name, dirty: false, toasts: [], saves: [], titles: [], errors: [], calls: [], files: [], stateSets: 0, ready: false, hostSave: null, co: { client: '', entries: 0, cursors: 0 } });

  // ---- enc=folder: filex 0.56's encrypted folder, its key in this page only.
  const E2E_MAGIC = new TextEncoder().encode('filexe2e');
  let folderKey = null;
  /** The document as "the server" holds it now: ciphertext. */
  let held = null;

  async function e2eKey() {
    if (!folderKey) folderKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return folderKey;
  }

  /** filex's encryptFile: 'filexe2e', 0x01, the wrap IV, the DEK sealed with the folder key, the data IV, 16 zero bytes, the content. */
  async function e2eSeal(plain) {
    const fmk = await e2eKey();
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const dek = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
    const wrapIV = crypto.getRandomValues(new Uint8Array(12));
    const dataIV = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIV }, fmk, raw));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: dataIV }, dek, plain));
    raw.fill(0);
    const out = new Uint8Array(97 + ct.length);
    out.set(E2E_MAGIC, 0);
    out[8] = 1;
    out.set(wrapIV, 9);
    out.set(wrapped, 21);
    out.set(dataIV, 69);
    out.set(ct, 97);
    return out.buffer;
  }

  /** filex's decryptFile, for the one-shot format e2eSeal writes. */
  async function e2eOpen(buf) {
    const b = new Uint8Array(buf);
    if (b.length < 97 || !E2E_MAGIC.every((c, i) => b[i] === c) || b[8] !== 1) throw new Error('not a file of an encrypted folder');
    const fmk = await e2eKey();
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(9, 21) }, fmk, b.slice(21, 69));
    const dek = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(69, 81) }, dek, b.slice(97));
  }

  /** What the measurement reads back: the document "the server" holds, decrypted with the folder key (base64), and its first bytes as stored. */
  fx.heldDocument = async function () {
    if (!held) return null;
    const plain = new Uint8Array(await e2eOpen(held));
    let s = '';
    for (let i = 0; i < plain.length; i += 0x8000) s += String.fromCharCode.apply(null, plain.subarray(i, i + 0x8000));
    return { plain: btoa(s), head: String.fromCharCode.apply(null, new Uint8Array(held, 0, 8)) };
  };

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', 'Office editor');
  frame.src = APP;
  document.getElementById('frame-box').appendChild(frame);

  let port = null;
  let hid = 0;
  const hostPending = new Map();

  function reply(id, result, transfer) {
    port.postMessage({ id, result }, transfer || []);
  }
  function fail(id, code, message) {
    port.postMessage({ id, error: { code, message: message || code } });
  }

  async function read(id) {
    if (enc === '055') return fail(id, 'failed', 'encrypted');
    if (enc === 'folder') {
      if (!held) {
        const first = await fetch(`/__doc/${encodeURIComponent(name)}`);
        if (!first.ok) return fail(id, 'not_found');
        held = await e2eSeal(await first.arrayBuffer());
      }
      // Decrypted here, transferred to the app: filex 0.56's AppFrame.
      const plain = await e2eOpen(held);
      return reply(id, { name, size: plain.byteLength, mime: MIME[ext] || 'application/octet-stream', bytes: plain }, [plain]);
    }
    const res = await fetch(`/__doc/${encodeURIComponent(name)}`);
    if (!res.ok) return fail(id, 'not_found');
    const bytes = await res.arrayBuffer();
    reply(id, { name, size: bytes.byteLength, mime: MIME[ext] || 'application/octet-stream', bytes }, [bytes]);
  }

  async function save(id, params) {
    if (readOnly) return fail(id, 'read_only');
    let data = params && params.data;
    if (typeof data === 'string') data = new TextEncoder().encode(data);
    if (data && typeof data.getReader === 'function') data = await new Response(data).arrayBuffer();
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return fail(id, 'invalid');
    if (enc === '055') return fail(id, 'read_only');
    if (enc === 'folder') {
      // Encrypted here: the server receives and keeps only the ciphertext.
      const plain = ArrayBuffer.isView(data) ? data : new Uint8Array(data);
      const sealed = await e2eSeal(plain);
      const res = await fetch(`/__save?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}&enc=1`, { method: 'POST', body: sealed });
      const r = await res.json();
      held = sealed;
      fx.saves.push({ size: r.size, at: Date.now(), encrypted: true });
      return reply(id, { saved: true, size: plain.byteLength });
    }
    let at = `/__save?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`;
    // In a session, the save says how far into the log it reaches (filex 0.56 records it).
    if (room && co.client && typeof params.through === 'number') at += `&room=${encodeURIComponent(room)}&client=${encodeURIComponent(co.client)}&through=${params.through}`;
    const res = await fetch(at, { method: 'POST', body: data });
    const r = await res.json();
    fx.saves.push({ size: r.size, at: Date.now(), through: typeof params.through === 'number' ? params.through : null });
    reply(id, { saved: true, size: r.size });
  }

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STATE) || '{}');
    } catch {
      return {};
    }
  }

  function stateSet(id, params) {
    const key = String((params && params.key) || '');
    if (!key || key.length > 128) return fail(id, 'invalid', 'a state key is 1-128 characters');
    const all = readState();
    if (params.value === undefined) delete all[key];
    else {
      const json = JSON.stringify(params.value);
      if (json.length > STATE_VALUE_MAX) return fail(id, 'too_large', `a state value is at most ${STATE_VALUE_MAX} bytes as JSON`);
      all[key] = JSON.parse(json);
    }
    if (new TextEncoder().encode(JSON.stringify(all)).length > STATE_APP_MAX) return fail(id, 'too_large', `an app keeps at most ${STATE_APP_MAX} bytes`);
    localStorage.setItem(STATE, JSON.stringify(all));
    fx.stateSets++;
    return reply(id, null);
  }

  /** ui.download and the ui.print stand-in: the file goes to the server, which keeps it for the measurement. */
  async function handOver(id, params, how) {
    let data = params && params.data;
    if (typeof data === 'string') data = new TextEncoder().encode(data);
    if (data && typeof data.getReader === 'function') data = await new Response(data).arrayBuffer();
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return fail(id, 'invalid');
    const fname = String((params && params.name) || '');
    if (!fname || /[\\/]/.test(fname)) return fail(id, 'invalid', 'a name, not a path');
    if (how === 'print') {
      const head = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, Math.min(5, data.byteLength)) : new Uint8Array(data, 0, Math.min(5, data.byteLength));
      if (String.fromCharCode(...head) !== '%PDF-') return fail(id, 'invalid', 'the data is not a PDF');
      if (params.mime !== undefined && params.mime !== 'application/pdf') return fail(id, 'invalid', 'print takes a PDF (application/pdf)');
    }
    const res = await fetch(`/__file?how=${how}&name=${encodeURIComponent(fname)}&tag=${encodeURIComponent(tag)}`, { method: 'POST', body: data });
    const r = await res.json();
    fx.files.push({ how, name: fname, mime: params.mime || '', size: r.size });
    return reply(id, how === 'print' ? { printed: true, size: r.size } : { saved: true, size: r.size });
  }

  // ---- Editing together: filex 0.56's coedit.*, through the harness's relay.
  const co = { client: '', events: null };
  const coUrl = (what, extra) => `/__co/${what}?room=${encodeURIComponent(room)}&client=${encodeURIComponent(co.client)}${extra || ''}`;

  /** A refusal as filex's AppFrame says it: the code, and the server's short word. */
  async function coFail(id, res) {
    let e = {};
    try {
      e = await res.json();
    } catch {
      /* no body */
    }
    return fail(id, e.error || 'failed', e.message || e.error || 'failed');
  }

  async function coPost(id, what, params, answer) {
    const res = await fetch(coUrl(what), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}) });
    if (!res.ok) return coFail(id, res);
    const r = await res.json();
    return reply(id, answer ? answer(r) : null);
  }

  async function coedit(id, method, params) {
    if (!room) return fail(id, 'unknown_method');
    if (!grants.includes('files:co-edit')) return fail(id, 'not_granted');
    switch (method) {
      case 'coedit.join': {
        // filex waits for the base the starter has not put yet (about 20 s).
        const end = Date.now() + 20000;
        for (;;) {
          const res = await fetch(`/__co/join?room=${encodeURIComponent(room)}&who=${encodeURIComponent(who)}&name=${encodeURIComponent(personName)}${readOnly ? '&ro=1' : ''}`, { method: 'POST' });
          if (res.status === 409 && Date.now() < end) {
            // Only a session whose base is not there yet is asked again.
            const why = await res.clone().json().catch(() => ({}));
            if (why.message === 'not_ready') {
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }
          }
          if (!res.ok) return coFail(id, res);
          const hello = await res.json();
          co.client = hello.me.client;
          fx.co.client = co.client;
          return reply(id, hello);
        }
      }
      case 'coedit.subscribe': {
        const from = Math.max(0, Number(params && params.from) || 0);
        if (co.events) co.events.close();
        const es = new EventSource(coUrl('events', `&from=${from}`));
        co.events = es;
        es.onmessage = (m) => {
          let v;
          try {
            v = JSON.parse(m.data);
          } catch {
            return;
          }
          if (v.type === 'entry') {
            fx.co.entries++;
            port.postMessage({ event: 'coedit.entry', data: v.entry });
          } else if (v.type === 'cursor') {
            fx.co.cursors++;
            port.postMessage({ event: 'coedit.cursor', data: { client: v.client, cursor: v.cursor } });
          }
        };
        return reply(id, null);
      }
      case 'coedit.append':
        return coPost(id, 'append', { kind: params && params.kind, body: params && params.body }, (r) => ({ seq: r.seq }));
      case 'coedit.lease':
        return coPost(id, 'lease', { op: params && params.op, changesSeen: params && params.changesSeen }, (r) => ({ granted: r.granted === true }));
      case 'coedit.cursor':
        return coPost(id, 'cursor', { cursor: params && params.cursor });
      case 'coedit.blob.put': {
        const data = params && params.data;
        if (!(data instanceof ArrayBuffer)) return fail(id, 'invalid', 'a blob is bytes');
        const res = await fetch(coUrl('blob', `&name=${encodeURIComponent(String(params.name || ''))}`), { method: 'PUT', body: data });
        if (!res.ok) return coFail(id, res);
        return reply(id, null);
      }
      case 'coedit.blob.get': {
        const nm = String((params && params.name) || '');
        const res = await fetch(coUrl('blob', `&name=${encodeURIComponent(nm)}`));
        if (!res.ok) return coFail(id, res);
        const bytes = await res.arrayBuffer();
        return reply(id, { name: nm, bytes }, [bytes]);
      }
      case 'coedit.leave':
        if (co.events) co.events.close();
        co.events = null;
        return coPost(id, 'leave', {});
    }
    return fail(id, 'unknown_method');
  }

  // Closing the page leaves the session (filex drops a member whose page is gone).
  window.addEventListener('pagehide', () => {
    if (room && co.client) fetch(coUrl('leave'), { method: 'POST', body: '{}', keepalive: true }).catch(() => {});
  });

  async function onRequest(ev) {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    if (typeof m.hid === 'number') {
      const p = hostPending.get(m.hid);
      hostPending.delete(m.hid);
      if (p) p(m);
      return;
    }
    const { id, method, params } = m;
    fx.calls.push(method);
    try {
      switch (method) {
        case 'session.get':
          return reply(id, {
            v: 1,
            app: { name: 'office-editor', version: '0.0.0' },
            view: { id: 'editor', placement: 'viewer' },
            locale,
            dir: 'ltr',
            theme: { mode, tokens: TOKENS[mode] },
            user: { name: personName },
            files: [
              {
                index: 0,
                name,
                ext,
                size: 0,
                mime: MIME[ext] || '',
                readOnly: readOnly || enc === '055',
                ...(enc ? { encrypted: 'folder' } : {}),
                ...(enc === 'folder' ? { plaintext: true } : {}),
              },
            ],
            grants,
          });
        case 'file.read':
          return read(id);
        case 'file.save':
          return save(id, params);
        case 'ui.dirty':
          fx.dirty = !!(params && params.dirty);
          document.getElementById('dirty').textContent = fx.dirty ? '(unsaved changes)' : '';
          return reply(id, null);
        case 'ui.toast':
          fx.toasts.push(params);
          return reply(id, null);
        case 'ui.title':
          fx.titles.push(params && params.text);
          return reply(id, null);
        case 'ui.close':
          return reply(id, null);
        case 'state.set':
          return stateSet(id, params);
        case 'state.get': {
          const v = readState()[String((params && params.key) || '')];
          return reply(id, v === undefined ? null : v);
        }
        case 'ui.download':
          if (!grants.includes('ui:download')) return fail(id, 'not_granted');
          return handOver(id, params, 'download');
        case 'ui.print':
          if (!canPrint) return fail(id, 'unknown_method');
          if (!grants.includes('ui:print')) return fail(id, 'not_granted');
          return handOver(id, params, 'print');
        case 'license.get':
          return reply(id, { status: 'free' });
        case 'coedit.join':
        case 'coedit.subscribe':
        case 'coedit.append':
        case 'coedit.lease':
        case 'coedit.cursor':
        case 'coedit.blob.put':
        case 'coedit.blob.get':
        case 'coedit.leave':
          return coedit(id, method, params);
        default:
          return fail(id, 'unknown_method');
      }
    } catch (e) {
      fx.errors.push(String((e && e.message) || e));
      fail(id, 'failed');
    }
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== frame.contentWindow) return;
    const d = ev.data;
    if (!d || typeof d !== 'object' || d.type !== 'filex:hello' || port) return;
    const ch = new MessageChannel();
    port = ch.port1;
    port.onmessage = onRequest;
    frame.contentWindow.postMessage({ type: 'filex:port', v: 1 }, '*', [ch.port2]);
    fx.ready = true;
  });

  /** filex's Save button: the host asks the app for its document. */
  fx.hostSave = function () {
    return new Promise((resolve) => {
      const n = ++hid;
      hostPending.set(n, resolve);
      port.postMessage({ hid: n, request: 'save' });
    });
  };

  /** filex closes the frame's surroundings: the app's last chance (settings, unsaved work). */
  fx.closeRequest = function () {
    port.postMessage({ event: 'close.request' });
  };

  /** filex's theme switch. */
  fx.setTheme = function (m) {
    port.postMessage({ event: 'theme', data: { mode: m, tokens: TOKENS[m] } });
  };
})();
