# sampler.sh — lifecycle of the on-device 1 s thermal sampler: launch, the
# pause/resume around each measured turn, the final stop. One responsibility.
# The pause is audit dd6bdb56 A-11 (owner-approved): the sampler's
# dumpsys+sysfs loop is a 1 Hz load on the very SoC the measured turn times,
# so it runs everywhere EXCEPT inside `llama-completion`'s measured window
# (registered in PREREG's pre-run amendments).
# Deps provided by d_run.sh: adbT, log, ADB_BIN, SER, RAW, HEAT_TMP,
# SAMPLER_WAIT_S.
SAMPLER_PID=0; SAMPLER_PAUSED=0

launch_sampler() {
  "$ADB_BIN" -s "$SER" shell "sh $HEAT_TMP/smp.sh" >> "$RAW/sampler.log" 2>&1 &
  SAMPLER_PID=$!
  if [ "$SAMPLER_WAIT_S" -gt 0 ]; then sleep "$SAMPLER_WAIT_S"; fi
  log "SAMPLER_LAUNCHED pid=$SAMPLER_PID"
}
sampler_pause() {
  [ "$SAMPLER_PID" -ne 0 ] || return 0
  adbT 30 -s "$SER" shell "touch $HEAT_TMP/stop" >/dev/null 2>&1 || true
  kill "$SAMPLER_PID" 2>/dev/null || true
  wait "$SAMPLER_PID" 2>/dev/null || true
  SAMPLER_PID=0; SAMPLER_PAUSED=1
  log "SAMPLER_PAUSED (measured turn excluded from the 1 Hz series)"
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
  adbT 30 -s "$SER" shell "touch $HEAT_TMP/stop" >/dev/null 2>&1 || true
  if [ "$SAMPLER_PID" -ne 0 ]; then
    kill "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
    SAMPLER_PID=0
  fi
  return 0
}
