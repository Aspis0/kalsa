#!/usr/bin/env bash
# Device-side environment helpers: serial pick, thermal/battery reads,
# wake-lock + screen timeout, shade collapse.
#
# Sourced by device-share-send.sh (and anything else that drives a phone).
# Not a CLI. Relies on ci-lib.sh for log/die/adb keep-awake.
#
# Thermal: dumpsys battery history lines contain "temperature:" — never
# scrape digits off the whole dump. Use the anchored awk below.
#
# Serial: ANDROID_SERIAL or -s. Never hardcode. Two attached transports
# without a serial is fatal. Export ANDROID_SERIAL so ci-lib's bare `adb`
# hits the same device.
set -uo pipefail

PKG="${PKG:-com.kalsa.app}"
BENCH_TARGET="${BENCH_TARGET:-device}"

_DEVICE_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-lib.sh
source "$_DEVICE_ENV_DIR/ci-lib.sh"

# device_pick_serial <env_serial> <newline-separated attached serials>
# Prints the serial to use. Return 1 if the caller must die.
device_pick_serial() {
  local env_s="${1:-}" list="${2:-}" n first
  if [ -n "$env_s" ]; then
    printf '%s\n' "$env_s"
    return 0
  fi
  n=$(printf '%s\n' "$list" | awk 'NF {c++} END {print c+0}')
  first=$(printf '%s\n' "$list" | awk 'NF {print; exit}')
  if [ "$n" -eq 1 ]; then
    printf '%s\n' "$first"
    return 0
  fi
  return 1
}

# Live battery temperature (tenths of °C) from a dumpsys battery blob.
device_battery_temp_from_dump() {
  awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ { print $2; exit }'
}

device_battery_level_from_dump() {
  awk '/^[[:space:]]+level:[[:space:]]*[0-9]+[[:space:]]*$/ { print $2; exit }'
}

device_thermal_status_from_dump() {
  awk '/^[[:space:]]*Thermal Status:[[:space:]]*[0-9]+/ {
    sub(/.*Thermal Status:[[:space:]]*/, "")
    print $1
    exit
  }'
}

device_battery_temp_deci() {
  local v
  v=$(adb shell dumpsys battery 2>/dev/null | tr -d '\r' | device_battery_temp_from_dump || true)
  case "$v" in ''|*[!0-9]*) printf '%s\n' unknown ;; *) printf '%s\n' "$v" ;; esac
}

device_battery_level() {
  local v
  v=$(adb shell dumpsys battery 2>/dev/null | tr -d '\r' | device_battery_level_from_dump || true)
  case "$v" in ''|*[!0-9]*) printf '%s\n' unknown ;; *) printf '%s\n' "$v" ;; esac
}

device_thermal_status() {
  local v
  v=$(adb shell dumpsys thermalservice 2>/dev/null | tr -d '\r' | device_thermal_status_from_dump || true)
  case "$v" in ''|*[!0-9]*) printf '%s\n' unknown ;; *) printf '%s\n' "$v" ;; esac
}

# Battery temperature in °C (dumpsys battery 'temperature' is in deci-°C,
# e.g. 420 = 42.0°C). 'unknown' on any parse failure.
device_battery_temp_c() {
  local t
  t=$(adb shell dumpsys battery 2>/dev/null | tr -d '\r' | grep -m1 -E '^\s*temperature:' | sed -E 's/.*temperature:[[:space:]]*([0-9]+).*/\1/' || true)
  case "$t" in ''|*[!0-9]*) printf '%s\n' unknown ;; *) python3 -c "print(f'{int('$t')/10:.1f}')" ;; esac
}

device_termux_wakelock_setup() {
  adb shell "run-as com.termux files/usr/bin/bash -lc 'export PATH=/data/data/com.termux/files/usr/bin:\$PATH; termux-wake-lock'" >/dev/null 2>&1 \
    && log "termux-wake-lock: on" \
    || log "termux-wake-lock: skipped (Termux missing — not fatal)"
}

device_termux_wakelock_restore() {
  adb shell "run-as com.termux files/usr/bin/bash -lc 'export PATH=/data/data/com.termux/files/usr/bin:\$PATH; termux-wake-unlock'" >/dev/null 2>&1 || true
}

# keep-awake + Termux. Overwrites the keep-awake EXIT trap so both restore.
device_keepawake_begin() {
  device_keepawake_setup
  device_termux_wakelock_setup
  trap 'device_termux_wakelock_restore; device_keepawake_restore' EXIT
}

device_collapse_shade() {
  adb shell cmd statusbar collapse >/dev/null 2>&1 || true
  adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
  adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
}

device_dump_ui_retry() {
  local attempt out
  for attempt in 1 2 3; do
    out=$(dump_ui 2>/dev/null || true)
    if printf '%s' "$out" | grep -q '<hierarchy'; then
      printf '%s\n' "$out"
      return 0
    fi
    [ "$attempt" -lt 3 ] && sleep 2
  done
  log "dump failed, not an empty screen" >&2
  return 1
}

device_ui_has_any() {
  local ui="$1" label
  shift
  for label in "$@"; do
    printf '%s' "$ui" | grep -qF "$label" && return 0
  done
  return 1
}
