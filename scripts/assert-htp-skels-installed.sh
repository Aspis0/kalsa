#!/usr/bin/env bash
# Fail the APK build unless the installed llama.rn ships the four Hexagon DSP
# skels byte-identical to their manifest, built from the engine the app pins.
#
# bin/arm64-v8a/HTP_SKELS declares ENGINE_COMMIT and a sha256 per
# libggml-htp-v{73,75,79,81}.so. The binding's own gate (assert-htp-skels.sh
# in the fork) needs .git and cannot run on the npm tarball this app installs;
# this one reads only the installed package. The APK ships these skels as
# assets while its host Hexagon backend is compiled from vendor/llama.cpp, so
# a skel from a different engine commit speaks a different data-plane protocol
# than the host — the 2026-09 dspqueue hang. Hence the pin comparison, not
# just the hashes.
#
# Usage: assert-htp-skels-installed.sh [installed-llama-rn-dir] [engine-pin-file]
#
# Exit 0 = four skels present, hashes match, ENGINE_COMMIT == pin.
# Exit 1 = skew: skel missing, hash mismatch, or engine commit mismatch.
# Exit 2 = cannot decide: manifest or pin missing/unusable.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLED="${1:-$REPO_ROOT/node_modules/llama.rn}"
PIN="${2:-$REPO_ROOT/native/kalsallama.pin}"
BIN="$INSTALLED/bin/arm64-v8a"
MANIFEST="$BIN/HTP_SKELS"
SKELS=(libggml-htp-v73.so libggml-htp-v75.so libggml-htp-v79.so libggml-htp-v81.so)

fatal() { echo "[htp-skels] FATAL: $1" >&2; exit 2; }
fail()  { echo "[htp-skels] SKEW: $1" >&2; exit 1; }

if command -v sha256sum >/dev/null 2>&1; then HASH=(sha256sum); else HASH=(shasum -a 256); fi

[[ -f "$MANIFEST" ]] || fatal "missing $MANIFEST — the installed package ships no skel manifest"
[[ -f "$PIN" ]] || fatal "missing engine pin $PIN"

pinned="$(tr -d '[:space:]' < "$PIN")"
[[ "$pinned" =~ ^[0-9a-f]{40}$ ]] || fatal "engine pin $PIN is not one 40-hex sha: '$pinned'"

engine="$(awk -F= '$1 == "ENGINE_COMMIT" {print $2; exit}' "$MANIFEST" | tr -d '[:space:]')"
[[ "$engine" =~ ^[0-9a-f]{40}$ ]] || fatal "manifest declares no usable ENGINE_COMMIT: '$engine'"
[[ "$engine" == "$pinned" ]] \
  || fail "manifest ENGINE_COMMIT is kalsallama@$engine but $PIN pins kalsallama@$pinned"

for skel in "${SKELS[@]}"; do
  f="$BIN/$skel"
  [[ -f "$f" ]] || fail "missing skel $f"
  want="$(awk -F= -v s="$skel" '$1 == s {print $2; exit}' "$MANIFEST" | tr -d '[:space:]')"
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || fatal "manifest has no sha256 for $skel"
  got="$("${HASH[@]}" "$f" | awk '{print $1}')"
  [[ "$got" == "$want" ]] || fail "$skel hash $got != manifest $want"
done

echo "[htp-skels] OK: 4 skels match HTP_SKELS, ENGINE_COMMIT kalsallama@${engine:0:12} == $PIN"
