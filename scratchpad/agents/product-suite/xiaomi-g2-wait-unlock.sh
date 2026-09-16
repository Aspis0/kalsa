#!/usr/bin/env bash
# Xiaomi 14: care + keyguard poll. No PIN taps. No S23/Jelly. No pairing spam.
# Stdout: ACTION_REQUIRED / DONE / FAILED only. Heartbeats go to the evidence md.
set -uo pipefail
DIR=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite
LOG="${LOG:-$DIR/XIAOMI-G2-WAIT-2026-09-11.log}"
MD="${MD:-$DIR/XIAOMI-G2-IDENTITY-2026-09-11.md}"
UNLOCK_FLAG="${UNLOCK_FLAG:-$DIR/XIAOMI-G2-UNLOCKED.flag}"
IP=192.168.1.193
SERIAL="${ANDROID_SERIAL:-$IP:37707}"
DELAY=30
MAX_DELAY=120
export ANDROID_SERIAL="$SERIAL"

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
    return 0
  fi
  note "adb missing serial=$SERIAL delay=${DELAY}s"
  adb connect "$SERIAL" >/dev/null 2>&1 || true
  sleep 1
  s=$(xiaomi_serial)
  if [ -n "$s" ]; then
    SERIAL="$s"
    export ANDROID_SERIAL="$s"
    DELAY=30
    echo "ACTION_REQUIRED: adb recovered $SERIAL"
    return 0
  fi
  p=$(mdns_port)
  if [ -n "$p" ]; then
    note "mdns port=$p"
    SERIAL="$IP:$p"
    adb connect "$SERIAL" >/dev/null 2>&1 || true
    sleep 1
    s=$(xiaomi_serial)
    if [ -n "$s" ]; then
      SERIAL="$s"
      export ANDROID_SERIAL="$s"
      DELAY=30
      echo "ACTION_REQUIRED: adb recovered via mdns $SERIAL"
      return 0
    fi
  fi
  utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '%s | - | - | - | - | - | blocked:adb | missing, retry %ss\n' "$utc" "$DELAY" >> "$MD"
  sleep "$DELAY"
  if [ "$DELAY" -lt "$MAX_DELAY" ]; then
    DELAY=$((DELAY * 2))
    [ "$DELAY" -gt "$MAX_DELAY" ] && DELAY=$MAX_DELAY
  fi
  return 1
}

# 0 = still locked/unknown (fail closed). 1 = positively unlocked.
# Empty dumpsys must NOT count as unlocked. Never taps.
keyguard_blocked() {
  local dump
  dump=$(adb shell dumpsys window 2>/dev/null | tr -d '\r') || return 0
  [ -n "$dump" ] || return 0
  printf '%s' "$dump" | grep -q 'mDreamingLockscreen' || return 0
  printf '%s' "$dump" | grep -q 'mDreamingLockscreen=true' && return 0
  printf '%s' "$dump" | grep -qiE 'keyguard_pin_view|Enter PIN or use fingerprint' && return 0
  printf '%s' "$dump" | grep -q 'isStatusBarKeyguard=true' && return 0
  printf '%s' "$dump" | grep -q 'mDreamingLockscreen=false' || return 0
  return 1
}

care_and_heartbeat() {
  local kg="$1" batt therm utc deci level ac status skin
  utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  batt=$(adb shell dumpsys battery 2>/dev/null | tr -d '\r') || batt=""
  therm=$(adb shell dumpsys thermalservice 2>/dev/null | tr -d '\r') || therm=""
  deci=$(printf '%s\n' "$batt" | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/{print $2; exit}')
  level=$(printf '%s\n' "$batt" | awk '/^[[:space:]]+level:[[:space:]]*[0-9]+[[:space:]]*$/{print $2; exit}')
  ac=$(printf '%s\n' "$batt" | awk '/^[[:space:]]+AC powered:/{print $3; exit}')
  status=$(printf '%s\n' "$therm" | awk '/^[[:space:]]*Thermal Status:/{print $3; exit}')
  skin=$(printf '%s\n' "$therm" | awk -F'[=,}]' '/Temperature\{/ && /mName=skin/ { v=$2 } END { print v }')
  if [ "${deci:-0}" -ge 400 ] 2>/dev/null; then
    kg="$kg STOP-inference batt>=40"
  fi
  printf '%s | %s | %s | %s | %s | %s | %s | %s\n' \
    "$utc" "${deci:--}" "${skin:--}" "${level:--}" "${ac:--}" "${status:--}" "$kg" "$SERIAL" >> "$MD"
  note "hb batt=$deci skin=$skin level=$level kg=$kg serial=$SERIAL"
}

note "watch start serial=$SERIAL delay=$DELAY"
while :; do
  if ! ensure_adb; then
    continue
  fi
  if keyguard_blocked; then
    care_and_heartbeat "blocked:keyguard"
    sleep "$DELAY"
    if [ "$DELAY" -lt "$MAX_DELAY" ]; then
      DELAY=$((DELAY * 2))
      [ "$DELAY" -gt "$MAX_DELAY" ] && DELAY=$MAX_DELAY
    fi
    continue
  fi
  care_and_heartbeat "unlocked"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$UNLOCK_FLAG"
  echo "$SERIAL" >> "$UNLOCK_FLAG"
  note "unlocked serial=$SERIAL"
  echo "DONE: Xiaomi unlocked serial=$SERIAL"
  exit 0
done
