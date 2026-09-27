# pin.sh — calib.ok pin resolution and validation. One responsibility: turn
# the device-specific pin written by CALIBRATE=1 into the session's execute-op
# floor, or refuse it loudly. Two entry points:
#   resolve_calib_pin   — parse + validate the file (keys, rate sanity, model
#                         and kit binding); called by d_run.sh after log().
#   check_calib_pin_board — after the board is known: the pin's serial/SoC
#                         must match THIS device (audit3 A-N6), else exit 9.
# Refusal is an abort, not a silent fallback: a pin that does not belong to
# this board/kit/range must force a recalibration, never a weaker gate.
#
# Keys written by calibrate.sh: htp_ops_floor_per_tok, serial, soc, model_sha,
# kit_sha (+ measured_npu_*). Rate sanity (audit3 A-N5a): the measured
# ops/token must sit inside [0.5, 25] — the repo's own priors span 1.72..20.2
# (arm.sh header); anything outside is a broken calibration, not a truth.

HTP_FLOOR_PER_TOKEN="${HTP_FLOOR_PRIOR}"; HTP_FLOOR_SOURCE="prior"
PIN_SERIAL=""; PIN_SOC=""

resolve_calib_pin() {
  local floor serial soc model_sha kit_sha why=""
  if [ ! -f "$CELL/calib.ok" ]; then
    HTP_FLOOR_PER_TOKEN="$HTP_FLOOR_PRIOR"
    HTP_FLOOR_SOURCE="prior(no calib.ok — run CALIBRATE=1 first)"
    return 0
  fi
  floor=$(sed -n 's/^htp_ops_floor_per_tok=//p' "$CELL/calib.ok" | tail -1)
  serial=$(sed -n 's/^serial=//p' "$CELL/calib.ok" | tail -1)
  soc=$(sed -n 's/^soc=//p' "$CELL/calib.ok" | tail -1)
  model_sha=$(sed -n 's/^model_sha=//p' "$CELL/calib.ok" | tail -1)
  kit_sha=$(sed -n 's/^kit_sha=//p' "$CELL/calib.ok" | tail -1)
  if [ -z "$floor" ] || [ -z "$serial" ] || [ -z "$soc" ] || [ -z "$model_sha" ] || [ -z "$kit_sha" ]; then
    why="missing_keys"
  elif ! awk -v v="$floor" 'BEGIN{exit !(v ~ /^[0-9]+([.][0-9]+)?$/)}'; then
    why="floor_not_numeric"
  elif ! awk -v v="$floor" 'BEGIN{exit !(v+0 >= 0.5 && v+0 <= 25)}'; then
    why="floor_rate_out_of_band($floor)"
  elif [ "$model_sha" != "$MODEL_SHA" ]; then
    why="model_sha_mismatch"
  elif [ "$kit_sha" != "$KIT_SHA" ]; then
    why="kit_sha_mismatch"
  fi
  if [ -n "$why" ]; then
    log "CALIB_PIN_INVALID why=$why file=$CELL/calib.ok — recalibrate with CALIBRATE=1"
    exit 9
  fi
  HTP_FLOOR_PER_TOKEN="$floor"
  HTP_FLOOR_SOURCE="calib.ok"
  PIN_SERIAL="$serial"
  PIN_SOC="$soc"
  return 0
}

check_calib_pin_board() {
  # Called once the board is known (SER + SOC), still pre-mutation.
  [ -n "$PIN_SERIAL" ] || return 0
  if [ "$PIN_SERIAL" != "$SER" ] || [ "$PIN_SOC" != "$SOC" ]; then
    log "CALIB_PIN_MISMATCH serial=$SER soc=$SOC pin_serial=$PIN_SERIAL pin_soc=$PIN_SOC — this pin belongs to another board, recalibrate here"
    exit 9
  fi
  log "CALIB_PIN_BOARD_OK serial=$SER soc=$SOC"
  return 0
}
