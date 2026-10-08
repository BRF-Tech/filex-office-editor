// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Reads the notices a font carries in its own `name` table: the full name
// (name ID 4), the copyright (0), the license (13) and its address (14).
// Several of ONLYOFFICE's core-fonts families ship without a license file;
// the bundle writes these strings beside the fonts instead, so every font
// it hands on travels with its own notice. TrueType, OpenType and
// collections (.ttc, every font in it).

const IDS = { 0: 'copyright', 4: 'name', 13: 'license', 14: 'licenseUrl' };

function decode(buf, platform, encoding) {
  if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10 || encoding === 0))) {
    let s = '';
    for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
    return s;
  }
  if (platform === 1 && encoding === 0) return buf.toString('latin1');
  return null;
}

// Windows English first, then any Windows, then Unicode, then Mac Roman.
function rank(platform, language) {
  if (platform === 3 && language === 0x409) return 0;
  if (platform === 3) return 1;
  if (platform === 0) return 2;
  if (platform === 1 && language === 0) return 3;
  return 9;
}

function readSfnt(b, at) {
  const numTables = b.readUInt16BE(at + 4);
  let name = null;
  for (let i = 0; i < numTables; i++) {
    const r = at + 12 + i * 16;
    if (b.toString('latin1', r, r + 4) === 'name') name = { offset: b.readUInt32BE(r + 8), length: b.readUInt32BE(r + 12) };
  }
  if (!name) return {};
  const t = name.offset;
  const count = b.readUInt16BE(t + 2);
  const strings = t + b.readUInt16BE(t + 4);
  const best = {};
  for (let i = 0; i < count; i++) {
    const r = t + 6 + i * 12;
    const platform = b.readUInt16BE(r);
    const encoding = b.readUInt16BE(r + 2);
    const language = b.readUInt16BE(r + 4);
    const id = b.readUInt16BE(r + 6);
    const len = b.readUInt16BE(r + 8);
    const off = b.readUInt16BE(r + 10);
    const key = IDS[id];
    if (!key) continue;
    const rk = rank(platform, language);
    if (best[key] && best[key].rank <= rk) continue;
    const text = decode(b.subarray(strings + off, strings + off + len), platform, encoding);
    if (text === null) continue;
    best[key] = { rank: rk, text: text.replace(/\s+/g, ' ').trim() };
  }
  const out = {};
  for (const [k, v] of Object.entries(best)) if (v.text) out[k] = v.text;
  return out;
}

/** The notices of every font in a file: [{ name, copyright, license, licenseUrl }]. */
export function fontNotices(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  try {
    if (b.toString('latin1', 0, 4) === 'ttcf') {
      const n = b.readUInt32BE(8);
      const out = [];
      for (let i = 0; i < n; i++) out.push(readSfnt(b, b.readUInt32BE(12 + i * 4)));
      return out;
    }
    return [readSfnt(b, 0)];
  } catch {
    return [];
  }
}
