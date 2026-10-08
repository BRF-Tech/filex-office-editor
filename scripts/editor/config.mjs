// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// Prints what scripts/extract-editor.sh needs to know, one KEY=value a line,
// from the two places that decide it: the pinned release
// (upstream/onlyoffice.json, the weekly upstream watch's pin) and the
// bundle's rules (rules.mjs). The shell script reads no JSON itself.

import { readFileSync } from 'node:fs';

import { PIN_FILE, validatePin } from '../upstream-watch.mjs';
import { FONT_EXCLUDE } from './rules.mjs';

const pin = validatePin(JSON.parse(readFileSync(PIN_FILE, 'utf8')));
const line = (k, v) => {
  if (/[\n=]/.test(k) || /\n/.test(v)) throw new Error(`config: bad value for ${k}`);
  console.log(`${k}=${v}`);
};
line('IMAGE', `${pin.image}@${pin.digest}`);
line('BUILD', pin.build);
line('FONT_EXCLUDE', FONT_EXCLUDE.join(' '));
