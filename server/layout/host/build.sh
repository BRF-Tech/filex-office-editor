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

QJS_VERSION=0.18.0
QJS_SHA256=28bcd89aa3683fd2a946537e5ce3f11cc46b5cbf3383c7561aaef3df5ff9f1dd
# wasi-sdk's own image, by its digest: two builds give the same
# layout-host.wasm, whose SHA-256 upstream/onlyoffice.json pins under
# "engine" (wasi-sdk 25, built 2024-12-12, measured 2026-10-15 and
# 2026-10-16; wasi-sdk 34, built 2026-08-25, from 0.5.0).
WASI_SDK_IMAGE=ghcr.io/webassembly/wasi-sdk:wasi-sdk-34@sha256:52595085a0ffbaf574d8d678a9aa81305f0b3af81c639291f15bc7713e42848e

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
