#!/usr/bin/env bash
# Prove that the app patch and the pinned engine reached the release binaries.
#
# Both markers live in the ENGINE libraries (librnllama*.so): the patch
# marker "kalsa-native-patches" is appended by common_params_get_system_info
# in common.cpp, which CMake compiles into librnllama.so, and "q23k" comes
# from the pinned kalsallama kernels. RNLlamaJSI.cpp is the JNI wrapper
# (always-from-source) and carries no marker — grepping librnllama_jni*.so
# for either would fail on a correct build. The wrapper is still required
# to exist, or the build did not produce a complete native set.
#
#   assert-native-patch.sh [patch-marker] [engine-marker]
#
set -uo pipefail

PATCH_MARKER="${1:-kalsa-native-patches}"
ENGINE_MARKER="${2:-q23k}"
FOUND_ANY=0
WRAPPER_COUNT=0
ENGINE_COUNT=0
FAILED=0

STRING_TOOL="${KALSA_STRINGS_TOOL:-}"
if [[ -z "$STRING_TOOL" ]] && command -v strings >/dev/null 2>&1; then
  STRING_TOOL="$(command -v strings)"
fi
if [[ -z "$STRING_TOOL" ]]; then
  for sdk in "${ANDROID_NDK_ROOT:-}" "${ANDROID_NDK_HOME:-}" "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}"; do
    [[ -n "$sdk" ]] || continue
    sdk_path="$sdk"
    if command -v cygpath >/dev/null 2>&1; then
      sdk_path="$(cygpath -u "$sdk" 2>/dev/null || printf '%s' "$sdk")"
    fi
    if [[ -d "$sdk_path" ]]; then
      STRING_TOOL="$(find "$sdk_path" -type f -name 'llvm-strings*' -print 2>/dev/null | sort | tail -n 1)"
      [[ -n "$STRING_TOOL" ]] && break
    fi
  done
fi
if [[ -z "$STRING_TOOL" ]]; then
  echo "[assert] FATAL: neither strings nor NDK llvm-strings is available"
  exit 1
fi
echo "[assert] string tool: $STRING_TOOL"

while IFS= read -r -d '' so; do
  FOUND_ANY=1
  base="${so##*/}"
  if [[ "$base" == librnllama_jni*.so ]]; then
    WRAPPER_COUNT=$((WRAPPER_COUNT + 1))
    echo "[assert] wrapper present: $so"
  elif [[ "$base" == librnllama*.so ]]; then
    ENGINE_COUNT=$((ENGINE_COUNT + 1))
    for marker in "$PATCH_MARKER" "$ENGINE_MARKER"; do
      if "$STRING_TOOL" "$so" 2>/dev/null | grep -F "$marker" >/dev/null; then
        echo "[assert] $marker present in $so"
      else
        echo "[assert] $marker MISSING in $so"
        FAILED=1
      fi
    done
  fi
done < <(find android -type f -name 'librnllama*.so' -path '*release*' -print0 2>/dev/null | sort -z -u)

if [[ "$FOUND_ANY" -eq 0 ]]; then
  echo "[assert] FATAL: no release librnllama*.so found under android/ — did the build run?"
  exit 1
fi
if [[ "$WRAPPER_COUNT" -eq 0 ]]; then
  echo "[assert] FATAL: no release librnllama_jni*.so found under android/"
  exit 1
fi
if [[ "$ENGINE_COUNT" -eq 0 ]]; then
  echo "[assert] FATAL: no release engine librnllama*.so found under android/"
  exit 1
fi
if [[ "$FAILED" -ne 0 ]]; then
  echo "[assert] FATAL: native patch or pinned-engine marker missing from release binaries."
  exit 1
fi
echo "[assert] native patch and q23k engine verified in all release binaries"
