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
# QAIC invocation mirrors the engine's build_idl() expansion. The IDL comes
# from the installed package's vendored engine, so it cannot drift from
# what the build compiles. Env in: HEXAGON_SDK_VERSION, HEXAGON_TOOLS_VERSION.
# The caller exports HEXAGON_SDK_ROOT / HEXAGON_TOOLS_ROOT for Gradle.
set -euo pipefail

SDK_VERSION="${HEXAGON_SDK_VERSION:?HEXAGON_SDK_VERSION must be set}"
TOOLS_VERSION="${HEXAGON_TOOLS_VERSION:?HEXAGON_TOOLS_VERSION must be set}"
INSTALL_DIR="${HEXAGON_INSTALL_DIR:-$HOME/.hexagon-sdk}"
SDK_ROOT="$INSTALL_DIR/$SDK_VERSION"
TOOLS_ROOT="$SDK_ROOT/tools/HEXAGON_Tools/$TOOLS_VERSION"

HTP_DIR="node_modules/llama.rn/vendor/llama.cpp/ggml/src/ggml-hexagon/htp"
IDL="$HTP_DIR/htp_iface.idl"
STAGE_DIR="$HTP_DIR/v73"

# The CMake gate additionally refuses to compile hexagon sources unless this
# exact file exists (rnllama CMakeLists.txt links it for the host target).
CDSPRPC="$SDK_ROOT/ipc/fastrpc/remote/ship/android_aarch64/libcdsprpc.so"

fail() {
  echo "FATAL: $*" >&2
  exit 1
}

TMP=""
GEN=""
cleanup() {
  if [ -n "$TMP" ]; then rm -rf "$TMP"; fi
  if [ -n "$GEN" ]; then rm -rf "$GEN"; fi
}
trap cleanup EXIT

test -f "$IDL" || fail "$IDL not found — is llama.rn installed and provenance-asserted?"

if [ -d "$SDK_ROOT" ] && [ -d "$TOOLS_ROOT" ]; then
  echo "Hexagon SDK $SDK_VERSION already present: $SDK_ROOT"
else
  # Same URL, release and layout as the binding's scripts/bootstrap.sh:
  # the archive unpacks to <install>/<version>/, the path Gradle probes.
  URL="https://github.com/snapdragon-toolchain/hexagon-sdk/releases/download/v${SDK_VERSION}/hexagon-sdk-v${SDK_VERSION}-amd64-lnx.tar.xz"
  TMP=$(mktemp -d)
  echo "Downloading $URL"
  curl --fail --location --show-error --silent -o "$TMP/hexagon-sdk.tar.xz" "$URL"
  mkdir -p "$INSTALL_DIR"
  tar -xJf "$TMP/hexagon-sdk.tar.xz" -C "$INSTALL_DIR"
fi

test -d "$SDK_ROOT" || fail "$SDK_ROOT missing after download/restore"
test -d "$TOOLS_ROOT" || fail "$TOOLS_ROOT missing — SDK archive layout changed?"
test -f "$CDSPRPC" || fail "$CDSPRPC missing (rnllama CMakeLists.txt requires it verbatim)"

QAIC="$SDK_ROOT/ipc/fastrpc/qaic/bin/qaic"
test -x "$QAIC" || fail "qaic not found or not executable at $QAIC"

# Generate ONLY the host artifacts (the DSP skels are prebuilt in the
# package's bin/arm64-v8a and must stay as they are). Include flags mirror
# the engine's build_idl() qaic invocation; the output pair must land in
# the CMake-checked directory htp/v73/ of the installed package.
GEN=$(mktemp -d)
"$QAIC" -mdll -o "$GEN" \
  -I"$SDK_ROOT/incs/" \
  -I"$SDK_ROOT/incs/stddef/" \
  -I"$SDK_ROOT/ipc/fastrpc/rtld/ship/android_aarch64" \
  -I"$SDK_ROOT/incs" \
  -I"$SDK_ROOT/incs/stddef" \
  -I"$SDK_ROOT/utils/examples" \
  -I"$HTP_DIR" \
  -I"$GEN" \
  "$IDL"

test -s "$GEN/htp_iface_stub.c" || { ls -la "$GEN"; fail "qaic produced no htp_iface_stub.c"; }
test -s "$GEN/htp_iface.h" || { ls -la "$GEN"; fail "qaic produced no htp_iface.h"; }

mkdir -p "$STAGE_DIR"
cp "$GEN/htp_iface_stub.c" "$GEN/htp_iface.h" "$STAGE_DIR/"
echo "Staged QAIC host artifacts:"
ls -la "$STAGE_DIR"
