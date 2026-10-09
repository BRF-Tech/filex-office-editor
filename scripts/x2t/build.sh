#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
# app for filex (see README.md and NOTICE).
#
# Builds x2t, ONLYOFFICE's converter, to WebAssembly from ONLYOFFICE core at
# the tag upstream/onlyoffice.json names ("x2t" -> "build"), and checks the
# two files it makes against the SHA-256 sums pinned there.
#
#   bash scripts/x2t/build.sh [--work DIR] [--out DIR] [--cpus N] [--memory SIZE] [--jobs N]
#
#   --work DIR     the build tree (default .x2t-build/ in the repository, about
#                  4.5 GB); a run that stopped goes on from where it stopped,
#                  an empty one builds everything
#   --out DIR      where x2t.js and x2t.wasm go (default dist/x2t)
#   --cpus N       CPUs the build container may use (default 8)
#   --memory SIZE  its memory, in GiB as 16g (the default; swap as much again)
#   --jobs N       parallel compilations (default: --cpus)
#
# It needs bash and docker. The toolchain is emscripten's own image, pinned by
# digest, with the build tools from one day's Ubuntu snapshot
# (scripts/x2t/Dockerfile); the build runs in a container of it
# (scripts/x2t/steps.sh), which fetches every source by the commit pinned.
# About 20 minutes on 6 cores. Two builds give the same bytes (README.md, "x2t,
# the converter").

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
pin=$repo/upstream/onlyoffice.json

work=$repo/.x2t-build
out=$repo/dist/x2t
cpus=8
memory=16g
jobs=

while [ $# -gt 0 ]; do
  case $1 in
    --work) work=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --cpus) cpus=$2; shift 2 ;;
    --memory) memory=$2; shift 2 ;;
    --jobs) jobs=$2; shift 2 ;;
    *) echo "usage: bash scripts/x2t/build.sh [--work DIR] [--out DIR] [--cpus N] [--memory SIZE] [--jobs N]" >&2; exit 2 ;;
  esac
done
jobs=${jobs:-$cpus}
case $memory in
  [1-9]*g) ;;
  *) echo "--memory: in GiB, as 16g" >&2; exit 2 ;;
esac

mkdir -p "$work" "$out"
work=$(cd "$work" && pwd)
out=$(cd "$out" && pwd)

tag=filex-office-editor/x2t-toolchain:$(sha256sum < "$here/Dockerfile" | cut -c1-16)
if ! docker image inspect "$tag" > /dev/null 2>&1; then
  docker build -t "$tag" "$here"
fi

# The pin, read with the toolchain's python (the host needs only docker).
read -r release want_js want_wasm < <(docker run --rm -v "$pin:/pin.json:ro" "$tag" python3 -c '
import json
x = json.load(open("/pin.json"))["x2t"]
print(x["release"], x["files"]["x2t.js"], x["files"]["x2t.wasm"])')
if [ -z "$want_wasm" ]; then
  echo "upstream/onlyoffice.json: no x2t release or file sums" >&2
  exit 1
fi

user=()
if [ "$(id -u)" != 0 ]; then
  user=(--user "$(id -u):$(id -g)" -e HOME=/work/home)
fi

docker run --rm \
  --cpus "$cpus" --memory "$memory" --memory-swap "$(( ${memory%g} * 2 ))g" \
  "${user[@]}" \
  -e JOBS="$jobs" \
  -v "$here:/x2t:ro" \
  -v "$pin:/pin.json:ro" \
  -v "$work:/work" \
  "$tag" bash /x2t/steps.sh

got_js=$(sha256sum "$work/out/x2t.js" | cut -c1-64)
got_wasm=$(sha256sum "$work/out/x2t.wasm" | cut -c1-64)
echo "x2t.js    $got_js"
echo "x2t.wasm  $got_wasm"
if [ "$got_js" != "$want_js" ] || [ "$got_wasm" != "$want_wasm" ]; then
  echo "not the pinned build: upstream/onlyoffice.json has x2t.js $want_js, x2t.wasm $want_wasm" >&2
  echo "(the files are in $work/out; a change to the recipe pins the new sums with the change)" >&2
  exit 1
fi
cp "$work/out/x2t.js" "$out/.x2t.js.tmp" && mv "$out/.x2t.js.tmp" "$out/x2t.js"
cp "$work/out/x2t.wasm" "$out/.x2t.wasm.tmp" && mv "$out/.x2t.wasm.tmp" "$out/x2t.wasm"
echo "$release" > "$out/.version"
echo "x2t $release: both files match the pin -> $out"
