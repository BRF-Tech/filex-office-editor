#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 BRF Tech. Part of filex-office-editor, the office editor
# app for filex (see README.md and NOTICE).
#
# A release, from its signed tag to the GitHub Release, every file built
# again and held to its pin - the way README.md "Building a release" builds
# them, in one command, with no person in it:
#
#   bash scripts/release.sh prepare VERSION [--x2t DIR]
#   bash scripts/release.sh publish VERSION [--x2t DIR] [--work DIR] [--dry-run]
#                                           [--skip-tag-verify] [--replace-draft]
#
# prepare, in this checkout: builds every release file into dist/ and pins
#   them for VERSION - filex-app.json ui.bundle (url, SHA-256),
#   engines.office.sha256 and ui.extras' dictionaries catalog,
#   upstream/onlyoffice.json x2t (url, SHA-512) - then checks them. Next,
#   outside this script: commit, a signed tag vVERSION, push the branch and
#   the tag to both remotes.
#
# publish: clones this repository's tag vVERSION into a new directory
#   (--work; default a new one under ${TMPDIR:-/tmp}), builds every file again
#   there and checks each against the tag's pins (scripts/release-pins.mjs
#   check): one mismatch and it stops, with nothing on GitHub. Then: a draft
#   release vVERSION titled "filex-office-editor VERSION" with VERSION's
#   CHANGELOG section as its notes, the assets uploaded (ui.zip, engine.zip,
#   x2t.zip, dictionaries.json and its files), the release read back and
#   every asset's SHA-256 compared with the file built, and only then
#   published. --dry-run stops before GitHub. --replace-draft deletes a DRAFT
#   release of the tag left by an earlier run (never a published one).
#
# --x2t DIR: x2t.js, x2t.wasm and x2t-server.wasm of a build made elsewhere
#   (checked against the pins like everything else) instead of building x2t
#   here (scripts/x2t/build.sh --server: about 50 minutes, 5 GB; its options
#   from X2T_BUILD_ARGS, as "--cpus 4 --jobs 4 --memory 12g").
#
# The tag must exist here, be annotated and signed (this script never
# signs), name the commit GitHub has for it, and verify (git verify-tag;
# --skip-tag-verify when this machine lacks the signer's public key - the
# signature must still be there). Needs bash, git, docker, curl, python3;
# publish needs GH_TOKEN (contents: write on the repository), or gh logged
# in, whose token is used. The token is never printed.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/.." && pwd)
REPO_SLUG=${RELEASE_REPO:-BRF-Tech/filex-office-editor}
API=https://api.github.com
UPLOADS=https://uploads.github.com

die() {
  echo "release: $*" >&2
  exit 1
}

usage() {
  sed -n '9,13p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

[ $# -ge 2 ] || usage
mode=$1
version=$2
shift 2
x2t_dir=
work=
dry=0
skip_verify=0
replace_draft=0
while [ $# -gt 0 ]; do
  case $1 in
    --x2t) x2t_dir=$(cd "$2" && pwd); shift 2 ;;
    --work) work=$2; shift 2 ;;
    --dry-run) dry=1; shift ;;
    --skip-tag-verify) skip_verify=1; shift ;;
    --replace-draft) replace_draft=1; shift ;;
    *) usage ;;
  esac
done
case $mode in prepare | publish) ;; *) usage ;; esac
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "not a version: $version"
tag=v$version
for t in git docker curl python3; do command -v "$t" > /dev/null || die "$t is needed"; done
if [ -n "$x2t_dir" ]; then
  for f in x2t.js x2t.wasm x2t-server.wasm; do [ -f "$x2t_dir/$f" ] || die "--x2t $x2t_dir: no $f"; done
fi

# The Node image the bundle is built in: extract-editor.sh's, by its digest.
NODE_IMAGE=$(sed -n 's/^NODE_IMAGE="\(.*\)"$/\1/p' "$repo/scripts/extract-editor.sh")
[ -n "$NODE_IMAGE" ] || die "scripts/extract-editor.sh names no NODE_IMAGE"

json() { # json FILE EXPR: a value of a JSON file, read with python3
  python3 -c 'import json, sys
v = json.load(open(sys.argv[1], encoding="utf-8"))
for k in sys.argv[2].split("."):
    v = v[k]
print(v)' "$1" "$2"
}

# What a release of VERSION needs in a tree, before anything is built.
check_tree() {
  local d=$1
  [ "$(json "$d/filex-app.json" version)" = "$version" ] || die "filex-app.json version is $(json "$d/filex-app.json" version), not $version"
  [ "$(json "$d/package.json" version)" = "$version" ] || die "package.json version is $(json "$d/package.json" version), not $version"
  grep -Eq "^## \[$version\] - [0-9]{4}-[0-9]{2}-[0-9]{2}\s*$" "$d/CHANGELOG.md" || die "CHANGELOG.md has no \"## [$version] - <date>\" section"
}

node_run() { # node_run DIR [extra docker args...] -- COMMAND
  local d=$1
  shift
  local extra=()
  while [ "$1" != "--" ]; do extra+=("$1"); shift; done
  shift
  docker run --rm --platform linux/amd64 -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm \
    -v "$d:/src" -w /src "${extra[@]}" "$NODE_IMAGE" sh -c "$*"
}

# Every release file of the tree in DIR, into DIR/dist. $2: "--manifest"
# writes the engine's and the catalog's pins (prepare) or nothing (publish).
build_all() {
  local d=$1 manifest=${2:-}
  local t0=$SECONDS
  (
    cd "$d"
    local fetch=() mount=()
    if [ -n "$x2t_dir" ]; then
      mkdir -p dist/x2t
      cp "$x2t_dir/x2t-server.wasm" dist/x2t/x2t-server.wasm
      fetch=(--dir /x2t-in)
      mount=(-v "$x2t_dir:/x2t-in:ro")
    else
      echo "== x2t (scripts/x2t/build.sh --server ${X2T_BUILD_ARGS:-})"
      # shellcheck disable=SC2086 # X2T_BUILD_ARGS is a list of options
      bash scripts/x2t/build.sh --server ${X2T_BUILD_ARGS:-}
    fi
    echo "== layout-host.wasm"
    bash server/layout/host/build.sh
    echo "== the image's two engine files"
    bash scripts/engine-ds-files.sh
    echo "== the editor files (checked against upstream/editor.lock.json)"
    bash scripts/extract-editor.sh
    echo "== the image's dictionaries"
    bash scripts/ds-dictionaries.sh
    echo "== the bundle, x2t.zip, engine.zip, the dictionaries (pinned Node image)"
    node_run "$d" "${mount[@]}" -- "npm ci --no-audit --no-fund > /tmp/npm-ci.log 2>&1 || { tail -30 /tmp/npm-ci.log; exit 1; }
      node scripts/fetch-x2t.mjs ${fetch[*]} && node scripts/build-app.mjs && node scripts/fetch-x2t.mjs --pack dist/x2t.zip &&
      node scripts/pack-engine.mjs $manifest && node scripts/pack-dictionaries.mjs $manifest"
  )
  echo "== built in $(( (SECONDS - t0) / 60 )) min"
}

if [ "$mode" = prepare ]; then
  check_tree "$repo"
  build_all "$repo" --manifest
  node_run "$repo" -- "node scripts/release-pins.mjs write $version && node scripts/release-pins.mjs check $version"
  echo "release: $version prepared in $repo - commit filex-app.json and upstream/onlyoffice.json, sign $tag, push, then: bash scripts/release.sh publish $version"
  exit 0
fi

# ---------------------------------------------------------------- publish

git -C "$repo" rev-parse -q --verify "refs/tags/$tag" > /dev/null || die "no tag $tag here"
[ "$(git -C "$repo" cat-file -t "$tag")" = tag ] || die "$tag is not an annotated tag"
git -C "$repo" cat-file -p "$tag" | grep -q -e '-----BEGIN PGP SIGNATURE-----' -e '-----BEGIN SSH SIGNATURE-----' || die "$tag is not signed (this script never signs; sign it first)"
if ! git -C "$repo" verify-tag "$tag" > /dev/null 2>&1; then
  if [ "$skip_verify" = 1 ]; then
    echo "release: $tag carries a signature this machine cannot verify (--skip-tag-verify)" >&2
  else
    git -C "$repo" verify-tag "$tag" || true
    die "$tag does not verify (git verify-tag); --skip-tag-verify if this machine lacks the signer's key"
  fi
fi
tag_object=$(git -C "$repo" rev-parse "$tag")
commit=$(git -C "$repo" rev-parse "$tag^{commit}")

if [ -z "$work" ]; then
  work=$(mktemp -d "${TMPDIR:-/tmp}/filex-office-editor-$version.XXXXXX")
else
  [ ! -e "$work" ] || die "--work $work exists; give a new directory"
  mkdir -p "$work"
fi
work=$(cd "$work" && pwd)
git clone -q --no-hardlinks "$repo" "$work/src"
git -C "$work/src" -c advice.detachedHead=false checkout -q "$tag"
[ -z "$(git -C "$work/src" status --porcelain)" ] || die "the clone of $tag is not clean"
src=$work/src
check_tree "$src"
echo "== $tag ($commit) in $src"
build_all "$src"
echo "== the release files against the pins of $tag"
node_run "$src" -- "node scripts/release-pins.mjs check $version" || die "MISMATCH: the files built from $tag are not the ones it pins (above); nothing published"
node_run "$src" -- "node scripts/release-pins.mjs assets $version --dist dist" > "$work/assets.tsv"
node_run "$src" -- "node scripts/release-pins.mjs notes $version" > "$work/notes.md"
n=$(wc -l < "$work/assets.tsv")
echo "== $n assets, every one at its pin"
if [ "$dry" = 1 ]; then
  echo "release: --dry-run, $tag not published; the files are in $src/dist"
  exit 0
fi

# GitHub. The token goes into a header file only this user reads.
token=${GH_TOKEN:-}
if [ -z "$token" ] && command -v gh > /dev/null; then token=$(gh auth token 2> /dev/null || true); fi
[ -n "$token" ] || die "GH_TOKEN is not set (and no gh to ask)"
secret=$(mktemp -d)
chmod 700 "$secret"
trap 'rm -rf "$secret"' EXIT
printf 'Authorization: Bearer %s\n' "$token" > "$secret/auth"
unset token GH_TOKEN
gh_api() { # gh_api METHOD PATH [JSON]: the response body on stdout; non-2xx fails
  local method=$1 path=$2 body=${3:-}
  local args=(-sS -X "$method" -H @"$secret/auth" -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' -o "$secret/body" -w '%{http_code}')
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data-binary "$body")
  local code
  code=$(curl "${args[@]}" "$API$path") || die "$method $path: curl failed"
  echo "$code" > "$secret/code"
  case $code in 2??) cat "$secret/body" ;; *) return 1 ;; esac
}
pyj() { python3 -c "import json, sys; d = json.load(sys.stdin); $1"; }

remote_tag=$(gh_api GET "/repos/$REPO_SLUG/git/ref/tags/$tag" | pyj 'print(d["object"]["sha"])') || die "GitHub has no tag $tag (git push github $tag first)"
[ "$remote_tag" = "$tag_object" ] || die "GitHub's $tag is $remote_tag, here it is $tag_object"

if gh_api GET "/repos/$REPO_SLUG/releases/tags/$tag" > /dev/null; then
  die "a published release of $tag exists already"
fi
for id in $(gh_api GET "/repos/$REPO_SLUG/releases?per_page=100" | pyj "print(' '.join(str(r['id']) for r in d if r['tag_name'] == '$tag' and r['draft']))"); do
  [ "$replace_draft" = 1 ] || die "a draft release of $tag exists (id $id); --replace-draft deletes it"
  gh_api DELETE "/repos/$REPO_SLUG/releases/$id" > /dev/null || die "could not delete draft $id"
  echo "== deleted the earlier draft $id"
done

body=$(python3 -c 'import json, sys; print(json.dumps({"tag_name": sys.argv[1], "name": "filex-office-editor " + sys.argv[2], "body": open(sys.argv[3], encoding="utf-8").read(), "draft": True, "prerelease": False}))' "$tag" "$version" "$work/notes.md")
release_id=$(gh_api POST "/repos/$REPO_SLUG/releases" "$body" | pyj 'print(d["id"])') || die "could not create the draft release: $(cat "$secret/body")"
echo "== draft release $release_id"

i=0
while IFS=$'\t' read -r name file sum; do
  i=$((i + 1))
  code=$(curl -sS -X POST -H @"$secret/auth" -H 'Content-Type: application/octet-stream' --data-binary @"$file" \
    -o "$secret/up" -w '%{http_code}' "$UPLOADS/repos/$REPO_SLUG/releases/$release_id/assets?name=$name") || die "upload $name: curl failed"
  [ "$code" = 201 ] || die "upload $name: HTTP $code $(head -c 300 "$secret/up")"
  if [ $((i % 20)) = 0 ]; then echo "   $i/$n uploaded"; fi
done < "$work/assets.tsv"
echo "== $i assets uploaded"

# Read the release back: every asset there, once, at the SHA-256 of the file built.
: > "$secret/remote.tsv"
page=1
while :; do
  got=$(gh_api GET "/repos/$REPO_SLUG/releases/$release_id/assets?per_page=100&page=$page") || die "listing the assets failed"
  echo "$got" | pyj 'print("\n".join("%s\t%s\t%s\t%s" % (a["name"], a.get("digest") or "", a["size"], a["id"]) for a in d))' | sed '/^$/d' >> "$secret/remote.tsv"
  [ "$(echo "$got" | pyj 'print(len(d))')" = 100 ] || break
  page=$((page + 1))
done
bad=0
while IFS=$'\t' read -r name file sum; do
  line=$(awk -F'\t' -v n="$name" '$1 == n' "$secret/remote.tsv")
  [ -n "$line" ] || { echo "MISMATCH $name: not in the release" >&2; bad=1; continue; }
  digest=$(echo "$line" | cut -f2)
  if [ -z "$digest" ]; then
    asset=$(echo "$line" | cut -f4)
    curl -sSL -H @"$secret/auth" -H 'Accept: application/octet-stream' -o "$secret/dl" "$API/repos/$REPO_SLUG/releases/assets/$asset"
    digest=sha256:$(sha256sum "$secret/dl" | cut -c1-64)
  fi
  [ "$digest" = "sha256:$sum" ] || { echo "MISMATCH $name: GitHub has $digest, built sha256:$sum" >&2; bad=1; }
done < "$work/assets.tsv"
[ "$(wc -l < "$secret/remote.tsv")" = "$n" ] || { echo "MISMATCH the release holds $(wc -l < "$secret/remote.tsv") assets, $n were built" >&2; bad=1; }
[ "$bad" = 0 ] || die "the draft release $release_id does not hold what was built (above); it stays a draft"
echo "== every asset on GitHub at the SHA-256 of the file built"

gh_api PATCH "/repos/$REPO_SLUG/releases/$release_id" '{"draft": false, "make_latest": "true"}' > /dev/null || die "could not publish the release: $(cat "$secret/body")"
echo "release: https://github.com/$REPO_SLUG/releases/tag/$tag published ($n assets, from $commit)"
