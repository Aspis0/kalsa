#!/bin/bash
# dryrun.sh — fixture matrix for d_run.sh against dryrun-adb.sh (fake adb).
# One responsibility: prove the mandated behaviors and print a PASS/FAIL line
# per assertion — 6 arms → 6 rows, missing HTP proof → VOID N arm, every
# safety stop fires from injected readings, and restore runs after each end.
# Mac only; no device, no phone, no QDC.
set -euo pipefail
CELL="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0; RAW=""; RC=0; STATE=""
pass() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL  %s -- %s\n' "$1" "$2"; }
eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected=[$2] got=[$3]"; fi; }
has() { case "$3" in *"$2"*) pass "$1" ;; *) fail "$1" "missing [$2] in [$3]" ;; esac; }

run_fixture() {
  local name="$1" order="$2"
  shift 2
  STATE="/tmp/qdc-heat3way-fake-$name"
  rm -rf "$STATE" "$CELL/raw/dry-$name"
  mkdir -p "$STATE" "$CELL/raw"
  set +e
  env ADB_BIN="$CELL/dryrun-adb.sh" FAKE_ADB_STATE="$STATE" ADB_PORT=5037 \
      COOL_POLL_S=1 COOL_MAX_S=5 TAIL_S=0 POLL_S=1 SAMPLER_WAIT_S=0 \
      BATT_TRUST_INTERVAL_S=1 "$@" \
      bash "$CELL/d_run.sh" "dry-$name" "$order" 20 > "$CELL/raw/dryrun-$name.log" 2>&1
  RC=$?
  set -e
  RAW="$CELL/raw/dry-$name"
}
rows() { awk 'NR > 1' "$RAW/results.tsv" 2>/dev/null | wc -l | tr -d '[:space:]'; }
end_reason() { sed -n 's/^END reason=//p' "$RAW/END.txt" 2>/dev/null | tail -1; }
col() { awk -F'\t' -v r="$1" -v c="$2" 'NR == r + 1 { print $c }' "$RAW/results.tsv" 2>/dev/null; }
row_of() { awk -F'\t' -v b="$1" 'NR > 1 && $2 == b { print NR - 1; exit }' "$RAW/results.tsv" 2>/dev/null; }
assert_end() { eq "$1 END" "$2" "$(end_reason)"; }
assert_restore() {
  if [ -f "$RAW/restore.log" ] && grep -q 'state=1 .*rc=0' "$RAW/restore.log"; then
    pass "$1 restore-ran"
  else
    fail "$1 restore-ran" "$(cat "$RAW/restore.log" 2>/dev/null || echo missing)"
  fi
  eq "$1 timeout-restored" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
  eq "$1 stayon-restored" false "$(cat "$STATE/stayon" 2>/dev/null || echo missing)"
}
assert_clean_shell() {
  if [ -f "$STATE/unknown_shell.log" ]; then
    fail "$1 no-unknown-shell" "$(head -3 "$STATE/unknown_shell.log")"
  else
    pass "$1 no-unknown-shell"
  fi
}

echo "== fixture: six-arms (order CGNNGC, happy path) =="
run_fixture six-arms CGNNGC
eq "six rc" 0 "$RC"
assert_end six exit_0
eq "six rows" 6 "$(rows)"
eq "six arm sequence" "cpu gpu npu npu gpu cpu" "$(awk -F'\t' 'NR>1 {printf "%s%s", sep, $2; sep=" "}' "$RAW/results.tsv" 2>/dev/null)"
eq "six pairs" "1 1 2 2 3 3" "$(awk -F'\t' 'NR>1 {printf "%s%s", sep, $1; sep=" "}' "$RAW/results.tsv" 2>/dev/null)"
eq "six all-OK" "" "$(awk -F'\t' 'NR>1 && $4!="OK"{printf "%s ", $2}' "$RAW/results.tsv" 2>/dev/null)"
eq "six prompt_n" 1018 "$(col 1 17)"
eq "six decode_runs" 127 "$(col 1 19)"
eq "six cpu prefill" 45000.00 "$(col 1 18)"
eq "six gpu prefill" 14000.00 "$(col 2 18)"
eq "six npu prefill" 18000.00 "$(col 3 18)"
has "six cpu proof" cpu_no_offload "$(col 1 21)"
has "six gpu proof" gpu_assigned_lines= "$(col 2 21)"
has "six npu proof" "arch=v73" "$(col 3 21)"
has "six npu proof ops" htp_ops= "$(col 3 21)"
eq "six skin_before" 33.5 "$(col 1 10)"
assert_restore six
assert_clean_shell six
eq "six samples.txt" yes "$([ -f "$RAW/samples.txt" ] && echo yes || echo no)"
eq "six list-devices" yes "$([ -f "$RAW/list_devices.txt" ] && echo yes || echo no)"

echo "== fixture: missing HTP proof voids the N arm =="
run_fixture no-htp N DRY_NO_HTP_PROOF=1
eq "nohtp rc" 0 "$RC"
assert_end nohtp exit_0
eq "nohtp rows" 1 "$(rows)"
eq "nohtp status" VOID "$(col 1 4)"
eq "nohtp void_reason" no_htp_proof "$(col 1 5)"
eq "nohtp backend" npu "$(col 1 2)"
assert_restore nohtp
assert_clean_shell nohtp

echo "== fixture: missing GPU proof voids the G arm =="
run_fixture no-gpu G DRY_NO_GPU_PROOF=1
eq "nogpu rc" 0 "$RC"
eq "nogpu rows" 1 "$(rows)"
eq "nogpu status" VOID "$(col 1 4)"
eq "nogpu void_reason" no_gpu_proof "$(col 1 5)"
assert_restore nogpu

echo "== fixture: cooldown is a cap only (warm_start flagged, no cool-start gate) =="
run_fixture warm-start CG DRY_SKIN_AT=1 DRY_SKIN_AFTER=38
eq "warm rc" 0 "$RC"
assert_end warm exit_0
eq "warm rows" 2 "$(rows)"
eq "warm all-OK" "" "$(awk -F'\t' 'NR>1 && $4!="OK"{printf "%s ", $2}' "$RAW/results.tsv" 2>/dev/null)"
eq "warm warm_start" 1 "$(col 1 6)"
eq "warm cooldown_s" 5 "$(col 1 7)"
eq "warm skin_before recorded" 38 "$(col 1 10)"
assert_restore warm

echo "== fixture: stop thermal_status >= 3 (injected at first gate) =="
run_fixture stop-thermal CG DRY_THERMAL_STATUS_AFTER=3
eq "st rc" 0 "$RC"
assert_end st stop_thermal_status
eq "st rows" 0 "$(rows)"
assert_restore st

echo "== fixture: stop battery_temp >= 44.0 C (fires between arms) =="
run_fixture stop-batt-temp CG DRY_BATT_TEMP_AT=11 DRY_BATT_TEMP_AFTER=445
eq "sbtemp rc" 0 "$RC"
assert_end sbtemp stop_battery_temp
eq "sbtemp rows" 1 "$(rows)"
eq "sbtemp first row OK" OK "$(col 1 4)"
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
eq "sskin trust verdict" 1 "$(sed -n 's/^untrusted=//p' "$RAW/battery_trust.txt" 2>/dev/null | tail -1)"
assert_restore sskin

echo "== fixture: stop fires mid-arm (background poll) =="
run_fixture stop-midarm C DRY_ARM_SLEEP_S=4 DRY_BATT_TEMP_AT=9 DRY_BATT_TEMP_AFTER=445
eq "smid rc" 0 "$RC"
assert_end smid stop_battery_temp
eq "smid rows" 1 "$(rows)"
eq "smid row voided by stop" "VOID stop_battery_temp" "$(col 1 4) $(col 1 5)"
assert_restore smid

echo
echo "dryrun summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
