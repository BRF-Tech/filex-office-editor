#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
# app for filex (see README.md and NOTICE).
#
# Copies the Document Server image's dictionaries (spell checking and
# hyphenation, 49 languages, about 220 MB) out of the image pinned in
# upstream/onlyoffice.json, by its digest, unchanged:
#
#   bash scripts/ds-dictionaries.sh [--out DIR]   (default dist/ds-dictionaries)
#
# scripts/pack-dictionaries.mjs then writes the release's dictionary assets
# and their catalog from DIR/dictionaries/. Needs bash and docker; the image
# runs only tar, without a network.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/.." && pwd)
out=$repo/dist/ds-dictionaries
while [ $# -gt 0 ]; do
  case $1 in
    --out) out=$2; shift 2 ;;
    *) echo "usage: bash scripts/ds-dictionaries.sh [--out DIR]" >&2; exit 2 ;;
  esac
done

. "$here/lib/ds-image.sh"
ref=$(ds_image_ref "$repo/upstream/onlyoffice.json")
# The image's dictionary folders are r-x (dr-xr-xr-x) and tar keeps that, so
# a copy from an earlier run cannot be removed until its folders are writable
# again; the files' bytes are not touched.
writable() {
  if [ -d "$1" ]; then chmod -R u+w -- "$1"; fi
}
writable "$out.tmp"
rm -rf "$out.tmp"
mkdir -p "$out.tmp"
# tar inside the image: some of its files are readable by root only, which
# docker cp to a user's folder is refused.
docker run --rm --network none --platform linux/amd64 --entrypoint tar "$ref" \
  -C /var/www/onlyoffice/documentserver -cf - dictionaries | tar -C "$out.tmp" -xf -
writable "$out.tmp"
writable "$out"
rm -rf "$out"
mv "$out.tmp" "$out"
echo "$(find "$out/dictionaries" -mindepth 1 -maxdepth 1 -type d | wc -l) dictionaries -> $out/dictionaries"
