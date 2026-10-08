#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
# app for filex (see README.md and NOTICE).
#
# Runs INSIDE ONLYOFFICE's official Document Server image, started by
# scripts/extract-editor.sh with no network, as a throwaway container: it
# never starts the Document Server. It does what the image does on its
# first start (documentserver-generate-allfonts.sh) - the font list
# (AllFonts.js), the font files the editor downloads, the font and theme
# thumbnails - but from a chosen set of ONLYOFFICE's own fonts (core-fonts)
# and without the system's, then copies the editor's files out to /out/raw:
#
#   web-apps/  sdkjs/  fonts/            as the image has them, plus the
#                                        generated files
#   LICENSE.txt 3rd-Party.txt license/   ONLYOFFICE's license and notices
#   document-templates/new/default/      the Document Server's blank docx,
#                                        xlsx and pptx (what its "Create
#                                        new" starts from; filex's New menu
#                                        copies them)
#   core-fonts-licenses/<family>/        the license files of every font
#                                        family the fonts come from
#   core-fonts-src/                      those families' original font
#                                        files, read by the bundle step for
#                                        the notices inside them (the web
#                                        fonts in fonts/ are encoded copies)
#   ds-version                           the package version (9.4.0-129)
#
# Nothing is trimmed here: what the bundle keeps is decided in one place,
# scripts/editor/rules.mjs.
#
# Environment:
#   FONT_EXCLUDE  space-separated core-fonts entries left out (directories
#                 or files, relative to core-fonts: "nanum noto/Noto_Sans_KR")
#   HOST_UID HOST_GID  the owner the output is handed to
#
# Why not the system fonts: the image carries Microsoft's core fonts
# (msttcorefonts: Arial, Times New Roman, ...), whose license does not let
# a project hand them on in a bundle. ONLYOFFICE's core-fonts are under open
# licenses, ship their license files, and include the metric-compatible
# stand-ins (Liberation for Arial, Times New Roman and Courier New, Carlito
# for Calibri, Caladea for Cambria).
set -euo pipefail

DS=/var/www/onlyoffice/documentserver
OUT=/out/raw
FIN=/tmp/fonts-in

: "${HOST_UID:?}" "${HOST_GID:?}"
if [ ! -d "$DS/web-apps" ] || [ ! -x "$DS/server/tools/allfontsgen" ]; then
  echo "in-image.sh: this is not ONLYOFFICE's Document Server image" >&2
  exit 1
fi

rm -rf "$OUT" "$FIN"
mkdir -p "$OUT" "$FIN"

cp -a "$DS/core-fonts/." "$FIN/"
for entry in ${FONT_EXCLUDE:-}; do
  case "$entry" in
    /*|*..*|"") echo "in-image.sh: bad FONT_EXCLUDE entry: $entry" >&2; exit 1 ;;
  esac
  if [ ! -e "$FIN/$entry" ]; then
    echo "in-image.sh: FONT_EXCLUDE names $entry, which core-fonts does not have" >&2
    exit 1
  fi
  rm -rf "${FIN:?}/$entry"
done

export LD_LIBRARY_PATH="$DS/server/FileConverter/bin${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

echo "in-image: fonts (AllFonts.js, font files, thumbnails)"
"$DS/server/tools/allfontsgen" \
  --input="$FIN" \
  --allfonts-web="$DS/sdkjs/common/AllFonts.js" \
  --allfonts="$DS/server/FileConverter/bin/AllFonts.js" \
  --images="$DS/sdkjs/common/Images" \
  --selection="$DS/server/FileConverter/bin/font_selection.bin" \
  --output-web="$DS/fonts" \
  --use-system="false" \
  --use-system-user-fonts="false"

echo "in-image: presentation theme thumbnails"
"$DS/server/tools/allthemesgen" \
  --converter-dir="$DS/server/FileConverter/bin" \
  --src="$DS/sdkjs/slide/themes" \
  --output="$DS/sdkjs/common/Images"

rm -f "$DS"/fonts/*.gz "$DS/sdkjs/common/AllFonts.js.gz" "$DS"/sdkjs/common/Images/*.gz "$DS/sdkjs/slide/themes/themes.js.gz"

echo "in-image: copying out"
cp -a "$DS/web-apps" "$DS/sdkjs" "$DS/fonts" "$DS/license" "$DS/LICENSE.txt" "$DS/3rd-Party.txt" "$OUT/"
mkdir -p "$OUT/document-templates/new/default"
cp -a "$DS/document-templates/new/default/new.docx" "$DS/document-templates/new/default/new.xlsx" \
  "$DS/document-templates/new/default/new.pptx" "$OUT/document-templates/new/default/"
mkdir -p "$OUT/core-fonts-licenses"
for dir in "$FIN"/*/; do
  family="$(basename "$dir")"
  found=0
  for f in "$dir"*; do
    case "$(basename "$f")" in
      LICENSE*|LICENCE*|COPYING*|OFL*|*.license|README*|AUTHORS*)
        mkdir -p "$OUT/core-fonts-licenses/$family"
        cp -a "$f" "$OUT/core-fonts-licenses/$family/"
        found=1
        ;;
    esac
  done
  if [ "$found" = 0 ]; then
    echo "$family" >> "$OUT/core-fonts-licenses/WITHOUT-LICENSE-FILE.txt"
  fi
done
cp -a "$DS/core-fonts/README.md" "$OUT/core-fonts-licenses/README.md"
cp -a "$FIN" "$OUT/core-fonts-src"
dpkg-query -W -f='${Version}\n' onlyoffice-documentserver > "$OUT/ds-version"

chown -R "$HOST_UID:$HOST_GID" "$OUT"
chmod -R u+w "$OUT"
echo "in-image: done ($(cat "$OUT/ds-version"))"
