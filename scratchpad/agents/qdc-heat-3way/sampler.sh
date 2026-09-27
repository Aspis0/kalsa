# sampler.sh — lifecycle of the on-device 1 s thermal sampler: launch, the
# pause/resume around each measured turn, the final stop. One responsibility.
# The pause is audit dd6bdb56 A-11 (owner-approved): the sampler's
# dumpsys+sysfs loop is a 1 Hz load on the very SoC the measured turn times,
# so it runs everywhere EXCEPT inside `llama-completion`'s measured window
# (registered in PREREG's pre-run amendments).
# Deps provided by d_run.sh: adbT, log, ADB_BIN, SER, RAW, HEAT_TMP,
# SAMPLER_WAIT_S.
SAMPLER_PID=0; SAMPLER_PAUSED=0
# A-N7 (audit3): what the LAST measured turn saw — "na" until a pause runs,
# then "ok" (device-confirmed exit) or "unconfirmed"; row col 26 carries it.
SAMPLER_STATE="na"

launch_sampler() {
  "$ADB_BIN" -s "$SER" shell "sh $HEAT_TMP/smp.sh" >> "$RAW/sampler.log" 2>&1 &
  SAMPLER_PID=$!
  if [ "$SAMPLER_WAIT_S" -gt 0 ]; then sleep "$SAMPLER_WAIT_S"; fi
  log "SAMPLER_LAUNCHED pid=$SAMPLER_PID"
}
sampler_pause() {
  # Nothing running = quiet window, but record it as ok so the row is honest.
  [ "$SAMPLER_PID" -ne 0 ] || { SAMPLER_STATE=ok; return 0; }
  # NEW-6 (audit2): the marker — not the client kill — is what ends the device
  # loop; it may be inside a dumpsys + sleep 1, so wait for its exit stamp
  # (smp.sh writes "H sampler_done" when the loop ends) BEFORE trusting the
  # window to be quiet. The client exits by itself once the remote script does.
  local before after i=0
  # Read the baseline BEFORE touching the marker — otherwise the loop's
  # (fast) exit stamp could land inside the baseline and the wait would look
  # for a second stamp that never comes.
  before=$(adbT 15 -s "$SER" shell "grep -c 'H sampler_done' $HEAT_TMP/samples.txt" 2>/dev/null || true)
  before=$(printf '%s' "${before:-0}" | tr -d '\r[:space:]')
  [ -n "$before" ] || before=0
  adbT 30 -s "$SER" shell "touch $HEAT_TMP/stop" >/dev/null 2>&1 || true
  while [ "$i" -lt 6 ]; do
    after=$(adbT 15 -s "$SER" shell "grep -c 'H sampler_done' $HEAT_TMP/samples.txt" 2>/dev/null || true)
    after=$(printf '%s' "${after:-0}" | tr -d '\r[:space:]')
    if [ -n "$after" ] && [ "$after" -gt 0 ] 2>/dev/null && [ "$after" -gt "$before" ] 2>/dev/null; then
      kill "$SAMPLER_PID" 2>/dev/null || true
      wait "$SAMPLER_PID" 2>/dev/null || true
      SAMPLER_PID=0; SAMPLER_PAUSED=1
      SAMPLER_STATE=ok
      log "SAMPLER_PAUSE_CONFIRMED (device loop exited; window quiet)"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  kill "$SAMPLER_PID" 2>/dev/null || true
  wait "$SAMPLER_PID" 2>/dev/null || true
  SAMPLER_PID=0; SAMPLER_PAUSED=1
  SAMPLER_STATE=unconfirmed
  log "SAMPLER_PAUSE_UNCONFIRMED (no sampler_done stamp in 6 s — device loop may still run into the turn)"
  return 0
}
sampler_resume() {
  [ "$SAMPLER_PAUSED" -eq 1 ] || return 0
  adbT 30 -s "$SER" shell "rm -f $HEAT_TMP/stop" >> "$RAW/setup.log" 2>&1 || true
  SAMPLER_PAUSED=0
  launch_sampler
  log "SAMPLER_RESUMED"
}
stop_sampler() {
  [ -n "$SER" ] || return 0
  SAMPLER_PAUSED=0
  adbT 30 -s "$SER" shell "touch $HEAT_TMP/stop" >/dev/null 2>&1 || true
  if [ "$SAMPLER_PID" -ne 0 ]; then
    kill "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
    SAMPLER_PID=0
  fi
  return 0
}
