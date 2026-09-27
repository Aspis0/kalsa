# dryrun-stops.sh — safety-stop injections (owner stop set, battery-trust
# fallback, mid-arm/load polling, kill verification) — sourced by dryrun.sh.

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

echo "== fixture: stop fires mid-arm (background poll, POLL_S=1) =="
run_fixture stop-midarm CG POLL_S=1 DRY_ARM_SLEEP_S=4 DRY_BATT_TEMP_AT=11 DRY_BATT_TEMP_AFTER=445
eq "smid rc" 0 "$RC"
assert_end smid stop_battery_temp
eq "smid rows" 1 "$(rows)"
eq "smid row voided by stop" "VOID stop_battery_temp" "$(col 1 4) $(col 1 5)"
assert_restore smid

echo "== fixture A-4: pkill that does not kill -> loud kill_unverified end =="
run_fixture kill-unverified CG POLL_S=1 DRY_ARM_SLEEP_S=4 DRY_BATT_TEMP_AT=11 DRY_BATT_TEMP_AFTER=445 DRY_PKILL_NOOP=1
eq "kuv rc" 3 "$RC"
assert_end kuv stop_battery_temp_kill_unverified
eq "kuv rows" 1 "$(rows)"
has "kuv loud log" "PKILL_UNVERIFIED" "$(cat "$RAW/driver.log")"
# The session exit is 3 AND the restore reports the unkillable process: with
# DRY_PKILL_NOOP the pkill genuinely cannot clear the arm, so restore.sh must
# fail loudly (rc=1), not pretend the phone is clean.
has "kuv restore loud" "RESTORE_LLAMA_STILL_RUNNING" "$(cat "$RAW/restore_run.log" 2>/dev/null)"
eq "kuv restore rc" 1 "$(sed -n 's/.* rc=\([0-9]*\)$/\1/p' "$RAW/restore.log" 2>/dev/null | tail -1)"
eq "kuv timeout-restored" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
eq "kuv pgrep probed" yes "$([ -f "$STATE/pgrep.log" ] && echo yes || echo no)"

echo "== fixture A-10/A-3: production 15 s poll cadence during the load phase =="
run_fixture poll-cadence CG DRY_ARM_SLEEP_S=25 DRY_BATT_TEMP_AT=9 DRY_BATT_TEMP_AFTER=445
eq "pcad rc" 0 "$RC"
assert_end pcad stop_battery_temp
eq "pcad rows" 1 "$(rows)"
eq "pcad row is the load-phase stop" "VOID stop_battery_temp na" "$(col 1 4) $(col 1 5) $(col 1 8)"
_start=$(log_ts "$RAW/driver.log" ARM_START)
_stop=$(log_ts "$RAW/driver.log" "STOP reason")
_gap=""
if [ -n "$_start" ] && [ -n "$_stop" ]; then
  _e1=$(ts_epoch "$_start" || echo 0)
  _e2=$(ts_epoch "$_stop" || echo 0)
  _gap=$((_e2 - _e1))
fi
if [ -n "$_gap" ] && [ "$_gap" -ge 13 ] && [ "$_gap" -le 40 ]; then
  pass "pcad stop latency ${_gap}s >= POLL_S(15)-slack"
else
  fail "pcad stop latency" "gap=[${_gap}] start=$_start stop=$_stop (expected 13..40 at production cadence)"
fi
assert_restore poll-cadence

