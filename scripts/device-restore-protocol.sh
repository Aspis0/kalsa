#!/usr/bin/env bash
# HARNESS_FINDINGS §7.29 protocol, re-run on an APK that carries the merge.
#
# Question: after `tryLoadEngineSession` populates native KV, does the static
# prefix prewarm still `seq_rm` over it? §7.29 measured the restore alone on an
# APK that predates the prewarm. This script measures restore + prewarm
# together, which is the shipping path.
#
# Shape, per cycle: force-stop -> relaunch -> wait Ready -> one continuation
# turn -> read `n_past` (KALSA_KVDIAG), `promptMs` (KALSA_TELEMETRY) and the
# prewarm's own verdict (KALSA_PREWARM).
#
# Everything runs in ONE invocation with keep-awake armed at the top, because
# a detached phone loses the wake-lock between scripts. Every adb call takes
# `</dev/null` — a caller's stdin gets eaten otherwise and the loop hangs.
#
#   ANDROID_SERIAL=<serial> scripts/device-restore-protocol.sh [cycles]
set -uo pipefail

_RP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=device-share-send.sh
source "$_RP_DIR/device-share-send.sh"

CYCLES="${1:-4}"
OUT="${OUT:-device-restore-out}"
ACTIVITY="${ACTIVITY:-com.kalsa.app/.MainActivity}"
REPLY_TIMEOUT="${REPLY_TIMEOUT:-600}"
READY_TIMEOUT="${READY_TIMEOUT:-240}"

MESSAGES=(
  "In una riga: qual e la capitale del Portogallo?"
  "In una riga: e quella della Norvegia?"
  "In una riga: e quella della Grecia?"
  "In una riga: e quella della Finlandia?"
  "In una riga: e quella dell Islanda?"
  "In una riga: e quella dell Irlanda?"
)

rp_wait_ready() {
  local t=0 ui
  while [ "$t" -lt "$READY_TIMEOUT" ]; do
    if ui=$(device_dump_ui_retry); then
      device_ui_has_any "$ui" "${_SHARE_READY_LABELS[@]}" && { log "ready after ${t}s"; return 0; }
    fi
    sleep 5
    t=$((t + 5))
  done
  log "never reported Ready after ${READY_TIMEOUT}s"
  return 1
}

rp_wait_reply() {
  local prev="$1" t=0 count
  while [ "$t" -lt "$REPLY_TIMEOUT" ]; do
    count=$(device_history_assistant_count)
    case "$count" in ''|*[!0-9]*) count=-1 ;; esac
    if [ "$count" -gt "$prev" ]; then
      log "reply persisted after ${t}s (assistants ${prev}->${count})"
      return 0
    fi
    sleep 5
    t=$((t + 5))
  done
  log "no reply within ${REPLY_TIMEOUT}s"
  return 1
}

rp_state() {
  log "state: level=$(device_battery_level) temp_deci=$(device_battery_temp_deci) thermal=$(device_thermal_status)"
}

rp_main() {
  local attached picked i prev
  mkdir -p "$OUT"
  attached=$(adb devices 2>/dev/null | awk '$2=="device" {print $1}')
  picked=$(device_pick_serial "${ANDROID_SERIAL:-}" "$attached") \
    || die "need ANDROID_SERIAL (attached: $(printf '%s' "$attached" | tr '\n' ' '))"
  export ANDROID_SERIAL="$picked"
  BENCH_TARGET=device
  log "serial=$ANDROID_SERIAL cycles=$CYCLES"

  device_keepawake_begin
  rp_state

  adb logcat -c </dev/null >/dev/null 2>&1 || true
  adb logcat -v time </dev/null > "$OUT/logcat.txt" 2>&1 &
  local logcat_pid=$!
  trap 'kill '"$logcat_pid"' 2>/dev/null || true; device_termux_wakelock_restore; device_keepawake_restore' EXIT

  for i in $(seq 1 "$CYCLES"); do
    log "=== cycle $i/$CYCLES ==="
    echo "KALSA_RP_MARK cycle=$i" >> "$OUT/logcat.txt"
    adb shell am force-stop com.kalsa.app </dev/null >/dev/null 2>&1
    sleep 5
    adb shell am start -n "$ACTIVITY" </dev/null >/dev/null 2>&1
    rp_wait_ready || { log "cycle $i: no Ready, aborting cycle"; continue; }
    rp_state
    prev=$(device_history_assistant_count)
    case "$prev" in ''|*[!0-9]*) prev=0 ;; esac
    if ! device_share_send "${MESSAGES[$(( (i - 1) % ${#MESSAGES[@]} ))]}"; then
      log "cycle $i: send failed"
      continue
    fi
    rp_wait_reply "$prev" || log "cycle $i: reply timeout"
    rp_state
    sleep 5
  done

  sleep 5
  kill "$logcat_pid" 2>/dev/null || true
  grep -E "KALSA_RP_MARK|KALSA_KVDIAG|KALSA_KVRESUME|KALSA_PREWARM|KALSA_SESSION|KALSA_TELEMETRY|restored state checkpoint|no usable state checkpoint|reusing [0-9]+/" \
    "$OUT/logcat.txt" > "$OUT/evidence.txt" || true
  log "evidence: $OUT/evidence.txt ($(wc -l < "$OUT/evidence.txt" | tr -d ' ') lines)"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  rp_main "$@"
fi
