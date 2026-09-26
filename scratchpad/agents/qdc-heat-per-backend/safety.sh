# Per-turn safety gate for the heat driver. One responsibility: read live
# device status, end the session on a hard limit, and rebuild the
# kalsa.bench.thermo profile that readGovernorThermo (governorInputs.ts:259)
# prefers over the real sensor.
#
# Why live: a profile frozen at session start can never reach the engine's
# pause/kill (llama-governor-policy.cpp:12,23 reads batt_temp_tenths_c/10) or
# its low-battery/plugged paths, so every model turn re-reads the device and
# pushes a fresh profile first; the hard stops below end the run where the
# engine would otherwise kill it.
#
# Field mapping: batt_temp_tenths_c carries the LIVE skin (the field the old
# frozen profile filled, now current); t_idle_c stays the session's idle
# baseline because the engine invalidates a plugged profile when idle drifts
# > 1.5 C from its reference (policy:98-101).

LIVE_SKIN=""; LIVE_THERMAL_STATUS=""; LIVE_BATT_TEMP_TENTHS=""; LIVE_BATT_LEVEL=""; LIVE_PLUGGED=""

session_stop() {
  log "STOP reason=$1"
  write_end "stop_$1"
  STOP_SAMPLER_ON_EXIT=1
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

# Hard stops (audit F1): skin >= 44 C, thermal status >= 3, battery
# temperature >= 44 C, battery level <= 25 %, plugged = true.
hard_stops() {
  awk -v v="${LIVE_SKIN:-0}" 'BEGIN{exit !(v+0 >= 44)}' && session_stop skin
  [ "${LIVE_THERMAL_STATUS:-0}" -ge 3 ] 2>/dev/null && session_stop thermal_status
  awk -v v="${LIVE_BATT_TEMP_TENTHS:-0}" 'BEGIN{exit !(v+0 >= 440)}' && session_stop battery_temp
  [ "${LIVE_BATT_LEVEL:-100}" -le 25 ] 2>/dev/null && session_stop battery_level
  [ "$LIVE_PLUGGED" = true ] && session_stop plugged
  return 0
}

# Stop checks only: called before the cooldown wait so a hot fixture cannot
# park the driver in 720 s of polling.
safety_stops() {
  live_readings
  hard_stops
}

# safety_gate <label>: hard stops, then rebuild and push the bench thermo
# profile from live readings. Exits 0 via session_stop on any limit.
safety_gate() {
  local label="$1" now trend tskin
  safety_stops
  tskin="${LIVE_SKIN:-}"
  [ -n "$tskin" ] || { log "NO_LIVE_SKIN label=$label"; write_end "no_live_skin"; exit 6; }
  # A missing battery level must not fall back to a fabricated 100 % in the
  # profile — that would hide the low-battery path F1 exists to unblock.
  [ -n "$LIVE_BATT_LEVEL" ] || { log "NO_LIVE_BATT_LEVEL label=$label"; write_end "no_live_batt"; exit 6; }
  [ -n "$FIRST_SKIN_C" ] || FIRST_SKIN_C="$tskin"
  now=$(date +%s)
  trend=0.000
  if [ "$PREV_TIME" -gt 0 ]; then
    trend=$(awk -v a="$tskin" -v b="$PREV_SKIN" -v d="$((now-PREV_TIME))" 'BEGIN{if(d>0)printf "%.3f",(a-b)/(d/60);else print "0.000"}')
  fi
  THERMO_JSON=$(printf '{"batt_temp_tenths_c":%s,"batt_level_pct":%s,"plugged":%s,"sensor_valid":true,"t_idle_valid":true,"t_idle_c":%s,"trend_c_per_min":%s}' \
    "$(awk -v v="$tskin" 'BEGIN{printf "%.0f",v*10}')" "${LIVE_BATT_LEVEL:-100}" "$LIVE_PLUGGED" "$FIRST_SKIN_C" "$trend")
  PREV_SKIN="$tskin"; PREV_TIME="$now"
  set_prefs "$RAW/safety_$label" || { log "PREFS_FAIL label=$label"; write_end "prefs_fail"; exit 3; }
  log "THERMO_REFRESH label=$label skin=$tskin batt_level=${LIVE_BATT_LEVEL:-na} batt_temp=${LIVE_BATT_TEMP_TENTHS:-na} plugged=$LIVE_PLUGGED thermal_status=${LIVE_THERMAL_STATUS:-na}"
}
