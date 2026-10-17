#!/bin/bash
# Build upstream llama.cpp at the closest tag to the vendored fork (b11517),
# Metal on, Release. Gives llama-bench / llama-cli / test-backend-ops, which the
# fork's library-only tree does not ship.
set -u
UP=/tmp/llama-upstream
OUT=/tmp/lcpp-upstream-b11517
TAG=b11517
LOG="$1"
: > "$LOG"
cd "$UP"
git checkout -q -B bench-base "$TAG" >>"$LOG" 2>&1 || { echo "checkout failed" >>"$LOG"; exit 1; }
echo "checked out $TAG -> $(git rev-parse HEAD)" >>"$LOG"
{
  echo "=== configure ==="
  cmake -S "$UP" -B "$OUT" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY=OFF \
    -DGGML_CCACHE=OFF \
    -DLLAMA_BUILD_TESTS=ON \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_SERVER=OFF \
    -DLLAMA_BUILD_APP=OFF \
    -DLLAMA_BUILD_TOOLS=ON \
    -DLLAMA_CURL=OFF
  echo "configure_exit=$?"
  echo "=== build ==="
  cmake --build "$OUT" --target llama-bench llama-completion test-backend-ops -j "$(sysctl -n hw.ncpu)"
  echo "build_exit=$?"
  echo "=== result ==="
  ls -l "$OUT"/bin/ 2>&1
} >> "$LOG" 2>&1