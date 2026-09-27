# dryrun-paths.sh — session lifecycle paths: stale state, arm timeout,
# decode gates, prior restore, adb failures, SIGHUP (sourced by dryrun.sh).

echo "== fixture A2: stale stop_request + END cleared at session start =="
run_fixture stale CG seed_stale
eq "stale rc" 0 "$RC"
assert_end stale exit_0
eq "stale rows" 2 "$(rows)"
eq "stale first row OK" OK "$(col 1 4)"
eq "stale stop_request gone" absent "$([ -f "$RAW/stop_request" ] && echo present || echo absent)"
eq "stale kill marker gone (A-N2)" absent "$([ -f "$RAW/kill_unverified" ] && echo present || echo absent)"
assert_restore stale

echo "== fixture A3/A-4: arm timeout kills the remote orphan (verified) =="
run_fixture timeout CG ARM_TIMEOUT_S=1 DRY_ARM_SLEEP_S=2
eq "tmo rc" 0 "$RC"
assert_end tmo exit_0
eq "tmo rows" 2 "$(rows)"
eq "tmo void_reason" load_fail "$(col 1 5)"
has "tmo orphan-kill logged" "ARM_TIMEOUT backend=cpu" "$(cat "$RAW/driver.log")"
has "tmo kill verified" "KILL_VERIFIED" "$(cat "$RAW/driver.log")"
eq "tmo bracketed pkill" yes "$([ -f "$STATE/pkill.log" ] && echo yes || echo no)"
eq "tmo pgrep probed" yes "$([ -f "$STATE/pgrep.log" ] && echo yes || echo no)"
assert_restore tmo

echo "== fixture A7: unequal decode voids the row and stops the session =="
run_fixture decode-unequal CG DRY_DECODE_RUNS=125
eq "dec rc" 0 "$RC"
assert_end dec stop_unequal_decode
eq "dec rows" 1 "$(rows)"
eq "dec status" VOID "$(col 1 4)"
eq "dec void_reason" decode_len "$(col 1 5)"
eq "dec runs recorded" 125 "$(col 1 23)"
assert_restore dec

echo "== fixture A7b: gate derives N-1 from -n (DECODE_N=64 accepts 63) =="
run_fixture decode-derived CG DECODE_N=64 DRY_DECODE_RUNS=63
eq "decder rc" 0 "$RC"
assert_end decder exit_0
eq "decder rows" 2 "$(rows)"
eq "decder status" OK "$(col 1 4)"
eq "decder runs accepted" 63 "$(col 1 23)"
assert_restore decder

echo "== fixture A-6: stale .restore-state is consumed (prior restore), not clobbered =="
run_fixture prior-restore CG seed_prior_restore
eq "prs rc" 0 "$RC"
assert_end prs exit_0
eq "prs prior restore log" yes "$([ -f "$RAW/prior_restore.log" ] && echo yes || echo no)"
eq "prs fresh state captured pristine" "STAYON=1" "$(grep '^STAYON=' "$CELL/.restore-state" 2>/dev/null)"
eq "prs final timeout pristine" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
eq "prs final stayon pristine" 1 "$(cat "$STATE/stay_on_while_plugged_in" 2>/dev/null || echo missing)"
assert_restore prior-restore

echo "== fixture A-9: adb failures log loudly instead of dying raw =="
run_fixture fail-devices CG DRY_FAIL_DEVICES=1
eq "fdv rc" 2 "$RC"
has "fdv NO_DEVICE logged" "NO_DEVICE" "$(cat "$RAW/driver.log")"
assert_no_end fdv
run_fixture fail-soc CG DRY_FAIL_SOC=1
eq "fsoc rc" 2 "$RC"
has "fsoc ADB_FAIL logged" "ADB_FAIL soc_read" "$(cat "$RAW/driver.log")"
assert_no_end fsoc

echo "== fixture NEW-4: broken pgrep aborts before any load =="
run_fixture pgrep-broken CG DRY_PGREP_BROKEN=1
eq "pgb rc" 4 "$RC"
has "pgb selftest failed" "PGREP_SELFTEST_FAIL" "$(cat "$RAW/driver.log")"
assert_end pgb exit_4_kill_unverified
eq "pgb no load ran" absent "$([ -f "$RAW/dry-pgrep-broken-t1cpu.load.log" ] && echo present || echo absent)"
eq "pgb no turn ran" absent "$([ -f "$RAW/dry-pgrep-broken-t1cpu.log" ] && echo present || echo absent)"
# restore runs but CANNOT verify the kill on a broken pgrep: loud rc=1 +
# marker (which is exactly what gave us END exit_4_kill_unverified above).
eq "pgb restore rc loud" 1 "$(sed -n 's/.* rc=\([0-9]*\)$/\1/p' "$RAW/restore.log" 2>/dev/null | tail -1)"
has "pgb restore unverified" "RESTORE_LLAMA_UNVERIFIED" "$(cat "$RAW/restore_run.log" 2>/dev/null)"
eq "pgb timeout-restored" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"

echo "== fixture A-N6: a pin from another board refuses the session =="
run_fixture calib-pin-mismatch CG seed_calib_mismatch
eq "cpm rc" 9 "$RC"
has "cpm mismatch logged" "CALIB_PIN_MISMATCH" "$(cat "$RAW/driver.log")"
assert_no_end cpm
eq "cpm no load ran" absent "$([ -f "$RAW/dry-calib-pin-mismatch-t1cpu.load.log" ] && echo present || echo absent)"

echo "== fixture A-N5a: an out-of-band pin rate refuses the session pre-device =="
run_fixture calib-pin-badrate CG seed_calib_badrate
eq "cpr rc" 9 "$RC"
has "cpr invalid logged" "CALIB_PIN_INVALID why=floor_rate_out_of_band" "$(cat "$RAW/driver.log")"
assert_no_end cpr
eq "cpr never touched the device" absent "$([ -f "$RAW/wait_for_device.txt" ] && echo present || echo absent)"

echo "== fixture: no pgrep/pkill probe self-matches on healthy equipment (S23 1640559a) =="
run_fixture no-selfmatch CG
eq "nsm rc" 0 "$RC"
assert_end nsm exit_0
eq "nsm rows" 2 "$(rows)"
has "nsm selftest ok" "PGREP_SELFTEST_OK" "$(cat "$RAW/driver.log")"
has "nsm restore probe verified" "kill_check=verified" "$(cat "$RAW/restore.log" 2>/dev/null)"
eq "nsm restore rc" 0 "$(sed -n 's/.* rc=\([0-9]*\)$/\1/p' "$RAW/restore.log" 2>/dev/null | tail -1)"
assert_restore nsm

echo "== fixture A-5: SIGHUP (SSH drop) restores the device =="
STATE="/tmp/qdc-heat3way-fake-sighup"
rm -rf "$STATE" "$CELL/raw/dry-sighup"
mkdir -p "$STATE" "$CELL/raw"
# Fixture isolation (this block bypasses run_fixture): no stale state AND no
# leftover pin — the pin fixtures before this one leave their seeds behind.
rm -f "$CELL/.restore-state" "$CELL/calib.ok"
set +e
env ADB_BIN="$CELL/dryrun-adb.sh" FAKE_ADB_STATE="$STATE" ADB_PORT=5037 \
    COOL_POLL_S=1 TAIL_S=0 SAMPLER_WAIT_S=0 BATT_TRUST_INTERVAL_S=1 \
    DRY_ARM_SLEEP_S=60 \
    bash "$CELL/d_run.sh" dry-sighup CG 20 > "$CELL/raw/dryrun-sighup.log" 2>&1 &
HUP_PID=$!
sleep 8
kill -HUP "$HUP_PID"
wait "$HUP_PID"
RC=$?
set -e
RAW="$CELL/raw/dry-sighup"
eq "hup rc" 129 "$RC"
assert_end hup signal_HUP
assert_restore hup
eq "hup stop marker left for the sampler" yes "$([ -f "$STATE/dev/stop_marker" ] && echo yes || echo no)"
