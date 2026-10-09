// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor (see README.md and NOTICE).
//
// A stand-in for filex 0.56's co-editing relay, for the browser measurement
// of editing together (e2e/run.mjs togetherRun): two browser contexts - two
// people - open the same document through the harness, and their host pages
// (host.js, filex's AppFrame as far as the app uses it) answer `coedit.*`
// through this, the way filex 0.56 answers them (its docs/APP-PLUGINS-API.md
// → Editing together):
//
//   - one session per room (the harness's stand-in for one file), started by
//     the first to join, who must put the base before anybody else can join
//     (the others are answered "not_ready" until then);
//   - one order: the relay gives every entry its seq and hands the entries to
//     every member, in order, each once (server-sent events, from where the
//     member asks), its own included;
//   - the changes lease: changes only from its holder, the lease only for a
//     writer that has seen every change (60 s, renewed by each changes entry);
//   - the relay's own entries: join (with an indexUser never given twice),
//     leave, saved (written when a save carries `through`);
//   - cursors passed to the others, not kept; the session's blobs, once a name.
//
// What it does not do: sealing (filex's page seals and opens; the app never
// sees it), the database, the 45-second drop of a member whose page is gone,
// limits. None of it is the app's to see.

const LEASE_MS = 60_000;
const BLOB_NAME = /^[A-Za-z0-9._-]{1,128}$/;

function json(res, status, v) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(v));
}

function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createRelay({ log = () => {} } = {}) {
  /** room -> session */
  const rooms = new Map();

  function session(room) {
    return rooms.get(room) ?? null;
  }

  function add(s, e) {
    const entry = { ...e, seq: s.log.length + 1, at: Date.now() };
    s.log.push(entry);
    if (entry.kind === 'changes') s.changesHead = entry.seq;
    for (const sub of s.subs) sub.send({ type: 'entry', entry });
    return entry.seq;
  }

  function memberOf(s, m) {
    return { client: m.client, user: m.user, name: m.name, indexUser: m.indexUser, canEdit: m.canEdit };
  }

  /** A save of the room's document reached `through` (host.js's file.save with through). */
  function saved(room, client, through) {
    const s = session(room);
    if (!s || !s.members.has(client)) return false;
    const t = Math.min(Number(through) || 0, s.log.length);
    if (t < s.savedThrough) return false;
    s.savedThrough = t;
    add(s, { kind: 'saved', client, through: t });
    return true;
  }

  /** What the measurement reads: each room's log, as the relay holds it. */
  function snapshot(room) {
    const s = session(room);
    if (!s) return null;
    return {
      log: s.log.map((e) => ({ seq: e.seq, kind: e.kind, client: e.client, through: e.through })),
      members: [...s.members.values()].map((m) => memberOf(s, m)),
      changesHead: s.changesHead,
      savedThrough: s.savedThrough,
      blobs: [...s.blobs.keys()],
    };
  }

  async function handle(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith('/__co/')) return false;
    const room = url.searchParams.get('room') || '';
    const client = url.searchParams.get('client') || '';
    if (!room) {
      json(res, 400, { error: 'invalid' });
      return true;
    }
    let s = session(room);
    const what = p.slice('/__co/'.length);

    if (what === 'state' && req.method === 'GET') {
      json(res, 200, snapshot(room));
      return true;
    }

    if (what === 'join' && req.method === 'POST') {
      const who = (url.searchParams.get('who') || 'p').replace(/[^A-Za-z0-9]/g, '').slice(0, 16) || 'p';
      const name = url.searchParams.get('name') || who;
      const canEdit = url.searchParams.get('ro') !== '1';
      let created = false;
      if (!s) {
        s = { log: [], blobs: new Map(), members: new Map(), nextClient: 0, nextIndex: 0, lease: { holder: '', until: 0 }, changesHead: 0, savedThrough: 0, subs: new Set(), id: `s-${room}` };
        rooms.set(room, s);
        created = true;
      } else if (!s.blobs.has('base')) {
        json(res, 409, { error: 'unavailable', message: 'not_ready' });
        return true;
      }
      s.nextClient++;
      s.nextIndex++;
      const m = { client: `c${s.nextClient}`, user: `u${who}`, name, indexUser: s.nextIndex, canEdit, lastCtr: 0 };
      s.members.set(m.client, m);
      add(s, { kind: 'join', client: m.client, member: memberOf(s, m) });
      log(`co ${room}: ${m.client} (${name}) joined${created ? ', started the session' : ''}`);
      json(res, 200, { session: s.id, me: memberOf(s, m), head: s.log.length, changesHead: s.changesHead, savedThrough: s.savedThrough, created });
      return true;
    }

    if (!s) {
      json(res, 404, { error: 'unavailable', message: 'no_session' });
      return true;
    }

    if (what === 'events' && req.method === 'GET') {
      const from = Math.max(0, Number(url.searchParams.get('from')) || 0);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const sub = {
        client,
        send: (v) => res.write(`data: ${JSON.stringify(v)}\n\n`),
      };
      for (const e of s.log.slice(from)) sub.send({ type: 'entry', entry: e });
      s.subs.add(sub);
      req.on('close', () => s.subs.delete(sub));
      return true;
    }

    if (what === 'blob' && req.method === 'GET') {
      const name = url.searchParams.get('name') || '';
      const b = s.blobs.get(name);
      if (!b) {
        json(res, 404, { error: 'not_found' });
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }).end(b);
      return true;
    }

    const m = s.members.get(client);
    if (!m) {
      json(res, 403, { error: 'unavailable', message: 'not_member' });
      return true;
    }

    if (what === 'blob' && req.method === 'PUT') {
      const name = url.searchParams.get('name') || '';
      if (!BLOB_NAME.test(name)) {
        json(res, 400, { error: 'invalid' });
        return true;
      }
      if (s.blobs.has(name)) {
        json(res, 409, { error: 'failed', message: 'exists' });
        return true;
      }
      s.blobs.set(name, await body(req));
      json(res, 200, {});
      return true;
    }

    if (req.method !== 'POST') {
      json(res, 405, { error: 'invalid' });
      return true;
    }
    let params = {};
    try {
      const raw = (await body(req)).toString('utf8');
      params = raw ? JSON.parse(raw) : {};
    } catch {
      json(res, 400, { error: 'invalid' });
      return true;
    }

    if (what === 'append') {
      if (!m.canEdit) {
        json(res, 403, { error: 'read_only' });
        return true;
      }
      const kind = params.kind;
      if (!['changes', 'lock', 'release'].includes(kind)) {
        json(res, 400, { error: 'invalid' });
        return true;
      }
      const now = Date.now();
      if (kind === 'changes' && !(s.lease.holder === client && now < s.lease.until)) {
        json(res, 403, { error: 'failed', message: 'no_lease' });
        return true;
      }
      const seq = add(s, { kind, client, body: params.body });
      if (kind === 'changes') s.lease.until = now + LEASE_MS;
      json(res, 200, { seq });
      return true;
    }

    if (what === 'lease') {
      if (!m.canEdit) {
        json(res, 403, { error: 'read_only' });
        return true;
      }
      const now = Date.now();
      if (params.op === 'release') {
        if (s.lease.holder === client) s.lease.holder = '';
        json(res, 200, { granted: false });
        return true;
      }
      const busy = s.lease.holder && s.lease.holder !== client && now < s.lease.until;
      const granted = !busy && Number(params.changesSeen) === s.changesHead;
      if (granted) s.lease = { holder: client, until: now + LEASE_MS };
      json(res, 200, { granted });
      return true;
    }

    if (what === 'cursor') {
      if (m.canEdit) for (const sub of s.subs) if (sub.client !== client) sub.send({ type: 'cursor', client, cursor: params.cursor });
      json(res, 200, {});
      return true;
    }

    if (what === 'leave') {
      s.members.delete(client);
      if (s.lease.holder === client) s.lease.holder = '';
      add(s, { kind: 'leave', client });
      log(`co ${room}: ${client} left`);
      json(res, 200, {});
      return true;
    }

    json(res, 404, { error: 'unknown_method' });
    return true;
  }

  return { handle, saved, snapshot };
}
