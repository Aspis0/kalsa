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
# Serial / thermal / wake-lock: scripts/device-env.sh (source of those).
#
# Source this file for the helpers, or run it:
#   ANDROID_SERIAL=<serial> scripts/device-share-send.sh [--keepawake] TEXT
#
# Proves the turn left the composer (message_was_submitted) before any
# reply wait. Does not wait for a reply; the caller does. Does not
# install an APK, set prefs, or type into the composer.
# No -e at source time (tests and callers source this). The CLI block sets -e.
set -uo pipefail

OUT="${OUT:-device-share-send-out}"

_DEVICE_SHARE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=device-env.sh
source "$_DEVICE_SHARE_DIR/device-env.sh"

readonly _SHARE_SEND_LABELS=("Send" "Invia")
readonly _SHARE_RELOAD_LABELS=("Tap to reload" "Tocca per ricaricare")
readonly _SHARE_READY_LABELS=("Ready" "Pronto")
readonly _SHARE_PLACEHOLDERS=("Ask a question…" "Fai una domanda…")

# Readiness is a LOG API plus an enabled composer, not a _SHARE_READY_LABELS
# match: "Ready"/"Pronto" lives only inside the model sheet when it is open
# and the main screen never shows it (S23 2026-09-27: KALSA_PREWARM op=done
# arrived at 21 s, the label gate still timed out at 240 s). The line must
# come from THIS launch: the caller captured the logcat byte offset before
# `am start` (campaign_launch stores _CAMPAIGN_LAUNCH_LOG_OFFSET), so a
# stale op=done from the previous launch sits before the offset and cannot
# satisfy the gate. The labels stay for the reload banner wait below and for
# the harnesses that source this file without a campaign logcat.
device_ready_log_seen() {
  local offset="${1:-0}" file="${CAMPAIGN_LOGCAT_FILE:-}" slice
  [ -n "$file" ] && [ -f "$file" ] || return 1
  slice=$(tail -c "+$((offset + 1))" "$file" 2>/dev/null || true)
  [ -n "$slice" ] || return 1
  # One line must carry both markers; the emitter puts op first
  # (LlamaService logPrewarm({op:"done", ...})). TWO wire forms, both seen on
  # the S23 (debuggable APK): React Native renders a multi-arg console.log
  # quoted — verbatim raw/s23-governor-long-577867c0 matcher-repro.txt:
  #   09-27 15:05:47.444 29885 29913 I ReactNativeJS: 'KALSA_PREWARM', '{"op":"done","promptMs":14265.905,"promptN":1660,"hash":"3677660334"}'
  # while a single-string template logs unquoted. Herestring, never a pipe
  # into grep -q: an early-closing grep hands the writer a SIGPIPE.
  grep -qF 'KALSA_PREWARM {"op":"done"' <<<"$slice" \
    || grep -qF "'KALSA_PREWARM', '{\"op\":\"done\"" <<<"$slice"
}

# A dead load leaves the composer disabled; the XML must show an enabled one.
device_composer_enabled() {
  local ui
  ui=$(device_dump_ui_retry </dev/null) || return 1
  # awk over the split nodes reads every line (no early-exit SIGPIPE).
  printf '%s\n' "$ui" | tr '>' '\n' | awk '
    /class="android.widget.EditText"/ { if ($0 ~ /enabled="true"/) found = 1 }
    END { exit found ? 0 : 1 }'
}

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

# Privacy: the conversation JSON is piped STRAIGHT into python on stdin and
# only the count leaves — it is never written to $OUT (the old
# .share_hist.json dump landed the user text and every modelEmittedText on
# disk, twice per attempt, and was never removed).
# `err` is deliberately outside the numeric count range so a failed or invalid
# database read cannot become evidence that a toolcap answer was absent.
device_history_assistant_count() {
  local index_raw id key messages
  if ! index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null); then
    printf '%s\n' err
    return 0
  fi
  if ! id=$(resolve_active_conversation_id "$index_raw" 2>/dev/null); then
    printf '%s\n' err
    return 0
  fi
  key=$(messages_storage_key "$id")
  if ! messages=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" 2>/dev/null); then
    printf '%s\n' err
    return 0
  fi
  printf '%s' "$messages" | python3 -c '
import json, sys
try:
    raw = sys.stdin.read()
    data = json.loads(raw) if raw else []
    if not isinstance(data, list):
        raise ValueError("conversation messages must be a list")
    print(sum(1 for m in data if isinstance(m, dict) and m.get("role") == "assistant"))
except Exception:
    print("err")
'
}

# Same privacy shape as device_history_assistant_count, extracting the LAST
# assistant text instead of the count (pt_last_assistant_text used to call
# the count only for the side effect of writing .share_hist.json, then
# re-parse it).
device_last_assistant_text() {
  local index_raw id key
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  id=$(resolve_active_conversation_id "$index_raw")
  key=$(messages_storage_key "$id")
  sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" 2>/dev/null \
    | python3 -c '
import json, sys
try:
    data = json.loads(sys.stdin.read() or "[]")
    msgs = [m for m in data if isinstance(m, dict) and m.get("role") == "assistant"]
    if not msgs:
        sys.exit(0)
    print(msgs[-1].get("text") or "")
except Exception:
    pass
'
}

# Cache-bust with a fragment: AppShell ignores a URL it already consumed.
# Quote the URI for the device shell so metacharacters never split `am`.
device_share_intent() {
  local enc nonce
  enc=$(device_share_encode "$1") || return 1
  nonce="${2:-1}"
  if declare -F campaign_ensure_launch_pid >/dev/null 2>&1; then
    campaign_ensure_launch_pid || return 1
  fi
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
  if declare -F campaign_ensure_launch_pid >/dev/null 2>&1; then
    campaign_ensure_launch_pid || return 1
  fi
  mkdir -p "$OUT"
  device_collapse_shade
  prev=$(device_history_assistant_count)
  case "$prev" in ''|*[!0-9]*) log "share-send: assistant count unreadable before send"; return 1 ;; esac
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
    # While the previous turn is still generating, the Send/Invia control is a stop
    # button and no send node exists; on a slow device (Jelly ~300-400s/turn) that
    # outlasts a short retry and the turn washes (turn 5: both Send and Invia gone).
    # The text is already shared and held in the composer, so wait for the affordance
    # to return, up to SHARE_SEND_NODE_WAIT s (default 6 preserves the old fast path).
    # SHARE_SEND_ABORT_FILE lets a caller's thermal watchdog break a long wait.
    local node_wait=0 tapped=0
    while : ; do
      if device_tap_send; then tapped=1; break; fi
      if [ -n "${SHARE_SEND_ABORT_FILE:-}" ] && [ -f "$SHARE_SEND_ABORT_FILE" ]; then
        log "share-send: abort file present during send-node wait (${node_wait}s)"
        return 1
      fi
      [ "$node_wait" -ge "${SHARE_SEND_NODE_WAIT:-6}" ] && break
      sleep 3
      node_wait=$((node_wait + 3))
    done
    if [ "$tapped" -ne 1 ]; then
      log "share-send: Send node not found after ${node_wait}s"
      # A full-timeout miss means the affordance is truly gone (crash/hang), not a
      # transient between generation and idle; another full wait only hangs longer.
      [ "$node_wait" -ge "${SHARE_SEND_NODE_WAIT:-6}" ] && break
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
