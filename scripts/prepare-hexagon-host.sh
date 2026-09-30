#!/usr/bin/env bash
# Make the Hexagon host backend compilable before Gradle configures the
# hexagon variant. Two inputs must exist at configure time, or CMake builds
# the hexagon-named variant CPU-only and only a warning tells you:
#
#   1. the Hexagon SDK, at the path the binding's android/build.gradle
#      probes by default (~/.hexagon-sdk/<version> with
#      tools/HEXAGON_Tools/<tools-version>) or via HEXAGON_SDK_ROOT /
#      HEXAGON_TOOLS_ROOT;
#   2. the QAIC-generated host artifacts htp_iface_stub.c and htp_iface.h,
#      which the binding never ships (htp/v73/ is gitignored there) — the
#      binding generates them with scripts/build-hexagon-htp.sh, a script
#      the npm package omits entirely.
#
# This is the binding's own bootstrap route, not a new one: same public
# release (snapdragon-toolchain/hexagon-sdk), same install dir, and the
# QAIC invocation mirrors the engine's build_idl(). The IDL comes from the
# installed package's vendored engine, so it cannot drift from what the
# build compiles.
#
# The SDK archive is content-pinned: HEXAGON_SDK_SHA256 must equal the
# release-asset digest from the GitHub API (see apk.yml's comment), is
# verified on EVERY run — a restored cache copy no less than a fresh
# download — and the tree is extracted fresh from the verified archive.
# The toolchain runs only after that gate: an unverified binary from the
# network must never execute here.
#
# Env in: HEXAGON_SDK_VERSION, HEXAGON_TOOLS_VERSION, HEXAGON_SDK_SHA256.
# The caller exports HEXAGON_SDK_ROOT / HEXAGON_TOOLS_ROOT for Gradle.
set -euo pipefail

SDK_VERSION="${HEXAGON_SDK_VERSION:?HEXAGON_SDK_VERSION must be set}"
TOOLS_VERSION="${HEXAGON_TOOLS_VERSION:?HEXAGON_TOOLS_VERSION must be set}"
SDK_SHA256="${HEXAGON_SDK_SHA256:?HEXAGON_SDK_SHA256 must be set (release-asset digest, see apk.yml)}"
INSTALL_DIR="${HEXAGON_INSTALL_DIR:-$HOME/.hexagon-sdk}"
ARCHIVE_DIR="${HEXAGON_ARCHIVE_DIR:-$HOME/.hexagon-sdk-archive}"
SDK_ROOT="$INSTALL_DIR/$SDK_VERSION"
TOOLS_ROOT="$SDK_ROOT/tools/HEXAGON_Tools/$TOOLS_VERSION"

GGML_HEXAGON_DIR="$PWD/node_modules/llama.rn/vendor/llama.cpp/ggml/src/ggml-hexagon"
HTP_DIR="$GGML_HEXAGON_DIR/htp"
IDL_REL="htp/htp_iface.idl"
STAGE_DIR="$HTP_DIR/v73"

# The CMake gate additionally refuses to compile hexagon sources unless this
# exact file exists (rnllama CMakeLists.txt links it for the host target).
CDSPRPC="$SDK_ROOT/ipc/fastrpc/remote/ship/android_aarch64/libcdsprpc.so"

ARCHIVE_NAME="hexagon-sdk-v${SDK_VERSION}-amd64-lnx.tar.xz"
ARCHIVE="$ARCHIVE_DIR/$ARCHIVE_NAME"
URL="https://github.com/snapdragon-toolchain/hexagon-sdk/releases/download/v${SDK_VERSION}/${ARCHIVE_NAME}"

fail() {
  echo "FATAL: $*" >&2
  exit 1
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

TMP=""
GEN=""
cleanup() {
  if [ -n "$TMP" ]; then rm -rf "$TMP"; fi
  if [ -n "$GEN" ]; then rm -rf "$GEN"; fi
}
trap cleanup EXIT

test -f "$GGML_HEXAGON_DIR/$IDL_REL" || fail "$GGML_HEXAGON_DIR/$IDL_REL not found — is llama.rn installed and provenance-asserted?"

if [ ! -s "$ARCHIVE" ]; then
  # Download to a temp file and mv into place, so an interrupted download
  # can never leave a truncated archive where the cache would pick it up.
  mkdir -p "$ARCHIVE_DIR"
  TMP=$(mktemp -d)
  echo "Downloading $URL"
  curl --fail --location --show-error -o "$TMP/$ARCHIVE_NAME" "$URL"
  mv "$TMP/$ARCHIVE_NAME" "$ARCHIVE"
fi

# The integrity gate: every run, download or cache restore alike. A replaced
# asset at the same URL — or a tampered cache — dies here, before tar and
# before any SDK binary runs.
GOT=$(file_sha256 "$ARCHIVE")
if [ "$GOT" != "$SDK_SHA256" ]; then
  fail "$ARCHIVE_NAME has sha256 $GOT, expected $SDK_SHA256 — delete the cache entry and re-run if this is a restore"
fi
echo "sha256 verified: $ARCHIVE_NAME"

# Extract fresh from the verified archive; a stale or partial tree under
# INSTALL_DIR is never trusted.
rm -rf "$SDK_ROOT"
mkdir -p "$INSTALL_DIR"
tar -xJf "$ARCHIVE" -C "$INSTALL_DIR"

test -d "$SDK_ROOT" || fail "$SDK_ROOT missing after extraction — SDK archive layout changed?"
test -d "$TOOLS_ROOT" || fail "$TOOLS_ROOT missing — SDK archive layout changed?"
test -f "$CDSPRPC" || fail "$CDSPRPC missing (rnllama CMakeLists.txt requires it verbatim)"

QAIC="$SDK_ROOT/ipc/fastrpc/qaic/bin/qaic"
test -x "$QAIC" || fail "qaic not found or not executable at $QAIC"

# Generate ONLY the host artifacts (the DSP skels are prebuilt in the
# package's bin/arm64-v8a and must stay as they are). Flags and include
# order mirror build_idl()'s expansion for the engine's htp_iface target
# (hexagon_fun.cmake: its two default includes with trailing slashes, then
# the target's INCLUDE_DIRECTORIES: incs, incs/stddef, utils/examples, the
# htp source dir, the output dir) with the working directory set the same
# way and the IDL passed by the same relative path.
GEN=$(mktemp -d)
(
  cd "$GGML_HEXAGON_DIR"
  "$QAIC" -mdll -o "$GEN" \
    -I"$SDK_ROOT/incs/" \
    -I"$SDK_ROOT/incs/stddef/" \
    -I"$SDK_ROOT/incs" \
    -I"$SDK_ROOT/incs/stddef" \
    -I"$SDK_ROOT/utils/examples" \
    -I"$HTP_DIR" \
    -I"$GEN" \
    "$IDL_REL"
)

test -s "$GEN/htp_iface_stub.c" || { ls -la "$GEN"; fail "qaic produced no htp_iface_stub.c"; }
test -s "$GEN/htp_iface.h" || { ls -la "$GEN"; fail "qaic produced no htp_iface.h"; }

mkdir -p "$STAGE_DIR"
cp "$GEN/htp_iface_stub.c" "$GEN/htp_iface.h" "$STAGE_DIR/"
echo "Staged QAIC host artifacts:"
ls -la "$STAGE_DIR"
