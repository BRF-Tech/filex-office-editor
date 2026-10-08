// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The editor's socket.io, replaced.
//
// sdkjs opens its Document Server connection with `AscCommon.getSocketIO()`,
// which takes `window.io` when there is one and the bundled socket.io client
// otherwise (common/editorscommon.js). The editor's page loads that client
// from web-apps/vendor/socketio/socket.io.min.js. Serving this shim at that
// path, and nothing else changed, gives the editor a socket that never leaves
// the frame: it is plugged into the bridge. The editor's own files stay
// exactly as ONLYOFFICE ships them.
//
// The shim speaks the part of socket.io the editor uses (docscoapi.js
// _initSocksJs): on('connect' | 'disconnect' | 'connect_error' | 'message'),
// emit('message', data), connect(), disconnect(), and the manager's on(),
// opts and reconnection setters. Messages cross it as JSON, a turn later,
// the way they cross a real socket: neither side keeps a reference into the
// other's objects, and no answer arrives inside the call that asked.

import type { EditorMessage, ServerMessage } from './protocol';

/** The server side of one socket. */
export interface ShimServer {
  /** The socket connected. */
  connect(): void;
  /** A message from the editor. */
  fromEditor(msg: EditorMessage): void;
  /** The editor closed its socket. */
  disconnect?(): void;
}

/** What the server side gets back: the way to the editor. */
export interface EditorLink {
  deliver(msg: ServerMessage): void;
  /** The server ends the connection ("io server disconnect"). */
  close(): void;
}

/** Builds the server side when the editor's socket connects. */
export type ShimConnector = (link: EditorLink, handshake: { auth?: unknown; query?: unknown }) => ShimServer;

/** When queued work runs (a turn later by default; tests run it by hand). */
export type Defer = (run: () => void) => void;

type Handler = (...args: unknown[]) => void;

const defaultDefer: Defer = (run) => {
  setTimeout(run, 0);
};

/** A copy as JSON makes it: what a socket would deliver. */
function wire<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

class Handlers {
  private readonly map = new Map<string, Handler[]>();

  on(ev: string, fn: Handler): void {
    const list = this.map.get(ev) ?? [];
    list.push(fn);
    this.map.set(ev, list);
  }

  off(ev: string, fn?: Handler): void {
    if (!fn) {
      this.map.delete(ev);
      return;
    }
    this.map.set(
      ev,
      (this.map.get(ev) ?? []).filter((h) => h !== fn),
    );
  }

  fire(ev: string, ...args: unknown[]): void {
    for (const fn of [...(this.map.get(ev) ?? [])]) fn(...args);
  }
}

/** The manager (socket.io's `socket.io`): reconnection is moot, the rest is accepted. */
export class ShimManager {
  private readonly handlers = new Handlers();

  constructor(readonly opts: Record<string, unknown>) {}

  on(ev: string, fn: Handler): this {
    this.handlers.on(ev, fn);
    return this;
  }

  off(ev: string, fn?: Handler): this {
    this.handlers.off(ev, fn);
    return this;
  }

  reconnectionAttempts(): this {
    return this;
  }

  reconnectionDelay(): this {
    return this;
  }

  reconnectionDelayMax(): this {
    return this;
  }

  randomizationFactor(): this {
    return this;
  }
}

/** One socket, plugged into a ShimServer instead of a network. */
export class ShimSocket {
  connected = false;
  id = '';
  /** socket.io-client keeps the handshake's auth here; docscoapi writes its token into it. */
  auth: Record<string, unknown>;
  readonly io: ShimManager;
  private readonly handlers = new Handlers();
  private server: ShimServer | null = null;
  private connecting = false;
  private readonly outbox: unknown[] = [];
  private readonly queue: (() => void)[] = [];
  private draining = false;

  constructor(
    private readonly connector: ShimConnector,
    opts: Record<string, unknown>,
    private readonly defer: Defer = defaultDefer,
  ) {
    this.io = new ShimManager(opts);
    const auth = opts.auth;
    this.auth = auth && typeof auth === 'object' ? (auth as Record<string, unknown>) : {};
  }

  get disconnected(): boolean {
    return !this.connected;
  }

  on(ev: string, fn: Handler): this {
    this.handlers.on(ev, fn);
    return this;
  }

  off(ev: string, fn?: Handler): this {
    this.handlers.off(ev, fn);
    return this;
  }

  /** emit('message', data): to the server, a turn later. Before the socket connects it waits, as socket.io buffers. */
  emit(ev: string, data?: unknown): this {
    // The editor sends objects only (docscoapi _send); anything else would
    // not survive the copy below either.
    if (ev !== 'message' || data === null || typeof data !== 'object') return this;
    if (!this.connected) {
      this.outbox.push(data);
      return this;
    }
    this.toServer(data);
    return this;
  }

  /** Alias socket.io-client has. */
  send(data?: unknown): this {
    return this.emit('message', data);
  }

  connect(): this {
    if (this.connected || this.connecting) return this;
    this.connecting = true;
    this.post(() => {
      this.connecting = false;
      const link: EditorLink = {
        deliver: (msg) => {
          // Copied now: what the server changes after sending is not on the wire.
          const copy = wire(msg);
          this.post(() => {
            if (this.server === server) this.handlers.fire('message', copy);
          });
        },
        close: () => this.post(() => {
          if (this.server === server) this.drop('io server disconnect');
        }),
      };
      const server = this.connector(link, { auth: this.auth, query: this.io.opts.query });
      this.server = server;
      this.connected = true;
      this.id = 'filex-office-e2e';
      this.handlers.fire('connect');
      server.connect();
      for (const data of this.outbox.splice(0)) this.toServer(data);
    });
    return this;
  }

  open(): this {
    return this.connect();
  }

  disconnect(): this {
    if (!this.connected) return this;
    this.server?.disconnect?.();
    this.drop('io client disconnect');
    return this;
  }

  close(): this {
    return this.disconnect();
  }

  private drop(reason: string): void {
    this.server = null;
    this.connected = false;
    this.handlers.fire('disconnect', reason);
  }

  private toServer(data: unknown): void {
    const server = this.server;
    const msg = wire(data) as EditorMessage;
    this.post(() => {
      if (this.server === server && server) server.fromEditor(msg);
    });
  }

  /**
   * Run in order, a turn later. A handler that throws does not stop the
   * socket: its error is thrown again on a turn of its own, where it shows,
   * and the queue goes on.
   */
  private post(run: () => void): void {
    this.queue.push(run);
    if (this.draining) return;
    this.draining = true;
    this.defer(() => {
      try {
        while (this.queue.length > 0) {
          const next = this.queue.shift();
          try {
            next?.();
          } catch (err) {
            setTimeout(() => {
              throw err;
            }, 0);
          }
        }
      } finally {
        this.draining = false;
      }
    });
  }
}

/** The `io` function the editor calls: io(options) gives a socket that connects at once. */
export type ShimIo = ((opts?: Record<string, unknown>) => ShimSocket) & { connect: (opts?: Record<string, unknown>) => ShimSocket };

export function createSocketIo(connector: ShimConnector, defer?: Defer): ShimIo {
  const io = (opts?: Record<string, unknown>): ShimSocket => {
    const o = opts ?? {};
    const s = new ShimSocket(connector, o, defer);
    if (o.autoConnect !== false) s.connect();
    return s;
  };
  return Object.assign(io, { connect: io });
}

/** The global the editor's frame finds the connector under, on its parent (the bridge's frame). */
export const SHIM_GLOBAL = '__filexOfficeE2e';

interface ShimWindow {
  io?: unknown;
  define?: unknown;
}

/** The RequireJS loader plugin installSocketIo defines to hold the module back (see there). */
export const WAIT_PLUGIN = 'filex-office-editor-wait';

type AmdDefine = ((...args: unknown[]) => void) & { amd?: unknown };

/**
 * Put `io` where the editor looks: window.io, and as the AMD module the
 * editor's loader asks for (socket.io.min.js is a UMD module).
 *
 * With `ready`, the module is given only once `ready` settles. The editor's
 * pages load the "socketio" module before anything of the editor runs (it is
 * a dependency of sdkjs in their RequireJS configuration), so holding it
 * holds the editor's start - which is how the editor page gets its kept
 * settings (settings.ts) into its storage before the editor reads them. The
 * hold is a loader plugin (RequireJS's way to wait for something that is not
 * a script), defined by name in this same script.
 */
export function installSocketIo(win: ShimWindow, io: ShimIo, ready?: Promise<unknown>): void {
  win.io = io;
  const define = win.define as AmdDefine;
  if (typeof define !== 'function' || !define.amd) return;
  if (!ready) {
    define(() => io);
    return;
  }
  define(WAIT_PLUGIN, [], () => ({
    load: (_name: string, _req: unknown, onload: (value: unknown) => void) => {
      ready.then(
        () => onload(true),
        () => onload(true),
      );
    },
  }));
  define([`${WAIT_PLUGIN}!ready`], () => io);
}

/**
 * A port between one bridge and whichever editor socket is connected: give
 * `toEditor` to the bridge's host and `connector` to createSocketIo.
 */
export class BridgeSocketPort {
  private link: EditorLink | null = null;

  constructor(private readonly server: () => { connect(): void; fromEditor(msg: EditorMessage): void }) {}

  /** For BridgeHost.toEditor: dropped while no editor is connected. */
  readonly toEditor = (msg: ServerMessage): void => {
    this.link?.deliver(msg);
  };

  readonly connector: ShimConnector = (link) => {
    this.link = link;
    const s = this.server();
    return {
      connect: () => s.connect(),
      fromEditor: (msg) => s.fromEditor(msg),
      disconnect: () => {
        if (this.link === link) this.link = null;
      },
    };
  };

  /** End the editor's connection (the session was closed or the right to it revoked). */
  close(): void {
    this.link?.close();
    this.link = null;
  }
}
