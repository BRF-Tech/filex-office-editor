# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
# app for filex (see README.md and NOTICE).
#
# The toolchain x2t is built with (scripts/x2t/build.sh): emscripten's own
# image, pinned by its digest, and the few build tools ONLYOFFICE core's
# qmake projects and third-party scripts need, from Ubuntu's snapshot of one
# day, so the same packages come every time. Nothing is compiled here; the
# build itself runs in a container of this image (scripts/x2t/steps.sh).

ARG EMSDK_IMAGE=docker.io/emscripten/emsdk:4.0.11@sha256:f8a157011b8fa61bdaab875bb1f0f08695229dffe086448d14b53538cae16bd3
FROM ${EMSDK_IMAGE}

ARG APT_SNAPSHOT=20261001T000000Z

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN printf '%s\n' \
      "deb https://snapshot.ubuntu.com/ubuntu/${APT_SNAPSHOT} jammy main universe" \
      "deb https://snapshot.ubuntu.com/ubuntu/${APT_SNAPSHOT} jammy-updates main universe" \
      "deb https://snapshot.ubuntu.com/ubuntu/${APT_SNAPSHOT} jammy-security main universe" \
      > /etc/apt/sources.list \
 && rm -f /etc/apt/sources.list.d/*.list \
 && apt-get -o Acquire::Check-Valid-Until=false update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      autoconf \
      automake \
      bzip2 \
      libtool \
      make \
      patch \
      pkg-config \
      python-is-python3 \
      qt6-base-dev \
      qt6-base-dev-tools \
      xz-utils \
      zip \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s /usr/lib/qt6/bin/qmake /usr/local/bin/qmake \
 && chmod -R a+rwX /emsdk/upstream/emscripten/cache
