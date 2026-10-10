// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for filex-office-editor (see README.md and NOTICE).
//
// Editing together (filex 0.56), the app page's half (src/app/together.ts):
// joining or editing alone, the base, the log on its way to the editor page
// (an image another member inserted ahead of the change that shows it), the
// editor page's appends, lease and cursor on their way to filex, and who is
// told "unsaved changes". filex is a stand-in with its protocol (filex
// docs/APP-PLUGINS-API.md → Editing together).
import { describe, expect, it } from 'vitest';

import type { CoEditApi } from '../src/app/coedit-client';
import { ALONE_CODES, codeOf } from '../src/app/coedit-client';
import { CURSOR_EVERY_MS, MEDIA_TRIES_MS, Together, joinSession } from '../src/app/together';
import type { CoEditCursor, CoEditDropped, CoEditHello, CoEditMember } from '../src/coedit';
import { EDITOR_USER_ID, type ToFrame } from '../src/frame-protocol';

const T = 1_700_000_000_000;

class Refusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

/** filex, as far as the app page talks to it. */
class Filex implements CoEditApi {
  joins: (CoEditHello | Refusal)[] = [];
  calls: string[] = [];
  blobs = new Map<string, ArrayBuffer>();
  /** How many times a blob is asked for before it is there (an upload under way). */
  missing = new Map<string, number>();
  appendRefusal: Refusal | null = null;
  leaseAnswer = true;
  cursors: unknown[] = [];
  saves: { size: number; mime: string; through: number }[] = [];
  private entry: ((e: unknown) => void) | null = null;
  private cursorH: ((c: CoEditCursor) => void) | null = null;
  private droppedH: ((d: CoEditDropped) => void) | null = null;

  async join(): Promise<CoEditHello> {
    this.calls.push('join');
    const next = this.joins.shift();
    if (!next) throw new Refusal('unavailable', '');
    if (next instanceof Refusal) throw next;
    return next;
  }
  async subscribe(from: number): Promise<void> {
    this.calls.push(`subscribe ${from}`);
  }
  async append(kind: string): Promise<{ seq: number }> {
    this.calls.push(`append ${kind}`);
    if (this.appendRefusal) throw this.appendRefusal;
    return { seq: 1 };
  }
  async lease(op: string, seen: number): Promise<boolean> {
    this.calls.push(`lease ${op} ${seen}`);
    return this.leaseAnswer;
  }
  cursor(c: unknown): void {
    this.cursors.push(c);
  }
  async putBlob(name: string, bytes: ArrayBuffer): Promise<void> {
    this.calls.push(`put ${name}`);
    this.blobs.set(name, bytes);
  }
  async getBlob(name: string): Promise<ArrayBuffer> {
    this.calls.push(`get ${name}`);
    const left = this.missing.get(name) ?? 0;
    if (left > 0) {
      this.missing.set(name, left - 1);
      throw new Refusal('not_found', 'not_found');
    }
    const b = this.blobs.get(name);
    if (!b) throw new Refusal('not_found', 'not_found');
    return b.slice(0);
  }
  async leave(): Promise<void> {
    this.calls.push('leave');
  }
  async save(bytes: ArrayBuffer, mime: string, through: number): Promise<void> {
    this.saves.push({ size: bytes.byteLength, mime, through });
  }
  onEntry(h: (e: unknown) => void) {
    this.entry = h;
    return () => {
      this.entry = null;
    };
  }
  onCursor(h: (c: CoEditCursor) => void) {
    this.cursorH = h;
    return () => {
      this.cursorH = null;
    };
  }
  onDropped(h: (d: CoEditDropped) => void) {
    this.droppedH = h;
    return () => {
      this.droppedH = null;
    };
  }
  /** filex hands the next entry over. */
  give(e: unknown): void {
    this.entry?.(e);
  }
  cursorEvent(c: CoEditCursor): void {
    this.cursorH?.(c);
  }
  drop(d: CoEditDropped): void {
    this.droppedH?.(d);
  }
  get listening(): boolean {
    return !!this.entry || !!this.cursorH || !!this.droppedH;
  }
}

const member = (n: number, canEdit = true): CoEditMember => ({ client: `c${n}`, user: `u${n}`, name: `Kişi ${n}`, indexUser: n, canEdit });
const hello = (n: number, created: boolean): CoEditHello => ({ session: 's1', me: member(n), head: 0, changesHead: 0, savedThrough: 0, created });
const join = (seq: number, n: number, canEdit = true) => ({ seq, at: T + seq, client: `c${n}`, kind: 'join', member: member(n, canEdit) });
const changes = (seq: number, n: number, list: unknown[] = ['x'], at = T + seq) => ({
  seq,
  at,
  client: `c${n}`,
  kind: 'changes',
  body: { changes: list, start: true, end: true, deleteIndex: null, releaseLocks: false, excel: false, coAuthoring: true, excelInfo: null },
});

function setup(n = 1, created = true, o: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  const fx = new Filex();
  const frame: { m: ToFrame; transfer?: Transferable[] }[] = [];
  const dropped: CoEditDropped[] = [];
  const refused: string[] = [];
  let changed = 0;
  const t = new Together({
    api: fx,
    hello: hello(n, created),
    onChange: () => changed++,
    onDropped: (d) => dropped.push(d),
    onRefused: (k, c) => refused.push(`${k}:${c}`),
    now: o.now,
    sleep: o.sleep ?? (async () => {}),
  });
  return { fx, t, frame, dropped, refused, changed: () => changed, attach: () => t.attach((m, transfer) => frame.push({ m, transfer })) };
}

describe('joining', () => {
  it('filex offers editing together: the hello, `created` as filex says it', async () => {
    const fx = new Filex();
    fx.joins.push(hello(1, true));
    const r = await joinSession(fx, async () => {});
    expect(r).toEqual({ ok: true, hello: hello(1, true) });
  });

  it('filex offers none here (an older filex, no grant, a vault): alone, and nobody is told', async () => {
    for (const code of ALONE_CODES) {
      const fx = new Filex();
      fx.joins.push(new Refusal(code, code));
      const r = await joinSession(fx, async () => {});
      expect(r).toMatchObject({ ok: false, code, expected: true });
    }
  });

  it('the starter has not put the base yet ("not_ready"): asked again, then alone and said', async () => {
    const fx = new Filex();
    fx.joins.push(new Refusal('unavailable', 'not_ready'), hello(2, false));
    const waits: number[] = [];
    const r = await joinSession(fx, async (ms) => {
      waits.push(ms);
    });
    expect(r).toMatchObject({ ok: true });
    expect(waits.length).toBe(1);
    const fx2 = new Filex();
    fx2.joins.push(new Refusal('unavailable', 'not_ready'), new Refusal('unavailable', 'not_ready'), new Refusal('unavailable', 'not_ready'));
    const r2 = await joinSession(fx2, async () => {});
    expect(r2).toMatchObject({ ok: false, message: 'not_ready', expected: false });
    expect(fx2.calls.filter((c) => c === 'join').length).toBe(3);
  });

  it('a failure that is not filex\'s "no": alone, and the person is told', async () => {
    const fx = new Filex();
    fx.joins.push(new Refusal('failed', 'failed'));
    expect(await joinSession(fx, async () => {})).toMatchObject({ ok: false, code: 'failed', expected: false });
    expect(codeOf(new Refusal('failed', 'x'))).toBe('failed');
  });
});

describe('the base', () => {
  it('the starter puts exactly the bytes it opened, and opens them', async () => {
    const { fx, t } = setup(1, true);
    const opened = new Uint8Array([80, 75, 3, 4, 1, 2]).buffer;
    const bytes = await t.base(async () => opened);
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([80, 75, 3, 4, 1, 2]));
    expect(new Uint8Array(fx.blobs.get('base')!)).toEqual(new Uint8Array([80, 75, 3, 4, 1, 2]));
  });

  it('everybody else opens the base, never the file', async () => {
    const { fx, t } = setup(2, false);
    fx.blobs.set('base', new Uint8Array([9, 9]).buffer);
    let read = 0;
    const bytes = await t.base(async () => {
      read++;
      return new ArrayBuffer(0);
    });
    expect(read).toBe(0);
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([9, 9]));
  });

  it("the editor's user id is the member's", () => {
    const { t } = setup(3, false);
    expect(t.me.user).toBe(`${EDITOR_USER_ID}u3-`);
    expect(t.me.client).toBe('c3');
  });
});

describe('the log, on its way to the editor page', () => {
  it('subscribes from the first entry once the editor page has the document, and hands entries over in order', async () => {
    const { fx, t, frame, attach } = setup();
    await attach();
    expect(fx.calls).toContain('subscribe 0');
    fx.give(join(1, 1));
    fx.give(changes(2, 1));
    await settle();
    expect(frame.map((f) => f.m.t)).toEqual(['co-entry', 'co-entry']);
    expect((frame[0].m as { entry: { member: { user: string } } }).entry.member.user).toBe(`${EDITOR_USER_ID}u1-`);
    expect(t.unsaved).toBe(true);
  });

  it('an image another member inserted goes ahead of the change that shows it, fetched while its upload may still be under way', async () => {
    const waits: number[] = [];
    const { fx, frame, attach } = setup(1, true, {
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await attach();
    const name = 'image_fx0123456789abcdef.png';
    fx.blobs.set(`m.${name}`, new Uint8Array([137, 80, 78, 71]).buffer);
    fx.missing.set(`m.${name}`, 2);
    fx.give(join(1, 1));
    fx.give(join(2, 2));
    fx.give(changes(3, 2, [`{"img":"media/${name}"}`]));
    await settle();
    expect(frame.map((f) => f.m.t)).toEqual(['co-entry', 'co-entry', 'co-media', 'co-entry']);
    const media = frame[2].m as { name: string; bytes: ArrayBuffer };
    expect(media.name).toBe(name);
    expect(new Uint8Array(media.bytes)).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(frame[2].transfer).toEqual([media.bytes]);
    expect(waits).toEqual(MEDIA_TRIES_MS.slice(1, 3));
    // Once handed over, the next change that shows it does not fetch it again.
    fx.give(changes(4, 2, [`media/${name}`]));
    await settle();
    expect(frame.map((f) => f.m.t).slice(4)).toEqual(['co-entry']);
  });

  it("an image that never comes: the change goes on without it, and it is said - the others' document does not stall", async () => {
    const { fx, frame, attach } = setup();
    await attach();
    fx.give(join(1, 1));
    fx.give(changes(2, 2, ['media/image_fxfedcba9876543210.jpg']));
    await settle();
    expect(frame.map((f) => f.m.t)).toEqual(['co-entry', 'co-entry']);
    expect(fx.calls.filter((c) => c.startsWith('get m.')).length).toBe(MEDIA_TRIES_MS.length);
  });

  it("the base's images and this member's own are not fetched", async () => {
    const { fx, t, frame, attach } = setup();
    await attach();
    t.haveMedia(['image_fx1111111111111111.png']);
    t.fromFrame({ t: 'co-media-put', name: 'image_fx2222222222222222.png', bytes: new Uint8Array([1]).buffer });
    await settle();
    fx.give(join(1, 1));
    fx.give(changes(2, 1, ['media/image_fx1111111111111111.png', 'media/image_fx2222222222222222.png']));
    await settle();
    expect(fx.calls.filter((c) => c.startsWith('get '))).toEqual([]);
    expect(frame.filter((f) => f.m.t === 'co-media')).toEqual([]);
  });

  it('an entry the bridge cannot take stops editing together ("broken")', async () => {
    const { fx, frame, dropped, attach } = setup();
    await attach();
    fx.give({ seq: 1, at: T, client: 'c1', kind: 'exec' });
    fx.give(join(2, 1));
    await settle();
    expect(dropped).toEqual([{ from: 0, reason: 'broken' }]);
    expect(frame).toEqual([]);
  });

  it("filex drops the member: told once, and nothing more goes to the editor page", async () => {
    const { fx, frame, dropped, attach } = setup();
    await attach();
    fx.drop({ from: 3, reason: 'gone' });
    fx.drop({ from: 3, reason: 'gone' });
    fx.give(join(1, 1));
    await settle();
    expect(dropped).toEqual([{ from: 3, reason: 'gone' }]);
    expect(frame).toEqual([]);
  });
});

describe("the editor page's messages", () => {
  it('appends go to filex; a refusal goes back to the editor page and is said', async () => {
    const { fx, t, frame, refused, attach } = setup();
    await attach();
    expect(t.fromFrame({ t: 'co-append', append: { kind: 'lock', body: { blocks: ['p'] } } })).toBe(true);
    await settle();
    expect(fx.calls).toContain('append lock');
    fx.appendRefusal = new Refusal('failed', 'log_full');
    t.fromFrame({ t: 'co-append', append: { kind: 'release', body: { deleteIndex: null, locks: true } } });
    await settle();
    expect(frame.map((f) => f.m)).toContainEqual({ t: 'co-refused', kind: 'release', code: 'log_full' });
    expect(refused).toEqual(['release:log_full']);
  });

  it("a lease acquire is answered with filex's answer, its id kept; a release is not answered", async () => {
    const { fx, t, frame, attach } = setup();
    await attach();
    fx.leaseAnswer = false;
    t.fromFrame({ t: 'co-lease', id: 7, op: 'acquire', seen: 4 });
    t.fromFrame({ t: 'co-lease', id: 8, op: 'release', seen: 4 });
    await settle();
    expect(fx.calls).toEqual(expect.arrayContaining(['lease acquire 4', 'lease release 4']));
    expect(frame.map((f) => f.m)).toEqual([{ t: 'co-lease-answer', id: 7, granted: false }]);
  });

  it('an image this member inserted is kept with the session, and the editor page is told', async () => {
    const { fx, t, frame, attach } = setup();
    await attach();
    t.fromFrame({ t: 'co-media-put', name: 'image_fx0123456789abcdef.png', bytes: new Uint8Array([5]).buffer });
    await settle();
    expect(fx.blobs.has('m.image_fx0123456789abcdef.png')).toBe(true);
    expect(frame.map((f) => f.m)).toEqual([{ t: 'co-media-stored', name: 'image_fx0123456789abcdef.png', ok: true }]);
  });

  it('cursors: the latest one, at most every CURSOR_EVERY_MS; the others\' come back to the editor page, its own not', async () => {
    const { fx, t, frame, attach } = setup();
    await attach();
    t.fromFrame({ t: 'co-cursor', cursor: 1 });
    t.fromFrame({ t: 'co-cursor', cursor: 2 });
    t.fromFrame({ t: 'co-cursor', cursor: 3 });
    await new Promise((r) => setTimeout(r, CURSOR_EVERY_MS + 50));
    expect(fx.cursors).toEqual([3]);
    fx.cursorEvent({ client: 'c2', cursor: 'p-9' });
    fx.cursorEvent({ client: 'c1', cursor: 'mine' });
    expect(frame.map((f) => f.m)).toEqual([{ t: 'co-cursor-in', client: 'c2', cursor: 'p-9' }]);
    t.dispose();
  });

  it('what is not a session message is not taken', () => {
    const { t } = setup();
    expect(t.fromFrame({ t: 'save' })).toBe(false);
  });
});

describe('who is told "unsaved changes", who saves', () => {
  it('the last writer only; the saver is the writer who joined first', async () => {
    const { fx, t, attach } = setup(2, false);
    await attach();
    fx.give(join(1, 1));
    fx.give(join(2, 2));
    fx.give(changes(3, 1));
    await settle();
    expect(t.unsaved).toBe(true);
    expect(t.lastWriter).toBe(false);
    expect(t.saver).toBe(false);
    fx.give({ seq: 4, at: T, client: 'c1', kind: 'leave' });
    await settle();
    expect(t.lastWriter).toBe(true);
    expect(t.saver).toBe(true);
  });

  it("the ten-minute version is the saver's, on the relay's clock", async () => {
    let local = 5_000;
    const { fx, t, attach } = setup(1, true, { now: () => local });
    await attach();
    fx.give(join(1, 1));
    fx.give(changes(2, 1, ['x'], T));
    await settle();
    expect(t.autosaveDue()).toBe(false);
    local += 10 * 60 * 1000;
    expect(t.autosaveDue()).toBe(true);
  });

  it('a save goes to filex with how far into the log it reaches', async () => {
    const { fx, t } = setup();
    await t.saveFile(new Uint8Array([1, 2, 3]).buffer, 'application/x', 9);
    expect(fx.saves).toEqual([{ size: 3, mime: 'application/x', through: 9 }]);
  });

  it('leaving: once, and nothing is listened to after', async () => {
    const { fx, t, attach } = setup();
    await attach();
    await t.leave();
    await t.leave();
    expect(fx.calls.filter((c) => c === 'leave')).toEqual(['leave']);
    expect(fx.listening).toBe(false);
    expect(t.active).toBe(false);
  });
});
