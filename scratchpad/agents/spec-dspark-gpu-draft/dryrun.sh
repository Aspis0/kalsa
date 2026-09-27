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
# AUDIT4 (round 4): N-B2 turn-side backend evidence (fixture turndisabled),
# N-B1 FAKE_ADB_STATE-gated DEADLINE_S (deadlines-guard2), N-B4 ADB_PORT
# validation (port-guard), item-3 pgrep self-match modelled in the fake (the
# kill-verified fixtures go red with a plain-literal probe), N-B3 END suffix.
# AUDIT5: N-C1 partial-offload turn gate (turnpartial), one fixture per turn
# gate (turnnomarker/turnnoplace/turnleak), dash syntax check, real-log shape
# check (shape_check.sh).
# Mac only; no device, no phone, no adb binary.
set -euo pipefail
CELL="$(cd "$(dirname "$0")" && pwd)"
# Test hygiene: an aborted earlier dry-run may have left a .restore-state
# behind; the fixtures own their own state lifecycle (rerun2 tests the stale
# repair explicitly), so a cross-invocation leftover must not contaminate them.
rm -f "$CELL/.restore-state"
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
eq "happy rows" 19 "$(rows)"              # 7 proofs + 7 probes + 5 adjustments

eq "happy rows attempt0" 7 "$(rows_att 0)"
eq "happy rows attempt1" 7 "$(rows_att 1)"
eq "happy rows attempt>1" 5 "$(rows_att_gt 1)"
eq "happy probe N" "126 128 132 136 132 136 126" "$(awk -F'\t' 'NR>1 && $3==1 {printf "%s%s", sep, $5; sep=" "}' "$RAW/results.tsv")"
eq "happy matched N" "136 136 136 136 136" "$(awk -F'\t' 'NR>1 && $3>1 {printf "%s%s", sep, $5; sep=" "}' "$RAW/results.tsv")"
has "happy match-gate" "MATCH ok n=136" "$(driver_log)"
eq "happy all-OK" "" "$(awk -F'\t' 'NR>1 && $14!="OK"{printf "%s ", $1}' "$RAW/results.tsv")"
eq "happy final proof" 7 "$(fcount proof)"
eq "happy final matched" 7 "$(fcount matched)"
eq "happy final superseded" 5 "$(fcount superseded)"
# audit10: A0/A0b = the plain completion baseline — eval-line metric (runs =
# limit-1 = 126), no spec stats, and its two instances must agree (drift test)
eq "happy A0 probe N" 126 "$(colr A0 5)"
eq "happy A0 tps" 21.00 "$(colr A0 9)"
eq "happy A0 accept-na" na "$(colr A0 8)"
eq "happy A0-vs-A0b drift" "$(colr A0 9)" "$(colr A0b 9)"
eq "happy ctx-A0" "2048 " "$(awk '/llama_context: n_ctx / && !/n_ctx_seq/{printf "%s ", $NF}' "$RAW/A0.log" 2>/dev/null)"
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
# audit8: with `-dev none` pinned, no log may mention the NPU at all
if grep -q "HTP0\|ggml-hex" "$RAW"/*.log 2>/dev/null; then fail "happy no-npu" "$(grep -l "HTP0\|ggml-hex" "$RAW"/*.log | head -2)"; else pass "happy no-npu"; fi
# audit9: BOTH contexts (target + drafter) at the configured 2048, and
# `-fit off` removed the extra-model probe from every log
eq "happy ctx-values" "2048 2048 " "$(awk '/llama_context: n_ctx / && !/n_ctx_seq/{printf "%s ", $NF}' "$RAW/B8.log" 2>/dev/null)"
eq "happy ctx-values-C4" "2048 2048 " "$(awk '/llama_context: n_ctx / && !/n_ctx_seq/{printf "%s ", $NF}' "$RAW/C4.log" 2>/dev/null)"
if grep -aq "getting device memory data for the extra model" "$RAW"/*.log 2>/dev/null; then fail "happy no-fit-probe" "$(grep -al "getting device memory data" "$RAW"/*.log | head -1)"; else pass "happy no-fit-probe"; fi
if grep -q ' D load_tensors: layer' "$RAW/A-p.log" 2>/dev/null; then pass "happy proof-prefixed-placement"; else fail "happy proof-prefixed-placement" "no ' D load_tensors' in A-p.log"; fi
if [ "$(grep -c 'assigned to device' "$RAW/B8.log" 2>/dev/null || true)" = 0 ]; then pass "happy measured-no-placement"; else fail "happy measured-no-placement" "$(grep -m2 'assigned to device' "$RAW/B8.log")"; fi
has "happy measured-prefix" " I n_predict = 136" "$(cat "$RAW/B8.log" 2>/dev/null || echo none)"
# audit4 N-B2: the measured turn must carry its OWN backend evidence at -lv 4
if grep -q "model buffer size" "$RAW/B8.log" 2>/dev/null; then pass "happy turn-info-admitted"; else fail "happy turn-info-admitted" "no placement INFO in the measured turn log"; fi
if grep -Eq "offloaded [1-9][0-9]*/[0-9]+ layers to GPU" "$RAW/C4.log" 2>/dev/null; then pass "happy turn-gpu-offload"; else fail "happy turn-gpu-offload" "no >0 GPU offload line in the C4 turn"; fi
if grep -Eq "offloaded [1-9][0-9]*/[0-9]+ layers to GPU" "$RAW/B8.log" 2>/dev/null; then fail "happy turn-cpu-no-offload" "B8 turn offloaded the drafter to GPU"; else pass "happy turn-cpu-no-offload"; fi
has "happy EXIT-unprefixed" "EXIT=0" "$(cat "$RAW/B8.log" 2>/dev/null || echo none)"
if [ "$(grep -c '^GGML_OPENCL_LOG_KERNELS:' "$RAW/C4-p.log" 2>/dev/null || true)" = 6 ]; then pass "happy kernels-unprefixed-6"; else fail "happy kernels-unprefixed-6" "count=$(grep -c '^GGML_OPENCL_LOG_KERNELS:' "$RAW/C4-p.log" 2>/dev/null || echo 0)"; fi
has "happy kit-verified" "KIT_AND_MODELS_VERIFIED" "$(driver_log)"
has "happy battery-trusted" "BATTERY_SENSOR_TRUSTED" "$(driver_log)"
has "happy selftest-ok" "PGREP_SELFTEST ok" "$(driver_log)"   # audit7: the string is EXECUTED, not modelled
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
run_fixture thermal DRY_THERMAL_AT=21 DRY_THERMAL_AFTER=3 DRY_ARM_SLEEP_S=3
eq "thermal rc" 0 "$RC"
eq "thermal END" stop_thermal_status "$(end_reason)"
eq "thermal rows" 8 "$(rows)"             # 7 proofs + the stopped A0 probe
eq "thermal void" stop_thermal_status "$(colr A0 15)"
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
eq "jitter rows" 21 "$(rows)"             # 7 proofs + 7 probes + A0,A,B4,C4,A0b + B4-m2 adjustments
has "jitter second-round tag" "B4-m2" "$(awk -F'\t' 'NR>1{printf "%s ", $1}' "$RAW/results.tsv")"
has "jitter match" "MATCH ok n=136" "$(driver_log)"
eq "jitter final matched" 7 "$(fcount matched)"

echo "== B-3: non-converging arm -> END=match_void, exit 3, final=void_match =="
run_fixture matchvoid DRY_NEVER_MATCH_ARM=B4
eq "matchvoid rc" 3 "$RC"
eq "matchvoid END" match_void "$(end_reason)"
eq "matchvoid rows" 22 "$(rows)"          # 7 proofs + 7 probes + 5 raises + B4 m2..m4 (stuck)
eq "matchvoid matched-tag" 0 "$(fcount matched)"
eq "matchvoid void_match-tag" 15 "$(fcount void_match)"
eq "matchvoid proof-tag" 7 "$(fcount proof)"
not_has "matchvoid no-success-log" "MATCH ok" "$(driver_log)"
assert_restore matchvoid

echo "== B-1: timeout kills AND verifies; void session not success =="
run_fixture timeout DRY_PROOF_SLEEP_S=3 ARM_TIMEOUT_S=1
eq "timeout rc" 3 "$RC"
eq "timeout END" match_void "$(end_reason)"
eq "timeout rows" 7 "$(rows)"
eq "timeout void" timeout "$(colr A-p 15)"
has "timeout kill-verified" "KILL_VERIFY reason=abn_A-p result=gone" "$(driver_log)"
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
  # phase-1's fake arm is orphaned and shares THIS state dir with phase 2 —
  # its late write raced phase 2's pull (truncated A-p.log). Reap it first.
  pkill -f "$CELL/fake-adb.sh" 2>/dev/null
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
eq "killfail END" signal_TERM_kill_unverified "$(end_reason)"   # N-B3: unverifiable kill must be visible in END
has "killfail alive-recorded" "result=ALIVE" "$(driver_log)"
if [ -f "$RAW/KILL_VERIFY_FAIL" ]; then pass "killfail marker"; else fail "killfail marker" "missing KILL_VERIFY_FAIL"; fi

echo "== NEW-5: pgrep self-test fails at setup -> abort BEFORE any mutation =="
run_fixture selftestfail DRY_PGREP_BROKEN=1
eq "selftestfail rc" 4 "$RC"
if [ -f "$RAW/PGREP_SELFTEST_FAIL" ]; then pass "selftestfail marker"; else fail "selftestfail marker" "missing PGREP_SELFTEST_FAIL"; fi
has "selftestfail abort-log" "PGREP_SELFTEST_ABORT" "$(driver_log)"
eq "selftestfail END" exit_4_kill_unverified "$(end_reason)"   # N-B3: cleanup's kill fails here too
eq "selftestfail untouched-timeout" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
if [ -f "$CELL/.restore-state" ]; then fail "selftestfail no-state" "state written before self-test"; else pass "selftestfail no-state"; fi
eq "selftestfail rows" 0 "$(rows)"

echo "== NEW-5: pgrep breaks AFTER the self-test -> kill verdict fails closed =="
signal_fixture -TERM pgrepbreaklater DRY_PROOF_SLEEP_S=4 DRY_PGREP_BREAK_AT=2
eq "pgrepbreaklater rc" 143 "$RC"
eq "pgrepbreaklater END" signal_TERM_kill_unverified "$(end_reason)"   # N-B3
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

echo "== audit3 B-N1: deadline bites INSIDE a long cooldown, before any arm runs =="
run_fixture deadlinecool DEADLINE_S=8 COOL_TARGET_C=37.0 COOL_MAX_S=30 COOL_POLL_S=1 DRY_SKIN_AFTER=38.5
eq "deadlinecool rc" 124 "$RC"
eq "deadlinecool END" deadline "$(end_reason)"
eq "deadlinecool rows" 0 "$(rows)"        # fired inside the wait: no proof may have run
if dlog_has "COOLDOWN_CAP"; then fail "deadlinecool beat-cap" "cap fired before the deadline"; else pass "deadlinecool beat-cap"; fi
sr=$(grep -c 'live skin' "$RAW/safety.log" 2>/dev/null || true)
# 3 setup gates + >=1 cooldown iteration: the run_proof pre-check passed and
# the expiry landed INSIDE the wait (reads=3 would mean the deadline hit before
# the cooldown started — not the case under test). With the old pre-loop-only
# check this fixture fails: the cooldown would spin to the cap and run a proof.
if [ "${sr:-0}" -ge 4 ]; then pass "deadlinecool spun-in-cooldown reads=$sr"; else fail "deadlinecool spun-in-cooldown" "safety_reads=${sr:-0}, need >=4"; fi
has "deadlinecool kill-verified" "KILL_VERIFY" "$(driver_log)"
assert_restore deadlinecool

echo "== audit3: decoded <N> vs n_predict = <N> cross-check voids the row =="
run_fixture countmismatch DRY_N_DECODED_MISMATCH=1
eq "countmismatch rc" 3 "$RC"
eq "countmismatch END" match_void "$(end_reason)"
eq "countmismatch rows" 14 "$(rows)"      # 7 proofs + 7 probes, every probe voided
eq "countmismatch void-A" count_mismatch "$(colr A 15)"
eq "countmismatch void-B4" count_mismatch "$(colr B4 15)"
eq "countmismatch final-void" 5 "$(fcount void)"   # the 5 SPEC probes (A0/A0b print no decoded line — knob scope)
eq "countmismatch A0-ok" OK "$(colr A0 14)"
eq "countmismatch final-proof" 7 "$(fcount proof)"
eq "countmismatch matched-tag" 0 "$(fcount matched)"
not_has "countmismatch no-success" "MATCH ok" "$(driver_log)"
assert_restore countmismatch

echo "== audit3: DEADLINE_S is refused with the real adb (dry-run-only hook) =="
set +e
env -u ADB_BIN DEADLINE_S=1 bash "$CELL/d_run.sh" dry-deadlines-guard > "$CELL/raw/dryrun-deadlines-guard.log" 2>&1
RC=$?
set -e
eq "deadlines-guard rc" 2 "$RC"
has "deadlines-guard msg" "dry-run-only" "$(cat "$CELL/raw/dryrun-deadlines-guard.log" 2>/dev/null || echo none)"
if [ -f "$CELL/.restore-state" ]; then fail "deadlines-guard no-side-effect" "state written"; else pass "deadlines-guard no-side-effect"; fi
if [ -d "$CELL/raw/dry-deadlines-guard" ]; then fail "deadlines-guard no-raw" "RAW created before the guard"; else pass "deadlines-guard no-raw"; fi

echo "== audit4 N-B1: DEADLINE_S refused for ANY adb outside the fake (path-independent) =="
rm -rf "$CELL/raw/dry-deadlines-guard2"   # stale from a pre-fix run: the guard creates no RAW
set +e
env ADB_BIN=/nonexistent/adb DEADLINE_S=1 bash "$CELL/d_run.sh" dry-deadlines-guard2 > "$CELL/raw/dryrun-deadlines-guard2.log" 2>&1
RC=$?
set -e
eq "deadlines-guard2 rc" 2 "$RC"
has "deadlines-guard2 msg" "dry-run-only" "$(cat "$CELL/raw/dryrun-deadlines-guard2.log" 2>/dev/null || echo none)"
if [ -d "$CELL/raw/dry-deadlines-guard2" ]; then fail "deadlines-guard2 no-raw" "RAW created (guard did not fire)"; else pass "deadlines-guard2 no-raw"; fi
if [ -f "$CELL/.restore-state" ]; then fail "deadlines-guard2 no-state" "state written"; else pass "deadlines-guard2 no-state"; fi

echo "== audit4 N-B4: ADB_PORT outside 5037/6037/6039 refused before any device call =="
rm -rf "$CELL/raw/dry-port-guard"         # stale from a pre-fix run: the guard creates no RAW
set +e
env ADB_PORT=5038 bash "$CELL/d_run.sh" dry-port-guard > "$CELL/raw/dryrun-port-guard.log" 2>&1
RC=$?
set -e
eq "port-guard rc" 2 "$RC"
has "port-guard msg" "ADB_PORT must be" "$(cat "$CELL/raw/dryrun-port-guard.log" 2>/dev/null || echo none)"
if [ -d "$CELL/raw/dry-port-guard" ]; then fail "port-guard no-raw" "RAW created"; else pass "port-guard no-raw"; fi
if [ -f "$CELL/.restore-state" ]; then fail "port-guard no-state" "state written"; else pass "port-guard no-state"; fi

echo "== audit4 N-B2: a disabled backend in the TURN voids the row (the proof was fine) =="
run_fixture turndisabled DRY_TURN_DISABLED=1
eq "turndisabled rc" 3 "$RC"
eq "turndisabled END" match_void "$(end_reason)"
eq "turndisabled rows" 14 "$(rows)"       # 7 proofs + 7 probes, every turn voided
eq "turndisabled void-A" turn_backend_disabled "$(colr A 15)"
eq "turndisabled proof-A-status" OK "$(colr A-p 14)"   # proof passed: the silent case
eq "turndisabled proof-A-final" proof "$(colr A-p 18)"
eq "turndisabled matched" 0 "$(fcount matched)"
not_has "turndisabled no-success" "MATCH ok" "$(driver_log)"
assert_restore turndisabled

echo "== AUDIT5 N-C2: turn_no_marker / turn_no_placement each have a fixture =="
run_fixture turnnomarker DRY_TURN_NO_MARKER=1
eq "turnnomarker rc" 3 "$RC"
eq "turnnomarker END" match_void "$(end_reason)"
eq "turnnomarker rows" 14 "$(rows)"        # 7 proofs + 7 probes, all turns voided
eq "turnnomarker void-A" turn_no_marker "$(colr A 15)"
eq "turnnomarker proof-A" OK "$(colr A-p 14)"
eq "turnnomarker matched" 0 "$(fcount matched)"
assert_restore turnnomarker

run_fixture turnnoplace DRY_TURN_NO_PLACEMENT=1
eq "turnnoplace rc" 3 "$RC"
eq "turnnoplace END" match_void "$(end_reason)"
eq "turnnoplace rows" 14 "$(rows)"
eq "turnnoplace void-A" turn_no_placement "$(colr A 15)"
eq "turnnoplace proof-A" OK "$(colr A-p 14)"
eq "turnnoplace matched" 0 "$(fcount matched)"
assert_restore turnnoplace

echo "== AUDIT5 N-C1: a PARTIAL drafter offload (3/6) must not pass as C4 =="
run_fixture turnpartial DRY_TURN_PARTIAL=1
eq "turnpartial rc" 3 "$RC"
eq "turnpartial END" match_void "$(end_reason)"
eq "turnpartial rows" 18 "$(rows)"        # 7 proofs + 7 probes + A0,A,B4,A0b raises (C voided)
eq "turnpartial void-C4" turn_placement_mismatch "$(colr C4 15)"
eq "turnpartial void-C8" turn_placement_mismatch "$(colr C8 15)"
eq "turnpartial proof-C4" OK "$(colr C4-p 14)"
eq "turnpartial A-ok" OK "$(colr A 14)"
eq "turnpartial matched" 0 "$(fcount matched)"
assert_restore turnpartial

echo "== AUDIT5 N-C2: turn_gpu_leak — an A/B turn that offloads the drafter =="
run_fixture turnleak DRY_TURN_GPU_LEAK=1
eq "turnleak rc" 3 "$RC"
eq "turnleak END" match_void "$(end_reason)"
eq "turnleak rows" 17 "$(rows)"           # 7 proofs + 7 probes + A0,C4,A0b raises (A,B4,B8 voided)
eq "turnleak void-A" turn_gpu_leak "$(colr A 15)"
eq "turnleak void-B8" turn_gpu_leak "$(colr B8 15)"
eq "turnleak proof-A" OK "$(colr A-p 14)"
eq "turnleak C4-ok" OK "$(colr C4 14)"
eq "turnleak matched" 0 "$(fcount matched)"
assert_restore turnleak

echo "== audit6: an interactive/conversation TURN is voided (proof was fine) =="
run_fixture interactiveturn DRY_TURN_INTERACTIVE=1
eq "interactiveturn rc" 3 "$RC"
eq "interactiveturn END" match_void "$(end_reason)"
eq "interactiveturn rows" 14 "$(rows)"     # 7 proofs OK + 7 turns voided
eq "interactiveturn void-A" interactive_mode "$(colr A 15)"
eq "interactiveturn proof-A" OK "$(colr A-p 14)"
eq "interactiveturn matched" 0 "$(fcount matched)"
assert_restore interactiveturn

echo "== audit6: an interactive PROOF voids the arm before it is ever measured =="
run_fixture interactiveproof DRY_PROOF_INTERACTIVE=1
eq "interactiveproof rc" 3 "$RC"
eq "interactiveproof END" match_void "$(end_reason)"
eq "interactiveproof rows" 7 "$(rows)"     # proof-only: arms dead, no turns ran
eq "interactiveproof void-A" interactive_mode "$(colr A-p 15)"
eq "interactiveproof matched" 0 "$(fcount matched)"
not_has "interactiveproof no-success" "MATCH ok" "$(driver_log)"
assert_restore interactiveproof

echo "== audit8: an HTP0 leak in a PROOF is voided htp_leak (content beats rc) =="
run_fixture htpproof DRY_HTP_LEAK=1
eq "htpproof rc" 3 "$RC"
eq "htpproof END" match_void "$(end_reason)"
eq "htpproof rows" 7 "$(rows)"          # proofs voided before any turn ran
eq "htpproof void-A" htp_leak "$(colr A-p 15)"
eq "htpproof proof-col" htp_line=1 "$(colr A-p 16)"   # parse-gate proof string: EXIT=0 was NOT the reason
eq "htpproof matched" 0 "$(fcount matched)"
assert_restore htpproof

echo "== audit8: an HTP0 leak in a TURN voids the probe, the proof stays OK =="
run_fixture htpturn DRY_TURN_HTP=1
eq "htpturn rc" 3 "$RC"
eq "htpturn END" match_void "$(end_reason)"
eq "htpturn rows" 14 "$(rows)"
eq "htpturn void-A" htp_leak "$(colr A 15)"
eq "htpturn proof-A" OK "$(colr A-p 14)"
assert_restore htpturn

echo "== audit8: a pure SIGSEGV (no HTP lines) is crash_sig139, not timeout =="
run_fixture segv DRY_ARM_RC=139
eq "segv rc" 3 "$RC"
eq "segv END" match_void "$(end_reason)"
eq "segv rows" 7 "$(rows)"
eq "segv void-A" crash_sig11 "$(colr A-p 15)"   # rc 139 = 128 + signal 11 (SIGSEGV)
eq "segv rc-recorded" 139 "$(colr A-p 16)"   # abnormal rows carry the rc in the proof col
has "segv kill-verified" "KILL_VERIFY reason=abn_A-p result=gone" "$(driver_log)"
assert_restore segv

echo "== audit9: a train-ctx (128000) run is voided ctx_mismatch =="
run_fixture ctxbad DRY_CTX_MISMATCH=1
eq "ctxbad rc" 3 "$RC"
eq "ctxbad END" match_void "$(end_reason)"
eq "ctxbad rows" 7 "$(rows)"            # proofs voided before any turn ran
eq "ctxbad void-A" ctx_mismatch "$(colr A-p 15)"
has "ctxbad proof-values" "128000" "$(colr A-p 16)"   # n_ctx=128000,128000 want=2048
eq "ctxbad matched" 0 "$(fcount matched)"
not_has "ctxbad no-success" "MATCH ok" "$(driver_log)"
assert_restore ctxbad

echo "== audit10: an A0 turn without the eval-time metric line is voided no_stats =="
run_fixture a0noperf DRY_A0_NO_PERF=1
eq "a0noperf rc" 3 "$RC"
eq "a0noperf END" match_void "$(end_reason)"
eq "a0noperf rows" 17 "$(rows)"         # 7 proofs + 7 probes + A,B4,C4 raises (A0/A0b dead)
eq "a0noperf void-A0" no_stats "$(colr A0 15)"
has "a0noperf why" "eval_line=missing" "$(colr A0 16)"
eq "a0noperf proof-A0" OK "$(colr A0-p 14)"   # the proof does not read the metric
eq "a0noperf matched" 0 "$(fcount matched)"
not_has "a0noperf no-success" "MATCH ok" "$(driver_log)"
assert_restore a0noperf

echo "== audit6b: the fake rejects a misspelled flag (--no-cnv is NOT a flag) =="
FB=/tmp/dspark-dry-flagbad
rm -rf "$FB"; mkdir -p "$FB"
BADCMD=$(D=/data/local/tmp/dspark-spec; . "$CELL/arm.sh" >/dev/null 2>&1; arm_cmd flagbad A 8 measure | sed 's/ -lv 4/ -lv 4 --no-cnv/')
CLEANCMD=$(D=/data/local/tmp/dspark-spec; . "$CELL/arm.sh" >/dev/null 2>&1; arm_cmd flagok A0 8 measure)
set +e
env FAKE_ADB_STATE="$FB" "$CELL/fake-adb.sh" -s fake shell "$BADCMD" > "$CELL/raw/dryrun-flagbad.log" 2>&1
RC=$?
set -e
eq "flagbad rc" 65 "$RC"
has "flagbad names the flag" "--no-cnv" "$(cat "$CELL/raw/dryrun-flagbad.log" 2>/dev/null || echo none)"
has "flagbad recorded" "--no-cnv" "$(cat "$FB/shell_bad_flags.log" 2>/dev/null || echo none)"
if [ -f "$FB/dev/flagbad.log" ]; then fail "flagbad no-log" "fake answered anyway"; else pass "flagbad no-log"; fi
set +e
env FAKE_ADB_STATE="$FB" "$CELL/fake-adb.sh" -s fake shell "$CLEANCMD" > "$CELL/raw/dryrun-flagok.log" 2>&1
RC2=$?
set -e
eq "flagok rc (selective)" 0 "$RC2"
rm -rf "$FB"

echo
echo "== audit4-adj: fake adb sh -n-checked every shell command of every fixture =="
synbad=$(ls /tmp/dspark-dry-*/shell_syntax_errors.log 2>/dev/null | head -5 || true)
if [ -z "$synbad" ]; then
  pass "shell-syntax all-fixtures"
else
  fail "shell-syntax all-fixtures" "$synbad: $(head -3 $(echo "$synbad" | head -1) 2>/dev/null | tr '\n' ' ')"
fi
printf 'SUMMARY pass=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
