#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
# app for filex (see README.md and NOTICE).
#
# Copies the two scripts the server's page layout loads that the app's
# bundle does not carry (docs/SERVER.md, "Page layout without a browser")
# out of the Document Server image pinned in upstream/onlyoffice.json, by
# its digest, unchanged:
#
#   sdkjs/common/libfont/engine/fonts_ie.js   -> dist/layout/fonts_ie.js
#   web-apps/vendor/xregexp/xregexp-all-min.js -> dist/layout/xregexp-all-min.js
#
#   bash scripts/engine-ds-files.sh [--out DIR]
#
# scripts/pack-engine.mjs checks them against upstream/onlyoffice.json
# ("engine": "files") and puts them in engine.zip. Needs bash and docker; the
# image is not run, only created and read.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/.." && pwd)
out=$repo/dist/layout
while [ $# -gt 0 ]; do
  case $1 in
    --out) out=$2; shift 2 ;;
    *) echo "usage: bash scripts/engine-ds-files.sh [--out DIR]" >&2; exit 2 ;;
  esac
done
mkdir -p "$out"

. "$here/lib/ds-image.sh"
ref=$(ds_image_ref "$repo/upstream/onlyoffice.json")
id=$(docker create --platform linux/amd64 "$ref")
trap 'docker rm -f "$id" > /dev/null' EXIT
ds=/var/www/onlyoffice/documentserver
docker cp "$id:$ds/sdkjs/common/libfont/engine/fonts_ie.js" "$out/fonts_ie.js"
docker cp "$id:$ds/web-apps/vendor/xregexp/xregexp-all-min.js" "$out/xregexp-all-min.js"
(cd "$out" && sha256sum fonts_ie.js xregexp-all-min.js)
