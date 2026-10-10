// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor (see README.md and NOTICE).
//
// The documents the browser measurements open, in dist/e2e-docs:
//
//   blank.docx / blank.xlsx / blank.pptx   the bundle's blank documents (what
//                                          filex's New menu makes)
//   tr.docx / tr.xlsx / tr.pptx            the Turkish test documents of the
//                                          x2t smoke test (tests/fixtures/office.ts)
//   formula.odt / formula-nostyle.odt      a formula at the end of a sentence and
//                                          between two words, the frames styled
//                                          as LibreOffice writes them / without
//                                          a style (odtWithFormula)
//   stops.docx                             an OFD package under a .docx name: x2t
//                                          stops on it (ofdPackage)
//
//   node e2e/make-docs.mjs [--ui dist/ui] [--out dist/e2e-docs]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');

export async function makeDocs({ ui = path.join(ROOT, 'dist', 'ui'), out = path.join(ROOT, 'dist', 'e2e-docs') } = {}) {
  mkdirSync(out, { recursive: true });
  for (const ext of ['docx', 'xlsx', 'pptx']) {
    writeFileSync(path.join(out, `blank.${ext}`), readFileSync(path.join(ui, 'editor', 'document-templates', 'new', 'default', `new.${ext}.bin`)));
  }
  // The fixtures are TypeScript: bundled for Node, then imported.
  const r = await build({
    absWorkingDir: ROOT,
    entryPoints: ['tests/fixtures/office.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const mod = path.join(out, '.fixtures.mjs');
  writeFileSync(mod, r.outputFiles[0].text);
  const f = await import(pathToFileURL(mod).href);
  writeFileSync(path.join(out, 'tr.docx'), f.docx());
  writeFileSync(path.join(out, 'tr.xlsx'), f.xlsx());
  writeFileSync(path.join(out, 'tr.pptx'), f.pptx());
  writeFileSync(path.join(out, 'formula.odt'), f.odtWithFormula({ styled: true }));
  writeFileSync(path.join(out, 'formula-nostyle.odt'), f.odtWithFormula({ styled: false }));
  writeFileSync(path.join(out, 'stops.docx'), f.ofdPackage());
  return { out, TR: f.TR, fixtures: f };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < a.length; i++) if (a[i] === '--ui' || a[i] === '--out') o[a[i].slice(2)] = path.resolve(a[++i]);
  makeDocs(o).then((r) => console.log(`documents in ${r.out}`));
}
