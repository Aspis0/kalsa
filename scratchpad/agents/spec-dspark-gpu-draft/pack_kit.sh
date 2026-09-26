#!/usr/bin/env bash
# Package the Android arm64 spec-decoding kit for the S23 DSpark arms.
# Reuses the npu-spec-verify stage (kalsallama-wt-oom @ f25f0c1c5, OpenCL ON)
# and adds the llama-speculative-simple binary built in this cell.
# One responsibility: stage -> strip -> SHA256SUMS -> tgz under raw/.
set -euo pipefail

CELL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_STAGE=/Users/marco/kalsa-qdc/npu-step0-v73/stage
BUILD_BIN=/Users/marco/Projects/kalsallama-wt-oom/build-s23-step0-v73/bin/llama-speculative-simple
OUT="$CELL/raw/kit-stage"
# kits live outside the lab repo (npu-spec-verify precedent), only the sums are committed
TGZ=/Users/marco/kalsa-qdc/dspark-spec-v73/dspark-kit-f25f0c1c5.tgz
STRIP_IMG=ghcr.io/snapdragon-toolchain/arm64-android:v0.7
LLVM_STRIP=/opt/android-ndk-r29/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip

[ -f "$SRC_STAGE/lib/libggml-opencl.so" ] || { echo "MISSING_STAGE $SRC_STAGE"; exit 2; }
[ -f "$BUILD_BIN" ] || { echo "MISSING_BINARY $BUILD_BIN"; exit 2; }

rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/lib"
cp "$SRC_STAGE/lib/"*.so "$OUT/lib/"
cp "$SRC_STAGE/bin/llama-completion" "$OUT/bin/"
cp "$BUILD_BIN" "$OUT/bin/llama-speculative-simple"

docker run --rm --volume "$OUT":/out --platform linux/amd64 "$STRIP_IMG" \
  bash -c "\"$LLVM_STRIP\" --strip-all /out/bin/llama-speculative-simple /out/bin/llama-completion"

cd "$OUT"
find bin lib -type f | LC_ALL=C sort | xargs shasum -a 256 > SHA256SUMS
mkdir -p "$(dirname "$TGZ")"
cp "$OUT/SHA256SUMS" "$CELL/raw/kit_SHA256SUMS.txt"
cd "$CELL/raw"
tar -czf "$TGZ" -C "$OUT" bin lib SHA256SUMS
shasum -a 256 "$TGZ"
wc -c "$TGZ"
