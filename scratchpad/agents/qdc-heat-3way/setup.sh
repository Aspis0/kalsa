# setup.sh — pre-arm device setup. One responsibility: everything between
# "adb is up" and "the first arm may load" — prior-run restore, fresh state
# write, trap arming (INT/TERM/HUP/EXIT, before the first mutation), screen
# mutations, kit+trust+gate, the NEW-4 pgrep self-test, sampler launch.
# Called once by d_run.sh as session_setup; exits the driver on any failure.
pgrep_selftest() {
  local out probe
  out=$(adbT 15 -s "$SER" shell "pgrep -f zzz_no_such_proc_zzz; echo PGREP_RC=\$?" 2>/dev/null || true)
  probe=$(printf '%s\n' "$out" | sed -n 's/.*PGREP_RC=\([0-9][0-9]*\).*/\1/p' | tail -1)
  if [ "$probe" != 1 ]; then log "PGREP_SELFTEST_FAIL health_probe_rc=${probe:-missing}"; return 1; fi
  adbT 15 -s "$SER" shell "sh -c 'sleep 4731 >/dev/null 2>&1 &'" >/dev/null 2>&1 || true
  out=$(adbT 15 -s "$SER" shell "pgrep -f 'sleep 4731'; echo PGREP_RC=\$?" 2>/dev/null || true)
  probe=$(printf '%s\n' "$out" | sed -n 's/.*PGREP_RC=\([0-9][0-9]*\).*/\1/p' | tail -1)
  if [ "$probe" != 0 ]; then log "PGREP_SELFTEST_FAIL alive_probe_rc=${probe:-missing} (pgrep could not find a live process)"; return 1; fi
  adbT 15 -s "$SER" shell "pkill -f 'sleep 4731'" >/dev/null 2>&1 || true
  out=$(adbT 15 -s "$SER" shell "pgrep -f 'sleep 4731'; echo PGREP_RC=\$?" 2>/dev/null || true)
  probe=$(printf '%s\n' "$out" | sed -n 's/.*PGREP_RC=\([0-9][0-9]*\).*/\1/p' | tail -1)
  if [ "$probe" != 1 ]; then log "PGREP_SELFTEST_FAIL kill_probe_rc=${probe:-missing} (sleep still visible after pkill)"; return 1; fi
  log "PGREP_SELFTEST_OK (health/alive/gone probes passed — kill verification trusted this session)"
  return 0
}


# ---- session setup: pre-mutation (nothing changes before the state file
# exists and the traps below are armed) ----
session_setup() {
SER="${ADB_SERIAL:-$(adbT 60 devices | awk 'NR > 1 && $2 == "device" { print $1; exit }' | tr -d '\r' || true)}"
[ -n "$SER" ] || { log "NO_DEVICE port=$ADB_PORT"; exit 2; }
adbT 60 -s "$SER" wait-for-device > "$RAW/wait_for_device.txt" 2>&1 || { log "WAIT_FOR_DEVICE_FAIL"; exit 2; }
# A-6/A-8: an earlier run's .restore-state is CONSUMED here (restore first),
# never blindly deleted — after a SIGKILL the stale state is the only record
# of the pre-run values, and overwriting it with mutated values would strand
# the device at 1800000/3 on the next restore. Refuse to continue if that
# restore fails; only after success may this run write its own fresh state.
if [ -f "$CELL/.restore-state" ]; then
  log "PRIOR_RESTORE .restore-state from an earlier run"
  bash "$CELL/restore.sh" >> "$RAW/prior_restore.log" 2>&1 \
    || { log "PRIOR_RESTORE_FAIL (see prior_restore.log); refusing to continue over unrestored state"; exit 3; }
fi
prompt_verify || { log "PROMPT_IDENTITY_FAIL"; exit 6; }
SOC=$(adbT 30 -s "$SER" shell getprop ro.soc.model | tr -d '\r') || { log "ADB_FAIL soc_read"; exit 2; }
case "$SOC" in
  SM8550) BOARD=S23-v73 ;;
  *) log "UNSUPPORTED_SOC=$SOC (this kit ships only the v73 DSP skel)"; exit 6 ;;
esac
# A-7: default to null like STAYON — an empty read must not strand the
# restore in RESTORE_BAD_TIMEOUT with the phone left at 1800000.
SCREEN_OFF_TIMEOUT=$(adbT 30 -s "$SER" shell settings get system screen_off_timeout | tr -d '\r') || { log "ADB_FAIL timeout_get"; exit 2; }
[ -n "$SCREEN_OFF_TIMEOUT" ] || SCREEN_OFF_TIMEOUT=null
STAYON=$(adbT 30 -s "$SER" shell settings get global stay_on_while_plugged_in | tr -d '\r') || { log "ADB_FAIL stayon_get"; exit 2; }
[ -n "$STAYON" ] || STAYON=null
printf 'SER=%s\nSCREEN_OFF_TIMEOUT=%s\nSTAYON=%s\nJOB=%s\n' "$SER" "$SCREEN_OFF_TIMEOUT" "$STAYON" "$JOB" > "$CELL/.restore-state"
# Traps armed AFTER the state write and BEFORE the first mutation — so a
# failure between here and any device change is restored (A-5: HUP included;
# an SSH drop must not leave the phone at 1800000/3 without restore).
trap 'on_signal INT 2' INT
trap 'on_signal TERM 15' TERM
trap 'on_signal HUP 1' HUP
trap cleanup EXIT
DEADLINE_EPOCH=$(( $(date +%s) + DEADLINE_MINUTES * 60 ))
adbT 30 -s "$SER" shell input keyevent KEYCODE_WAKEUP >> "$RAW/setup.log" 2>&1 || true
adbT 30 -s "$SER" shell svc power stayon true >> "$RAW/setup.log" 2>&1 || true
adbT 30 -s "$SER" shell settings put system screen_off_timeout 1800000 >> "$RAW/setup.log" 2>&1 || true
log "SESSION job=$JOB board=$BOARD soc=$SOC serial=$SER order=$ARM_ORDER stayon_saved=$STAYON timeout_saved=$SCREEN_OFF_TIMEOUT"
kit_setup || { log "KIT_SETUP_FAIL"; exit 5; }
battery_trust_check || { log "BATTERY_TRUST_READ_FAIL"; exit 3; }
safety_gate setup || finish_stop
FIRST_SKIN_C="$LIVE_SKIN"
log "SETUP_DONE skin0=$FIRST_SKIN_C battery_untrusted=$BATTERY_UNTRUSTED htp_floor=$HTP_FLOOR_PER_TOKEN source=$HTP_FLOOR_SOURCE"
pgrep_selftest || { log "PGREP_SELFTEST_ABORT (audit2 NEW-4: kill verification impossible on this phone)"; exit 4; }
launch_sampler
}
