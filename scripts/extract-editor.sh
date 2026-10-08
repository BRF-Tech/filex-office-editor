#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
# app for filex (see README.md and NOTICE).
#
# Builds the editor part of the app's bundle from ONLYOFFICE's official
# Document Server image - the release, image tag and digest pinned in
# upstream/onlyoffice.json (the file the weekly upstream watch checks):
#
#   bash scripts/extract-editor.sh           dist/editor/, dist/editor.zip and
#                                            dist/editor.lock.json; fails when
#                                            the files differ from the committed
#                                            upstream/editor.lock.json
#   bash scripts/extract-editor.sh --update  the same, and writes
#                                            upstream/editor.lock.json (a new
#                                            pin, or a change of the rules)
#
# Needs only bash and docker (Linux, x86-64; elsewhere the amd64 images run
# emulated). Three steps, each in a container:
#
#   1. scripts/editor/config.mjs reads the pin and the rules (pinned Node).
#   2. scripts/editor/in-image.sh runs in the Document Server image, by its
#      digest and without network: it generates the fonts and thumbnails the
#      image makes on its first start, from ONLYOFFICE's own core-fonts, and
#      copies the editor's files out.
#   3. scripts/editor/bundle.mjs (pinned Node, no network) keeps what the
#      editor needs (scripts/editor/rules.mjs), moves the HTML pages' inline
#      scripts into files (scripts/editor/html.mjs), writes the tree, the zip
#      and the lock file, checks filex's limits, and compares the lock.
#
# The output is REPRODUCIBLE: the image is pulled by digest, the generators
# give the same bytes on every run (measured: two runs, identical trees),
# the zip is written sorted with one date, and its deflate runs in the Node
# image pinned below - deflate's bytes depend on the zlib that makes them,
# so the image is part of the build's input. Two builds give the same
# editor.zip; the lock file records its SHA-256.
#
# EDITOR_WORK (default dist/.editor-work) holds the image's files between
# steps 2 and 3 (about 1.3 GB); KEEP_WORK=1 keeps it afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# Node 22.23.3 (zlib 1.3.1-e00f703), Debian bookworm, by its digest.
NODE_IMAGE="docker.io/library/node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392"
PLATFORM="linux/amd64"

update=0
case "${1:-}" in
  "") ;;
  --update) update=1 ;;
  *) echo "usage: bash scripts/extract-editor.sh [--update]" >&2; exit 2 ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "extract-editor: docker is needed" >&2
  exit 1
fi

WORK="${EDITOR_WORK:-$ROOT/dist/.editor-work}"
mkdir -p "$WORK" "$ROOT/dist"
uid="$(id -u)"
gid="$(id -g)"

node_run() {
  docker run --rm --platform "$PLATFORM" --network none -u "$uid:$gid" \
    -e NODE_IMAGE="$NODE_IMAGE" \
    -v "$ROOT:/src:ro" -v "$WORK:/work" -v "$ROOT/dist:/dist" -w /src \
    "$NODE_IMAGE" node "$@"
}

echo "== the pinned Node image"
docker pull -q --platform "$PLATFORM" "$NODE_IMAGE" >/dev/null

image=""
build=""
font_exclude=""
while IFS='=' read -r key value; do
  case "$key" in
    IMAGE) image="$value" ;;
    BUILD) build="$value" ;;
    FONT_EXCLUDE) font_exclude="$value" ;;
  esac
done < <(node_run scripts/editor/config.mjs)
if [ -z "$image" ] || [ -z "$build" ]; then
  echo "extract-editor: could not read upstream/onlyoffice.json" >&2
  exit 1
fi

echo "== ONLYOFFICE Docs $build: $image"
docker pull -q --platform "$PLATFORM" "$image" >/dev/null

echo "== the image's files (fonts generated, no network)"
rm -rf "$WORK/raw"
docker run --rm --platform "$PLATFORM" --network none --entrypoint bash \
  -e HOST_UID="$uid" -e HOST_GID="$gid" -e FONT_EXCLUDE="$font_exclude" \
  -v "$WORK:/out" -v "$ROOT/scripts/editor/in-image.sh:/in-image.sh:ro" \
  "$image" /in-image.sh

echo "== the bundle"
flags=()
if [ "$update" = 1 ]; then
  flags+=(--update)
fi
set +e
node_run scripts/editor/bundle.mjs --raw /work/raw --out /dist ${flags[@]+"${flags[@]}"}
rc=$?
set -e

if [ "$update" = 1 ] && [ "$rc" = 0 ]; then
  cp "$ROOT/dist/editor.lock.json" "$ROOT/upstream/editor.lock.json"
  echo "wrote upstream/editor.lock.json - commit it with the change that caused it"
fi
if [ "${KEEP_WORK:-0}" != 1 ]; then
  rm -rf "$WORK/raw"
fi
exit "$rc"
