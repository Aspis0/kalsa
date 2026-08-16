#!/usr/bin/env bash
# Unit-test the pure guard functions (assert_size_match, check_free_space,
# assert_engine_ran) from scripts/ci-lib.sh with fake inputs — no emulator needed.
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

# ── Engine positive control (assert_engine_ran) ──────────────────────
# Guards the bench arm that exited 0 with 7 error-bubble turns because the model
# never loaded. Numbers only: no case here may depend on reply language.
TJ="$OUT/telemetry.jsonl"

# Test 4: real telemetry line → engine alive, must NOT die.
_died=""
echo '{"turnId":"t1","round":0,"tokensCached":0,"tokensEvaluated":128,"tokensPredicted":64,"predictedPerSecond":7.5}' > "$TJ"
assert_engine_ran "$TJ" 1
if [ -z "$_died" ]; then
  echo "PASS: engine ran — tokensEvaluated=128, no die"
  pass=$((pass + 1))
else
  echo "FAIL: engine ran — unexpected die: $_died"
  fail=$((fail + 1))
fi

# Test 5: empty telemetry.jsonl (no KALSA_TELEMETRY line at all) → must die.
_died=""
: > "$TJ"
assert_engine_ran "$TJ" 1
if echo "$_died" | grep -q "engine never ran on turn 1" \
  && echo "$_died" | grep -q "tokensEvaluated<=0"; then
  echo "PASS: empty telemetry — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: empty telemetry — die missing/incomplete (got: '$_died')"
  fail=$((fail + 1))
fi

# Test 6: tokensEvaluated 0 (line present, engine evaluated nothing) → must die.
_died=""
echo '{"turnId":"t1","round":0,"tokensEvaluated":0,"tokensPredicted":0}' > "$TJ"
assert_engine_ran "$TJ" 1
if echo "$_died" | grep -q "engine never ran on turn 1"; then
  echo "PASS: tokensEvaluated=0 — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: tokensEvaluated=0 — no die (got: '$_died')"
  fail=$((fail + 1))
fi

# Test 7: malformed line (truncated JSON — logcat cuts lines at ~4 KB) → must die.
_died=""
echo '{"turnId":"t1","tokensEvaluated":12' > "$TJ"
assert_engine_ran "$TJ" 1
if echo "$_died" | grep -q "engine never ran on turn 1"; then
  echo "PASS: malformed line — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: malformed line — no die (got: '$_died')"
  fail=$((fail + 1))
fi

# Test 8: field absent (valid JSON, no tokensEvaluated) → must die.
_died=""
echo '{"turnId":"t1","round":0,"tokensPredicted":64}' > "$TJ"
assert_engine_ran "$TJ" 1
if echo "$_died" | grep -q "engine never ran on turn 1"; then
  echo "PASS: tokensEvaluated absent — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: tokensEvaluated absent — no die (got: '$_died')"
  fail=$((fail + 1))
fi

# Test 9: a summarize line can precede the chat turn's line (capture_turn_evidence
# keeps every KALSA_TELEMETRY since the last logcat clear) — any line with
# tokensEvaluated > 0 proves the engine ran, even after a malformed one.
_died=""
{
  echo '{"turnId":"t0","tokensEvaluated":'
  echo '{"turnId":"t1","round":0,"tokensEvaluated":512,"tokensPredicted":31}'
} > "$TJ"
assert_engine_ran "$TJ" 1
if [ -z "$_died" ]; then
  echo "PASS: mixed lines — one good line is enough, no die"
  pass=$((pass + 1))
else
  echo "FAIL: mixed lines — unexpected die: $_died"
  fail=$((fail + 1))
fi

# ── Device wakefulness decision (wakefulness_is_fatal) ──────────────
# Pure logic: given a mWakefulness token, decide whether the arm must die.
# Awake/""/unknown → continue; Dozing/Asleep/Dreaming → die. This is the check
# that would have saved the S23 arm (die early on a dozing device instead of
# burning the 40-min reply timeout). A guard nobody has seen fire is not a guard.

# _wf_expect <token> <expect_fatal:0|1> <label>
_wf_expect() {
  local token="$1" expect="$2" label="$3" rc
  wakefulness_is_fatal "$token"; rc=$?
  if [ "$expect" -eq 1 ]; then
    if [ "$rc" -eq 0 ]; then
      echo "PASS: $label — wakefulness='$token' is fatal (arm dies)"
      pass=$((pass + 1))
    else
      echo "FAIL: $label — wakefulness='$token' expected fatal but continued"
      fail=$((fail + 1))
    fi
  else
    if [ "$rc" -ne 0 ]; then
      echo "PASS: $label — wakefulness='$token' continues (arm continues)"
      pass=$((pass + 1))
    else
      echo "FAIL: $label — wakefulness='$token' expected continue but died"
      fail=$((fail + 1))
    fi
  fi
}

# Awake → continue (not fatal)
_wf_expect "Awake" 0 "wakefulness Awake"
# Dozing → die
_wf_expect "Dozing" 1 "wakefulness Dozing"
# Asleep → die
_wf_expect "Asleep" 1 "wakefulness Asleep"
# Dreaming → die
_wf_expect "Dreaming" 1 "wakefulness Dreaming"
# empty → continue (probe did not answer — never fail an arm on that)
_wf_expect "" 0 "wakefulness empty"
# unknown → continue (never fail on a probe that did not answer)
_wf_expect "Partial" 0 "wakefulness unknown"

# ── Deviceidle whitelist matcher (_device_whitelist_match) ───────────
# dumpsys deviceidle whitelist prints section headers and one package per
# indented line — no commas. Exact trimmed-line match against $PKG; a name
# that merely has $PKG as a prefix must not match.

_WL_SAMPLE_PRESENT="  Whitelist system apps:
    com.android.providers.downloads
    com.sec.android.app.shealth
  Whitelist user apps:
    com.kalsa.app
    com.example.other"

_WL_SAMPLE_ABSENT="  Whitelist system apps:
    com.android.providers.downloads
  Whitelist user apps:
    com.example.other"

_WL_SAMPLE_PREFIX="  Whitelist user apps:
    com.kalsa.app.extra
    com.kalsa.application"

# _wl_expect <dumpsys-text> <expect:0|1> <label>
_wl_expect() {
  local text="$1" expect="$2" label="$3" got
  got=$(_device_whitelist_match "$text")
  if [ "$got" = "$expect" ]; then
    echo "PASS: $label — match=$got"
    pass=$((pass + 1))
  else
    echo "FAIL: $label — expected match=$expect got=$got"
    fail=$((fail + 1))
  fi
}

_wl_expect "$_WL_SAMPLE_PRESENT" 1 "whitelist present (indented exact line)"
_wl_expect "$_WL_SAMPLE_ABSENT" 0 "whitelist absent"
_wl_expect "" 0 "whitelist empty input"
_wl_expect "$_WL_SAMPLE_PREFIX" 0 "whitelist prefix/substring must not match"

# ── screen_off_timeout restore decision ──────────────────────────────
# Pure: given the value saved at setup, decide put / delete / leave.
#   numeric → put it back
#   null    → delete (settings put cannot undo "unset")
#   empty   → leave + warn (adb unreadable)
#   == KA_SCREEN_TIMEOUT_MS → delete (leak from a prior un-restored run)

# _to_expect <saved> <expect-decision> <label>
_to_expect() {
  local saved="$1" expect="$2" label="$3" got
  got=$(_device_timeout_restore_decision "$saved")
  if [ "$got" = "$expect" ]; then
    echo "PASS: $label — decision='$got'"
    pass=$((pass + 1))
  else
    echo "FAIL: $label — expected '$expect' got '$got'"
    fail=$((fail + 1))
  fi
}

_to_expect "30000" "put 30000" "timeout restore numeric"
_to_expect "null" "delete" "timeout restore null → delete"
_to_expect "" "leave" "timeout restore empty/unreadable → leave"
_to_expect "$KA_SCREEN_TIMEOUT_MS" "delete" "timeout restore leak (== KA ceiling) → delete"

# ── NOREPACK env validation (validate_bench_norepack) ────────────────
# empty / 0 / 1 accepted; anything else dies. Same contract as NCTX empty=
# leave-absent; only the accepted set differs (boolean axis, not integer).

# _nr_expect <value> <expect_ok:0|1> <label>
_nr_expect() {
  local value="$1" expect="$2" label="$3"
  _died=""
  validate_bench_norepack "$value"
  if [ "$expect" -eq 1 ]; then
    if [ -z "$_died" ]; then
      echo "PASS: $label — accepted"
      pass=$((pass + 1))
    else
      echo "FAIL: $label — unexpected die: $_died"
      fail=$((fail + 1))
    fi
  else
    if echo "$_died" | grep -q "NOREPACK must be empty, 0, or 1"; then
      echo "PASS: $label — die fired: $_died"
      pass=$((pass + 1))
    else
      echo "FAIL: $label — expected die, got: '$_died'"
      fail=$((fail + 1))
    fi
  fi
}

_nr_expect "" 1 "NOREPACK empty accepted"
_nr_expect "0" 1 "NOREPACK 0 accepted"
_nr_expect "1" 1 "NOREPACK 1 accepted"
_nr_expect "2" 0 "NOREPACK 2 rejected"
_nr_expect "yes" 0 "NOREPACK yes rejected"
_nr_expect "-1" 0 "NOREPACK -1 rejected"

# ── Message submission decision (message_was_submitted) ─────────────
# Pure logic: did the message leave the composer? Count grew, or count
# equal with empty composer → submitted; equal + still holding text, or
# garbage count probes → not submitted (retry / never false success).

# _ms_expect <prev> <cur> <composer> <expect_submitted:0|1> <label>
# expect_submitted 1 → function returns 0; 0 → function returns 1.
_ms_expect() {
  local prev="$1" cur="$2" ctext="$3" expect="$4" label="$5" rc
  message_was_submitted "$prev" "$cur" "$ctext"; rc=$?
  if [ "$expect" -eq 1 ]; then
    if [ "$rc" -eq 0 ]; then
      echo "PASS: $label — submitted (rc=0)"
      pass=$((pass + 1))
    else
      echo "FAIL: $label — expected submitted, got rc=$rc"
      fail=$((fail + 1))
    fi
  else
    if [ "$rc" -ne 0 ]; then
      echo "PASS: $label — not submitted (rc=$rc)"
      pass=$((pass + 1))
    else
      echo "FAIL: $label — expected not submitted, got rc=0"
      fail=$((fail + 1))
    fi
  fi
}

# count grew → submitted
_ms_expect "2" "3" "still here" 1 "message_was_submitted count grew"
# count equal + composer still holding text → NOT submitted
_ms_expect "2" "2" "hello world" 0 "message_was_submitted equal + text"
# count equal + composer empty → submitted (reply may not have landed)
_ms_expect "2" "2" "" 1 "message_was_submitted equal + empty"
# count equal + probe failed (dump unavailable) → NOT submitted (retry send)
_ms_expect "2" "2" "$COMPOSER_PROBE_FAILED" 0 "message_was_submitted equal + probe failed"
# empty / unknown / non-integer probes → NOT submitted
_ms_expect "" "2" "" 0 "message_was_submitted empty prev"
_ms_expect "2" "" "" 0 "message_was_submitted empty cur"
_ms_expect "x" "2" "" 0 "message_was_submitted non-integer prev"
_ms_expect "2" "n/a" "" 0 "message_was_submitted non-integer cur"

rm -rf "$OUT"
echo ""
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
