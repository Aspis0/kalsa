#!/usr/bin/env bash
# dryrun.sh — fixture matrix for d_run.sh against fake-adb.sh. One
# responsibility: prove the mandated behaviors and print one PASS/FAIL line
# per assertion: happy path with the matched-N method (same token count for
# all five arms), every owner stop firing (battery temp >= 44.0 C, thermal >= 3,
# level <= 25 %, plugged, fail-closed missing reading), mid-arm stop + orphan
# kill, arm timeout + orphan kill, sha-verified push, and screen save/restore.
# Mac only; no device, no phone, no adb binary.
set -euo pipefail
CELL="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0; RAW=""; RC=0; STATE=""
pass() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL  %s -- %s\n' "$1" "$2"; }
eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected=[$2] got=[$3]"; fi; }
has() { case "$3" in *"$2"*) pass "$1" ;; *) fail "$1" "missing [$2] in [$(printf '%s' "$3" | head -c 240)]" ;; esac; }
not_has() { case "$3" in *"$2"*) fail "$1" "unexpected [$2]" ;; *) pass "$1" ;; esac; }

seed_screen() {
  printf '60000\n' > "$STATE/screen_timeout"
  printf '1\n' > "$STATE/stayon"
}

run_fixture() {
  local name=$1; shift
  STATE="/tmp/dspark-dry-$name"
  rm -rf "$STATE" "$CELL/raw/dry-$name"
  mkdir -p "$STATE" "$CELL/raw"
  seed_screen
  set +e
  env ADB_BIN="$CELL/fake-adb.sh" FAKE_ADB_STATE="$STATE" ADB_PORT=5037 \
      POLL_S=1 TAIL_S=0 MATCH_MAX=2 \
      "$@" \
      bash "$CELL/d_run.sh" "dry-$name" > "$CELL/raw/dryrun-$name.log" 2>&1
  RC=$?
  set -e
  RAW="$CELL/raw/dry-$name"
}
rows() { [ -f "$RAW/results.tsv" ] || { echo 0; return 0; }; awk 'NR > 1' "$RAW/results.tsv" | wc -l | tr -d '[:space:]'; }
end_reason() { sed -n 's/^END reason=//p' "$RAW/END.txt" 2>/dev/null | tail -1; }
col() { awk -F'\t' -v r="$1" -v c="$2" 'NR == r + 1 { print $c }' "$RAW/results.tsv" 2>/dev/null; }
driver_log() { cat "$RAW/driver.log" 2>/dev/null; }
assert_restore() {
  has "$1 screen-restored" "SCREEN_RESTORED" "$(driver_log)"
  eq "$1 timeout-restored" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
  eq "$1 stayon-restored" 1 "$(cat "$STATE/stayon" 2>/dev/null || echo missing)"
}
assert_clean_shell() {
  if [ -f "$STATE/unknown_shell.log" ]; then
    fail "$1 no-unknown-shell" "$(head -3 "$STATE/unknown_shell.log")"
  else
    pass "$1 no-unknown-shell"
  fi
}

echo "== fixture: happy path — probes + matched-N, sha-verified push, restore =="
run_fixture happy
eq "happy rc" 0 "$RC"
eq "happy END" exit_0 "$(end_reason)"
eq "happy rows" 8 "$(rows)"          # 5 probes + A/B4/C4 adjustments to n=136
eq "happy probe arms" "A B4 B8 C4 C8" "$(awk -F'\t' 'NR>1 && $3==1 {printf "%s%s", sep, $2; sep=" "}' "$RAW/results.tsv")"
eq "happy probe N" "128 132 136 132 136" "$(awk -F'\t' 'NR>1 && $3==1 {printf "%s%s", sep, $5; sep=" "}' "$RAW/results.tsv")"
eq "happy matched N" "136 136 136" "$(awk -F'\t' 'NR>1 && $3>1 {printf "%s%s", sep, $5; sep=" "}' "$RAW/results.tsv")"
has "happy match-gate" "MATCH ok n=136" "$(driver_log)"
eq "happy all-OK" "" "$(awk -F'\t' 'NR>1 && $10!="OK"{printf "%s ", $1}' "$RAW/results.tsv")"
eq "happy A no-spec" 0 "$(col 1 7)"                       # n_drafted = 0 for arm A
has "happy C4 gpu-proof" "draft_gpu_assign=5" "$(col 4 12)"
has "happy C4 kernel-proof" "kernels=6" "$(col 4 12)"
has "happy B4 cpu-proof" "draft_cpu_assign=5" "$(col 2 12)"
has "happy kit-verified" "KIT_AND_MODELS_VERIFIED" "$(driver_log)"
for f in kit.tgz ship.gguf draft.gguf prompt.txt; do
  has "happy pushed $f" "$f" "$(cat "$STATE/push.log" 2>/dev/null || echo none)"
done
not_has "happy no pkill" "pkill" "$(cat "$STATE/pkill.log" 2>/dev/null || echo '')"
assert_restore happy
assert_clean_shell happy

echo "== fixture: battery >= 44.0 C stops BEFORE the push =="
run_fixture batt DRY_TEMP_AT=1 DRY_TEMP_AFTER=450
eq "batt rc" 0 "$RC"
eq "batt END" stop_battery_temp "$(end_reason)"
eq "batt rows" 0 "$(rows)"
eq "batt no-push" "" "$(cat "$STATE/push.log" 2>/dev/null || echo '')"

echo "== fixture: thermal >= 3 stops MID-ARM and kills the binary =="
run_fixture thermal DRY_THERMAL_AT=4 DRY_THERMAL_AFTER=3 DRY_ARM_SLEEP_S=3
eq "thermal rc" 0 "$RC"
eq "thermal END" stop_thermal_status "$(end_reason)"
eq "thermal rows" 1 "$(rows)"
eq "thermal void" stop_thermal_status "$(col 1 11)"
has "thermal killed-spec" "llama-speculative-simpl[e]" "$(cat "$STATE/pkill.log" 2>/dev/null || echo none)"
assert_restore thermal

echo "== fixture: level <= 25 % stops =="
run_fixture level DRY_LEVEL_AT=1 DRY_LEVEL_AFTER=20
eq "level rc" 0 "$RC"
eq "level END" stop_battery_level "$(end_reason)"
eq "level rows" 0 "$(rows)"

echo "== fixture: plugged stops =="
run_fixture plug DRY_PLUGGED_AT=1 DRY_PLUGGED_AFTER=1
eq "plug rc" 0 "$RC"
eq "plug END" stop_plugged "$(end_reason)"
eq "plug rows" 0 "$(rows)"

echo "== fixture: missing battery temp fails closed =="
run_fixture miss DRY_MISS_TEMP=1 DRY_MISS_TEMP_AT=1
eq "miss rc" 0 "$RC"
eq "miss END" stop_missing_battery_temp "$(end_reason)"
eq "miss rows" 0 "$(rows)"

echo "== fixture: arm timeout orphans the remote process -> kill + VOID =="
run_fixture timeout DRY_ARM_SLEEP_S=3 ARM_TIMEOUT_S=1
eq "timeout rc" 0 "$RC"
eq "timeout END" exit_0 "$(end_reason)"
eq "timeout rows" 5 "$(rows)"
eq "timeout void" timeout "$(col 1 11)"
has "timeout killed-spec" "llama-speculative-simpl[e]" "$(cat "$STATE/pkill.log" 2>/dev/null || echo none)"
assert_restore timeout

echo
printf 'SUMMARY pass=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
