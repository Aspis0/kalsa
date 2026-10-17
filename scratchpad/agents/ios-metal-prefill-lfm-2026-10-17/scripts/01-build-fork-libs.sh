#!/bin/bash
# Build the EXACT vendored llama.cpp the Kalsa app ships (library-only fork),
# out-of-tree, Metal on, Release. No edits to the source tree.
set -u
SRC="$HOME/Projects/llama.rn-kalsa-onecopy/vendor/llama.cpp"
OUT=/tmp/lcpp-metal
LOG="$1"
: > "$LOG"
{
  echo "=== configure ==="
  cmake -S "$SRC" -B "$OUT" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY=OFF \
    -DGGML_OPENMP=OFF \
    -DGGML_CCACHE=ON \
    -DLLAMA_BUILD_COMMON=ON \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_TOOLS=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_SERVER=OFF \
    -DLLAMA_BUILD_APP=OFF \
    -DLLAMA_CURL=OFF
  echo "configure_exit=$?"
  echo "=== build ==="
  cmake --build "$OUT" --target llama ggml-metal ggml-base -j "$(sysctl -n hw.ncpu)"
  echo "build_exit=$?"
  echo "=== result ==="
  ls -l "$OUT"/src/libllama* "$OUT"/ggml/src/libggml* 2>&1
} >> "$LOG" 2>&1