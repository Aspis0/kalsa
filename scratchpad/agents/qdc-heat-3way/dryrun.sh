#!/bin/bash
# dryrun.sh — fixture matrix for d_run.sh against dryrun-adb.sh (fake adb).
# One responsibility: prove the mandated behaviors and print a PASS/FAIL line
# per assertion — 6 arms -> 6 rows, proof thresholds void their arms, every
# safety stop fires from injected readings, stale state cleared (A2), arm
# timeout kills the orphan (A3), unequal decode stops (A7), the real
# common_perf_print prefix parses (A1), and restore runs after each end.
# Mac only; no device, no phone, no QDC.
set -euo pipefail
CELL="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0; RAW=""; RC=0; STATE=""
pass() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL  %s -- %s\n' "$1" "$2"; }
eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected=[$2] got=[$3]"; fi; }
ne() { if [ "$2" != "$3" ]; then pass "$1"; else fail "$1" "expected NOT [$2]"; fi; }
has() { case "$3" in *"$2"*) pass "$1" ;; *) fail "$1" "missing [$2] in [$(printf '%s' "$3" | head -c 200)]" ;; esac; }

seed_stale() { # A2: stale stop_request + END from a previous run of this job
  local name="$1"
  mkdir -p "$CELL/raw/dry-$name"
  printf 'fake\n' > "$CELL/raw/dry-$name/stop_request"
  printf 'END reason=stop_fake\n' > "$CELL/raw/dry-$name/END.txt"
}
seed_stayon() { printf '1\n' > "$STATE/stay_on_while_plugged_in"; }

run_fixture() {
  # arg3 (optional, no `=`): seed-function name, called after the state wipe
  # and before d_run; everything else is a DRY_*/tuning env assignment.
  local name="$1" order="$2" seed=""
  shift 2
  if [ "$#" -gt 0 ] && [[ "$1" != *=* ]]; then seed="$1"; shift; fi
  STATE="/tmp/qdc-heat3way-fake-$name"
  rm -rf "$STATE" "$CELL/raw/dry-$name"
  mkdir -p "$STATE" "$CELL/raw"
  [ -z "$seed" ] || "$seed" "$name"
  set +e
  env ADB_BIN="$CELL/dryrun-adb.sh" FAKE_ADB_STATE="$STATE" ADB_PORT=5037 \
      COOL_POLL_S=1 TAIL_S=0 POLL_S=1 SAMPLER_WAIT_S=0 BATT_TRUST_INTERVAL_S=1 \
      "$@" \
      bash "$CELL/d_run.sh" "dry-$name" "$order" 20 > "$CELL/raw/dryrun-$name.log" 2>&1
  RC=$?
  set -e
  RAW="$CELL/raw/dry-$name"
}
rows() { awk 'NR > 1' "$RAW/results.tsv" 2>/dev/null | wc -l | tr -d '[:space:]'; }
end_reason() { sed -n 's/^END reason=//p' "$RAW/END.txt" 2>/dev/null | tail -1; }
col() { awk -F'\t' -v r="$1" -v c="$2" 'NR == r + 1 { print $c }' "$RAW/results.tsv" 2>/dev/null; }
assert_end() { eq "$1 END" "$2" "$(end_reason)"; }
assert_restore() {
  if [ -f "$RAW/restore.log" ] && grep -q 'state=1 .*rc=0' "$RAW/restore.log"; then
    pass "$1 restore-ran"
  else
    fail "$1 restore-ran" "$(cat "$RAW/restore.log" 2>/dev/null || echo missing)"
  fi
  eq "$1 timeout-restored" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
}
assert_clean_shell() {
  if [ -f "$STATE/unknown_shell.log" ]; then
    fail "$1 no-unknown-shell" "$(head -3 "$STATE/unknown_shell.log")"
  else
    pass "$1 no-unknown-shell"
  fi
}
trust_verdict() { sed -n 's/^untrusted=//p' "$RAW/battery_trust.txt" 2>/dev/null | tail -1; }

echo "== fixture: six-arms (order CGNNGC, happy path, seeded stayon=1) =="
run_fixture six-arms CGNNGC seed_stayon
eq "six rc" 0 "$RC"
assert_end six exit_0
eq "six rows" 6 "$(rows)"
eq "six arm sequence" "cpu gpu npu npu gpu cpu" "$(awk -F'\t' 'NR>1 {printf "%s%s", sep, $2; sep=" "}' "$RAW/results.tsv" 2>/dev/null)"
eq "six pairs" "1 1 2 2 3 3" "$(awk -F'\t' 'NR>1 {printf "%s%s", sep, $1; sep=" "}' "$RAW/results.tsv" 2>/dev/null)"
eq "six all-OK" "" "$(awk -F'\t' 'NR>1 && $4!="OK"{printf "%s ", $2}' "$RAW/results.tsv" 2>/dev/null)"
has "six perf-prefix A1" "I common_perf_print:" "$(cat "$RAW/dry-six-arms-t1cpu.log")"
has "six inload-parsed A8" "inload_ms=9876.50" "$(cat "$RAW/driver.log")"
eq "six prompt_n" 1018 "$(col 1 21)"
eq "six decode_runs" 126 "$(col 1 23)"
eq "six cpu prefill" 45000.00 "$(col 1 22)"
eq "six gpu prefill" 14000.00 "$(col 2 22)"
eq "six npu prefill" 18000.00 "$(col 3 22)"
has "six cpu proof" cpu_no_offload "$(col 1 25)"
has "six gpu proof assign" gpu_assigned_lines= "$(col 2 25)"
has "six gpu proof kernels" "kernels=" "$(col 2 25)"
has "six npu proof arch" "arch=v73" "$(col 3 25)"
has "six npu proof ops" "htp_ops=1200" "$(col 3 25)"
eq "six skin_before" 33.5 "$(col 1 14)"
eq "six load_skin_before A8" 33.5 "$(col 1 11)"
eq "six load_skin_after A8" 33.5 "$(col 1 12)"
eq "six pagein_cold arm1" 1 "$(col 1 13)"
eq "six pagein_cold arm2" 0 "$(col 2 13)"
ne "six load_wall_s" na "$(col 1 10)"
eq "six samples.txt" yes "$([ -f "$RAW/samples.txt" ] && echo yes || echo no)"
eq "six list-devices" yes "$([ -f "$RAW/list_devices.txt" ] && echo yes || echo no)"
assert_restore six
eq "six stayon-restored" 1 "$(cat "$STATE/stay_on_while_plugged_in" 2>/dev/null || echo missing)"
assert_clean_shell six

echo "== fixture: missing HTP proof voids the N arm (A6) =="
run_fixture no-htp N DRY_NO_HTP_PROOF=1
eq "nohtp rc" 0 "$RC"
assert_end nohtp method_void_no_htp_proof
eq "nohtp rows" 1 "$(rows)"
eq "nohtp status" VOID "$(col 1 4)"
eq "nohtp void_reason" no_htp_proof "$(col 1 5)"
eq "nohtp backend" npu "$(col 1 2)"
assert_restore nohtp

echo "== fixture: execute-op below the 1000 floor voids the N arm (A6) =="
run_fixture htp-low N DRY_HTP_OPS=5
eq "htplow rc" 0 "$RC"
eq "htplow rows" 1 "$(rows)"
eq "htplow void_reason" htp_ops_low "$(col 1 5)"
eq "htplow proof count" "htp_ops=5" "$(col 1 25)"
assert_end htplow method_void_htp_ops_low
assert_restore htp-low

echo "== fixture: missing GPU placement evidence voids the G arm (A6) =="
run_fixture no-gpu G DRY_NO_GPU_PROOF=1
eq "nogpu rc" 0 "$RC"
eq "nogpu rows" 1 "$(rows)"
eq "nogpu status" VOID "$(col 1 4)"
eq "nogpu void_reason" no_gpu_proof "$(col 1 5)"
assert_end nogpu method_void_no_gpu_proof
assert_restore nogpu

echo "== fixture: GPU kernel-dispatch below the 8 floor voids the G arm (A6) =="
run_fixture gpu-exec-low G DRY_GPU_KERNELS=3
eq "gpuex rc" 0 "$RC"
eq "gpuex rows" 1 "$(rows)"
eq "gpuex void_reason" gpu_exec_low "$(col 1 5)"
assert_end gpuex method_void_gpu_exec_low
assert_restore gpu-exec-low

echo "== fixture: kernel-build failure line voids the G arm (A6) =="
run_fixture gpu-disabled G DRY_GPU_DISABLED=1
eq "gpudis rc" 0 "$RC"
eq "gpudis rows" 1 "$(rows)"
eq "gpudis void_reason" gpu_disabled "$(col 1 5)"
assert_end gpudis method_void_gpu_disabled
assert_restore gpu-disabled

echo "== fixture: cooldown is a cap only (warm_start flagged, no cool-start gate) =="
run_fixture warm-start CG DRY_SKIN_AT=1 DRY_SKIN_AFTER=38 COOL_MAX_S=2
eq "warm rc" 0 "$RC"
assert_end warm exit_0
eq "warm rows" 2 "$(rows)"
eq "warm all-OK" "" "$(awk -F'\t' 'NR>1 && $4!="OK"{printf "%s ", $2}' "$RAW/results.tsv" 2>/dev/null)"
eq "warm warm_start" 1 "$(col 1 6)"
eq "warm cooldown_s" 2 "$(col 1 7)"
eq "warm skin_before recorded" 38 "$(col 1 14)"
assert_restore warm

echo "== fixture: stop thermal_status >= 3 (injected at first gate) =="
run_fixture stop-thermal CG DRY_THERMAL_STATUS_AFTER=3
eq "st rc" 0 "$RC"
assert_end st stop_thermal_status
eq "st rows" 0 "$(rows)"
assert_restore st
eq "st stayon deleted" absent "$([ -f "$STATE/stay_on_while_plugged_in" ] && echo present || echo absent)"

echo "== fixture: stop battery_temp >= 44.0 C (fires after arm 1, trusted) =="
run_fixture stop-batt-temp CG DRY_BATT_TEMP_AT=11 DRY_BATT_TEMP_AFTER=445
eq "sbtemp rc" 0 "$RC"
assert_end sbtemp stop_battery_temp
eq "sbtemp rows" 1 "$(rows)"
eq "sbtemp first row OK" OK "$(col 1 4)"
eq "sbtemp battery trusted" 0 "$(trust_verdict)"
assert_restore sbtemp

echo "== fixture: stop battery_level <= 25 % =="
run_fixture stop-level CG DRY_BATT_LEVEL_AFTER=20
eq "slvl rc" 0 "$RC"
assert_end slvl stop_battery_level
eq "slvl rows" 0 "$(rows)"
assert_restore slvl

echo "== fixture: stop plugged =="
run_fixture stop-plugged CG DRY_PLUGGED_AFTER=1
eq "spl rc" 0 "$RC"
assert_end spl stop_plugged
eq "spl rows" 0 "$(rows)"
assert_restore spl

echo "== fixture: stop missing_skin (fail-closed missing reading) =="
run_fixture stop-missing CG DRY_MISSING_AFTER=skin
eq "smis rc" 0 "$RC"
assert_end smis stop_missing_skin
eq "smis rows" 0 "$(rows)"
assert_restore smis

echo "== fixture: stop skin_fallback >= 46 C on untrusted battery (stub) =="
run_fixture stop-skinfb CG DRY_BATT_STUB=1 DRY_SKIN_AT=11 DRY_SKIN_AFTER=46.5
eq "sskin rc" 0 "$RC"
assert_end sskin stop_skin_fallback
eq "sskin rows" 1 "$(rows)"
eq "sskin untrusted verdict" 1 "$(trust_verdict)"
assert_restore sskin

echo "== fixture A5: untrusted battery still stops on 44.5 C (never disarmed) =="
run_fixture stop-untrusted-batt CG DRY_SKIN_AT=3 DRY_SKIN_AFTER=34.2 DRY_BATT_TEMP_AT=11 DRY_BATT_TEMP_AFTER=445
eq "sunb rc" 0 "$RC"
assert_end sunb stop_battery_temp
eq "sunb rows" 1 "$(rows)"
eq "sunb untrusted verdict" 1 "$(trust_verdict)"
assert_restore sunb

echo "== fixture: stop fires mid-arm (background poll) =="
run_fixture stop-midarm C DRY_ARM_SLEEP_S=4 DRY_BATT_TEMP_AT=11 DRY_BATT_TEMP_AFTER=445
eq "smid rc" 0 "$RC"
assert_end smid stop_battery_temp
eq "smid rows" 1 "$(rows)"
eq "smid row voided by stop" "VOID stop_battery_temp" "$(col 1 4) $(col 1 5)"
assert_restore smid

echo "== fixture A2: stale stop_request + END cleared at session start =="
run_fixture stale C seed_stale
eq "stale rc" 0 "$RC"
assert_end stale exit_0
eq "stale rows" 1 "$(rows)"
eq "stale first row OK" OK "$(col 1 4)"
eq "stale stop_request gone" absent "$([ -f "$RAW/stop_request" ] && echo present || echo absent)"
assert_restore stale

echo "== fixture A3: arm timeout kills the remote orphan =="
run_fixture timeout C ARM_TIMEOUT_S=1 DRY_ARM_SLEEP_S=2
eq "tmo rc" 0 "$RC"
assert_end tmo exit_0
eq "tmo rows" 1 "$(rows)"
eq "tmo void_reason" load_fail "$(col 1 5)"
has "tmo orphan-kill logged" "ARM_TIMEOUT backend=cpu" "$(cat "$RAW/driver.log")"
has "tmo bracketed pkill" "llama-completio[n]" "$(cat "$STATE/pkill.log" 2>/dev/null || echo missing)"
assert_restore tmo

echo "== fixture A7: unequal decode voids the row and stops the session =="
run_fixture decode-unequal C DRY_DECODE_RUNS=125
eq "dec rc" 0 "$RC"
assert_end dec stop_unequal_decode
eq "dec rows" 1 "$(rows)"
eq "dec status" VOID "$(col 1 4)"
eq "dec void_reason" decode_len "$(col 1 5)"
eq "dec runs recorded" 125 "$(col 1 23)"
assert_restore dec

echo "== fixture A7b: gate derives N-1 from -n (DECODE_N=64 accepts 63) =="
run_fixture decode-derived C DECODE_N=64 DRY_DECODE_RUNS=63
eq "decder rc" 0 "$RC"
assert_end decder exit_0
eq "decder rows" 1 "$(rows)"
eq "decder status" OK "$(col 1 4)"
eq "decder runs accepted" 63 "$(col 1 23)"
assert_restore decder

echo "== fixture: CPU placement proof absent — models a default-verbosity log =="
run_fixture no-cpu C DRY_NO_CPU_PROOF=1
eq "nocpu rc" 0 "$RC"
eq "nocpu rows" 1 "$(rows)"
eq "nocpu void_reason" no_cpu_proof "$(col 1 5)"
assert_end nocpu method_void_no_cpu_proof
assert_restore nocpu

echo
echo "dryrun summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
