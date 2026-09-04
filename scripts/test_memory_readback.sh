#!/usr/bin/env bash
# Test the memory read-back assert logic with fake inputs.
# Verifies the assert fires correctly for both branches:
# - asked-on/got-on → pass
# - asked-on/got-off → die
# - asked-off/got-off → pass  
# - asked-off/got-on → die
set -uo pipefail

# Mock sql() to return fake values
sql() {
  echo "$MOCK_MEMORY_VALUE"
}

# Mock die() to capture instead of exit
_died=""
die() { _died="FATAL: $*"; }

pass=0
fail=0

# Test 1: asked-on/got-on → should pass
MOCK_MEMORY_VALUE="1"
MEMORY="1"
MEMORY_PREF_RAW=$(sql | head -1 | tr -d '[:space:]')
_died=""
[ "$MEMORY_PREF_RAW" = "$MEMORY" ] || die "memory pref on device is '$MEMORY_PREF_RAW', expected '$MEMORY'"
if [ -z "$_died" ]; then
  echo "PASS: asked-on/got-on — no die"
  pass=$((pass + 1))
else
  echo "FAIL: asked-on/got-on — unexpected die: $_died"
  fail=$((fail + 1))
fi

# Test 2: asked-on/got-off → should die
MOCK_MEMORY_VALUE="0"
MEMORY="1"
MEMORY_PREF_RAW=$(sql | head -1 | tr -d '[:space:]')
_died=""
[ "$MEMORY_PREF_RAW" = "$MEMORY" ] || die "memory pref on device is '$MEMORY_PREF_RAW', expected '$MEMORY'"
if echo "$_died" | grep -q "memory pref on device is '0', expected '1'"; then
  echo "PASS: asked-on/got-off — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: asked-on/got-off — die missing or wrong (got: '$_died')"
  fail=$((fail + 1))
fi

# Test 3: asked-off/got-off → should pass
MOCK_MEMORY_VALUE="0"
MEMORY="0"
MEMORY_PREF_RAW=$(sql | head -1 | tr -d '[:space:]')
_died=""
[ "$MEMORY_PREF_RAW" = "$MEMORY" ] || die "memory pref on device is '$MEMORY_PREF_RAW', expected '$MEMORY'"
if [ -z "$_died" ]; then
  echo "PASS: asked-off/got-off — no die"
  pass=$((pass + 1))
else
  echo "FAIL: asked-off/got-off — unexpected die: $_died"
  fail=$((fail + 1))
fi

# Test 4: asked-off/got-on → should die
MOCK_MEMORY_VALUE="1"
MEMORY="0"
MEMORY_PREF_RAW=$(sql | head -1 | tr -d '[:space:]')
_died=""
[ "$MEMORY_PREF_RAW" = "$MEMORY" ] || die "memory pref on device is '$MEMORY_PREF_RAW', expected '$MEMORY'"
if echo "$_died" | grep -q "memory pref on device is '1', expected '0'"; then
  echo "PASS: asked-off/got-on — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: asked-off/got-on — die missing or wrong (got: '$_died')"
  fail=$((fail + 1))
fi

echo ""
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
