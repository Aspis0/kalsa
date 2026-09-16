#!/usr/bin/env bash
# Block until Xiaomi keyguard is down or 6h elapse. Fail-closed. No PIN taps.
# Exit 0 = unlocked (oneshot attempted). Exit 2 = 6h still locked.
set -uo pipefail
DIR=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite
MD="$DIR/XIAOMI-G2-IDENTITY-2026-09-11.md"
LOG="$DIR/XIAOMI-G2-WAIT6H-2026-09-11.log"
ONESHOT="$DIR/xiaomi-g2-restore-oneshot.sh"
FLAG="$DIR/XIAOMI-G2-UNLOCKED.flag"
IP=192.168.1.193
PORT=37707
SERIAL="${ANDROID_SERIAL:-$IP:$PORT}"
export ANDROID_SERIAL="$SERIAL"
DEADLINE=$(( $(date +%s) + 6 * 3600 ))
ADB_DELAY=30
ONESHOT_RAN=0

note() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }

xiaomi_serial() {
  adb devices -l 2>/dev/null | awk '/192\.168\.1\.193:/{print $1; exit}'
}

mdns_port() {
  adb mdns services 2>/dev/null | awk '/192\.168\.1\.193:/{
    if (match($0, /192\.168\.1\.193:[0-9]+/)) {
      s=substr($0, RSTART, RLENGTH)
      split(s, a, ":")
      print a[2]
      exit
    }
  }'
}

ensure_adb() {
  local s p
  s=$(xiaomi_serial)
  if [ -n "$s" ]; then
    SERIAL="$s"
    export ANDROID_SERIAL="$s"
    ADB_DELAY=30
    return 0
  fi
  note "adb missing; connect $SERIAL"
  adb connect "$SERIAL" >/dev/null 2>&1 || true
  sleep 1
  s=$(xiaomi_serial)
  if [ -n "$s" ]; then
    SERIAL="$s"
    export ANDROID_SERIAL="$s"
    ADB_DELAY=30
    note "adb recovered $SERIAL"
    return 0
  fi
  p=$(mdns_port)
  if [ -n "${p:-}" ]; then
    SERIAL="$IP:$p"
    adb connect "$SERIAL" >/dev/null 2>&1 || true
    sleep 1
    s=$(xiaomi_serial)
    if [ -n "$s" ]; then
      SERIAL="$s"
      export ANDROID_SERIAL="$s"
      ADB_DELAY=30
      note "adb recovered mdns $SERIAL"
      return 0
    fi
  fi
  hb "-" "-" "-" "-" "-" "blocked:adb" "missing"
  sleep "$ADB_DELAY"
  if [ "$ADB_DELAY" -lt 120 ]; then
    ADB_DELAY=$((ADB_DELAY * 2))
    [ "$ADB_DELAY" -gt 120 ] && ADB_DELAY=120
  fi
  return 1
}

hb() {
  local deci="$1" skin="$2" level="$3" ac="$4" status="$5" kg="$6" ser="$7"
  local utc
  utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '%s | %s | %s | %s | %s | %s | %s | %s\n' \
    "$utc" "$deci" "$skin" "$level" "$ac" "$status" "$kg" "$ser" >> "$MD"
  note "hb batt=$deci skin=$skin level=$level kg=$kg serial=$ser"
}

# Unlocked only if dump is non-empty, mDreamingLockscreen=false,
# AND mCurrentFocus is not NotificationShade. Empty dump = locked.
is_unlocked() {
  local dump
  dump=$(adb shell dumpsys window 2>/dev/null | tr -d '\r') || return 1
  [ -n "$dump" ] || return 1
  printf '%s' "$dump" | grep -q 'mDreamingLockscreen' || return 1
  printf '%s' "$dump" | grep -q 'mDreamingLockscreen=false' || return 1
  printf '%s' "$dump" | grep -q 'mDreamingLockscreen=true' && return 1
  printf '%s' "$dump" | grep -q 'isStatusBarKeyguard=true' && return 1
  printf '%s' "$dump" | awk '/mCurrentFocus=/{print; exit}' | grep -q 'NotificationShade' && return 1
  return 0
}

read_care() {
  BATT=$(adb shell dumpsys battery 2>/dev/null | tr -d '\r') || BATT=""
  THERM=$(adb shell dumpsys thermalservice 2>/dev/null | tr -d '\r') || THERM=""
  DECI=$(printf '%s\n' "$BATT" | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/{print $2; exit}')
  LEVEL=$(printf '%s\n' "$BATT" | awk '/^[[:space:]]+level:[[:space:]]*[0-9]+[[:space:]]*$/{print $2; exit}')
  AC=$(printf '%s\n' "$BATT" | awk '/^[[:space:]]+AC powered:/{print $3; exit}')
  STATUS=$(printf '%s\n' "$THERM" | awk '/^[[:space:]]*Thermal Status:/{print $3; exit}')
  SKIN=$(printf '%s\n' "$THERM" | awk -F'[=,}]' '/Temperature\{/ && /mName=skin/ { v=$2 } END { print v }')
  DECI=${DECI:-}
  SKIN=${SKIN:-}
  LEVEL=${LEVEL:-}
  AC=${AC:-}
  STATUS=${STATUS:-}
}

thermal_block() {
  case "${DECI:-}" in
    ''|*[!0-9]*) ;;
    *) [ "$DECI" -ge 400 ] && return 0 ;;
  esac
  if [ -n "${SKIN:-}" ] && awk "BEGIN{exit !(${SKIN} >= 40)}"; then
    return 0
  fi
  return 1
}

note "wait6h start serial=$SERIAL deadline=$(date -u -r "$DEADLINE" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$DEADLINE")"

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if ! ensure_adb; then
    continue
  fi
  read_care
  if thermal_block; then
    hb "${DECI:--}" "${SKIN:--}" "${LEVEL:--}" "${AC:--}" "${STATUS:--}" "blocked:thermal" "$SERIAL"
    sleep 90
    continue
  fi
  if ! is_unlocked; then
    hb "${DECI:--}" "${SKIN:--}" "${LEVEL:--}" "${AC:--}" "${STATUS:--}" "blocked:keyguard" "$SERIAL"
    sleep 90
    continue
  fi
  hb "${DECI:--}" "${SKIN:--}" "${LEVEL:--}" "${AC:--}" "${STATUS:--}" "unlocked" "$SERIAL"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$FLAG"
  echo "$SERIAL" >> "$FLAG"
  if [ "$ONESHOT_RAN" -eq 0 ]; then
    note "running oneshot"
    ONESHOT_RAN=1
    export ANDROID_SERIAL="$SERIAL"
    bash "$ONESHOT"
    rc=$?
    echo "ONESHOT_EXIT:$rc"
    note "oneshot exit=$rc"
  fi
  echo "DONE: unlocked serial=$SERIAL oneshot_ran=$ONESHOT_RAN"
  exit 0
done

hb "${DECI:--}" "${SKIN:--}" "${LEVEL:--}" "${AC:--}" "${STATUS:--}" "blocked:keyguard 6h-cap" "${SERIAL:-missing}"
echo "LOCKED_TIMEOUT"
exit 2
