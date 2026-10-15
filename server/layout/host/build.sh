#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
# app for filex (see README.md and NOTICE).
#
# Builds layout-host.wasm: quickjs-ng with layout-host.c (compileScript,
# runBytecode), for WASI, with wasi-sdk's own image - the flags quickjs-ng's
# CMakeLists.txt gives a WASI build (the emulated clocks and signals, a 2 MiB
# stack).
#
#   bash server/layout/host/build.sh [--out DIR]
#
# It needs bash, curl and docker. quickjs-ng's source comes from its
# release tarball, checked by SHA-256.

set -euo pipefail

QJS_VERSION=0.17.0
QJS_SHA256=559bc4c420475e55c7ab4510adbc562f55d7524d75e8e89d79ce4bb02f5687d9
WASI_SDK_IMAGE=ghcr.io/webassembly/wasi-sdk:wasi-sdk-25

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
out=${here}/../../../dist/layout
while [ $# -gt 0 ]; do
  case $1 in
    --out) out=$2; shift 2 ;;
    *) echo "usage: bash server/layout/host/build.sh [--out DIR]" >&2; exit 2 ;;
  esac
done
mkdir -p "$out"
out=$(cd "$out" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -fsSL -o "$work/quickjs.tar.gz" "https://github.com/quickjs-ng/quickjs/archive/refs/tags/v${QJS_VERSION}.tar.gz"
echo "${QJS_SHA256}  $work/quickjs.tar.gz" | sha256sum -c --status || {
  echo "quickjs-ng v${QJS_VERSION}: not the pinned tarball" >&2
  exit 1
}
tar -xzf "$work/quickjs.tar.gz" -C "$work"
cp "$here/layout-host.c" "$work/"

user=()
if [ "$(id -u)" != 0 ]; then
  user=(--user "$(id -u):$(id -g)")
fi
docker run --rm "${user[@]}" -v "$work:/w" -w /w "$WASI_SDK_IMAGE" sh -c "
  Q=quickjs-${QJS_VERSION}
  \$CC -O2 -funsigned-char -D_GNU_SOURCE -DQJS_BUILD_LIBC \
    -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_SIGNAL -I\$Q \
    \$Q/dtoa.c \$Q/libregexp.c \$Q/libunicode.c \$Q/quickjs.c \$Q/quickjs-libc.c layout-host.c \
    -Wl,-z,stack-size=2097152 -lwasi-emulated-process-clocks -lwasi-emulated-signal -lm \
    -o layout-host.wasm"
cp "$work/layout-host.wasm" "$out/layout-host.wasm"
(cd "$out" && sha256sum layout-host.wasm)
