// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor (see README.md and NOTICE).
//
// The host page of the harness: filex's AppFrame for one file, as far as the
// app uses it. It draws the frame the way filex does (sandbox before src,
// no-referrer, no `allow`), takes the app's hello only from that frame,
// answers the bridge's requests and keeps what the measurement reads in
// window.__fx. The query string chooses the file and the person's setup:
//
//   ?doc=<name>&locale=tr&theme=dark&ro=1&tag=<run>
'use strict';

(function () {
  const q = new URLSearchParams(location.search);
  const name = q.get('doc') || 'blank.docx';
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const locale = q.get('locale') || 'en';
  const mode = q.get('theme') === 'dark' ? 'dark' : 'light';
  const readOnly = q.get('ro') === '1';
  const tag = q.get('tag') || 'run';
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

  const fx = (window.__fx = { name, dirty: false, toasts: [], saves: [], titles: [], errors: [], calls: [], ready: false, hostSave: null });

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
    const res = await fetch(`/__save?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`, { method: 'POST', body: data });
    const r = await res.json();
    fx.saves.push({ size: r.size, at: Date.now() });
    reply(id, { saved: true, size: r.size });
  }

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
            user: { name: 'Ayşe Yılmaz' },
            files: [{ index: 0, name, ext, size: 0, mime: MIME[ext] || '', readOnly }],
            grants: ['files:read', 'files:write', 'ui', 'ui:eval', 'ui:wasm-eval', 'ui:package-fetch', 'ui:frame-package', 'ui:connect-blob', 'ui:download'],
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
        case 'state.set':
          return reply(id, null);
        case 'state.get':
          return reply(id, undefined);
        case 'license.get':
          return reply(id, { status: 'free' });
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

  /** filex's theme switch. */
  fx.setTheme = function (m) {
    port.postMessage({ event: 'theme', data: { mode: m, tokens: TOKENS[m] } });
  };
})();
