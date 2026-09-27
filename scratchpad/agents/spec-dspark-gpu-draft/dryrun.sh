#!/usr/bin/env bash
# dryrun.sh — fixture matrix for d_run.sh against fake-adb.sh. One
# responsibility: prove the audit-fix behaviors (AUDIT-dd6bdb56.md) and print
# one PASS/FAIL line per assertion:
#   B-1  kill + KILL_VERIFY on signal / stop / timeout / pkill-fails
#   B-2  standalone restore.sh after SIGKILL; stale state repaired, not clobbered
#   B-3  a void session -> END=match_void + exit 3 + final column (never success)
#   B-4  cooldown + per-row skin/cooldown/warm columns
#   B-5  proof runs carry `-lv 5` placement lines, measured runs carry none
#   B-6  matched-N converges with a content-dependent (jittered) overshoot
#   B-7  the push window runs under the poll and stops mid-push
#   B-8  battery_trust.sh verdict recorded (untrusted arms the skin stop)
#   B-9  SIGHUP trapped like INT/TERM
#   B-10 orphaned poll dies with a SIGKILLed parent; B-11 prefixed fake logs;
#        B-12 model-order assert; ARM_TPS sanity (tps numeric in happy rows)
# AUDIT2 (dd6bdb56 round 2): NEW-0 `-t 5` everywhere on device (proof limit 8
# per NEW-7), NEW-1 failed restore keeps .restore-state, NEW-2 the poll
# kills+verifies on parent death, NEW-3 stable 18-column schema, NEW-4 poll
# over unpack, NEW-5 pgrep self-test + health probe, NEW-8 deadline.
# Mac only; no device, no phone, no adb binary.
set -euo pipefail
CELL="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0; RAW=""; RC=0; STATE=""; BG_PID=""
pass() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL  %s -- %s\n' "$1" "$2"; }
eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected=[$2] got=[$3]"; fi; }
has() { case "$3" in *"$2"*) pass "$1" ;; *) fail "$1" "missing [$2] in [$(printf '%s' "$3" | head -c 240)]" ;; esac; }
not_has() { case "$3" in *"$2"*) fail "$1" "unexpected [$2]" ;; *) pass "$1" ;; esac; }

seed_screen() {
  printf '60000\n' > "$STATE/screen_timeout"
  printf '1\n' > "$STATE/stayon"
}
fixture_env() { printf '%s\n' ADB_BIN="$CELL/fake-adb.sh" FAKE_ADB_STATE="$STATE" ADB_PORT=5037 POLL_S=1 TAIL_S=0 MATCH_MAX=4 BATT_TRUST_INTERVAL_S=1; }

run_fixture() {
  local name=$1; shift
  STATE="/tmp/dspark-dry-$name"
  rm -rf "$STATE" "$CELL/raw/dry-$name"
  mkdir -p "$STATE" "$CELL/raw"
  seed_screen
  set +e
  env $(fixture_env) "$@" bash "$CELL/d_run.sh" "dry-$name" > "$CELL/raw/dryrun-$name.log" 2>&1
  RC=$?
  set -e
  RAW="$CELL/raw/dry-$name"
}

start_bg() {
  local name=$1; shift
  STATE="/tmp/dspark-dry-$name"
  rm -rf "$STATE" "$CELL/raw/dry-$name"
  mkdir -p "$STATE" "$CELL/raw"
  seed_screen
  set +e
  env $(fixture_env) "$@" bash "$CELL/d_run.sh" "dry-$name" > "$CELL/raw/dryrun-$name.log" 2>&1 &
  BG_PID=$!
  set -e
  RAW="$CELL/raw/dry-$name"
}
wait_for() { # <path> <timeout_s>
  local i=0 max=$(( $2 * 5 ))
  while [ "$i" -lt "$max" ]; do
    if [ -e "$1" ]; then return 0; fi
    sleep 0.2
    i=$((i + 1))
  done
  return 1
}
signal_fixture() { # <-TERM|-HUP|-9> <name> [knobs...]: start, wait for a running arm, signal, reap -> RC
  local sig=$1 name=$2
  shift 2
  start_bg "$name" "$@"
  if wait_for "$STATE/proc_running" 15; then
    set +e
    kill "$sig" "$BG_PID" 2>/dev/null
    wait "$BG_PID" 2>/dev/null
    RC=$?
    set -e
  else
    set +e
    kill -9 "$BG_PID" 2>/dev/null
    wait "$BG_PID" 2>/dev/null
    RC=99
    set -e
  fi
  RAW="$CELL/raw/dry-$name"
}

rows() { [ -f "$RAW/results.tsv" ] || { echo 0; return 0; }; awk 'NR > 1' "$RAW/results.tsv" | wc -l | tr -d '[:space:]'; }
rows_att() { [ -f "$RAW/results.tsv" ] || { echo 0; return 0; }; awk -F'\t' -v a="$1" 'NR > 1 && $3 == a' "$RAW/results.tsv" | wc -l | tr -d '[:space:]'; }
rows_att_gt() { [ -f "$RAW/results.tsv" ] || { echo 0; return 0; }; awk -F'\t' -v a="$1" 'NR > 1 && $3 > a' "$RAW/results.tsv" | wc -l | tr -d '[:space:]'; }
end_reason() { sed -n 's/^END reason=//p' "$RAW/END.txt" 2>/dev/null | tail -1; }
colr() { awk -F'\t' -v t="$1" -v c="$2" '$1 == t { print $c }' "$RAW/results.tsv" 2>/dev/null; }
fcount() { awk -F'\t' -v f="$1" 'NR > 1 && $18 == f { c++ } END { print c + 0 }' "$RAW/results.tsv" 2>/dev/null; }
cols18_bad() { [ -f "$RAW/results.tsv" ] || { echo 0; return 0; }; awk -F'\t' 'NF != 18 { c++ } END { print c + 0 }' "$RAW/results.tsv"; }
driver_log() { cat "$RAW/driver.log" 2>/dev/null; }
dlog_has() { grep -q "$1" "$RAW/driver.log" 2>/dev/null; }
assert_restore() {
  if grep -q 'state=1 ' "$RAW/restore.log" 2>/dev/null; then pass "$1 restore-ran"; else fail "$1 restore-ran" "$(cat "$RAW/restore.log" 2>/dev/null || echo missing)"; fi
  eq "$1 timeout-restored" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
  eq "$1 stayon-restored" 1 "$(cat "$STATE/stayon" 2>/dev/null || echo missing)"
  if [ -f "$CELL/.restore-state" ]; then fail "$1 state-consumed" "still present"; else pass "$1 state-consumed"; fi
}
assert_clean_shell() {
  if [ -f "$STATE/unknown_shell.log" ]; then fail "$1 no-unknown-shell" "$(head -3 "$STATE/unknown_shell.log")"; else pass "$1 no-unknown-shell"; fi
}

echo "== happy: proofs + probes + matched-N, prefixed logs, no debug in measured turns =="
run_fixture happy
eq "happy rc" 0 "$RC"
eq "happy END" exit_0 "$(end_reason)"
eq "happy rows" 13 "$(rows)"              # 5 proofs + 5 probes + 3 adjustments
eq "happy rows attempt0" 5 "$(rows_att 0)"
eq "happy rows attempt1" 5 "$(rows_att 1)"
eq "happy rows attempt>1" 3 "$(rows_att_gt 1)"
eq "happy probe N" "128 132 136 132 136" "$(awk -F'\t' 'NR>1 && $3==1 {printf "%s%s", sep, $5; sep=" "}' "$RAW/results.tsv")"
eq "happy matched N" "136 136 136" "$(awk -F'\t' 'NR>1 && $3>1 {printf "%s%s", sep, $5; sep=" "}' "$RAW/results.tsv")"
has "happy match-gate" "MATCH ok n=136" "$(driver_log)"
eq "happy all-OK" "" "$(awk -F'\t' 'NR>1 && $14!="OK"{printf "%s ", $1}' "$RAW/results.tsv")"
eq "happy final proof" 5 "$(fcount proof)"
eq "happy final matched" 5 "$(fcount matched)"
eq "happy final superseded" 3 "$(fcount superseded)"
eq "happy final void" 0 "$(fcount void)"
eq "happy A no-spec" 0 "$(colr A 7)"
eq "happy B8 tps" 17.000 "$(colr B8 9)"
has "happy C4 gpu-proof" "draft_gpu_assign=5" "$(colr C4-p 16)"
has "happy C4 kernel-proof" "kernels=6" "$(colr C4-p 16)"
has "happy B4 cpu-proof" "draft_cpu_assign=5" "$(colr B4-p 16)"
has "happy B4 cpu-proof-order" "pre_place=24" "$(colr B4-p 16)"   # B-12: target placement before marker
eq "happy skin_before" 33.5 "$(colr A-p 12)"
eq "happy cooldown" 0 "$(colr A-p 10)"
eq "happy warm_start" 0 "$(colr A-p 11)"
eq "happy proof limit" 8 "$(colr A-p 4)"                    # NEW-7: PROOF_N=8
eq "happy cols18" 0 "$(cols18_bad)"                          # NEW-3 schema
if grep -q ' D load_tensors: layer' "$RAW/A-p.log" 2>/dev/null; then pass "happy proof-prefixed-placement"; else fail "happy proof-prefixed-placement" "no ' D load_tensors' in A-p.log"; fi
if [ "$(grep -c 'assigned to device' "$RAW/B8.log" 2>/dev/null || true)" = 0 ]; then pass "happy measured-no-placement"; else fail "happy measured-no-placement" "$(grep -m2 'assigned to device' "$RAW/B8.log")"; fi
has "happy measured-prefix" " I n_predict = 136" "$(cat "$RAW/B8.log" 2>/dev/null || echo none)"
has "happy EXIT-unprefixed" "EXIT=0" "$(cat "$RAW/B8.log" 2>/dev/null || echo none)"
if [ "$(grep -c '^GGML_OPENCL_LOG_KERNELS:' "$RAW/C4-p.log" 2>/dev/null || true)" = 6 ]; then pass "happy kernels-unprefixed-6"; else fail "happy kernels-unprefixed-6" "count=$(grep -c '^GGML_OPENCL_LOG_KERNELS:' "$RAW/C4-p.log" 2>/dev/null || echo 0)"; fi
has "happy kit-verified" "KIT_AND_MODELS_VERIFIED" "$(driver_log)"
has "happy battery-trusted" "BATTERY_SENSOR_TRUSTED" "$(driver_log)"
for f in kit.tgz ship.gguf draft.gguf prompt.txt; do
  has "happy pushed $f" "$f" "$(cat "$STATE/push.log" 2>/dev/null || echo none)"
done
# Normal exit: no kill path may run (restore.sh's belt-and-braces pkill is
# the only allowed one); any KILL_VERIFY here would mean cleanup misfired.
not_has "happy no-kill-verify" "KILL_VERIFY" "$(driver_log)"
eq "happy only-restore-pkill" 1 "$(wc -l < "$STATE/pkill.log" 2>/dev/null | tr -d '[:space:]' || echo 0)"
has "happy restore-pkill-target" "llama-speculative-simpl[e]" "$(cat "$STATE/pkill.log" 2>/dev/null || echo none)"
assert_restore happy
assert_clean_shell happy

echo "== B-8: battery sensor untrusted (dumpsys != sysfs twice) arms the skin stop =="
run_fixture untrusted DRY_SYSFS_TEMP=999
eq "untrusted rc" 0 "$RC"
eq "untrusted END" exit_0 "$(end_reason)"
has "untrusted verdict" "BATTERY_SENSOR_UNTRUSTED" "$(driver_log)"
has "untrusted armed" "untrusted=1" "$(driver_log)"
has "untrusted file" "untrusted=1" "$(cat "$RAW/battery_trust.txt" 2>/dev/null || echo none)"

echo "== B-7: stop DURING the multi-GB push window (poll active), before unpack =="
run_fixture push DRY_PUSH_SLEEP_S=1 DRY_TEMP_AT=4 DRY_TEMP_AFTER=450
eq "push rc" 0 "$RC"
eq "push END" stop_battery_temp "$(end_reason)"
has "push stop-file" "battery_temp" "$(cat "$RAW/stop_request" 2>/dev/null || echo none)"
if dlog_has "KIT_AND_MODELS_VERIFIED"; then fail "push no-unpack" "KIT_AND_MODELS_VERIFIED present"; else pass "push no-unpack"; fi
has "push kill-verified" "KILL_VERIFY" "$(driver_log)"
eq "push rows" 0 "$(rows)"

echo "== B-1: thermal stop mid-probe-arm + verified kill =="
run_fixture thermal DRY_THERMAL_AT=17 DRY_THERMAL_AFTER=3 DRY_ARM_SLEEP_S=3
eq "thermal rc" 0 "$RC"
eq "thermal END" stop_thermal_status "$(end_reason)"
eq "thermal rows" 6 "$(rows)"             # 5 proofs + the stopped probe A
eq "thermal void" stop_thermal_status "$(colr A 15)"
has "thermal killed-spec" "llama-speculative-simpl[e]" "$(cat "$STATE/pkill.log" 2>/dev/null || echo none)"
has "thermal kill-verified" "KILL_VERIFY reason=stop_thermal_status result=gone" "$(driver_log)"
eq "thermal cols18" 0 "$(cols18_bad)"                        # NEW-3: stop path keeps 18 cols
assert_restore thermal

echo "== owner stops, pre-push: battery >= 44.0 C / level <= 25 % / plugged / missing =="
run_fixture batt DRY_TEMP_AT=1 DRY_TEMP_AFTER=450
eq "batt rc" 0 "$RC"; eq "batt END" stop_battery_temp "$(end_reason)"; eq "batt rows" 0 "$(rows)"
eq "batt no-push" "" "$(cat "$STATE/push.log" 2>/dev/null || echo '')"
has "batt kill-verified" "KILL_VERIFY reason=stop_battery_temp result=gone" "$(driver_log)"
run_fixture level DRY_LEVEL_AT=1 DRY_LEVEL_AFTER=20
eq "level rc" 0 "$RC"; eq "level END" stop_battery_level "$(end_reason)"; eq "level rows" 0 "$(rows)"
run_fixture plug DRY_PLUGGED_AT=1 DRY_PLUGGED_AFTER=1
eq "plug rc" 0 "$RC"; eq "plug END" stop_plugged "$(end_reason)"; eq "plug rows" 0 "$(rows)"
run_fixture miss DRY_MISS_TEMP=1 DRY_MISS_TEMP_AT=1
eq "miss rc" 0 "$RC"; eq "miss END" stop_missing_battery_temp "$(end_reason)"; eq "miss rows" 0 "$(rows)"

echo "== B-4: cooldown caps at COOL_MAX_S and flags warm_start + skin columns =="
run_fixture cooldown DRY_SKIN_AFTER=38.5 COOL_TARGET_C=37.0 COOL_MAX_S=1 COOL_POLL_S=1
eq "cooldown rc" 0 "$RC"
eq "cooldown END" exit_0 "$(end_reason)"
eq "cooldown warm row" 1 "$(colr A-p 11)"
eq "cooldown waited row" 1 "$(colr A-p 10)"
eq "cooldown skin row" 38.5 "$(colr A-p 12)"
has "cooldown match" "MATCH ok" "$(driver_log)"

echo "== B-6: jittered overshoot still converges inside MATCH_MAX =="
run_fixture jitter DRY_JITTER=1
eq "jitter rc" 0 "$RC"
eq "jitter END" exit_0 "$(end_reason)"
eq "jitter rows" 15 "$(rows)"             # 5 proofs + 5 probes; A x1, B4 x2, C4 x2 adjustments
has "jitter second-round tag" "B4-m2" "$(awk -F'\t' 'NR>1{printf "%s ", $1}' "$RAW/results.tsv")"
has "jitter match" "MATCH ok n=136" "$(driver_log)"
eq "jitter final matched" 5 "$(fcount matched)"

echo "== B-3: non-converging arm -> END=match_void, exit 3, final=void_match =="
run_fixture matchvoid DRY_NEVER_MATCH_ARM=B4
eq "matchvoid rc" 3 "$RC"
eq "matchvoid END" match_void "$(end_reason)"
eq "matchvoid rows" 16 "$(rows)"          # 5 proofs + 5 probes + A m1 + C4 m1 + B4 m1..m4
eq "matchvoid matched-tag" 0 "$(fcount matched)"
eq "matchvoid void_match-tag" 11 "$(fcount void_match)"
eq "matchvoid proof-tag" 5 "$(fcount proof)"
not_has "matchvoid no-success-log" "MATCH ok" "$(driver_log)"
assert_restore matchvoid

echo "== B-1: timeout kills AND verifies; void session not success =="
run_fixture timeout DRY_PROOF_SLEEP_S=3 ARM_TIMEOUT_S=1
eq "timeout rc" 3 "$RC"
eq "timeout END" match_void "$(end_reason)"
eq "timeout rows" 5 "$(rows)"
eq "timeout void" timeout "$(colr A-p 15)"
has "timeout kill-verified" "KILL_VERIFY reason=timeout_A-p result=gone" "$(driver_log)"
has "timeout killed-spec" "llama-speculative-simpl[e]" "$(cat "$STATE/pkill.log" 2>/dev/null || echo none)"
eq "timeout cols18" 0 "$(cols18_bad)"                        # NEW-3: void path keeps 18 cols
assert_restore timeout

echo "== B-1: SIGTERM mid-run -> kill verified, restore ran, exit 143 =="
signal_fixture -TERM sigterm DRY_PROOF_SLEEP_S=4
eq "sigterm rc" 143 "$RC"
eq "sigterm END" signal_TERM "$(end_reason)"
has "sigterm kill-verified" "result=gone" "$(driver_log)"
if [ -e "$STATE/proc_running" ]; then fail "sigterm binary-dead" "proc_running still present"; else pass "sigterm binary-dead"; fi
assert_restore sigterm

echo "== B-9: SIGHUP mid-run -> same kill+restore, exit 129 =="
signal_fixture -HUP sighup DRY_PROOF_SLEEP_S=4
eq "sighup rc" 129 "$RC"
eq "sighup END" signal_HUP "$(end_reason)"
has "sighup kill-verified" "result=gone" "$(driver_log)"
assert_restore sighup

echo "== B-2: SIGKILL leaves state; standalone restore.sh repairs; poll dies with parent =="
signal_fixture -9 sigkill DRY_PROOF_SLEEP_S=4
eq "sigkill rc" 137 "$RC"
if [ -f "$CELL/.restore-state" ]; then pass "sigkill state-left"; else fail "sigkill state-left" "missing"; fi
eq "sigkill mutated-timeout" 1800000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
eq "sigkill mutated-stayon" 3 "$(cat "$STATE/stayon" 2>/dev/null || echo missing)"
n1=$(wc -l < "$STATE/therm_reads" 2>/dev/null | tr -d '[:space:]' || echo 0)
sleep 2
n2=$(wc -l < "$STATE/therm_reads" 2>/dev/null | tr -d '[:space:]' || echo 0)
eq "sigkill poll-died" "$n1" "$n2"       # B-10: orphaned poll exited on parent liveness
has "sigkill poll-kill-verify" "KILL_VERIFY reason=parent_gone" "$(driver_log)"   # NEW-2
has "sigkill poll-pkill" "llama-speculative-simpl[e]" "$(cat "$STATE/pkill.log" 2>/dev/null || echo none)"
eq "sigkill cols18" 0 "$(cols18_bad)"                         # NEW-3 (SIGKILL: pending, but 18 cols)
set +e
env $(fixture_env) bash "$CELL/restore.sh" > "$RAW/manual_restore.txt" 2>&1
RRC=$?
set -e
eq "sigkill restore rc" 0 "$RRC"
eq "sigkill timeout-restored" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
eq "sigkill stayon-restored" 1 "$(cat "$STATE/stayon" 2>/dev/null || echo missing)"
if [ -f "$CELL/.restore-state" ]; then fail "sigkill state-consumed" "still present"; else pass "sigkill state-consumed"; fi

echo "== B-2: re-run after SIGKILL repairs stale state (no clobber, ends at original values) =="
start_bg rerun1 DRY_PROOF_SLEEP_S=4
if wait_for "$STATE/proc_running" 15; then
  set +e
  kill -9 "$BG_PID" 2>/dev/null
  wait "$BG_PID" 2>/dev/null
  set -e
fi
set +e
env $(fixture_env) bash "$CELL/d_run.sh" "dry-rerun2" > "$CELL/raw/dryrun-rerun2.log" 2>&1
RC=$?
set -e
RAW="$CELL/raw/dry-rerun2"
eq "rerun rc" 0 "$RC"
eq "rerun END" exit_0 "$(end_reason)"
if grep -q "STALE_RESTORE state_present" "$RAW/driver.log" 2>/dev/null; then pass "rerun repaired-stale"; else fail "rerun repaired-stale" "$(head -3 "$RAW/driver.log" 2>/dev/null || echo missing)"; fi
eq "rerun timeout-final" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
eq "rerun stayon-final" 1 "$(cat "$STATE/stayon" 2>/dev/null || echo missing)"

echo "== B-1: pkill that does NOT kill -> KILL_VERIFY=ALIVE recorded loudly =="
signal_fixture -TERM killfail DRY_PROOF_SLEEP_S=4 DRY_KILL_FAIL=1
eq "killfail rc" 143 "$RC"
eq "killfail END" signal_TERM "$(end_reason)"
has "killfail alive-recorded" "result=ALIVE" "$(driver_log)"
if [ -f "$RAW/KILL_VERIFY_FAIL" ]; then pass "killfail marker"; else fail "killfail marker" "missing KILL_VERIFY_FAIL"; fi

echo "== NEW-5: pgrep self-test fails at setup -> abort BEFORE any mutation =="
run_fixture selftestfail DRY_PGREP_BROKEN=1
eq "selftestfail rc" 4 "$RC"
eq "selftestfail END" exit_4 "$(end_reason)"
if [ -f "$RAW/PGREP_SELFTEST_FAIL" ]; then pass "selftestfail marker"; else fail "selftestfail marker" "missing PGREP_SELFTEST_FAIL"; fi
has "selftestfail abort-log" "PGREP_SELFTEST_ABORT" "$(driver_log)"
eq "selftestfail untouched-timeout" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
if [ -f "$CELL/.restore-state" ]; then fail "selftestfail no-state" "state written before self-test"; else pass "selftestfail no-state"; fi
eq "selftestfail rows" 0 "$(rows)"

echo "== NEW-5: pgrep breaks AFTER the self-test -> kill verdict fails closed =="
signal_fixture -TERM pgrepbreaklater DRY_PROOF_SLEEP_S=4 DRY_PGREP_BREAK_AT=2
eq "pgrepbreaklater rc" 143 "$RC"
eq "pgrepbreaklater END" signal_TERM "$(end_reason)"
has "pgrepbreaklater selftest-ok" "PGREP_SELFTEST ok" "$(driver_log)"
has "pgrepbreaklater recorded" "result=pgrep_broken" "$(driver_log)"
if [ -f "$RAW/KILL_VERIFY_FAIL" ]; then pass "pgrepbreaklater marker"; else fail "pgrepbreaklater marker" "missing KILL_VERIFY_FAIL"; fi

echo "== NEW-1: FAILED restore keeps .restore-state; the next run repairs it =="
run_fixture restorefail DRY_RESTORE_PUT_FAIL=1
eq "restorefail rc" 0 "$RC"
eq "restorefail END" exit_0 "$(end_reason)"
if [ -f "$CELL/.restore-state" ]; then pass "restorefail state-kept"; else fail "restorefail state-kept" "state consumed despite failed restore"; fi
has "restorefail keep-logged" "restore_failed_keep_state" "$(cat "$RAW/restore.log" 2>/dev/null || echo none)"
eq "restorefail device-still-mutated" 1800000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
set +e
env $(fixture_env) bash "$CELL/d_run.sh" "dry-restorefail2" > "$CELL/raw/dryrun-restorefail2.log" 2>&1
RC=$?
set -e
RAW="$CELL/raw/dry-restorefail2"
eq "restorefail2 rc" 0 "$RC"
eq "restorefail2 END" exit_0 "$(end_reason)"
if grep -q "STALE_RESTORE state_present" "$RAW/driver.log" 2>/dev/null; then pass "restorefail2 repaired-stale"; else fail "restorefail2 repaired-stale" "$(head -3 "$RAW/driver.log" 2>/dev/null || echo missing)"; fi
if [ -f "$CELL/.restore-state" ]; then fail "restorefail2 state-consumed" "still present"; else pass "restorefail2 state-consumed"; fi
eq "restorefail2 timeout-final" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
eq "restorefail2 stayon-final" 1 "$(cat "$STATE/stayon" 2>/dev/null || echo missing)"

echo "== NEW-8: session deadline aborts with kill + restore + END=deadline =="
run_fixture deadline DEADLINE_S=1
eq "deadline rc" 124 "$RC"
eq "deadline END" deadline "$(end_reason)"
has "deadline kill-verified" "KILL_VERIFY" "$(driver_log)"
eq "deadline rows" 0 "$(rows)"
eq "deadline cols18" 0 "$(cols18_bad)"
assert_restore deadline

echo
printf 'SUMMARY pass=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
