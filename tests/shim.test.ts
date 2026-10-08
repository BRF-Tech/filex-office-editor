// SPDX-License-Identifier: AGPL-3.0-only
// Tests for packages/office-e2e (AGPL-3.0-only, see its README.md).
//
// The socket.io stand-in the editor's frame serves in place of
// socket.io.min.js (task #189). The editor must not be able to tell it from
// a socket: it connects a turn after io() is called, answers never arrive
// inside the call that asked, messages are copies (as over a wire), and
// buffered sends go out once connected. And it must not leave the frame:
// there is no network in it at all.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OfficeBridge, type BridgeMember } from '../src/bridge';
import { EDITOR_TYPE, type EditorMessage, type ServerMessage } from '../src/protocol';
import {
  BridgeSocketPort,
  createSocketIo,
  installSocketIo,
  type EditorLink,
  type ShimConnector,
} from '../src/shim';

/** A hand-turned event loop: nothing runs until turn(). */
function loop() {
  const runs: (() => void)[] = [];
  return {
    defer: (run: () => void) => {
      runs.push(run);
    },
    turn: () => {
      while (runs.length > 0) runs.shift()!();
    },
  };
}

/** A server that records what it gets and greets with a license. */
function recorder() {
  const got: EditorMessage[] = [];
  let link: EditorLink | null = null;
  let handshake: unknown = null;
  let closed = 0;
  const connector: ShimConnector = (l, hs) => {
    link = l;
    handshake = hs;
    return {
      connect: () => l.deliver({ type: 'license' }),
      fromEditor: (m) => got.push(m),
      disconnect: () => {
        closed++;
      },
    };
  };
  return { connector, got, link: () => link!, handshake: () => handshake, closed: () => closed };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the socket', () => {
  it('connects a turn after io(), then the server speaks', () => {
    const { defer, turn } = loop();
    const srv = recorder();
    const io = createSocketIo(srv.connector, defer);
    const events: unknown[] = [];
    const s = io({ auth: { data: { type: 'auth' } }, query: { shardkey: 'k' } });
    s.on('connect', () => events.push('connect'));
    s.on('message', (m) => events.push(m));
    expect(s.connected).toBe(false);
    expect(events).toEqual([]);
    turn();
    expect(s.connected).toBe(true);
    expect(events).toEqual(['connect', { type: 'license' }]);
    expect(srv.handshake()).toEqual({ auth: { data: { type: 'auth' } }, query: { shardkey: 'k' } });
  });

  it('holds what the editor sends before it is connected, and sends it after', () => {
    const { defer, turn } = loop();
    const srv = recorder();
    const s = createSocketIo(srv.connector, defer)({ autoConnect: false });
    s.emit('message', { type: 'auth' });
    turn();
    expect(srv.got).toEqual([]);
    s.connect();
    turn();
    expect(srv.got).toEqual([{ type: 'auth' }]);
  });

  it('never answers inside the call that asked', () => {
    const { defer, turn } = loop();
    const order: string[] = [];
    const connector: ShimConnector = (link) => ({
      connect: () => {},
      fromEditor: () => link.deliver({ type: 'saveLock', saveLock: false }),
    });
    const s = createSocketIo(connector, defer)({});
    s.on('message', () => order.push('answer'));
    turn();
    s.emit('message', { type: 'isSaveLock' });
    order.push('emit returned');
    turn();
    expect(order).toEqual(['emit returned', 'answer']);
  });

  it('passes copies, the way a wire does', () => {
    const { defer, turn } = loop();
    const srv = recorder();
    const s = createSocketIo(srv.connector, defer)({});
    const got: ServerMessage[] = [];
    s.on('message', (m) => got.push(m as ServerMessage));
    turn();
    const sent = { type: 'getLock', block: ['p1'] as string[] };
    s.emit('message', sent);
    sent.block.push('changed after sending');
    turn();
    expect(srv.got).toEqual([{ type: 'getLock', block: ['p1'] }]);
    const answer = { type: 'getLock', locks: { p1: { user: 'u1-1' } } };
    srv.link().deliver(answer);
    answer.locks.p1.user = 'changed after sending';
    turn();
    expect(got[got.length - 1]).toEqual({ type: 'getLock', locks: { p1: { user: 'u1-1' } } });
  });

  it('a disconnect from either side is the editor\'s disconnect event, and the old link goes quiet', () => {
    const { defer, turn } = loop();
    const srv = recorder();
    const io = createSocketIo(srv.connector, defer);
    const a = io({});
    const reasons: unknown[] = [];
    const messages: unknown[] = [];
    a.on('disconnect', (r) => reasons.push(r));
    a.on('message', (m) => messages.push(m));
    turn();
    const oldLink = srv.link();
    a.disconnect();
    expect(srv.closed()).toBe(1);
    oldLink.deliver({ type: 'late' });
    turn();
    expect(reasons).toEqual(['io client disconnect']);
    expect(messages).toEqual([{ type: 'license' }]);

    const b = io({});
    b.on('disconnect', (r) => reasons.push(r));
    turn();
    srv.link().close();
    turn();
    expect(reasons).toEqual(['io client disconnect', 'io server disconnect']);
    expect(b.connected).toBe(false);
  });

  it('has the manager the editor reaches for', () => {
    const { defer } = loop();
    const s = createSocketIo(recorder().connector, defer)({ transports: ['websocket', 'polling'] });
    expect(s.io.on('reconnect_failed', () => {})).toBe(s.io);
    expect(s.io.reconnectionAttempts()).toBe(s.io);
    expect(s.io.reconnectionDelay()).toBe(s.io);
    expect(s.io.reconnectionDelayMax()).toBe(s.io);
    expect(s.io.opts.transports).toEqual(['websocket', 'polling']);
  });

  it('a handler that throws does not stop the socket', () => {
    vi.useFakeTimers();
    const { defer, turn } = loop();
    const srv = recorder();
    const s = createSocketIo(srv.connector, defer)({});
    const seen: unknown[] = [];
    let first = true;
    s.on('message', (m) => {
      if (first) {
        first = false;
        throw new Error('editor bug');
      }
      seen.push(m);
    });
    turn();
    srv.link().deliver({ type: 'auth' });
    turn();
    expect(seen).toEqual([{ type: 'auth' }]);
    // The error is thrown again on a turn of its own.
    expect(vi.getTimerCount()).toBe(1);
    vi.clearAllTimers();
  });
});

describe('installSocketIo', () => {
  it('is window.io, and the AMD module the editor\'s loader asks for', () => {
    const io = createSocketIo(recorder().connector);
    expect(io.connect).toBe(io);
    const plain: { io?: unknown } = {};
    installSocketIo(plain, io);
    expect(plain.io).toBe(io);

    const define = Object.assign(vi.fn(), { amd: {} });
    const amd: { io?: unknown; define?: unknown } = { define };
    installSocketIo(amd, io);
    expect(amd.io).toBe(io);
    expect(define).toHaveBeenCalledTimes(1);
    const factory = define.mock.calls[0][0] as () => unknown;
    expect(factory()).toBe(io);
  });
});

describe('the editor, the shim and the bridge', () => {
  it('open the document the way the editor expects it', () => {
    const { defer, turn } = loop();
    const me: BridgeMember = { client: 'c1', user: 'u1-', name: 'Ayşe', indexUser: 1, canEdit: true };
    let bridge: OfficeBridge;
    const port = new BridgeSocketPort(() => bridge);
    bridge = new OfficeBridge({
      me,
      editorType: EDITOR_TYPE.document,
      build: { version: '9.4.0', number: 129 },
      documentUrls: { 'Editor.bin': 'blob:base' },
      host: { toEditor: port.toEditor, append: () => {}, lease: () => {}, cursor: () => {}, save: () => {} },
    });
    bridge.onEntry({ seq: 1, at: 1, client: 'c1', kind: 'join', member: me });
    bridge.start();

    const socket = createSocketIo(port.connector, defer)({});
    const got: ServerMessage[] = [];
    socket.on('connect', () => socket.emit('message', { type: 'auth' }));
    socket.on('message', (m) => got.push(m as ServerMessage));
    turn();
    expect(got.map((m) => m.type)).toEqual(['license', 'auth', 'documentOpen']);

    port.close();
    turn();
    expect(socket.connected).toBe(false);
  });
});
