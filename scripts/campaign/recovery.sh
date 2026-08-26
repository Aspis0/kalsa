#!/usr/bin/env bash
# Device recovery: offline → connect+backoff; unauthorized → re-pair note;
# IP change → adb mdns services then connect Jelly. Pull RKStorage (+wal/shm)
# BEFORE any restart. App won't start → adb install -r SAME apk (never
# uninstall, never pm clear). Thermal status>=3: stop, cooldown, resume
# SAME arm/conv only.
set -uo pipefail

CAMPAIGN_SERIAL="${CAMPAIGN_SERIAL:-192.168.1.82:34037}"
CAMPAIGN_THERMAL_PAUSE="${CAMPAIGN_THERMAL_PAUSE:-3}"

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

campaign_mdns_jelly() {
  local line ip
  # mDNS only helps IP change; pairing persists.
  while IFS= read -r line; do
    ip=$(printf '%s' "$line" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+' | head -1)
    [ -z "$ip" ] && continue
    case "$ip" in
      192.168.1.82:*) printf '%s\n' "$ip"; return 0 ;;
    esac
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
      if found=$(campaign_mdns_jelly); then
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
  campaign_launch
  sleep 8
  if campaign_app_running; then
    return 0
  fi
  log "app did not start — install -r same apk"
  campaign_reinstall_r || return 1
  campaign_launch
  sleep 8
  campaign_app_running
}

campaign_thermal_should_pause() {
  local st
  st=$(device_thermal_status)
  case "$st" in
    ''|unknown|*[!0-9]*) return 1 ;;
  esac
  [ "$st" -ge "$CAMPAIGN_THERMAL_PAUSE" ]
}

# Stop, cooldown, caller resumes SAME arm/conv only.
campaign_thermal_cooldown() {
  local waited=0 cap=1200
  log "RECOVERY reason=thermal — pause (status>=$CAMPAIGN_THERMAL_PAUSE)"
  campaign_force_stop
  while [ "$waited" -lt "$cap" ]; do
    sleep 30
    waited=$((waited + 30))
    campaign_thermal_should_pause || { log "thermal cool after ${waited}s"; return 0; }
    log "thermal still hot (${waited}s)"
  done
  log "thermal still paused after ${cap}s"
  return 1
}
