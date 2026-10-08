// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor (see README.md and NOTICE).
//
// A stand-in for filex 0.55, for the browser measurements (e2e/run.mjs):
// serves the built bundle (dist/ui) the way filex serves an app's interface
// - the same address shape, the same headers, the same policy built from
// the same grant, filex's bootstrap first in every page - and a host page
// that draws the sandboxed frame and answers the app's bridge the way
// filex's AppFrame does, for one file.
//
// The policy and the bootstrap are filex's, as its branch feat/189-p1-app-frame
// builds them (backend/internal/wasmplugin/uipolicy.go, MIT, BRF Tech): the
// app gets nothing here it would not get there. What the host page does not
// do: filex's own UI (the Save button is a call, see host.js), drafts,
// versions, quotas.
//
//   node e2e/harness/server.mjs [--port 8089] [--ui dist/ui] [--docs DIR] [--out DIR]

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');

/** The app's address prefix, like filex's: /_appui/<app>/<bundle-sha[:16]>/. */
export const APP_PATH = '/_appui/office-editor/0123456789abcdef/';

// filex's bootstrap (uipolicy.go uiBootstrap), byte for byte: its hash is in
// the policy, so a copy that differs would not run.
const BOOTSTRAP =
  '(()=>{"use strict";' +
  'const N=["RTCPeerConnection","webkitRTCPeerConnection","mozRTCPeerConnection","RTCDataChannel","RTCSessionDescription","RTCIceCandidate","RTCRtpSender","RTCRtpReceiver","RTCRtpTransceiver","RTCDtlsTransport","RTCIceTransport","RTCSctpTransport","RTCCertificate","RTCPeerConnectionIceEvent","RTCDataChannelEvent","RTCTrackEvent","RTCDTMFSender","RTCStatsReport","RTCError","RTCErrorEvent","RTCEncodedAudioFrame","RTCEncodedVideoFrame","RTCRtpScriptTransform"];' +
  'const K=w=>{if(!w)return;for(const n of N){try{Object.defineProperty(w,n,{value:undefined,writable:false,configurable:false})}catch(e){try{delete w[n]}catch(_){}}}};' +
  'K(window);' +
  'const W=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,"contentWindow"),D=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,"contentDocument");' +
  'const G=r=>{if(!r||!r.nodeType)return;const l=r.querySelectorAll?Array.from(r.querySelectorAll("iframe,frame")):[];if(r.tagName==="IFRAME"||r.tagName==="FRAME")l.unshift(r);for(const f of l){try{K(W.get.call(f))}catch(e){}}};' +
  'Object.defineProperty(HTMLIFrameElement.prototype,"contentWindow",{get(){const w=W.get.call(this);K(w);return w},configurable:false});' +
  'Object.defineProperty(HTMLIFrameElement.prototype,"contentDocument",{get(){const d=D.get.call(this);if(d)K(d.defaultView);return d},configurable:false});' +
  'const P=(p,ns)=>{for(const n of ns){const o=p[n];if(typeof o!=="function")continue;Object.defineProperty(p,n,{value:function(...a){const r=o.apply(this,a);for(const x of a)G(x);G(this);return r},configurable:false,writable:false})}};' +
  'P(Node.prototype,["appendChild","insertBefore","replaceChild"]);' +
  'P(Element.prototype,["append","prepend","after","before","replaceWith","insertAdjacentElement","insertAdjacentHTML","replaceChildren"]);' +
  'for(const q of["innerHTML","outerHTML"]){const d=Object.getOwnPropertyDescriptor(Element.prototype,q);Object.defineProperty(Element.prototype,q,{get(){return d.get.call(this)},set(v){const p=this.parentNode;d.set.call(this,v);G(this);if(p)G(p)},configurable:false})}' +
  'window.addEventListener("load",e=>{const t=e.target;if(t&&(t.tagName==="IFRAME"||t.tagName==="FRAME")){try{K(W.get.call(t))}catch(_){}}},true);' +
  '})();';
const BOOTSTRAP_TAG = `<script>${BOOTSTRAP}</script>`;
const BOOTSTRAP_HASH = `'sha256-${createHash('sha256').update(BOOTSTRAP).digest('base64')}'`;

const PERMISSIONS_POLICY =
  'accelerometer=(), bluetooth=(), browsing-topics=(), camera=(), captured-surface-control=(), clipboard-read=(), clipboard-write=(), ' +
  'compute-pressure=(), digital-credentials-get=(), display-capture=(), encrypted-media=(), fullscreen=(), gamepad=(), geolocation=(), ' +
  'gyroscope=(), hid=(), identity-credentials-get=(), idle-detection=(), keyboard-map=(), local-fonts=(), magnetometer=(), microphone=(), ' +
  'midi=(), otp-credentials=(), payment=(), picture-in-picture=(), private-state-token-issuance=(), private-state-token-redemption=(), ' +
  'publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), storage-access=(), usb=(), web-share=(), ' +
  'window-management=(), xr-spatial-tracking=()';

/** The app's grant (filex-app.json's ui block): eval, wasm-eval, package-fetch, frame-package, connect-blob. */
export function uiPolicy(pkg) {
  const csp = [
    "default-src 'none'",
    `script-src ${pkg} ${BOOTSTRAP_HASH} 'unsafe-eval' 'wasm-unsafe-eval'`,
    `style-src ${pkg} 'unsafe-inline'`,
    `img-src ${pkg} data: blob:`,
    `font-src ${pkg} data:`,
    `media-src ${pkg} blob:`,
    `connect-src ${pkg} blob:`,
    'worker-src blob:',
    `frame-src ${pkg}`,
    `child-src ${pkg}`,
    "object-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    ...(process.env.FX_FRAME_ANCESTORS === 'star' ? ['frame-ancestors *'] : []),
    'sandbox allow-scripts',
  ].join('; ');
  return { csp, allowlist: `("${pkg}*")` };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.bin': 'application/octet-stream',
  '': 'text/plain; charset=utf-8',
};

function typeOf(p) {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot < 0 ? '' : base.slice(dot).toLowerCase();
  return TYPES[ext] ?? 'application/octet-stream';
}

/** filex's path check: decoded once, then no "..", ".", empty segment, backslash or NUL. */
function cleanPath(raw) {
  let p;
  try {
    p = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (/%2f/i.test(raw) || p.includes('\\') || p.includes('\0')) return null;
  const segs = p.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return null;
  return p;
}

const DOC_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function startServer({ port = 8089, ui = path.join(ROOT, 'dist', 'ui'), docs, out, log = () => {} } = {}) {
  const hostHtml = readFileSync(path.join(here, 'host.html'));
  const hostJs = readFileSync(path.join(here, 'host.js'));
  const saves = [];
  /** What the app handed the person (ui.download) or gave filex to print (the ui.print stand-in). */
  const files = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const origin = `http://${req.headers.host}`;
    const p = url.pathname;
    try {
      if (p === '/' || p === '/host.html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          // filex's own page names the interfaces by path, never 'self'.
          'Content-Security-Policy': `default-src 'none'; script-src ${origin}/host.js; style-src 'unsafe-inline'; connect-src ${origin}/__doc/ ${origin}/__save ${origin}/__file; frame-src ${origin}/_appui/; img-src data:`,
        });
        res.end(hostHtml);
        return;
      }
      if (p === '/host.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(hostJs);
        return;
      }
      if (p.startsWith('/__doc/')) {
        const name = cleanPath(p.slice('/__doc/'.length));
        const file = name && docs ? path.join(docs, name) : null;
        if (!file || !existsSync(file)) {
          res.writeHead(404).end();
          return;
        }
        const ext = name.slice(name.lastIndexOf('.') + 1);
        res.writeHead(200, { 'Content-Type': DOC_TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(readFileSync(file));
        return;
      }
      if (p === '/__save' && req.method === 'POST') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          const name = (url.searchParams.get('name') || 'saved.bin').replace(/[^A-Za-z0-9._-]/g, '_');
          const tag = (url.searchParams.get('tag') || 'run').replace(/[^A-Za-z0-9._-]/g, '_');
          const n = saves.filter((s) => s.tag === tag && s.name === name).length + 1;
          let file = null;
          if (out) {
            mkdirSync(out, { recursive: true });
            file = path.join(out, `${tag}-${n}-${name}`);
            writeFileSync(file, body);
          }
          saves.push({ tag, name, n, size: body.length, file, at: Date.now() });
          log(`save ${tag} ${name} #${n}: ${body.length} bytes`);
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ saved: true, size: body.length }));
        });
        return;
      }
      if (p === '/__file' && req.method === 'POST') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          const how = url.searchParams.get('how') === 'print' ? 'print' : 'download';
          const name = (url.searchParams.get('name') || 'file.bin').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120);
          const tag = (url.searchParams.get('tag') || 'run').replace(/[^A-Za-z0-9._-]/g, '_');
          const n = files.filter((f) => f.tag === tag).length + 1;
          let file = null;
          if (out) {
            mkdirSync(out, { recursive: true });
            file = path.join(out, `${tag}-${how}-${n}-${name.replace(/[^A-Za-z0-9._-]/g, '_')}`);
            writeFileSync(file, body);
          }
          files.push({ tag, how, name, n, size: body.length, file, at: Date.now() });
          log(`${how} ${tag} ${name}: ${body.length} bytes`);
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ size: body.length }));
        });
        return;
      }
      if (p.startsWith(APP_PATH)) {
        const rel = cleanPath(p.slice(APP_PATH.length));
        const file = rel ? path.join(ui, ...rel.split('/')) : null;
        if (!file || !existsSync(file) || !statSync(file).isFile()) {
          res.writeHead(404, { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).end();
          log(`404 ${p}`);
          return;
        }
        const type = typeOf(rel);
        const common = {
          'Content-Type': type,
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
        };
        if (type.startsWith('text/html')) {
          const pkg = `${origin}${APP_PATH}`;
          const { csp, allowlist } = uiPolicy(pkg);
          let doc = readFileSync(file);
          let i = 0;
          if (doc[0] === 0xef && doc[1] === 0xbb && doc[2] === 0xbf) i = 3;
          const text = doc.subarray(i).toString('utf8');
          const m = /^\s*<!doctype[^>]*>/i.exec(text);
          const at = m ? m[0].length : 0;
          doc = Buffer.from(text.slice(0, at) + BOOTSTRAP_TAG + text.slice(at), 'utf8');
          res.writeHead(200, {
            ...common,
            'Cache-Control': 'no-cache',
            'Content-Security-Policy': csp,
            'Connection-Allowlist': allowlist,
            'X-DNS-Prefetch-Control': 'off',
            'Referrer-Policy': 'no-referrer',
            'Permissions-Policy': PERMISSIONS_POLICY,
          });
          res.end(doc);
          return;
        }
        res.writeHead(200, {
          ...common,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        });
        res.end(readFileSync(file));
        return;
      }
      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500).end(String(e?.message ?? e));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, saves, files, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = { port: 8089, docs: path.join(ROOT, 'dist', 'e2e-docs'), out: path.join(ROOT, 'dist', 'e2e-out'), log: (s) => console.log(s) };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--port') opt.port = Number(a[++i]);
    else if (a[i] === '--ui') opt.ui = path.resolve(a[++i]);
    else if (a[i] === '--docs') opt.docs = path.resolve(a[++i]);
    else if (a[i] === '--out') opt.out = path.resolve(a[++i]);
  }
  startServer(opt).then(({ origin }) => console.log(`harness at ${origin}/?doc=<name>`));
}
