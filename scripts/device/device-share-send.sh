#!/usr/bin/env bash
# Deliver one chat turn on a physical device via kalsa://share?text=.
#
# WHY NOT `adb input text` + Send (do not "simplify" this back):
#   input text reaches the native EditText but not React `draft`. canSend is
#   `draft.trim()`; Send is a Pressable with accessibilityState.disabled from
#   !canSend and no `disabled=` prop, so the Android node stays enabled=true
#   clickable=true and every tap is a no-op. 2026-08-17 S23, APK 3a3a15f:
#   composer visibly held "Quanto fa due piu due"; Invia dump was
#   class=Button enabled=true clickable=true bounds=[909,2061][1017,2169].
#   Same after the tap. Known device-only harness hole (§7.3).
#
# COST of this path: `am start` makes RN report AppState background, which
#   disposeEngine()s. Survivable when kalsa.bench.kvtranscript=1 (session
#   load ~2 s instead of an ~80 s re-prefill). Expensive when the toggle
#   is off. This script does not flip the toggle.
#
# Serial / thermal / wake-lock: scripts/device/device-env.sh (source of those).
#
# Source this file for the helpers, or run it:
#   ANDROID_SERIAL=<serial> scripts/device/device-share-send.sh [--keepawake] TEXT
#
# Proves the turn left the composer (message_was_submitted) before any
# reply wait. Does not wait for a reply; the caller does. Does not
# install an APK, set prefs, or type into the composer.
# No -e at source time (tests and callers source this). The CLI block sets -e.
set -uo pipefail

OUT="${OUT:-out/device/share-send}"

_DEVICE_SHARE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=device-env.sh
source "$_DEVICE_SHARE_DIR/device-env.sh"

readonly _SHARE_SEND_LABELS=("Send" "Invia")
readonly _SHARE_RELOAD_LABELS=("Tap to reload" "Tocca per ricaricare")
readonly _SHARE_READY_LABELS=("Ready" "Pronto")
readonly _SHARE_PLACEHOLDERS=("Ask a question…" "Fai una domanda…")

device_share_encode() {
  python3 -c '
import sys, urllib.parse
t = sys.argv[1]
if not t.strip():
    sys.exit(2)
print(urllib.parse.quote(t, safe=""))
' "$1"
}

device_tap_reload_if_needed() {
  local ui label tapped=0
  ui=$(device_dump_ui_retry || true)
  device_ui_has_any "$ui" "${_SHARE_RELOAD_LABELS[@]}" || return 0
  for label in "${_SHARE_RELOAD_LABELS[@]}"; do
    if tap_node "$label"; then
      log "reload tap: $label"
      tapped=1
      break
    fi
  done
  [ "$tapped" -eq 1 ] || { log "reload: label found in dump but tap_node missed"; return 1; }
  local i
  for i in $(seq 1 30); do
    sleep 3
    ui=$(device_dump_ui_retry || true)
    if device_ui_has_any "$ui" "${_SHARE_READY_LABELS[@]}"; then
      log "reload: ready after $((i * 3))s"
      return 0
    fi
    if ! device_ui_has_any "$ui" "${_SHARE_RELOAD_LABELS[@]}"; then
      return 0
    fi
  done
  log "reload: banner still up after 90s"
  return 1
}

device_tap_send() {
  local label
  for label in "${_SHARE_SEND_LABELS[@]}"; do
    tap_node "$label" && return 0
  done
  return 1
}

device_composer_from_ui() {
  local ui="$1" t p
  # awk+||true: pipefail+early-exit must not become a CLI abort (SIGPIPE).
  t=$(printf '%s' "$ui" | tr '>' '\n' | awk '
    /class="android.widget.EditText"/ && match($0, /text="[^"]*"/) {
      print substr($0, RSTART + 6, RLENGTH - 7)
      exit
    }') || true
  [ -z "$t" ] && { printf '%s\n' ""; return 0; }
  for p in "${_SHARE_PLACEHOLDERS[@]}"; do
    if [ "$t" = "$p" ]; then
      printf '%s\n' ""
      return 0
    fi
  done
  printf '%s\n' "$t"
}

device_history_assistant_count() {
  local index_raw id key
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  id=$(resolve_active_conversation_id "$index_raw")
  key=$(messages_storage_key "$id")
  sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" > "$OUT/.share_hist.json" 2>/dev/null \
    || : > "$OUT/.share_hist.json"
  python3 -c '
import json, sys
try:
    data = json.loads(open(sys.argv[1], encoding="utf-8").read() or "[]")
    print(sum(1 for m in data if isinstance(m, dict) and m.get("role") == "assistant"))
except Exception:
    print(0)
' "$OUT/.share_hist.json"
}

# Cache-bust with a fragment: AppShell ignores a URL it already consumed.
# Quote the URI for the device shell so metacharacters never split `am`.
device_share_intent() {
  local enc nonce
  enc=$(device_share_encode "$1") || return 1
  nonce="${2:-1}"
  adb shell am start -a android.intent.action.VIEW \
    -d "'kalsa://share?text=${enc}#n=${nonce}'" >/dev/null
}

# device_share_send <text>
#   Share → reload-if-needed → require text visible → Send → prove submitted.
#   Returns 0 only after message_was_submitted. Never waits for a reply.
device_share_send() {
  local msg="$1"
  local prev count ctext ui needle attempt send_attempt sub_t seen
  [ -n "${msg//[[:space:]]/}" ] || { log "share-send: empty text"; return 1; }
  mkdir -p "$OUT"
  device_collapse_shade
  prev=$(device_history_assistant_count)
  case "$prev" in ''|*[!0-9]*) prev=0 ;; esac
  needle=$(printf '%s' "$msg" | awk '{s=$0} END {if (length(s)>48) print substr(s,1,48); else print s}')

  device_tap_reload_if_needed || true
  seen=false
  for attempt in 1 2 3; do
    log "share-send attempt ${attempt}/3: $msg"
    device_share_intent "$msg" "${attempt}_$(date +%s)" || {
      log "share-send: am start failed"
      continue
    }
    sleep 3
    device_tap_reload_if_needed || true
    local t=0 landed
    while [ "$t" -lt 18 ]; do
      landed=""
      if ui=$(device_dump_ui_retry); then
        landed=$(device_composer_from_ui "$ui")
      fi
      if [ -n "$landed" ] && printf '%s' "$landed" | grep -qF "$needle"; then
        seen=true
        break
      fi
      sleep 3
      t=$((t + 3))
    done
    if [ "$seen" = true ]; then
      break
    fi
    log "share-send: text not visible after share (attempt ${attempt}/3)"
  done
  if [ "$seen" != true ]; then
    log "share-send: text never appeared in UI after 3 shares"
    return 1
  fi

  for send_attempt in 1 2 3; do
    log "share-send: Send attempt ${send_attempt}/3"
    if ! device_tap_send; then
      log "share-send: Send node not found"
      sleep 2
      continue
    fi
    sub_t=0
    while [ "$sub_t" -lt 18 ]; do
      count=$(device_history_assistant_count)
      if ui=$(device_dump_ui_retry); then
        ctext=$(device_composer_from_ui "$ui")
      else
        ctext="$COMPOSER_PROBE_FAILED"
      fi
      if message_was_submitted "$prev" "$count" "$ctext"; then
        log "share-send: submitted prev=$prev count=$count"
        return 0
      fi
      sleep 3
      sub_t=$((sub_t + 3))
    done
    log "share-send: still in composer after Send (attempt ${send_attempt}/3)"
  done
  log "share-send: message never left the composer"
  return 1
}

_device_share_usage() {
  echo "usage: ANDROID_SERIAL=<serial> $0 [--keepawake] TEXT" >&2
  echo "   or: $0 -s SERIAL [--keepawake] TEXT" >&2
}

_device_share_main() {
  local keepawake=0 serial_arg="" text="" attached picked
  mkdir -p "$OUT"
  while [ $# -gt 0 ]; do
    case "$1" in
      -s)
        [ $# -ge 2 ] || { _device_share_usage; exit 2; }
        serial_arg="$2"
        shift 2
        ;;
      --keepawake) keepawake=1; shift ;;
      -h|--help) _device_share_usage; exit 0 ;;
      --) shift; break ;;
      -*) echo "unknown flag: $1" >&2; _device_share_usage; exit 2 ;;
      *) break ;;
    esac
  done
  text="$*"
  [ -n "${text//[[:space:]]/}" ] || { _device_share_usage; exit 2; }

  if [ -n "$serial_arg" ]; then
    ANDROID_SERIAL="$serial_arg"
  fi
  attached=$(adb devices 2>/dev/null | awk '$2=="device" {print $1}')
  if ! picked=$(device_pick_serial "${ANDROID_SERIAL:-}" "$attached"); then
    die "need ANDROID_SERIAL or -s (attached: $(printf '%s' "$attached" | tr '\n' ' '))"
  fi
  export ANDROID_SERIAL="$picked"
  BENCH_TARGET=device
  log "serial=$ANDROID_SERIAL"

  if [ "$keepawake" -eq 1 ]; then
    device_keepawake_begin
  fi
  device_share_send "$text"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  _device_share_main "$@"
fi
