#!/usr/bin/env bash
# Unit-test the sideload guard functions (assert_size_match, check_free_space)
# from scripts/ci-lib.sh with fake inputs — no emulator needed.
# A guard nobody has seen fire is not a guard.
set -uo pipefail

OUT=$(mktemp -d)
PKG=com.kalsa.app

# Source ci-lib.sh for the function definitions.
# It also defines die/log/ui_texts/shot — we override all four below.
source "$(dirname "$0")/ci-lib.sh"

# ── Override die/log to capture instead of exit/print ──
_died=""
die() { _died="FATAL: $*"; }
log() { :; }            # silence during tests
ui_texts() { :; }       # die calls this; no adb in test env
shot() { :; }           # die calls this; no adb in test env

pass=0
fail=0

# ── Test 1: size match (should NOT die) ──────────────────────────────
_died=""
assert_size_match "1234567" "1234567" "test-model.gguf"
if [ -z "$_died" ]; then
  echo "PASS: size match — equal sizes, no die"
  pass=$((pass + 1))
else
  echo "FAIL: size match — unexpected die: $_died"
  fail=$((fail + 1))
fi

# ── Test 2: short file (should die with both numbers + label) ────────
_died=""
assert_size_match "1000000" "1234567" "LFM2.5-8B.gguf"
if echo "$_died" | grep -q "1000000" \
  && echo "$_died" | grep -q "1234567" \
  && echo "$_died" | grep -q "LFM2.5-8B.gguf"; then
  echo "PASS: short file — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: short file — die missing sizes (got: '$_died')"
  fail=$((fail + 1))
fi

# ── Test 3: insufficient space (should die with model name + both sizes) ─
_died=""
check_free_space "5000000000" "5200000000" "LFM2.5-8B-A1B.gguf"
if echo "$_died" | grep -q "LFM2.5-8B-A1B.gguf" \
  && echo "$_died" | grep -q "5200000000" \
  && echo "$_died" | grep -q "5000000000"; then
  echo "PASS: insufficient space — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: insufficient space — die incomplete (got: '$_died')"
  fail=$((fail + 1))
fi

rm -rf "$OUT"
echo ""
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
