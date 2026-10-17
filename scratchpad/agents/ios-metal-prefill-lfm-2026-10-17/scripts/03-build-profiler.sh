#!/bin/bash
# Compile the per-node profiler against the FORK's already-built libs in
# /tmp/lcpp-metal (the exact ggml-metal kernels the Kalsa app ships).
set -eu
LAB="$(cd "$(dirname "$0")/.." && pwd)"
FORK="$HOME/Projects/llama.rn-kalsa-onecopy/vendor/llama.cpp"
OUT=/tmp/lcpp-metal
BIN=/tmp/lcpp-metal/bin/lfm-prof
LOG="$1"

{
  echo "=== compile profiler against fork libs ==="
  xcrun clang++ -O2 -std=c++17 \
    -I"$FORK/include" -I"$FORK/ggml/include" \
    "$LAB/scripts/profiler.cpp" \
    -L"$OUT/bin" -lllama -lggml -lggml-base \
    -Wl,-rpath,"$OUT/bin" \
    -o "$BIN"
  echo "compile_exit=$?"
  ls -l "$BIN"
  echo "=== ldd ==="
  otool -L "$BIN" | head -12
} >> "$LOG" 2>&1
echo "exit=$?" >> "$LOG"