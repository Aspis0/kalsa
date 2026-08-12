#!/usr/bin/env bash
# Prove that patches/llama.rn+*.patch reached the BINARY, not just the sources.
#
# llama.rn ships prebuilt jniLibs; unless rnllamaBuildFromSource=true the
# patched cpp/ is never compiled and every native patch is a no-op that still
# looks applied (`patch-package ✔`). This asserts a marker string from our patch
# is present in the built librnllama.so — the native equivalent of a mutation
# test, and the check whose absence wasted a night of experiments (2026-08-09).
#
# Default marker is "kalsa-native-patches" (appended to systemInfo in
# RNLlamaJSI.cpp). Override with an argument for legacy checks (e.g. KALSA_KVDIAG0).
#
#   assert-native-patch.sh [marker]        default marker: kalsa-native-patches
set -uo pipefail

MARKER="${1:-kalsa-native-patches}"
FOUND_ANY=0
MATCHED=0

while IFS= read -r so; do
  FOUND_ANY=1
  if strings "$so" 2>/dev/null | grep -qF "$MARKER"; then
    echo "[assert] $MARKER present in $so"
    MATCHED=1
  else
    echo "[assert] $MARKER MISSING in $so"
  fi
done < <(find android -name "librnllama.so" -path "*release*" 2>/dev/null)

if [ "$FOUND_ANY" -eq 0 ]; then
  echo "[assert] FATAL: no release librnllama.so found under android/ — did the build run?"
  exit 1
fi
if [ "$MATCHED" -eq 0 ]; then
  echo "[assert] FATAL: the native patch is NOT in the binary."
  echo "[assert] llama.rn used its prebuilt jniLibs: source-build is the default"
  echo "[assert] (plugins/withLlamaFromSource.js). Unset KALSA_LLAMA_FROM_SOURCE"
  echo "[assert] or set it to 1; only KALSA_LLAMA_FROM_SOURCE=0 restores prebuilt."
  exit 1
fi
echo "[assert] native patch verified in the shipped binary"
