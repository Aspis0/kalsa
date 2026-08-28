#!/usr/bin/env bash
# Continuous host-side logcat. Tags ReactNativeJS AndroidRuntime libc llama
# native PLUS *:W so crash stacks are not blind. Clear at arm start.
# On reconnect: `logcat -d` dump BEFORE resume, append. Per-turn datastore
# is the source of truth; this file is forensics.
set -uo pipefail

CAMPAIGN_LOGCAT_PID=""
CAMPAIGN_LOGCAT_FILE=""

# Broader than -s ReactNativeJS (that filter drops AndroidRuntime/native).
_CAMPAIGN_LOGCAT_FILTER="ReactNativeJS:V AndroidRuntime:V libc:V llama:V native:V DEBUG:V *:W"

campaign_logcat_stop() {
  if [ -n "${CAMPAIGN_LOGCAT_PID:-}" ]; then
    kill "$CAMPAIGN_LOGCAT_PID" 2>/dev/null || true
    wait "$CAMPAIGN_LOGCAT_PID" 2>/dev/null || true
    CAMPAIGN_LOGCAT_PID=""
  fi
}

campaign_logcat_start() {
  local file="${1:?}"
  CAMPAIGN_LOGCAT_FILE="$file"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  campaign_logcat_stop
  # stdin trap: logcat would eat supervisor stdin
  # shellcheck disable=SC2086
  adb logcat -v threadtime $_CAMPAIGN_LOGCAT_FILTER </dev/null >>"$file" 2>/dev/null &
  CAMPAIGN_LOGCAT_PID=$!
  log "logcat pid=$CAMPAIGN_LOGCAT_PID file=$file"
}

campaign_logcat_clear_arm() {
  campaign_logcat_stop
  adb logcat -c </dev/null >/dev/null 2>&1 || true
  if [ -n "${CAMPAIGN_LOGCAT_FILE:-}" ]; then
    : > "$CAMPAIGN_LOGCAT_FILE"
    campaign_logcat_start "$CAMPAIGN_LOGCAT_FILE"
  fi
  log "logcat cleared at arm start"
}

# Call on every adb reconnect BEFORE resume. Dumps the ring buffer that
# may have rotated during the drop, then restarts the live stream.
campaign_logcat_on_reconnect() {
  local file="${CAMPAIGN_LOGCAT_FILE:-}"
  [ -n "$file" ] || return 0
  log "logcat: dump -d on reconnect before resume"
  campaign_logcat_stop
  adb logcat -d -v threadtime </dev/null >>"$file" 2>/dev/null || true
  campaign_logcat_start "$file"
}

campaign_logcat_ensure() {
  local file="${CAMPAIGN_LOGCAT_FILE:-}"
  [ -n "$file" ] || return 0
  if [ -z "${CAMPAIGN_LOGCAT_PID:-}" ] || ! kill -0 "$CAMPAIGN_LOGCAT_PID" 2>/dev/null; then
    log "logcat: process dead, restarting"
    campaign_logcat_start "$file"
  fi
}

campaign_logcat_offset() {
  local file="${CAMPAIGN_LOGCAT_FILE:-}"
  if [ -n "$file" ] && [ -f "$file" ]; then
    wc -c < "$file" | tr -d ' '
  else
    echo 0
  fi
}

# Extract bytes after offset into dest (this turn's slice).
campaign_logcat_slice() {
  local offset="${1:-0}" dest="${2:?}"
  local file="${CAMPAIGN_LOGCAT_FILE:-}"
  : > "$dest"
  [ -n "$file" ] && [ -f "$file" ] || return 0
  tail -c +"$((offset + 1))" "$file" > "$dest" 2>/dev/null || : > "$dest"
}
