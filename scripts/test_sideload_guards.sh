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
assert_size_match "1000000" "1234567" "short-model.gguf"
if echo "$_died" | grep -q "1000000" \
  && echo "$_died" | grep -q "1234567" \
  && echo "$_died" | grep -q "short-model.gguf"; then
  echo "PASS: short file — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: short file — die missing sizes (got: '$_died')"
  fail=$((fail + 1))
fi

# ── Test 3: insufficient space (should die with model name + both sizes) ─
_died=""
check_free_space "5000000000" "5200000000" "large-model.gguf"
if echo "$_died" | grep -q "large-model.gguf" \
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

# ── wait_for_engine_ran (poll, not single-sample) ───────────────────
# Fake log source via refresh_fn — no adb. Short timeout/interval so the suite
# stays cheap. Covers the race: UI settled before KALSA_TELEMETRY landed.

# Test 10: line present immediately → returns at once (no wait log).
_died=""
_logs=""
log() { _logs="${_logs}$1"$'\n'; }
echo '{"turnId":"t1","round":0,"tokensEvaluated":99,"tokensPredicted":10}' > "$TJ"
wait_for_engine_ran "$TJ" 1 2 1 ""
if [ -z "$_died" ] && ! echo "$_logs" | grep -q "appeared after"; then
  echo "PASS: wait immediate — no die, no wait log"
  pass=$((pass + 1))
else
  echo "FAIL: wait immediate — died='$_died' logs='$_logs'"
  fail=$((fail + 1))
fi
log() { :; }

# Test 11: line appears only after a few polls → returns and reports the wait.
_died=""
_logs=""
_refresh_n=0
_fake_late_telemetry() {
  _refresh_n=$((_refresh_n + 1))
  # After 2 sleeps (waited=2 with interval 1) refresh has run twice → write line.
  if [ "$_refresh_n" -ge 2 ]; then
    echo '{"turnId":"t1","round":0,"tokensEvaluated":77,"tokensPredicted":5}' > "$TJ"
  fi
}
log() { _logs="${_logs}$1"$'\n'; }
: > "$TJ"
wait_for_engine_ran "$TJ" 1 5 1 _fake_late_telemetry
if [ -z "$_died" ] && echo "$_logs" | grep -q "telemetry appeared after 2s wait"; then
  echo "PASS: wait late — appeared after 2s, no die"
  pass=$((pass + 1))
else
  echo "FAIL: wait late — died='$_died' logs='$_logs' refresh_n=$_refresh_n"
  fail=$((fail + 1))
fi
log() { :; }

# Test 12: line never appears → still dies with the existing message.
_died=""
: > "$TJ"
_noop_refresh() { :; }
wait_for_engine_ran "$TJ" 1 2 1 _noop_refresh
if echo "$_died" | grep -q "engine never ran on turn 1" \
  && echo "$_died" | grep -q "tokensEvaluated<=0"; then
  echo "PASS: wait never — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: wait never — no/ incomplete die (got: '$_died')"
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

# ── Device thermal decision (thermal_decision) ──────────────────────
# Pure: (status, battery_deci_c) → continue | pause | unknown.
# Pause at SEVERE/44°C (S23 arm: 44.1°C + status 3 while turns doubled);
# unreadable → unknown (gate never acts — same rule as wakefulness).

# _th_expect <status> <battery_deci> <expect_decision> <label>
_th_expect() {
  local status="$1" batt="$2" expect="$3" label="$4" got
  got=$(thermal_decision "$status" "$batt")
  if [ "$got" = "$expect" ]; then
    echo "PASS: $label — decision='$got'"
    pass=$((pass + 1))
  else
    echo "FAIL: $label — expected '$expect' got '$got' (status='$status' batt='$batt')"
    fail=$((fail + 1))
  fi
}

# status 0 + 25.0°C → continue
_th_expect "0" "250" "continue" "thermal status 0 / 25°C → continue"
# status 3 (SEVERE) → pause (battery irrelevant once SEVERE)
_th_expect "3" "250" "pause" "thermal status 3 (SEVERE) → pause"
# battery 44.0°C with status 1 → pause
_th_expect "1" "440" "pause" "thermal battery 44.0°C status 1 → pause"
# status 1 + 38.0°C after a pause → resume (= continue)
_th_expect "1" "380" "continue" "thermal status 1 / 38°C after pause → resume"
# unreadable probe → unknown (gate continues; never act on mute probe)
_th_expect "" "" "unknown" "thermal empty probe → unknown (continue)"
_th_expect "N/A" "N/A" "unknown" "thermal N/A probe → unknown (continue)"

# cool-enough helper (wait-loop exit): status 1 + 38°C resumes; status 2 stays hot
if thermal_is_cool_enough "1" "380"; then
  echo "PASS: thermal_is_cool_enough status 1 / 38°C → yes (resume)"
  pass=$((pass + 1))
else
  echo "FAIL: thermal_is_cool_enough status 1 / 38°C expected yes"
  fail=$((fail + 1))
fi
if ! thermal_is_cool_enough "2" "380"; then
  echo "PASS: thermal_is_cool_enough status 2 / 38°C → no (keep waiting)"
  pass=$((pass + 1))
else
  echo "FAIL: thermal_is_cool_enough status 2 / 38°C expected no"
  fail=$((fail + 1))
fi
if ! thermal_is_cool_enough "" "380"; then
  echo "PASS: thermal_is_cool_enough unreadable → no (never act)"
  pass=$((pass + 1))
else
  echo "FAIL: thermal_is_cool_enough unreadable expected no"
  fail=$((fail + 1))
fi

# ci-bench must call the gate before each turn and record thermal evidence
if grep -qF 'device_thermal_gate' "$(dirname "$0")/ci-bench.sh" \
  && grep -qF 'thermal.txt' "$(dirname "$0")/ci-bench.sh"; then
  echo "PASS: ci-bench.sh wires device_thermal_gate + thermal.txt evidence"
  pass=$((pass + 1))
else
  echo "FAIL: ci-bench.sh missing device_thermal_gate / thermal.txt wire-up"
  fail=$((fail + 1))
fi

# thresholds must cite the S23 measurement (44.1°C / status 3)
if grep -qF 'THERMAL_STATUS_PAUSE=3' "$(dirname "$0")/ci-lib.sh" \
  && grep -qF 'THERMAL_BATTERY_PAUSE_DECI=440' "$(dirname "$0")/ci-lib.sh" \
  && grep -qF '44.1' "$(dirname "$0")/ci-lib.sh"; then
  echo "PASS: thermal thresholds documented with S23 44.1°C / status 3 evidence"
  pass=$((pass + 1))
else
  echo "FAIL: thermal thresholds missing or undocumented in ci-lib.sh"
  fail=$((fail + 1))
fi

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

# ── NGL env validation + the JSON it writes ──────────────────────────
# empty or a non-negative integer. The JSON is asserted here because
# ci-bench writes it and asserts it back through the SAME function: if
# bench_engine_json ever drifts, the arm's assert drifts with it and
# stops being a check. This is the test that notices.

# _ngl_expect <value> <expect_ok:0|1> <label>
_ngl_expect() {
  local value="$1" expect="$2" label="$3"
  _died=""
  validate_bench_ngl "$value"
  if [ "$expect" -eq 1 ]; then
    if [ -z "$_died" ]; then
      echo "PASS: $label — accepted"
      pass=$((pass + 1))
    else
      echo "FAIL: $label — unexpected die: $_died"
      fail=$((fail + 1))
    fi
  else
    if echo "$_died" | grep -q "NGL must be empty or a non-negative integer"; then
      echo "PASS: $label — die fired: $_died"
      pass=$((pass + 1))
    else
      echo "FAIL: $label — expected die, got: '$_died'"
      fail=$((fail + 1))
    fi
  fi
}

_ngl_expect "" 1 "NGL empty accepted"
_ngl_expect "0" 1 "NGL 0 accepted"
_ngl_expect "99" 1 "NGL 99 accepted"
_ngl_expect "-1" 0 "NGL -1 rejected"
_ngl_expect "all" 0 "NGL all rejected"
_ngl_expect "9 9" 0 "NGL with a space rejected"

# The escort is the point: layers without flashAttn "off" are ignored on
# Android by applyEngineOverride, so an arm written without it would run on
# CPU while reporting itself as GPU.
_ngl_json=$(bench_engine_json 99)
if [ "$_ngl_json" = '{"nGpuLayers":99,"flashAttn":"off"}' ]; then
  echo "PASS: bench_engine_json carries the mandatory flashAttn escort"
  pass=$((pass + 1))
else
  echo "FAIL: bench_engine_json produced '$_ngl_json'"
  fail=$((fail + 1))
fi

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

# ── Active conversation resolution (multi-chat storage) ─────────────
# Shape from ConversationsStore: { activeId, items:[{id, updatedAt, …}] }.
# Rule: activeId when it names an item; else most recent by updatedAt.
# Empty index → "" (legacy key fallback). Present but bad → die.
# Call resolve in the current shell (redirect stdout) so overridden die can
# set _died — command substitution would hide die in a subshell.

# one conversation → its id, keys built correctly
_died=""
_one='{"activeId":"conv-1786896210824-bj2n8joh","items":[{"id":"conv-1786896210824-bj2n8joh","title":"hi","updatedAt":1786896210824,"preview":"ok","searchBlob":"hi"}]}'
resolve_active_conversation_id "$_one" > "$OUT/conv_id.txt"
_got=$(tr -d '\n' < "$OUT/conv_id.txt")
_mkey=$(messages_storage_key "$_got")
_ckey=$(compactor_storage_key "$_got")
if [ -z "$_died" ] \
  && [ "$_got" = "conv-1786896210824-bj2n8joh" ] \
  && [ "$_mkey" = "kalsa.messages.conv-1786896210824-bj2n8joh" ] \
  && [ "$_ckey" = "kalsa.chat.compactor.conv-1786896210824-bj2n8joh" ]; then
  echo "PASS: one conversation — id + keys resolved"
  pass=$((pass + 1))
else
  echo "FAIL: one conversation — got id='$_got' mkey='$_mkey' ckey='$_ckey' die='$_died'"
  fail=$((fail + 1))
fi

# several conversations → activeId wins over a more recent non-active item
_died=""
_multi='{"activeId":"conv-old","items":[{"id":"conv-old","title":"a","updatedAt":100,"preview":"","searchBlob":""},{"id":"conv-new","title":"b","updatedAt":999,"preview":"","searchBlob":""}]}'
resolve_active_conversation_id "$_multi" > "$OUT/conv_id.txt"
_got=$(tr -d '\n' < "$OUT/conv_id.txt")
if [ -z "$_died" ] && [ "$_got" = "conv-old" ]; then
  echo "PASS: several conversations — activeId wins (not most-recent conv-new)"
  pass=$((pass + 1))
else
  echo "FAIL: several conversations activeId — got '$_got' die='$_died'"
  fail=$((fail + 1))
fi

# several conversations, activeId missing/invalid → most recent by updatedAt
_died=""
_multi_fb='{"activeId":"","items":[{"id":"conv-old","title":"a","updatedAt":100,"preview":"","searchBlob":""},{"id":"conv-new","title":"b","updatedAt":999,"preview":"","searchBlob":""}]}'
resolve_active_conversation_id "$_multi_fb" > "$OUT/conv_id.txt"
_got=$(tr -d '\n' < "$OUT/conv_id.txt")
if [ -z "$_died" ] && [ "$_got" = "conv-new" ]; then
  echo "PASS: several conversations — empty activeId falls back to most recent (updatedAt)"
  pass=$((pass + 1))
else
  echo "FAIL: several conversations fallback — got '$_got' die='$_died'"
  fail=$((fail + 1))
fi

# empty items list → die naming the index key
_died=""
: > "$OUT/conv_id.txt"
resolve_active_conversation_id '{"activeId":"","items":[]}' > "$OUT/conv_id.txt"
_got=$(tr -d '\n' < "$OUT/conv_id.txt")
if echo "$_died" | grep -q "kalsa.conversations.v1" \
  && echo "$_died" | grep -qiE "unparseable|empty|cannot resolve"; then
  echo "PASS: empty list — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: empty list — expected die naming key (got id='$_got' die='$_died')"
  fail=$((fail + 1))
fi

# malformed JSON → die naming the index key
_died=""
: > "$OUT/conv_id.txt"
resolve_active_conversation_id '{not-json' > "$OUT/conv_id.txt"
_got=$(tr -d '\n' < "$OUT/conv_id.txt")
if echo "$_died" | grep -q "kalsa.conversations.v1"; then
  echo "PASS: malformed JSON — die fired: $_died"
  pass=$((pass + 1))
else
  echo "FAIL: malformed JSON — expected die (got id='$_got' die='$_died')"
  fail=$((fail + 1))
fi

# legacy shape: no index value → empty id → legacy messages key
_died=""
resolve_active_conversation_id "" > "$OUT/conv_id.txt"
_got=$(tr -d '\n' < "$OUT/conv_id.txt")
_mkey=$(messages_storage_key "$_got")
_ckey=$(compactor_storage_key "$_got")
if [ -z "$_died" ] \
  && [ -z "$_got" ] \
  && [ "$_mkey" = "kalsa.messages.v1" ] \
  && [ "$_ckey" = "kalsa.chat.compactor.default" ]; then
  echo "PASS: legacy shape (no list) — fallback to kalsa.messages.v1 + compactor.default"
  pass=$((pass + 1))
else
  echo "FAIL: legacy shape — got id='$_got' mkey='$_mkey' ckey='$_ckey' die='$_died'"
  fail=$((fail + 1))
fi

# list_conversation_ids: both ids, one per line (reset wipe target)
_ids=$(list_conversation_ids "$_multi" | tr '\n' ' ')
if echo "$_ids" | grep -q "conv-old" && echo "$_ids" | grep -q "conv-new"; then
  echo "PASS: list_conversation_ids returns both ids"
  pass=$((pass + 1))
else
  echo "FAIL: list_conversation_ids — got '$_ids'"
  fail=$((fail + 1))
fi

# ── KALSA_KVDIAG0 capture (capture_kvdiag_from_buf / kvdiag_meta_lines) ──
# Same contract as capture_turn_evidence neighbours: fixture buffer → sibling
# file; empty buffer → empty file (not missing). loadprompt greps stay separate.

_KV_BUF="$OUT/kvdiag_buf.txt"
_KV_DEST="$OUT/kvdiag.txt"
_KV_LINE='08-16 12:00:01.000  1234  5678 W llama-rn: KALSA_KVDIAG0 cache_len=1713 prompt_len=1840 cache_head=[1 2 3 4 5 6 7 8 9 10 11 12 ] prompt_head=[1 99 3 4 5 6 7 8 9 10 11 12 ]'
{
  echo "08-16 12:00:00.000  1234  5678 W llama-rn: some unrelated warning"
  echo "$_KV_LINE"
  echo "08-16 12:00:02.000  1234  5678 I llama-rn: KALSA_KVPREFIX embd=0 text_tokens=1840 n_common=0 mtp_draft_mem_shared=0 is_enc_dec=0 this=0x1"
} > "$_KV_BUF"

capture_kvdiag_from_buf "$_KV_BUF" "$_KV_DEST"
if [ -f "$_KV_DEST" ] \
  && grep -qF "KALSA_KVDIAG0 cache_len=1713 prompt_len=1840" "$_KV_DEST" \
  && ! grep -qF "unrelated warning" "$_KV_DEST" \
  && ! grep -qF "KALSA_KVPREFIX" "$_KV_DEST"; then
  echo "PASS: kvdiag capture — diagnostic lands, noise excluded"
  pass=$((pass + 1))
else
  echo "FAIL: kvdiag capture — got: '$(tr '\n' '|' < "$_KV_DEST" 2>/dev/null)'"
  fail=$((fail + 1))
fi

# Existing loadprompt greps unchanged: still see KALSA_KVPREFIX from same buf.
_LP_DEST="$OUT/loadprompt.txt"
{
  grep -F "KALSA_KVPREFIX" "$_KV_BUF" 2>/dev/null || true
  grep -F "restored state checkpoint: reusing" "$_KV_BUF" 2>/dev/null || true
} > "$_LP_DEST" 2>/dev/null || : > "$_LP_DEST"
if grep -qF "KALSA_KVPREFIX embd=0 text_tokens=1840 n_common=0" "$_LP_DEST" \
  && ! grep -qF "KALSA_KVDIAG0" "$_LP_DEST"; then
  echo "PASS: loadprompt greps unchanged — KALSA_KVPREFIX only, no KVDIAG bleed"
  pass=$((pass + 1))
else
  echo "FAIL: loadprompt greps — got: '$(tr '\n' '|' < "$_LP_DEST" 2>/dev/null)'"
  fail=$((fail + 1))
fi

# prompt_meta surfaces cache_len/prompt_len (same style as reused=/total=)
_META=$(kvdiag_meta_lines "$_KV_DEST" | tr -d '\r')
if [ "$_META" = "cache_len=1713 prompt_len=1840" ]; then
  echo "PASS: kvdiag_meta_lines — cache_len/prompt_len for prompt_meta"
  pass=$((pass + 1))
else
  echo "FAIL: kvdiag_meta_lines — got '$_META'"
  fail=$((fail + 1))
fi

# Empty buffer → empty file, not missing
: > "$_KV_BUF"
rm -f "$_KV_DEST"
capture_kvdiag_from_buf "$_KV_BUF" "$_KV_DEST"
if [ -f "$_KV_DEST" ] && [ ! -s "$_KV_DEST" ]; then
  echo "PASS: empty buffer → empty kvdiag.txt (file exists)"
  pass=$((pass + 1))
else
  echo "FAIL: empty buffer — exists=$([ -f "$_KV_DEST" ] && echo y || echo n) size=$(wc -c < "$_KV_DEST" 2>/dev/null || echo missing)"
  fail=$((fail + 1))
fi

# ci-bench must wire the pure helper into capture_turn_evidence
if grep -qF 'capture_kvdiag_from_buf "$buf" "$tdir/kvdiag.txt"' "$(dirname "$0")/ci-bench.sh" \
  && grep -qF 'kvdiag_meta_lines "$tdir/kvdiag.txt"' "$(dirname "$0")/ci-bench.sh"; then
  echo "PASS: ci-bench.sh wires kvdiag capture + prompt_meta surface"
  pass=$((pass + 1))
else
  echo "FAIL: ci-bench.sh missing capture_kvdiag_from_buf / kvdiag_meta_lines wire-up"
  fail=$((fail + 1))
fi

# ── capture_kv_reuse: the shipped shell collector on synthetic logcat ───
# capture_kv_reuse calls `adb logcat -d`; stub adb so the test exercises the
# shipped grep/tail/dump-sidecar path instead of a copy of it.

_FAKE_LOGCAT="$OUT/fake_logcat.txt"
adb() { cat "$_FAKE_LOGCAT"; }

_KVP_PREWARM='09-19 12:00:00.100  1  1 W rnllama: KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832 mtp_draft_mem_shared=0 is_enc_dec=0 this=0x1'
_KVP_CHAT='09-19 12:00:00.200  1  1 W rnllama: KALSA_KVPREFIX embd=1600 text_tokens=4800 n_common=2865 mtp_draft_mem_shared=0 is_enc_dec=0 this=0x1'
{
  echo "09-19 12:00:00.000  1  1 I ReactNativeJS: unrelated line that must not be captured"
  echo "$_KVP_PREWARM"
  echo "$_KVP_CHAT"
} > "$_FAKE_LOGCAT"
capture_kv_reuse 9

_REUSE_T9="$OUT/reuse_t9.txt"
_REUSE_LINES=$(wc -l < "$_REUSE_T9" 2>/dev/null | tr -d ' ')
# Two marker-only lines (logcat prefix stripped), newest last.
if [ "$_REUSE_LINES" = "2" ] \
  && grep -qF "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832" "$_REUSE_T9" \
  && grep -qF "KALSA_KVPREFIX embd=1600 text_tokens=4800 n_common=2865" "$_REUSE_T9" \
  && [ "$(tail -1 "$_REUSE_T9" | grep -c '^KALSA_KVPREFIX')" = "1" ]; then
  echo "PASS: capture_kv_reuse extracts KALSA_KVPREFIX lines (old-regex mutation dies here)"
  pass=$((pass + 1))
else
  echo "FAIL: capture_kv_reuse extraction — got: '$(tr '\n' '|' < "$_REUSE_T9" 2>/dev/null)'"
  fail=$((fail + 1))
fi

if grep -qF "dump=content" "$OUT/reuse_t9.dump" 2>/dev/null; then
  echo "PASS: capture_kv_reuse records dump=content when logcat returned lines"
  pass=$((pass + 1))
else
  echo "FAIL: reuse_t9.dump — got '$(cat "$OUT/reuse_t9.dump" 2>/dev/null)'"
  fail=$((fail + 1))
fi

# Content but no marker: empty reuse file, sidecar still says content (BROKEN).
echo "09-19 12:00:01.000  1  1 I ReactNativeJS: nothing useful here" > "$_FAKE_LOGCAT"
rm -f "$_REUSE_T9" "$OUT/reuse_t9.dump"
capture_kv_reuse 9
if [ -f "$_REUSE_T9" ] && [ ! -s "$_REUSE_T9" ] \
  && grep -qF "dump=content" "$OUT/reuse_t9.dump" 2>/dev/null; then
  echo "PASS: content-but-no-marker → empty reuse file, dump=content (BROKEN case)"
  pass=$((pass + 1))
else
  echo "FAIL: content-but-no-marker — reuse size=$(wc -c < "$_REUSE_T9" 2>/dev/null) dump='$(cat "$OUT/reuse_t9.dump" 2>/dev/null)'"
  fail=$((fail + 1))
fi

# Failed/empty dump: empty reuse file, sidecar says empty (soft UNKNOWN).
: > "$_FAKE_LOGCAT"
rm -f "$_REUSE_T9" "$OUT/reuse_t9.dump"
capture_kv_reuse 9
if [ -f "$_REUSE_T9" ] && [ ! -s "$_REUSE_T9" ] \
  && grep -qF "dump=empty" "$OUT/reuse_t9.dump" 2>/dev/null; then
  echo "PASS: empty dump → empty reuse file, dump=empty (soft UNKNOWN case)"
  pass=$((pass + 1))
else
  echo "FAIL: empty dump — reuse size=$(wc -c < "$_REUSE_T9" 2>/dev/null) dump='$(cat "$OUT/reuse_t9.dump" 2>/dev/null)'"
  fail=$((fail + 1))
fi

# ── ci-bench prompt_meta mapping: run the shipped two-line pipeline ─────
# Extracted from ci-bench.sh, never copied: swapping the sed indexes back
# (reused=\1 total=\2) renames the columns and fails this case.
_bench_pipe() {
  awk '
    /grep -oE "KALSA_KVPREFIX embd=/ { p = 1 }
    p { print }
    p && /\|\| true/ { exit }
  ' "$(dirname "$0")/ci-bench.sh"
}
_BENCH_PIPE=$(_bench_pipe)
printf '%s\n' "$_KVP_CHAT" > "$OUT/loadprompt.txt"
_GOT_META=$(tdir="$OUT"; eval "$_BENCH_PIPE")
if [ "$_GOT_META" = "reused=2865 total=4800" ]; then
  echo "PASS: ci-bench prompt_meta maps n_common→reused, text_tokens→total (swap mutation dies here)"
  pass=$((pass + 1))
else
  echo "FAIL: ci-bench prompt_meta pipeline — got '$_GOT_META'"
  fail=$((fail + 1))
fi

# ── ci-e2e embedded node parsers: run the shipped JS on fixtures ───────
# Both blocks are extracted from ci-e2e.sh (never copied), so reintroducing the
# old capture-group indexes (rm[1]/rm[2]) turns these red. The block ends at the
# terminator line, which is the only line starting with a quote; matching on
# `reuse_tN.txt` alone would stop at a comment outside the block.
_e2e_node() {
  local q
  q=$(printf '\047')
  awk -v want="$1" -v q="$q" '
    /^node -e / { inblock = 1; buf = ""; next }
    inblock && substr($0, 1, 1) == q && index($0, want) > 0 { print buf; exit }
    inblock { buf = buf $0 "\n" }
  ' "$(dirname "$0")/ci-e2e.sh"
}
printf '%s\n' '{"tokensEvaluated":4800}' > "$OUT/e2e_telemetry.txt"
printf '%s\n' '{"op":"load","ok":true}' > "$OUT/e2e_session.txt"
printf '%s\n' '{"tokensEvaluated":4800,"promptMs":123}' > "$OUT/e2e_telemetry_restart.txt"
printf '%s\n' "$_KVP_PREWARM" "$_KVP_CHAT" > "$OUT/reuse_t2.txt"
printf 'dump=content bytes=1234\n' > "$OUT/reuse_t2.dump"

_KV_VERDICT=$(node -e "$(_e2e_node reuse_t2.txt)" "$OUT/e2e_telemetry.txt" "$OUT/reuse_t2.txt" "$OUT/reuse_t2.dump" 2>&1)
_KV_LAST=$(printf '%s\n' "$_KV_VERDICT" | tail -1)
if [ "$_KV_LAST" = "KV_CACHE: WARM (turn2 2865/4800 prompt tokens; pre-decision marker, the prefix that could be reused)" ]; then
  echo "PASS: ci-e2e KV_CACHE parser reads n_common/text_tokens (index mutation dies here)"
  pass=$((pass + 1))
else
  echo "FAIL: ci-e2e KV_CACHE parser — got '$_KV_LAST'"
  fail=$((fail + 1))
fi

# Empty dump → soft UNKNOWN naming the cause, never BROKEN.
: > "$OUT/reuse_t2.txt"
printf 'dump=empty\n' > "$OUT/reuse_t2.dump"
_KV_VERDICT=$(node -e "$(_e2e_node reuse_t2.txt)" "$OUT/e2e_telemetry.txt" "$OUT/reuse_t2.txt" "$OUT/reuse_t2.dump" 2>&1)
_KV_LAST=$(printf '%s\n' "$_KV_VERDICT" | tail -1)
if [ "$_KV_LAST" = "KV_CACHE: UNKNOWN (logcat dump carried nothing — reuse instrument not exercised)" ]; then
  echo "PASS: ci-e2e empty dump → soft UNKNOWN, not BROKEN"
  pass=$((pass + 1))
else
  echo "FAIL: ci-e2e empty dump — got '$_KV_LAST'"
  fail=$((fail + 1))
fi

# Content but no marker → BROKEN (the only die path).
printf 'dump=content bytes=9\n' > "$OUT/reuse_t2.dump"
_KV_VERDICT=$(node -e "$(_e2e_node reuse_t2.txt)" "$OUT/e2e_telemetry.txt" "$OUT/reuse_t2.txt" "$OUT/reuse_t2.dump" 2>&1)
_KV_LAST=$(printf '%s\n' "$_KV_VERDICT" | tail -1)
if [ "$_KV_LAST" = "KV_CACHE: BROKEN (no KALSA_KVPREFIX line in the whole run — reuse instrument dead)" ]; then
  echo "PASS: ci-e2e content-but-no-marker → BROKEN (die path)"
  pass=$((pass + 1))
else
  echo "FAIL: ci-e2e content-but-no-marker — got '$_KV_LAST'"
  fail=$((fail + 1))
fi

# A marker exists but for another load: soft UNKNOWN, no number.
printf '%s\n' "$_KVP_PREWARM" > "$OUT/reuse_t2.txt"
printf 'dump=content bytes=9\n' > "$OUT/reuse_t2.dump"
_KV_VERDICT=$(node -e "$(_e2e_node reuse_t2.txt)" "$OUT/e2e_telemetry.txt" "$OUT/reuse_t2.txt" "$OUT/reuse_t2.dump" 2>&1)
_KV_LAST=$(printf '%s\n' "$_KV_VERDICT" | tail -1)
if [ "$_KV_LAST" = "KV_CACHE: UNKNOWN (KALSA_KVPREFIX lines exist but none has text_tokens=4800 — no line belongs to turn 2)" ]; then
  echo "PASS: ci-e2e unmatched marker → soft UNKNOWN, no number from another load"
  pass=$((pass + 1))
else
  echo "FAIL: ci-e2e unmatched marker — got '$_KV_LAST'"
  fail=$((fail + 1))
fi

printf '%s\n' "$_KVP_PREWARM" "$_KVP_CHAT" > "$OUT/reuse_t3.txt"
_R3_VERDICT=$(node -e "$(_e2e_node reuse_t3.txt)" "$OUT/e2e_session.txt" "$OUT/e2e_telemetry_restart.txt" "$OUT/reuse_t3.txt" 2>&1)
_R3_LAST=$(printf '%s\n' "$_R3_VERDICT" | tail -1)
if [ "$_R3_LAST" = "SESSION_RESTORE: WARM RESTART CONFIRMED (restored prefix reusable 2865/4800 prompt tokens; pre-decision marker)" ]; then
  echo "PASS: ci-e2e SESSION_RESTORE parser reads n_common/text_tokens (index mutation dies here)"
  pass=$((pass + 1))
else
  echo "FAIL: ci-e2e SESSION_RESTORE parser — got '$_R3_LAST'"
  fail=$((fail + 1))
fi

rm -rf "$OUT"
echo ""
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
