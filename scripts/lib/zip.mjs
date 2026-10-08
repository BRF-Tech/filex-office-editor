// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// A small zip reader and writer, with nothing but node:zlib: the bundle
// build writes the editor's zip with it, scripts/fetch-x2t.mjs opens
// CryptPad's x2t.zip with it, and the tests build and read office
// documents (which are zips) with it.
//
// The writer is REPRODUCIBLE: the same files give the same bytes - entries
// sorted by name, one fixed date, fixed attributes, no extra fields, no
// directory entries. A file is deflated (level 9) unless deflating does not
// make it smaller, then it is stored. Deflate's bytes depend on the zlib that
// makes them, so a build that has to match another one runs in the same
// pinned Node image (scripts/extract-editor.sh says which).
//
// Limits: no zip64 (fewer than 65,535 entries, under 4 GiB), no encryption,
// methods 0 (stored) and 8 (deflate) only - all a bundle filex accepts uses.

import zlib from 'node:zlib';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
// 1980-01-01 00:00:00, the earliest date a zip can hold.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
// Bit 11: the name is UTF-8.
const FLAG_UTF8 = 0x0800;

let table = null;
function crc32js(data) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** CRC-32 of a buffer (zlib's when Node has it, the same numbers otherwise). */
export function crc32(data) {
  return typeof zlib.crc32 === 'function' ? zlib.crc32(data) >>> 0 : crc32js(data);
}

/** Byte order of the names' UTF-8, which is how the entries are sorted. */
export function compareNames(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Writes a zip. `files` is [{ name, data }] (data a Buffer or Uint8Array);
 * `options.store` stores every file. Throws on a duplicate or unsafe name.
 */
export function writeZip(files, options = {}) {
  const sorted = [...files].sort((a, b) => compareNames(a.name, b.name));
  if (sorted.length >= 0xffff) throw new Error(`zip: ${sorted.length} entries need zip64, which this writer does not do`);
  const parts = [];
  const central = [];
  let offset = 0;
  let prev = null;
  for (const f of sorted) {
    const name = Buffer.from(f.name, 'utf8');
    if (prev !== null && f.name === prev) throw new Error(`zip: ${f.name} twice`);
    prev = f.name;
    if (!f.name || f.name.startsWith('/') || f.name.includes('\\') || f.name.split('/').some((s) => s === '' || s === '.' || s === '..')) {
      throw new Error(`zip: unsafe name ${JSON.stringify(f.name)}`);
    }
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength);
    const crc = crc32(data);
    let method = 0;
    let body = data;
    if (!options.store && data.length > 0) {
      const z = zlib.deflateRawSync(data, { level: 9 });
      if (z.length < data.length) {
        method = 8;
        body = z;
      }
    }
    if (offset + 30 + name.length + body.length > 0xffffffff) throw new Error('zip: over 4 GiB needs zip64');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(CENTRAL, 0);
    // Made by: Unix (3), spec 3.0 - so the attributes below are read as Unix ones.
    c.writeUInt16LE((3 << 8) | 30, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(FLAG_UTF8, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(DOS_TIME, 12);
    c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    // A regular file, rw-r--r--.
    c.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, end]);
}

/**
 * Reads a zip's central directory: [{ name, method, size, compressedSize,
 * crc, isDir, mode, read() }]. read() inflates the entry and checks its size
 * and CRC. Refuses zip64, encryption and methods other than 0 and 8.
 */
export function readZip(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (b.readUInt32LE(i) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('zip: no end of central directory (not a zip)');
  const count = b.readUInt16LE(end + 10);
  const cdSize = b.readUInt32LE(end + 12);
  const cdOffset = b.readUInt32LE(end + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new Error('zip: zip64 is not supported');
  if (cdOffset + cdSize > end) throw new Error('zip: central directory out of range');
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(p) !== CENTRAL) throw new Error('zip: bad central directory entry');
    const madeBy = b.readUInt16LE(p + 4);
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const compressedSize = b.readUInt32LE(p + 20);
    const size = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const external = b.readUInt32LE(p + 38);
    const localOffset = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString(flags & FLAG_UTF8 ? 'utf8' : 'latin1');
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error(`zip: ${name} is encrypted`);
    const unixMode = madeBy >> 8 === 3 ? external >>> 16 : 0;
    const isDir = name.endsWith('/');
    entries.push({
      name,
      method,
      size,
      compressedSize,
      crc,
      isDir,
      mode: unixMode,
      read() {
        if (b.readUInt32LE(localOffset) !== LOCAL) throw new Error(`zip: bad local header for ${name}`);
        const lName = b.readUInt16LE(localOffset + 26);
        const lExtra = b.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + lName + lExtra;
        const raw = b.subarray(start, start + compressedSize);
        let data;
        if (method === 0) data = Buffer.from(raw);
        else if (method === 8) data = zlib.inflateRawSync(raw);
        else throw new Error(`zip: ${name} uses method ${method}`);
        if (data.length !== size) throw new Error(`zip: ${name} is ${data.length} bytes, its header says ${size}`);
        if (crc32(data) !== crc) throw new Error(`zip: ${name} fails its CRC`);
        return data;
      },
    });
  }
  return entries;
}
