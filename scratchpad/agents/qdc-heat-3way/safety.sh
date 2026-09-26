# safety.sh — hard stops for the qdc-heat-3way driver. One responsibility:
# read live device status and request a session stop on a hard limit.
#
# Provenance (copied, not sourced): live_readings, require_numeric and
# hard_stops are taken from ../qdc-heat-per-backend/safety.sh:26-77 (its
# session_stop becomes request_stop here). That file cannot be sourced whole
# because its second half — safety_gate/thermo_refresh — rebuilds the app's
# kalsa.bench.thermo profile through set_prefs (parse.sh), and parse.sh IS the
# app harness (APK install, logcat anchors, composer typing): none of it exists
# on the CLI-kit path, and safety.sh's session_stop force-stops com.kalsa.app
# then `exit 0`, which would hide the stop reason from this driver's exit
# status. ../qdc-heat-per-backend/battery_trust.sh, by contrast, is sourced
# unchanged (pure dumpsys logic; its only deps — adbT, log, RAW, SER — are
# provided by d_run.sh).
#
# Stops = the owner's closed list (qdc-heat-per-backend REPORT 2026-09-26):
# thermal status >= 3, battery temp >= 44.0 C, battery level <= 25 %, plugged,
# plus fail-closed missing_<name> for every reading. Skin is recorded, not a
# stop, except battery_trust.sh's skin >= 46 C fallback on a board whose
# battery sensor is an injected stub (the 44 C stop can never fire there).

LIVE_SKIN=""; LIVE_THERMAL_STATUS=""; LIVE_BATT_TEMP_TENTHS=""; LIVE_BATT_LEVEL=""; LIVE_PLUGGED=false

live_readings() {
  local thermals battery
  thermals=$(adbT 60 -s "$SER" shell dumpsys thermalservice 2>/dev/null)
  battery=$(adbT 60 -s "$SER" shell dumpsys battery 2>/dev/null)
  # HAL section only: dumpsys also prints a "Cached temperatures" skin value
  # that can trail the live reading by degrees (sa849155c: 30.4 cached vs
  # 38.4 HAL) — a stale skin would both miss stops and record wrong deltas.
  LIVE_SKIN=$(printf '%s\n' "$thermals" | awk '/Current temperatures from HAL/{f=1} f{print} /Current cooling devices from HAL/{f=0}' \
    | sed -n 's/.*mValue=\([0-9.]*\), mType=3, mName=[sS][kK][iI][nN].*/\1/p' | head -1 | tr -d '\r')
  LIVE_THERMAL_STATUS=$(printf '%s\n' "$thermals" | sed -n 's/.*Thermal Status: *\([0-9][0-9]*\).*/\1/p' | head -1 | tr -d '\r')
  LIVE_BATT_TEMP_TENTHS=$(printf '%s\n' "$battery" | sed -n 's/^ *temperature: *\([0-9][0-9]*\).*/\1/p' | head -1 | tr -d '\r')
  LIVE_BATT_LEVEL=$(printf '%s\n' "$battery" | sed -n 's/^ *level: *\([0-9][0-9]*\).*/\1/p' | head -1 | tr -d '\r')
  LIVE_PLUGGED=false
  if printf '%s\n' "$battery" | grep -Eq '^ *(AC|USB|Wireless) powered: true'; then LIVE_PLUGGED=true; fi
  printf 'live skin=%s thermal_status=%s batt_temp=%s batt_level=%s plugged=%s\n' \
    "${LIVE_SKIN:-na}" "${LIVE_THERMAL_STATUS:-na}" "${LIVE_BATT_TEMP_TENTHS:-na}" "${LIVE_BATT_LEVEL:-na}" "$LIVE_PLUGGED" >> "$RAW/safety.log"
}

# A missing or non-numeric reading is a failed sensor, not a safe value:
# defaulting it to 0/100 would both hide the stops and record garbage deltas,
# so it ends the session (fail closed, same as the source cell).
require_numeric() {
  if ! awk -v v="$2" 'BEGIN{exit !(v ~ /^[0-9]+([.][0-9]+)?$/)}'; then request_stop "missing_$1"; return 1; fi
  return 0
}

# request_stop <reason>: the only stop channel. Writes $RAW/stop_request so
# the background poll (a subshell) can report a stop the driver would never
# otherwise see, kills a running arm, and logs. Callers decide how to end.
request_stop() {
  printf '%s\n' "$1" > "$RAW/stop_request"
  log "STOP reason=$1"
  adbT 15 -s "$SER" shell pkill -f llama-completion >/dev/null 2>&1 || true
}

# hard_stops: returns 1 after requesting a stop, 0 when all readings pass.
hard_stops() {
  require_numeric skin "$LIVE_SKIN" || return 1
  require_numeric thermal_status "$LIVE_THERMAL_STATUS" || return 1
  require_numeric battery_temp "$LIVE_BATT_TEMP_TENTHS" || return 1
  require_numeric battery_level "$LIVE_BATT_LEVEL" || return 1
  if [ "$LIVE_THERMAL_STATUS" -ge 3 ]; then request_stop thermal_status; return 1; fi
  if [ "$BATTERY_UNTRUSTED" = "1" ]; then
    # battery_trust.sh verdict: the battery sensor is an injected stub, so the
    # 44 C stop can never fire — skin >= 46 C takes its place on this board.
    if awk -v v="$LIVE_SKIN" 'BEGIN{exit !(v+0 >= 46.0)}'; then request_stop skin_fallback; return 1; fi
  else
    if awk -v v="$LIVE_BATT_TEMP_TENTHS" 'BEGIN{exit !(v+0 >= 440)}'; then request_stop battery_temp; return 1; fi
  fi
  if [ "$LIVE_BATT_LEVEL" -le 25 ]; then request_stop battery_level; return 1; fi
  if [ "$LIVE_PLUGGED" = true ]; then request_stop plugged; return 1; fi
  return 0
}

# safety_gate <label>: read + check in one step for the foreground call sites
# (setup, after each arm). Returns 1 if a stop was requested.
safety_gate() {
  log "GATE label=$1"
  live_readings
  hard_stops
}
