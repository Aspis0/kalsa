#!/usr/bin/env bash
# Device recovery: offline → connect+backoff; unauthorized → re-pair note;
# IP change → adb mdns services then connect the configured device. Pull RKStorage (+wal/shm)
# BEFORE any restart. App won't start → adb install -r SAME apk (never
# uninstall, never pm clear). Thermal status>=3: stop, cooldown, resume
# SAME arm/conv only.
set -uo pipefail

CAMPAIGN_SERIAL="${CAMPAIGN_SERIAL:-192.168.1.82:34037}"
# Pause threshold: critical status (default ≥5) or battery temperature above
# CAMPAIGN_THERMAL_MAX_C. Status 2-3 on AC power is the Jelly's equilibrium,
# while the separate unplugged owner stop line below is deliberately stricter.
CAMPAIGN_THERMAL_PAUSE="${CAMPAIGN_THERMAL_PAUSE:-5}"
CAMPAIGN_THERMAL_MAX_C="${CAMPAIGN_THERMAL_MAX_C:-45}"
# Owner's written unplugged stop line: battery >=44.0°C or thermal status >=3.
# The external device watchdog kills at 43°C battery, so this is the second line
# of defence, not the first.
CAMPAIGN_THERMAL_HARD_ABORT_C="${CAMPAIGN_THERMAL_HARD_ABORT_C:-44.0}"
CAMPAIGN_THERMAL_HARD_ABORT_STATUS="${CAMPAIGN_THERMAL_HARD_ABORT_STATUS:-3}"
CAMPAIGN_THERMAL_OVERSHOOT_S="${CAMPAIGN_THERMAL_OVERSHOOT_S:-120}"
# Three consecutive 0.1°C rises are required after the expected overshoot;
# one battery reporting tick is too noisy to end a 20-turn run.
CAMPAIGN_THERMAL_RISING_SAMPLES="${CAMPAIGN_THERMAL_RISING_SAMPLES:-3}"
CAMPAIGN_THERMAL_COOLDOWN_STEP_S="${CAMPAIGN_THERMAL_COOLDOWN_STEP_S:-60}"
CAMPAIGN_THERMAL_COOLDOWN_CAP_S="${CAMPAIGN_THERMAL_COOLDOWN_CAP_S:-7200}"

campaign_connect() {
  local serial="${1:-$CAMPAIGN_SERIAL}" attempt delay
  delay=2
  for attempt in 1 2 3 4 5; do
    adb connect "$serial" </dev/null >/dev/null 2>&1 || true
    sleep 1
    if [ "$(campaign_adb_state)" = "device" ]; then
      log "adb connect ok $serial (attempt $attempt)"
      return 0
    fi
    sleep "$delay"
    delay=$((delay * 2))
    [ "$delay" -gt 30 ] && delay=30
  done
  return 1
}

campaign_mdns_for_serial() {
  local configured_serial="${1:-$CAMPAIGN_SERIAL}" configured_ip line ip discovered_ip
  configured_ip="${configured_serial%%:*}"
  # mDNS only helps IP change; pairing persists.
  while IFS= read -r line; do
    ip=$(printf '%s' "$line" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+' | head -1)
    [ -z "$ip" ] && continue
    discovered_ip="${ip%%:*}"
    if [ "$discovered_ip" = "$configured_ip" ]; then
      printf '%s\n' "$ip"
      return 0
    fi
    log "RECOVERY refusal: mdns serial=$ip has different IP from configured serial=$configured_serial" >&2
  done <<EOF
$(adb mdns services </dev/null 2>/dev/null || true)
EOF
  return 1
}

campaign_ensure_device() {
  local state serial
  serial="${ANDROID_SERIAL:-$CAMPAIGN_SERIAL}"
  export ANDROID_SERIAL="$serial"
  CAMPAIGN_SERIAL="$serial"
  state=$(campaign_adb_state)
  case "$state" in
    device) return 0 ;;
    unauthorized)
      log "RECOVERY reason=unauthorized — re-pair this host with the Jelly (adb pair <ip:port> <code>), then retry"
      return 1
      ;;
    offline|unknown|*)
      log "RECOVERY reason=offline state=$state — connect $serial"
      if campaign_connect "$serial"; then
        campaign_logcat_on_reconnect
        return 0
      fi
      local found
      if found=$(campaign_mdns_for_serial "$serial"); then
        log "RECOVERY reason=ip-change mdns=$found"
        export ANDROID_SERIAL="$found"
        CAMPAIGN_SERIAL="$found"
        campaign_connect "$found" || return 1
        campaign_logcat_on_reconnect
        return 0
      fi
      log "RECOVERY failed: device missing (serial=$serial)"
      return 1
      ;;
  esac
}

# Pull RKStorage (+wal/shm) via _device_pull_db BEFORE any restart.
campaign_pull_db() {
  local dir="${1:?}"
  mkdir -p "$dir"
  _device_pull_db "$dir" || { log "RKStorage pull failed"; return 1; }
  log "pulled RKStorage into $dir"
}

campaign_find_apk() {
  local f tried="" cands=()
  [ -n "${CAMPAIGN_APK:-}" ] && cands+=("$CAMPAIGN_APK")
  [ -n "${CAMPAIGN_CONFIG_APK:-}" ] && cands+=("$CAMPAIGN_CONFIG_APK")
  cands+=("${REPO:-.}/android/app/build/outputs/apk/debug/app-debug.apk")
  for f in "${cands[@]}"; do
    tried="$tried $f"
    if [ -f "$f" ]; then
      log "apk=$f"
      printf '%s\n' "$f"
      return 0
    fi
  done
  log "apk miss (tried:$tried)"
  return 1
}

# never uninstall, never pm clear
campaign_reinstall_r() {
  local apk
  apk=$(campaign_find_apk) || die "install -r needed but no apk (tried \$CAMPAIGN_APK, config.apk, debug)"
  log "adb install -r $apk (never uninstall, never pm clear)"
  adb install -r "$apk" </dev/null
}

campaign_app_running() {
  local pid
  pid=$(campaign_pidof)
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  return 0
}

campaign_relaunch_or_reinstall() {
  campaign_launch || return 1
  sleep 8
  if campaign_app_running; then
    return 0
  fi
  log "app did not start — install -r same apk"
  campaign_reinstall_r || return 1
  campaign_launch || return 1
  sleep 8
  campaign_app_running
}

campaign_thermal_should_pause() {
  local st bt
  st=$(device_thermal_status)
  case "$st" in
    ''|unknown|*[!0-9]*) return 1 ;;
  esac
  # The hard-abort condition must imply the pause condition: status 3/4 on an
  # unplugged phone must enter cooldown so the owner's stop line is reachable.
  if campaign_thermal_hard_abort_reason >/dev/null; then
    return 0
  fi
  # Pause only on REAL heat: battery temp > CAMPAIGN_THERMAL_MAX_C (T20C sets
  # 42 in run-t20c.sh:32; the 45 default here only applies if nothing sets it)
  # or a critical system
  # status (≥5, genuine overheating). Status 2-3 while charging is the Jelly's
  # normal equilibrium — work through it; the battery temp is the honest gate.
  [ "$st" -ge "$CAMPAIGN_THERMAL_PAUSE" ] && return 0
  bt=$(device_battery_temp_c)
  case "$bt" in
    ''|unknown|*[!0-9.]*) return 1 ;;
  esac
  python3 -c "exit(0 if float('$bt') > $CAMPAIGN_THERMAL_MAX_C else 1)"
}

# True while the phone is genuinely HOT: system thermal status at/above
# threshold OR battery temperature at/above 40°C (the Jelly stays hot even
# at status 2 because charging adds heat). Keeping the phone cool is the
# priority (owner: slow but safe, always cool) — so resume only when BOTH
# are below limits.
campaign_thermal_still_hot() {
  local st bt
  st=$(device_thermal_status)
  case "$st" in
    ''|unknown|*[!0-9]*) return 0 ;;
  esac
  [ "$st" -ge "$CAMPAIGN_THERMAL_PAUSE" ] && return 0
  bt=$(device_battery_temp_c)
  case "$bt" in
    ''|*[!0-9.]) return 0 ;;
  esac
  python3 -c "exit(0 if float('$bt') > $CAMPAIGN_THERMAL_MAX_C else 1)"
}

campaign_thermal_is_plugged() {
  local serial="${ANDROID_SERIAL:-${CAMPAIGN_SERIAL:-}}" dump
  if [ -n "$serial" ]; then
    dump=$(adb -s "$serial" shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' || true)
  else
    dump=$(adb shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' || true)
  fi
  [ -n "$dump" ] || { printf '%s\n' unknown; return 0; }
  if printf '%s\n' "$dump" | grep -qE '(AC|USB|Wireless|Dock) powered:[[:space:]]*true'; then
    printf '%s\n' true
  elif printf '%s\n' "$dump" | grep -qE '(AC|USB|Wireless|Dock) powered:'; then
    printf '%s\n' false
  else
    printf '%s\n' unknown
  fi
}

campaign_thermal_hard_abort_reason() {
  local plugged st bt
  plugged=$(campaign_thermal_is_plugged)
  [ "$plugged" = false ] || return 1
  st=$(device_thermal_status)
  case "$st" in
    ''|unknown|*[!0-9]*) ;;
    *)
      if [ "$st" -ge "$CAMPAIGN_THERMAL_HARD_ABORT_STATUS" ]; then
        printf 'unplugged thermal status %s >= %s' "$st" "$CAMPAIGN_THERMAL_HARD_ABORT_STATUS"
        return 0
      fi
      ;;
  esac
  bt=$(device_battery_temp_c)
  case "$bt" in
    ''|unknown|*[!0-9.]*) return 1 ;;
  esac
  if python3 - "$bt" "$CAMPAIGN_THERMAL_HARD_ABORT_C" <<'PY'
import sys
sys.exit(0 if float(sys.argv[1]) >= float(sys.argv[2]) else 1)
PY
  then
    printf 'unplugged battery %.1f°C >= %.1f°C' "$bt" "$CAMPAIGN_THERMAL_HARD_ABORT_C"
    return 0
  fi
  return 1
}

campaign_thermal_should_hard_abort() {
  local reason
  reason=$(campaign_thermal_hard_abort_reason) || return 1
  CAMPAIGN_THERMAL_HARD_ABORT_REASON="$reason"
  log "THERMAL HARD ABORT: $reason — stopping the unplugged run; it will not resume"
  return 0
}

campaign_thermal_trend() {
  python3 - "$1" "$2" <<'PY'
import sys
current, previous = map(float, sys.argv[1:])
print("rising" if current > previous else "falling" if current < previous else "steady")
PY
}

campaign_thermal_cooldown_wait() {
  local stop_app="${1:-yes}" waited=0 step cap overshoot previous_bt bt trend
  local rising_samples=0 rising_readings plugged
  step="${CAMPAIGN_THERMAL_COOLDOWN_STEP_S:-60}"
  cap="${CAMPAIGN_THERMAL_COOLDOWN_CAP_S:-7200}"
  overshoot="${CAMPAIGN_THERMAL_OVERSHOOT_S:-120}"
  CAMPAIGN_THERMAL_HARD_ABORT_REASON=""
  case "$step" in ''|*[!0-9]*|0) log "thermal cooldown failed: invalid step '$step'"; return 1 ;; esac
  case "$cap" in ''|*[!0-9]*|0) log "thermal cooldown failed: invalid cap '$cap'"; return 1 ;; esac
  case "$overshoot" in ''|*[!0-9]*|0) log "thermal cooldown failed: invalid overshoot window '$overshoot'"; return 1 ;; esac
  if [ "$step" -gt "$overshoot" ]; then
    # Keep the first post-load sample inside the expected battery overshoot window.
    log "thermal cooldown step ${step}s exceeds overshoot window ${overshoot}s — clamping step to ${overshoot}s"
    step="$overshoot"
  fi
  previous_bt=$(device_battery_temp_c)
  log "RECOVERY reason=thermal — pause (battery > ${CAMPAIGN_THERMAL_MAX_C}°C or status >= $CAMPAIGN_THERMAL_PAUSE; resume when cool — Jelly's charging equilibrium 41-43°C is fine to work through; overshoot window=${overshoot}s)"
  [ "$stop_app" = yes ] && campaign_force_stop
  campaign_thermal_should_hard_abort && return 1
  while [ "$waited" -lt "$cap" ]; do
    sleep "$step"
    waited=$((waited + step))
    campaign_thermal_should_hard_abort && return 1
    bt=$(device_battery_temp_c)
    trend=steady
    if [ "$previous_bt" != unknown ] && [ "$bt" != unknown ]; then
      if ! trend=$(campaign_thermal_trend "$bt" "$previous_bt"); then
        trend=unknown
        log "thermal trend unavailable: failed to compare battery readings previous=${previous_bt}°C current=${bt}°C"
      fi
    fi
    if [ "$waited" -le "$overshoot" ]; then
      rising_samples=0
      rising_readings="$bt"
      log "thermal overshoot window (${waited}s/${overshoot}s, battery=${bt}°C, trend=$trend) — rise is expected after load stops"
    else
      if [ "$trend" = rising ]; then
        rising_samples=$((rising_samples + 1))
        rising_readings="$rising_readings $bt"
      else
        rising_samples=0
        rising_readings="$bt"
      fi
      if [ "$rising_samples" -ge "$CAMPAIGN_THERMAL_RISING_SAMPLES" ]; then
        plugged=$(campaign_thermal_is_plugged)
        if [ "$plugged" = false ]; then
          CAMPAIGN_THERMAL_HARD_ABORT_REASON="unplugged battery kept rising for ${rising_samples} consecutive samples after the ${overshoot}s overshoot window (readings:${rising_readings})"
          log "THERMAL HARD ABORT: $CAMPAIGN_THERMAL_HARD_ABORT_REASON — stopping the unplugged run; it will not resume"
          return 1
        elif [ "$plugged" = true ]; then
          log "thermal battery kept rising for ${rising_samples} samples (readings:${rising_readings}) while plugged — rising temperature is not a reason to stop"
        else
          log "thermal battery kept rising for ${rising_samples} samples (readings:${rising_readings}) but power state is unknown — no hard abort"
        fi
      fi
      if ! campaign_thermal_should_pause; then
        CAMPAIGN_THERMAL_HARD_ABORT_REASON=""
        log "thermal cool after ${waited}s (battery=${bt}°C, trend=$trend; below resume threshold)"
        return 0
      fi
      log "thermal still hot (${waited}s, battery=${bt}°C, trend=$trend, rising_samples=${rising_samples}/${CAMPAIGN_THERMAL_RISING_SAMPLES}, readings:${rising_readings})"
    fi
    previous_bt="$bt"
  done
  CAMPAIGN_THERMAL_HARD_ABORT_REASON="thermal-giveup: cooldown cap ${cap}s reached"
  log "THERMAL GIVEUP: ${CAMPAIGN_THERMAL_HARD_ABORT_REASON} — stopping the run (no recursive wait)"
  return 1
}

# Stop, cooldown, caller resumes SAME arm/conv only.
campaign_thermal_cooldown() {
  campaign_thermal_cooldown_wait yes
}
