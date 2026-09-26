# stop_lib.sh — ONE sourced stop library for the heat cells: live readings,
# numeric (fail-closed) checks, the hard stops, and request_stop. The DSpark
# cell sources this file too, so it stays dependency-light: callers must
# provide log, adbT, RAW, SER, BATTERY_UNTRUSTED.
#
# Provenance (copied, not sourced): the bodies come from
# ../qdc-heat-per-backend/safety.sh — live_readings :29-46, require_numeric
# :51-53, hard_stops :65-84, session_stop :20-27 (became request_stop). That
# file cannot be sourced whole: its safety_gate/thermo_refresh rebuild the
# app's kalsa.bench.thermo profile through set_prefs in parse.sh, and parse.sh
# IS the app harness (APK install, logcat anchors, composer typing) — none of
# which exists on the CLI-kit path; its session_stop also `exit 0`s, hiding
# the stop reason from the driver. It is also frozen while its QDC session
# runs live (audit f2ee97f4 A5 requires changes below that we may not make
# there; that cell's owner applies them later).
#
# Audit f2ee97f4 deltas vs the source cell:
#   A5 — battery >= 44.0 C is ALWAYS armed; an untrusted-battery verdict only
#        ADDS the skin >= 46 C stop, it never disarms the battery stop.
#   A14 — plugged also matches `Dock powered: true`.
#   A3  — the pkill pattern is bracketed so it cannot self-match.

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
  if printf '%s\n' "$battery" | grep -Eq '^ *(AC|USB|Wireless|Dock) powered: true'; then LIVE_PLUGGED=true; fi
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
# otherwise see, and kills a running arm. The bracket in the pattern (A3):
# without it `pkill -f llama-completion` matches the wrapping `sh -c` that
# carries the same string and kills the killer's own shell.
request_stop() {
  printf '%s\n' "$1" > "$RAW/stop_request"
  log "STOP reason=$1"
  adbT 15 -s "$SER" shell "pkill -f 'llama-completio[n]'" >/dev/null 2>&1 || true
}

# hard_stops: returns 1 after requesting a stop, 0 when all readings pass.
# Owner's closed list; A5: the battery stop never disarms — an untrusted
# battery sensor only ADDS the skin >= 46 C stop for that board.
hard_stops() {
  require_numeric skin "$LIVE_SKIN" || return 1
  require_numeric thermal_status "$LIVE_THERMAL_STATUS" || return 1
  require_numeric battery_temp "$LIVE_BATT_TEMP_TENTHS" || return 1
  require_numeric battery_level "$LIVE_BATT_LEVEL" || return 1
  if [ "$LIVE_THERMAL_STATUS" -ge 3 ]; then request_stop thermal_status; return 1; fi
  if [ "$LIVE_BATT_TEMP_TENTHS" -ge 440 ]; then request_stop battery_temp; return 1; fi
  if [ "$BATTERY_UNTRUSTED" = "1" ]; then
    if awk -v v="$LIVE_SKIN" 'BEGIN{exit !(v+0 >= 46.0)}'; then request_stop skin_fallback; return 1; fi
  fi
  if [ "$LIVE_BATT_LEVEL" -le 25 ]; then request_stop battery_level; return 1; fi
  if [ "$LIVE_PLUGGED" = true ]; then request_stop plugged; return 1; fi
  return 0
}

# safety_gate <label>: read + check for the foreground call sites (setup,
# after each arm). Returns 1 if a stop was requested.
safety_gate() {
  log "GATE label=$1"
  live_readings
  hard_stops
}
