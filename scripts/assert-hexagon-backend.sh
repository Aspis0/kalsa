#!/usr/bin/env bash
# Refuse an APK whose hexagon-named engine library has no Hexagon host
# backend in it. The name proves nothing: CMake keeps the variant name
# rnllama_v8_2_dotprod_i8mm_hexagon_opencl even when the SDK gate is off,
# and the DSP skels ride along as assets either way, so only the compiled
# host code distinguishes a real Hexagon build from a CPU-only one.
#
# Markers are string literals that exist only when their translation unit
# was compiled and linked into the host library. Both are quoted verbatim
# from the vendored engine at the installed binding pin:
#
#   vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6848
#     GGML_LOG_INFO("ggml-hex: Hexagon backend (experimental) : allocating new registry : ndev %zu\n", opt_ndev);
#   vendor/llama.cpp/ggml/src/ggml-hexagon/htp-drv.cpp:343
#     GGML_LOG_INFO("ggml-hex: Loading driver %s\n", drv_path.c_str());
#
# The libcdsprpc dynamic-dependency check is the string-independent twin:
# the CMake gate links the FastRPC stub library only when the backend is on.
# GGML_LOG_* expands to ggml_log_internal (ggml-impl.h:119), never to a
# compile-time no-op, so the literals survive -flto=thin in release builds.
set -euo pipefail

APK="${1:-android/app/build/outputs/apk/release/app-release.apk}"
LIB_ENTRY="lib/arm64-v8a/librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so"

# Markers must be exact substrings of the source lines above.
MARKERS=(
  "ggml-hex: Hexagon backend (experimental)"
  "ggml-hex: Loading driver"
)

fail() {
  echo "FATAL: $*" >&2
  exit 1
}

test -f "$APK" || fail "APK not found: $APK"

OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

if ! unzip -p "$APK" "$LIB_ENTRY" > "$OUT/host.so" 2> "$OUT/unzip.err"; then
  cat "$OUT/unzip.err" >&2
  fail "$LIB_ENTRY not in $APK — did the arm64 hexagon variant build at all?"
fi
test -s "$OUT/host.so" || fail "$LIB_ENTRY extracted empty from $APK"

for MARKER in "${MARKERS[@]}"; do
  if grep -aqF -- "$MARKER" "$OUT/host.so"; then
    echo "[assert-hexagon] marker present: $MARKER"
  else
    fail "marker '$MARKER' absent from $LIB_ENTRY — CPU-only code shipped under a hexagon name"
  fi
done

READELF="${ANDROID_NDK_HOME:-}/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf"
test -x "$READELF" || fail "llvm-readelf not executable at $READELF (ANDROID_NDK_HOME set by the NDK step?)"

# readelf output goes to a file first: `readelf | grep -q` can die on
# SIGPIPE under pipefail and mask a match as a failure.
"$READELF" -d "$OUT/host.so" > "$OUT/dynamic.txt"
if grep -q cdsprpc "$OUT/dynamic.txt"; then
  echo "[assert-hexagon] dynamic section references libcdsprpc"
else
  fail "no libcdsprpc dependency in $LIB_ENTRY — the FastRPC stub library was never linked"
fi

echo "[assert-hexagon] OK: $LIB_ENTRY carries the Hexagon host backend"
