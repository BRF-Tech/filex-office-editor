#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
// app for filex (see README.md and NOTICE).
//
// The upstream watch: is there an ONLYOFFICE Docs release newer than the one
// the editor files are taken from (upstream/onlyoffice.json)? The files come
// from ONLYOFFICE's official Document Server image, so the image decides: a
// release counts once docker.io/onlyoffice/documentserver carries it.
// GitHub's release list is read too, for the link and to say when a release
// is announced but its image is not out yet.
//
// When there is a newer release, this opens ONE issue for it, and never a
// second one for the same version - whether the first is open or closed.
// Each issue carries a marker (see marker()) that the next run looks for.
//
//   node scripts/upstream-watch.mjs            what the weekly workflow runs
//   node scripts/upstream-watch.mjs --dry-run  reads everything, opens nothing
//                                              (also DRY_RUN=true)
//
// Environment, all given by GitHub Actions: GITHUB_TOKEN (issues: write),
// GITHUB_REPOSITORY (owner/name), GITHUB_STEP_SUMMARY, and the run's
// GITHUB_SERVER_URL / GITHUB_RUN_ID for the link. No other secret. Without
// GITHUB_REPOSITORY (a dry run on a laptop) the issue list is not read.
//
// Exit 0: up to date, or the issue exists. Exit 1: a source could not be
// read, or the issue could not be opened. The run goes red rather than
// saying "up to date" without knowing.

import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HUB_TAGS =
  'https://hub.docker.com/v2/namespaces/onlyoffice/repositories/documentserver/tags?page_size=100';
const HUB_PAGE = 'https://hub.docker.com/r/onlyoffice/documentserver/tags';
const GITHUB_API = 'https://api.github.com';
const UPSTREAM_REPO = 'ONLYOFFICE/DocumentServer';
const MARK = 'upstream-watch:onlyoffice-docs';
// Docker Hub had 204 tags (3 pages) when this was written; an issue list of
// more than 30 pages is not read half-way, the run fails instead.
const MAX_HUB_PAGES = 20;
const MAX_ISSUE_PAGES = 30;
const LABEL = 'upstream';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PIN_FILE = path.join(here, '..', 'upstream', 'onlyoffice.json');

/**
 * A release tag: "9.4.0", "9.4.0.1" (an image revision: ONLYOFFICE rebuilds
 * an image under a new last number without changing the release) or, on
 * GitHub, "v9.4.0". Anything else - "latest", "9.4", "9.5.0-beta" - is null.
 */
export function parseTag(name) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(name ?? '').trim());
  if (!m) return null;
  return {
    version: [Number(m[1]), Number(m[2]), Number(m[3])],
    revision: m[4] === undefined ? 0 : Number(m[4]),
  };
}

/** Compares two [major, minor, patch] arrays: -1, 0 or 1. */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export const versionString = (v) => v.join('.');

/**
 * The newest release among the image's tags: the highest X.Y.Z, and within
 * it the highest image revision. Moving tags (latest, 9, 9.4), anything that
 * is not all digits and inactive tags are not releases and are skipped.
 */
export function newestRelease(tags) {
  let best = null;
  for (const t of tags) {
    if (t.tag_status && t.tag_status !== 'active') continue;
    if (String(t.name).startsWith('v')) continue;
    const p = parseTag(t.name);
    if (!p) continue;
    const c = best ? compareVersions(p.version, best.version) : 1;
    if (c > 0 || (c === 0 && p.revision > best.revision)) {
      best = { ...p, tag: t.name, digest: t.digest ?? null, updated: t.last_updated ?? null };
    }
  }
  return best;
}

/** Checks upstream/onlyoffice.json and returns it with `parsed` added. */
export function validatePin(pin) {
  const problems = [];
  const p = parseTag(pin?.version);
  if (!p || p.revision !== 0 || String(pin.version).startsWith('v')) {
    problems.push('version must be X.Y.Z');
  }
  const tag = parseTag(pin?.tag);
  if (!tag || String(pin.tag).startsWith('v')) problems.push('tag must be an image tag, X.Y.Z or X.Y.Z.N');
  else if (p && compareVersions(tag.version, p.version) !== 0) problems.push('tag must belong to version');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(pin?.digest ?? ''))) problems.push('digest must be sha256:<64 hex>');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(String(pin?.build ?? ''))) problems.push('build must be X.Y.Z.B');
  else if (p && !String(pin.build).startsWith(`${pin.version}.`)) problems.push('build must belong to version');
  if (!/^v\d+\.\d+\.\d+\.\d+$/.test(String(pin?.source_tag ?? ''))) problems.push('source_tag must be vX.Y.Z.B');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(pin?.pinned ?? ''))) problems.push('pinned must be YYYY-MM-DD');
  if (problems.length) throw new Error(`upstream/onlyoffice.json: ${problems.join('; ')}`);
  return { ...pin, parsed: p };
}

/** The line each issue carries so that no run opens a second one. */
export const marker = (version) => `<!-- ${MARK} ${version} -->`;

export const issueTitle = (version) => `Upstream: ONLYOFFICE Docs ${version} is available`;

/** The issue (open or closed) already opened for this version, or null. */
export function alreadyOpened(issues, version) {
  const m = marker(version);
  const title = issueTitle(version);
  return (
    issues.find(
      (i) => (typeof i.body === 'string' && i.body.includes(m)) || i.title === title,
    ) ?? null
  );
}

export function issueBody({ pin, newest, release, runUrl }) {
  const v = versionString(newest.version);
  const releaseCell =
    release && parseTag(release.tag_name) && compareVersions(parseTag(release.tag_name).version, newest.version) === 0
      ? `[${release.tag_name}](${release.html_url})`
      : `[releases](https://github.com/${UPSTREAM_REPO}/releases)`;
  const lines = [
    `ONLYOFFICE has published **ONLYOFFICE Docs ${v}**. The editor files here are still taken from **${pin.version}** (build ${pin.build}, pinned ${pin.pinned}).`,
    '',
    '| | Pinned (`upstream/onlyoffice.json`) | Newest |',
    '|---|---|---|',
    `| Version | ${pin.version} | ${v} |`,
    `| Image tag | \`${pin.tag}\` | \`${newest.tag}\` |`,
    `| Digest | \`${pin.digest}\` | \`${newest.digest ?? 'unknown'}\` |`,
    `| Release | [${pin.source_tag}](${pin.release}) | ${releaseCell} |`,
    '',
    'Updating is more than changing the pin:',
    '',
    `- [ ] Take the editor files (web-apps, sdkjs, fonts) from \`onlyoffice/documentserver@${newest.digest ?? '<digest>'}\`: read the build number in the image (\`dpkg-query -W onlyoffice-documentserver\`), which is also the source tag (\`vX.Y.Z.B\`) of sdkjs, web-apps, server and core; put the new release in \`upstream/onlyoffice.json\`, run \`bash scripts/extract-editor.sh --update\` and read what changed in \`upstream/editor.lock.json\` (a new inline handler, a new file type or a size over filex's limits stops the build).`,
    `- [ ] Compare \`DocService/sources/DocsCoServer.js\` in ONLYOFFICE/server between \`${pin.source_tag}\` and the new tag: \`src/locks.ts\` carries its lock rules over and must keep matching them.`,
    "- [ ] Compare sdkjs `common/docscoapi.js` (the editor's side of the protocol) for messages `src/bridge.ts` and `src/protocol.ts` do not answer yet.",
    '- [ ] Build x2t from ONLYOFFICE core at the same tag and pin it in the "x2t" entry of `upstream/onlyoffice.json` (`npm run test:x2t` runs the round trips with it).',
    '- [ ] Commit `upstream/onlyoffice.json` (version, build, tag, digest, source_tag, release, pinned) and `upstream/editor.lock.json` in one change; if the HTML change moved (scripts/editor/html.mjs), `CHANGES_DATED` in scripts/editor/rules.mjs and NOTICE get the new date; a CHANGELOG line.',
    '',
    `Opened by the weekly upstream watch${runUrl ? ` ([this run](${runUrl}))` : ''}. It opens one issue per version and never a second one, even after this one is closed.`,
    '',
    marker(v),
  ];
  return lines.join('\n');
}

async function getJson(url, headers = {}, { allow404 = false } = {}) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (allow404 && res.status === 404) return null;
      if (res.ok) return await res.json();
      last = new Error(`${url}: HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, attempt * 5_000));
  }
  throw last;
}

function githubHeaders(token) {
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'filex-office-editor-upstream-watch',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function hubTags() {
  const tags = [];
  let url = HUB_TAGS;
  for (let page = 0; url; page++) {
    if (page >= MAX_HUB_PAGES) throw new Error(`Docker Hub: more than ${MAX_HUB_PAGES} pages of tags`);
    const data = await getJson(url, { 'User-Agent': 'filex-office-editor-upstream-watch' });
    if (!data || !Array.isArray(data.results)) throw new Error('Docker Hub: unexpected answer');
    tags.push(...data.results);
    url = data.next;
  }
  return tags;
}

async function repoIssues(repo, token) {
  const all = [];
  for (let page = 1; ; page++) {
    if (page > MAX_ISSUE_PAGES) {
      throw new Error(`more than ${MAX_ISSUE_PAGES} pages of issues: not reading half the list (a duplicate would follow)`);
    }
    const batch = await getJson(
      `${GITHUB_API}/repos/${repo}/issues?state=all&per_page=100&page=${page}`,
      githubHeaders(token),
    );
    if (!Array.isArray(batch)) throw new Error('GitHub: unexpected answer listing issues');
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

async function openIssue(repo, token, title, body) {
  const post = (payload) =>
    fetch(`${GITHUB_API}/repos/${repo}/issues`, {
      method: 'POST',
      headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  let res = await post({ title, body, labels: [LABEL] });
  if (res.status === 422) res = await post({ title, body });
  if (!res.ok) throw new Error(`opening the issue: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const dryRun = process.argv.includes('--dry-run') || /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? '');
  const token = process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPOSITORY || '';
  const runUrl =
    process.env.GITHUB_SERVER_URL && repo && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '';
  const summary = [];
  const say = (line = '') => {
    summary.push(line);
    console.log(line);
  };

  const pin = validatePin(JSON.parse(await readFile(PIN_FILE, 'utf8')));
  const tags = await hubTags();
  const newest = newestRelease(tags);
  if (!newest) throw new Error('Docker Hub: no release tag found');
  const release = await getJson(`${GITHUB_API}/repos/${UPSTREAM_REPO}/releases/latest`, githubHeaders(token), {
    allow404: true,
  });

  say('## ONLYOFFICE Docs upstream watch');
  say();
  say(`- Pinned: **${pin.version}** (build ${pin.build}), image \`${pin.tag}\` \`${pin.digest}\`, since ${pin.pinned}`);
  say(`- Newest image: **${versionString(newest.version)}**, tag \`${newest.tag}\` \`${newest.digest ?? 'unknown'}\` (${HUB_PAGE})`);
  say(`- Newest GitHub release: ${release ? `${release.tag_name}, ${release.published_at} (${release.html_url})` : 'none found'}`);

  const pinnedTag = tags.find((t) => t.name === pin.tag);
  if (!pinnedTag) {
    say(`- Note: the pinned tag \`${pin.tag}\` is no longer on Docker Hub; the digest still pulls it.`);
  } else if (pinnedTag.digest && pinnedTag.digest !== pin.digest) {
    say(`- Note: the pinned tag \`${pin.tag}\` now points at a rebuilt image (\`${pinnedTag.digest}\`). The pin keeps its digest; no issue for a rebuild.`);
  }
  const ghParsed = release ? parseTag(release.tag_name) : null;
  if (ghParsed && compareVersions(ghParsed.version, newest.version) > 0) {
    say(`- Note: ${release.tag_name} is released on GitHub but its image is not on Docker Hub yet; the issue opens once it is.`);
  }

  if (compareVersions(newest.version, pin.parsed.version) <= 0) {
    say();
    say('Up to date: no newer release than the pinned one.');
    await writeSummary(summary);
    return;
  }

  const v = versionString(newest.version);
  const title = issueTitle(v);
  const body = issueBody({ pin, newest, release, runUrl });
  say();
  if (!repo) {
    say(`Newer release ${v}. No GITHUB_REPOSITORY: the issue list is not read and nothing is opened.`);
    say();
    say(`Would open: "${title}"`);
    await writeSummary(summary);
    return;
  }
  const existing = alreadyOpened(await repoIssues(repo, token), v);
  if (existing) {
    say(`Newer release ${v}, and its issue already exists: #${existing.number} (${existing.state}). Nothing opened.`);
  } else if (dryRun) {
    say(`Newer release ${v}, no issue yet. Dry run: would open "${title}".`);
  } else {
    if (!token) throw new Error('GITHUB_TOKEN is not set: cannot open the issue');
    const issue = await openIssue(repo, token, title, body);
    say(`Newer release ${v}: opened #${issue.number} (${issue.html_url}).`);
  }
  await writeSummary(summary);
}

async function writeSummary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, `${lines.join('\n')}\n`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`upstream watch: ${err?.stack ?? err}`);
    process.exit(1);
  });
}
