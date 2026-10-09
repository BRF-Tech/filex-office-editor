#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
# app for filex (see README.md and NOTICE).
#
# Builds x2t, ONLYOFFICE's converter, to WebAssembly. Runs in a container of
# the toolchain image (scripts/x2t/Dockerfile), started by scripts/x2t/build.sh:
#
#   /x2t       this directory, read-only (the patches, main1.cpp, pre-js.js)
#   /pin.json  upstream/onlyoffice.json (what to fetch, at which commit)
#   /work      the build tree: src/ (the sources), b/ (one directory per
#              library), stamps/, out/ (x2t.js, x2t.wasm)
#
# Every step leaves a stamp in /work/stamps and is skipped on the next run, so
# a build that stopped goes on where it stopped; a fresh /work builds it all.
# The recipe is CryptPad's (github.com/cryptpad/onlyoffice-x2t-wasm, the
# Dockerfile and embuild.sh of 7debf5e6): the same libraries of ONLYOFFICE
# core in the same order, each one a qmake project built with emcc, linked
# into one module. Its changes to the sources are patches/01, ported to
# ONLYOFFICE core 9.4; patches/02-04 are this project's (README.md, "x2t,
# the converter").

set -euo pipefail

: "${JOBS:=6}"
W=/work
SRC=$W/src
CORE=$SRC/core
STAMPS=$W/stamps
OUT=$W/out
BOOST=$CORE/Common/3dParty/boost/build/linux_64
OPENSSL_DIR=$CORE/Common/3dParty/openssl

mkdir -p "$SRC" "$STAMPS" "$OUT" "$W/b"

export EM_CACHE=$W/emcache
if [ ! -d "$EM_CACHE" ]; then
  rm -rf "$EM_CACHE.tmp"
  cp -a /emsdk/upstream/emscripten/cache "$EM_CACHE.tmp"
  mv "$EM_CACHE.tmp" "$EM_CACHE"
fi
export LC_ALL=C.UTF-8
export SOURCE_DATE_EPOCH=0
export TZ=UTC

pin() {
  python3 -c 'import json, sys
v = json.load(open("/pin.json"))["x2t"]["build"]
for k in sys.argv[1].split("."):
    v = v[k]
print(v)' "$1"
}

# The version x2t writes into the documents it makes ("ONLYOFFICE/9.4.0.129"
# as the application), as ONLYOFFICE's build sets it: from the core tag.
core_tag=$(pin sources.core.tag)
export PRODUCT_VERSION=${core_tag#v}
PRODUCT_VERSION=${PRODUCT_VERSION%.*}
export BUILD_NUMBER=${core_tag##*.}

step() {
  local name=$1
  shift
  if [ -f "$STAMPS/$name" ]; then
    echo "== $name: done in an earlier run"
    return 0
  fi
  echo "== $name"
  local t0=$SECONDS
  "$@"
  echo "$((SECONDS - t0))" > "$STAMPS/$name"
  echo "== $name: $((SECONDS - t0)) s"
}

# A repository at one commit, fetched by that commit (a tag that moved
# cannot change what comes).
fetch_commit() {
  local dir=$1 url=$2 commit=$3
  rm -rf "$dir"
  git init -q "$dir"
  git -C "$dir" fetch -q --depth 1 "$url" "$commit"
  git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
  local got
  got=$(git -C "$dir" rev-parse HEAD)
  if [ "$got" != "$commit" ]; then
    echo "$url: got $got, pinned $commit" >&2
    exit 1
  fi
}

sources() {
  fetch_commit "$CORE" "$(pin sources.core.repository)" "$(pin sources.core.commit)"
  fetch_commit "$SRC/build_tools" "$(pin sources.build_tools.repository)" "$(pin sources.build_tools.commit)"
}

# ONLYOFFICE's own scripts fetch most third-party code, each at the commit
# they name (core's Common/3dParty/*/fetch.py and make.py).
third_party() {
  local d=$CORE/Common/3dParty
  (cd "$d/html" && python fetch.py)
  sed -i -e 's/b->yy_is_interactive = file ? (isatty( fileno(file) ) > 0) : 0;/b->yy_is_interactive = 0;/' \
    "$d/html/katana-parser/src/katana.lex.c"
  (cd "$d/md" && python fetch.py)
  (cd "$d/apple" && python fetch.py)
  (cd "$d/harfbuzz" && python make.py)
  (cd "$d/brotli" && python make.py)
  fetch_commit "$d/hyphen/hyphen" "$(pin sources.hyphen.repository)" "$(pin sources.hyphen.commit)"
}

patches() {
  local p
  for p in /x2t/patches/*.patch; do
    echo "   $(basename "$p")"
    git -C "$CORE" apply --whitespace=nowarn "$p"
  done
  cat /x2t/main1.cpp >> "$CORE/X2tConverter/src/main.cpp"
  local file
  for file in "${PRI_EDITED[@]}"; do
    mkdir -p "$(dirname "$W/pristine/$file")"
    cp "$CORE/$file" "$W/pristine/$file"
  done
  # doctrenderer without a JavaScript engine: CryptPad's stand-ins (added by
  # 01-cryptpad-wasm.patch) take the place of the three files that run one.
  local f
  for f in doctrenderer docbuilder docbuilder_p; do
    cp "$CORE/DesktopEditor/doctrenderer/${f}_empty.cpp" "$CORE/DesktopEditor/doctrenderer/$f.cpp"
  done
}

# OpenSSL: only its headers, as CryptPad has it. ooxmlsignature and
# doctrenderer compile against them; OpenSSL's own functions (signing a
# document and checking a signature) are not linked - the link lists them
# as undefined, and a conversion that reached one would stop the module, as
# in CryptPad's build.
openssl_headers() {
  fetch_commit "$OPENSSL_DIR/openssl" "$(pin sources.openssl.repository)" "$(pin sources.openssl.commit)"
  (cd "$OPENSSL_DIR/openssl" && ./config enable-md2 no-shared no-asm no-tests \
    --prefix="$OPENSSL_DIR/build/linux_64" --openssldir="$OPENSSL_DIR/build/linux_64" > /dev/null \
    && make include/openssl/opensslconf.h > /dev/null)
  mkdir -p "$OPENSSL_DIR/build/linux_64/include" "$OPENSSL_DIR/build/linux_64/lib"
  cp -r "$OPENSSL_DIR/openssl/include/openssl" "$OPENSSL_DIR/build/linux_64/include/"
}

# emscripten's ICU (a port, built into its cache on first use): built once
# here, before the parallel compilations below would all wait for it.
icu_port() {
  local d=$W/b/icu-port
  rm -rf "$d"
  mkdir -p "$d"
  cat > "$d/icu.cpp" <<'CPP'
#include "unicode/ucnv.h"
int main() { UErrorCode e = U_ZERO_ERROR; ucnv_close(ucnv_open("UTF-8", &e)); return 0; }
CPP
  em++ -sUSE_ICU=1 -Os "$d/icu.cpp" -o "$d/icu.js"
}

# Boost: the release's headers, and the two of its libraries x2t links
# (date_time and regex), compiled with emscripten from the files b2 builds
# them from (b2's own emscripten toolset predates this emscripten and fails).
boost_lib() {
  local name=$1 dir=$SRC/boost obj=$W/b/boost-$1
  shift
  rm -rf "$obj"
  mkdir -p "$obj"
  local src objs=()
  for src in "$@"; do
    local o=$obj/$(echo "$src" | tr / _).o
    em++ -Os -DNDEBUG -DBOOST_ALL_NO_LIB -I "$dir" -c "$dir/libs/$name/src/$src" -o "$o"
    objs+=("$o")
  done
  emar rcs "$BOOST/lib/libboost_$name.a" "${objs[@]}"
}

boost() {
  local url sha tarball dir
  url=$(pin sources.boost.url)
  sha=$(pin sources.boost.sha256)
  tarball=$SRC/$(basename "$url")
  if [ ! -f "$tarball" ] || ! echo "$sha  $tarball" | sha256sum -c --status; then
    curl -fsSL -o "$tarball.tmp" "$url"
    mv "$tarball.tmp" "$tarball"
  fi
  echo "$sha  $tarball" | sha256sum -c --status
  dir=$SRC/boost
  rm -rf "$dir" "$dir.tmp"
  mkdir "$dir.tmp"
  tar -xjf "$tarball" -C "$dir.tmp" --strip-components=1
  mv "$dir.tmp" "$dir"
  rm -rf "$BOOST"
  mkdir -p "$BOOST/include" "$BOOST/lib"
  cp -r "$dir/boost" "$BOOST/include/"
  boost_lib date_time gregorian/greg_month.cpp
  boost_lib regex posix_api.cpp regex.cpp regex_debug.cpp static_mutex.cpp wide_posix_api.cpp
  ls -l "$BOOST/lib"
}

CFLAGS="-sUSE_ICU=1 -sUSE_BOOST_HEADERS=0 -Os"
LFLAGS="-sUSE_ICU=1 -sALLOW_MEMORY_GROWTH -sSTACK_SIZE=128kb -sASSERTIONS=0 -sUSE_CLOSURE_COMPILER=1 -sERROR_ON_UNDEFINED_SYMBOLS=0 -sEMULATE_FUNCTION_POINTER_CASTS=1"

# One of core's qmake projects, built with emscripten in a directory of its
# own (CryptPad's embuild.sh). $1 a name, $2 the project, $3 how many jobs,
# the rest more qmake arguments.
qbuild() {
  local name=$1 pro=$2 jobs=$3
  shift 3
  local dir=$W/b/$name
  rm -rf "$dir" "$(dirname "$CORE/$pro")/core_build"
  mkdir -p "$dir"
  (cd "$dir" && qmake \
      "QMAKE_CXXFLAGS_RELEASE -= -O2" \
      "QMAKE_CXXFLAGS_RELEASE *= -Os" \
      "QMAKE_CFLAGS_RELEASE -= -O2" \
      "QMAKE_CFLAGS_RELEASE *= -Os" \
      "QMAKE_CC=emcc" \
      "QMAKE_CXX=em++" \
      "QMAKE_LINK=em++" \
      "QMAKE_AR=emar cqs" \
      "QMAKE_RANLIB=emranlib" \
      "QMAKE_CFLAGS+=$CFLAGS" \
      "QMAKE_CXXFLAGS+=$CFLAGS" \
      "QMAKE_LFLAGS+=$LFLAGS $CFLAGS" \
      "DEFINES+=__linux__ HAVE_UNISTD_H _RWSTD_NO_SETRLIMIT" \
      "INCLUDEPATH+=$BOOST/include" \
      "CONFIG+=core_wasm not_use_dynamic_libs" \
      "$@" \
      "$CORE/$pro" > qmake.log 2>&1 \
    && emmake make -j"$jobs" > make.log 2>&1) || {
    echo "!! $name failed; the end of $dir/make.log (or qmake.log):" >&2
    tail -60 "$dir/make.log" 2>/dev/null || tail -60 "$dir/qmake.log"
    exit 1
  }
}

# Some of CryptPad's stages drop a few sources from a shared .pri for that
# one library (two libraries carrying the same file would clash at the
# link); here the .pri is changed for that build and put back after it.
# The .pri is taken from the copy the patches step kept (a run stopped in
# the middle of such a build leaves the changed one behind).
PRI_EDITED=(Common/3dParty/html/css/CssCalculator.pri DesktopEditor/graphics/pro/freetype.pri)
with_pri_edit() {
  local file=$1 expr=$2
  shift 2
  cp "$W/pristine/$file" "$CORE/$file"
  sed -i -e "$expr" "$CORE/$file"
  local rc=0
  "$@" || rc=$?
  cp "$W/pristine/$file" "$CORE/$file"
  return $rc
}

libs() {
  local file
  for file in "${PRI_EDITED[@]}"; do
    cp "$W/pristine/$file" "$CORE/$file"
  done
  step lib-ooxmlsignature qbuild ooxmlsignature DesktopEditor/xmlsec/src/ooxmlsignature.pro "$JOBS"
  step lib-UnicodeConverter qbuild UnicodeConverter UnicodeConverter/UnicodeConverter.pro "$JOBS"
  step lib-kernel qbuild kernel Common/kernel.pro "$JOBS"
  step lib-graphics with_pri_edit Common/3dParty/html/css/CssCalculator.pri 's,$$PWD/src/[^ ]*\.cpp,,' \
    qbuild graphics DesktopEditor/graphics/pro/graphics.pro 1 "QMAKE_CXXFLAGS+=-Wno-register"
  step lib-TxtXmlFormatLib qbuild TxtXmlFormatLib TxtFile/Projects/Linux/TxtXmlFormatLib.pro "$JOBS"
  step lib-BinDocument qbuild BinDocument OOXML/Projects/Linux/BinDocument/BinDocument.pro "$JOBS"
  step lib-DocxFormatLib qbuild DocxFormatLib OOXML/Projects/Linux/DocxFormatLib/DocxFormatLib.pro "$JOBS"
  step lib-PPTXFormatLib qbuild PPTXFormatLib OOXML/Projects/Linux/PPTXFormatLib/PPTXFormatLib.pro 1
  step lib-XlsbFormatLib qbuild XlsbFormatLib OOXML/Projects/Linux/XlsbFormatLib/XlsbFormatLib.pro "$JOBS"
  step lib-VbaFormatLib qbuild VbaFormatLib MsBinaryFile/Projects/VbaFormatLib/Linux/VbaFormatLib.pro "$JOBS"
  step lib-DocFormatLib qbuild DocFormatLib MsBinaryFile/Projects/DocFormatLib/Linux/DocFormatLib.pro "$JOBS"
  step lib-PPTFormatLib qbuild PPTFormatLib MsBinaryFile/Projects/PPTFormatLib/Linux/PPTFormatLib.pro "$JOBS"
  step lib-XlsFormatLib qbuild XlsFormatLib MsBinaryFile/Projects/XlsFormatLib/Linux/XlsFormatLib.pro "$JOBS"
  step lib-OdfFormatLib qbuild OdfFormatLib OdfFile/Projects/Linux/OdfFormatLib.pro "$JOBS"
  step lib-StarMathConverter qbuild StarMathConverter OdfFile/Reader/Converter/StarMath2OOXML/StarMath2OOXML.pro "$JOBS"
  step lib-RtfFormatLib qbuild RtfFormatLib RtfFile/Projects/Linux/RtfFormatLib.pro "$JOBS"
  step lib-CompoundFileLib qbuild CompoundFileLib Common/cfcpp/cfcpp.pro "$JOBS"
  step lib-CryptoPPLib qbuild CryptoPPLib Common/3dParty/cryptopp/project/cryptopp.pro "$JOBS"
  step lib-kernel_network qbuild kernel_network Common/Network/network.pro "$JOBS"
  step lib-PdfFile with_pri_edit DesktopEditor/graphics/pro/freetype.pri 's,$$FREETYPE_PATH/[^ ]*\.c,,' \
    qbuild PdfFile PdfFile/PdfFile.pro "$JOBS"
  step lib-doctrenderer qbuild doctrenderer DesktopEditor/doctrenderer/doctrenderer.pro "$JOBS" \
    "INCLUDEPATH+=$OPENSSL_DIR/build/linux_64/include"
  step lib-HtmlFile2 with_pri_edit DesktopEditor/graphics/pro/freetype.pri 's,$$FREETYPE_PATH/[^ ]*\.c,,' \
    qbuild HtmlFile2 HtmlFile2/HtmlFile2.pro 1
  step lib-EpubFile qbuild EpubFile EpubFile/CEpubFile.pro "$JOBS"
  step lib-XpsFile qbuild XpsFile XpsFile/XpsFile.pro "$JOBS"
  step lib-DjVuFile qbuild DjVuFile DjVuFile/DjVuFile.pro "$JOBS"
  step lib-IWorkFile qbuild IWorkFile Apple/IWork.pro "$JOBS"
  step lib-HWPFile qbuild HWPFile HwpFile/HWPFile.pro "$JOBS"
  step lib-DocxRenderer qbuild DocxRenderer DocxRenderer/DocxRenderer.pro "$JOBS"
}

x2t() {
  qbuild X2tConverter X2tConverter/build/Qt/X2tConverter.pro "$JOBS" \
    "QMAKE_LFLAGS+=-looxmlsignature -L$BOOST/lib --pre-js /x2t/pre-js.js -sEXPORTED_RUNTIME_METHODS=ccall,FS -sEXPORTED_FUNCTIONS=_main1"
  local bin=$CORE/build/bin/linux_64
  cp "$bin/x2t" "$OUT/x2t.js"
  cp "$bin/x2t.wasm" "$OUT/x2t.wasm"
  (cd "$OUT" && sha256sum x2t.js x2t.wasm | tee SHA256SUMS)
}

step sources sources
step third-party third_party
step patches patches
step openssl-headers openssl_headers
step boost boost
step icu-port icu_port
libs
rm -f "$STAMPS/x2t"
step x2t x2t
