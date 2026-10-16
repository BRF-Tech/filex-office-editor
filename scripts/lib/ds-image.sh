# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
# app for filex (see README.md and NOTICE).
#
# Sourced by the scripts that take files out of the Document Server image
# (engine-ds-files.sh, ds-dictionaries.sh): ds_image_ref prints the image
# upstream/onlyoffice.json pins, by its digest, and pulls it.

ds_image_ref() {
  local pin=$1 image digest
  image=$(sed -n 's/^  "image": "\(.*\)",$/\1/p' "$pin")
  digest=$(sed -n 's/^  "digest": "\(sha256:[0-9a-f]*\)",$/\1/p' "$pin")
  if [ -z "$image" ] || [ -z "$digest" ]; then
    echo "upstream/onlyoffice.json: no image or digest" >&2
    return 1
  fi
  docker pull -q --platform linux/amd64 "$image@$digest" > /dev/null
  echo "$image@$digest"
}
