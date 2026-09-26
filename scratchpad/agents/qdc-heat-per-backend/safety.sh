# Per-turn safety gate for the heat driver. One responsibility: read live
# device status, end the session on a hard limit, and rebuild the
# kalsa.bench.thermo profile that readGovernorThermo (governorInputs.ts:259)
# prefers over the real sensor.
#
# Why live: a profile frozen at session start can never reach the engine's
# pause/kill (llama-governor-policy.cpp:12,23 reads batt_temp_tenths_c/10) or
# its low-battery/plugged paths, so every model turn re-reads the device and
# pushes a fresh profile first; the hard stops below end the run where the
# engine would otherwise kill it. The same checks also run mid-turn from
# poll_until_telemetry (parse.sh), every ~30 s while a turn generates.
#
# Field mapping: batt_temp_tenths_c carries the LIVE skin (the field the old
# frozen profile filled, now current); t_idle_c stays the session's idle
# baseline because the engine invalidates a plugged profile when idle drifts
# > 1.5 C from its reference (policy:98-101).

LIVE_SKIN=""; LIVE_THERMAL_STATUS=""; LIVE_BATT_TEMP_TENTHS=""; LIVE_BATT_LEVEL=""; LIVE_PLUGGED=""

session_stop() {
  log "STOP reason=$1"
  write_end "stop_$1"
  # The session ends here, so the app must too: no generation keeps running
  # past the stop (the EXIT trap restores settings, it does not kill the app).
  adbT 30 -s "$SER" shell "am force-stop $PKG" >/dev/null 2>&1 || true
  exit 0
}

live_readings() {
  local thermals battery
  thermals=$(adbT 60 -s "$SER" shell dumpsys thermalservice 2>/dev/null)
  battery=$(adbT 60 -s "$SER" shell dumpsys battery 2>/dev/null)
  # HAL section only: dumpsys also prints a "Cached temperatures" skin value
  # that can trail the live reading by degrees (sa849155c session_pre: 30.4
  # cached on line 36 vs 38.4 HAL on line 45) — a stale skin would both miss
  # stops and freeze the profile again.
  LIVE_SKIN=$(printf '%s\n' "$thermals" | awk '/Current temperatures from HAL/{f=1} f{print} /Current cooling devices from HAL/{f=0}' \
    | sed -n 's/.*mValue=\([0-9.]*\), mType=3, mName=skin.*/\1/p' | head -1 | tr -d '\r')
  LIVE_THERMAL_STATUS=$(printf '%s\n' "$thermals" | sed -n 's/.*Thermal Status: *\([0-9][0-9]*\).*/\1/p' | head -1 | tr -d '\r')
  LIVE_BATT_TEMP_TENTHS=$(printf '%s\n' "$battery" | sed -n 's/^ *temperature: *\([0-9][0-9]*\).*/\1/p' | head -1 | tr -d '\r')
  LIVE_BATT_LEVEL=$(printf '%s\n' "$battery" | sed -n 's/^ *level: *\([0-9][0-9]*\).*/\1/p' | head -1 | tr -d '\r')
  LIVE_PLUGGED=false
  printf '%s\n' "$battery" | grep -Eq '^ *(AC|USB|Wireless) powered: true' && LIVE_PLUGGED=true
  printf 'live skin=%s thermal_status=%s batt_temp=%s batt_level=%s plugged=%s\n' \
    "${LIVE_SKIN:-na}" "${LIVE_THERMAL_STATUS:-na}" "${LIVE_BATT_TEMP_TENTHS:-na}" "${LIVE_BATT_LEVEL:-na}" "$LIVE_PLUGGED" >> "$RAW/safety.log"
}

# A missing or non-numeric reading is a failed sensor, not a safe value:
# defaulting it to 0/100 would both hide the stops below and let
# thermo_refresh write sensor_valid:true from garbage, so it ends the session.
require_numeric() {
  awk -v v="$2" 'BEGIN{exit !(v ~ /^[0-9]+([.][0-9]+)?$/)}' || session_stop "missing_$1"
}

# Hard stops (owner decision 2026-09-26): thermal status >= 3, battery
# temperature >= 44 C, battery level <= 25 %, plugged = true, plus the
# fail-closed missing-reading stops above. Skin is RECORDED (results columns,
# thermo profile) but is NOT a driver stop — the engine's own pause 43 / kill
# 44 acts on it through the profile. Plugged stays: all 31 real QDC battery
# dumps in this repo read AC/USB powered: false, so true is a genuine
# anomaly (39c2dde6).
hard_stops() {
  require_numeric skin "$LIVE_SKIN"
  require_numeric thermal_status "$LIVE_THERMAL_STATUS"
  require_numeric battery_temp "$LIVE_BATT_TEMP_TENTHS"
  require_numeric battery_level "$LIVE_BATT_LEVEL"
  [ "$LIVE_THERMAL_STATUS" -ge 3 ] && session_stop thermal_status
  awk -v v="$LIVE_BATT_TEMP_TENTHS" 'BEGIN{exit !(v+0 >= 440)}' && session_stop battery_temp
  [ "$LIVE_BATT_LEVEL" -le 25 ] && session_stop battery_level
  [ "$LIVE_PLUGGED" = true ] && session_stop plugged
  return 0
}

# Stop checks only: called after an arm's cooldown/settle wait, before every
# turn, and mid-turn from the poll loop, so a device at (or reading) a limit
# ends the session instead of running on into the next gate.
safety_stops() {
  live_readings
  hard_stops
}

# Rebuild the bench thermo profile from the CURRENT live readings and push it.
# Call only right after safety_stops: that validates every reading, so
# sensor_valid:true never rests on a bad one (audit 39c2dde6 b).
thermo_refresh() {
  local label="$1" now trend tskin
  tskin="$LIVE_SKIN"
  [ -n "$FIRST_SKIN_C" ] || FIRST_SKIN_C="$tskin"
  now=$(date +%s)
  trend=0.000
  if [ "$PREV_TIME" -gt 0 ]; then
    trend=$(awk -v a="$tskin" -v b="$PREV_SKIN" -v d="$((now-PREV_TIME))" 'BEGIN{if(d>0)printf "%.3f",(a-b)/(d/60);else print "0.000"}')
  fi
  THERMO_JSON=$(printf '{"batt_temp_tenths_c":%s,"batt_level_pct":%s,"plugged":%s,"sensor_valid":true,"t_idle_valid":true,"t_idle_c":%s,"trend_c_per_min":%s}' \
    "$(awk -v v="$tskin" 'BEGIN{printf "%.0f",v*10}')" "$LIVE_BATT_LEVEL" "$LIVE_PLUGGED" "$FIRST_SKIN_C" "$trend")
  PREV_SKIN="$tskin"; PREV_TIME="$now"
  set_prefs "$RAW/safety_$label" || { log "PREFS_FAIL label=$label"; write_end "prefs_fail"; exit 3; }
  log "THERMO_REFRESH label=$label skin=$tskin batt_level=$LIVE_BATT_LEVEL batt_temp=$LIVE_BATT_TEMP_TENTHS plugged=$LIVE_PLUGGED thermal_status=$LIVE_THERMAL_STATUS"
}

# safety_gate <label>: hard stops, then rebuild and push the profile.
# Exits 0 via session_stop on any limit or bad reading.
safety_gate() {
  safety_stops
  thermo_refresh "$1"
}
