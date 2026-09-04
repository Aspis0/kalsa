#!/usr/bin/env bash

set +e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p logs
LOG="logs/governor-params-test.log"

(clang++ -std=c++17 \
  -I node_modules/llama.rn/cpp \
  -I node_modules/llama.rn/cpp/ggml/include \
  scripts/governor-params-test.cpp \
  node_modules/llama.rn/cpp/rn-governor-params.cpp \
  -o /tmp/kalsa-governor-params-test && \
  /tmp/kalsa-governor-params-test) > "$LOG" 2>&1
status=$?
echo "$status" >> "$LOG"
exit "$status"
