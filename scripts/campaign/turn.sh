#!/usr/bin/env bash
# One campaign turn: share-send, watchdog wait, snapshot messages, collect.
set -uo pipefail

campaign_charging_now() {
  local dump
  dump=$(adb shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' || true)
  if printf '%s\n' "$dump" | grep -qE '(AC|USB|Wireless) powered:[[:space:]]*true'; then
    echo true
  else
    echo false
  fi
}

campaign_snapshot_messages() {
  local dest="${1:?}" key index_raw id
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  id=$(resolve_active_conversation_id "$index_raw" 2>/dev/null || true)
  key=$(messages_storage_key "$id")
  sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" > "$dest" 2>/dev/null || : > "$dest"
}

campaign_assistant_count() {
  device_history_assistant_count
}

# True when the assistant count has advanced beyond the count captured before
# sending this turn. Keep this baseline across recovery: a landed user with no
# advancement is an in-flight generation, not a completed turn.
campaign_assistant_advanced() {
  local prev="${1:?}" count
  case "$prev" in ''|*[!0-9]*) return 1 ;; esac
  count=$(campaign_assistant_count)
  case "$count" in ''|*[!0-9]*) return 1 ;; esac
  [ "$count" -gt "$prev" ]
}

# True if the last user message in the pulled history contains needle.
campaign_user_landed() {
  local dest="${1:?}" needle="${2:?}"
  campaign_snapshot_messages "$dest"
  python3 -c '
import json, sys
needle = sys.argv[2]
try:
    data = json.loads(open(sys.argv[1], encoding="utf-8").read() or "[]")
except Exception:
    sys.exit(1)
users = [m.get("text") or "" for m in data if isinstance(m, dict) and m.get("role") == "user"]
sys.exit(0 if users and needle[:48] in users[-1] else 1)
' "$dest" "$needle"
}

campaign_last_assistant_interrupted() {
  local dest="${1:?}"
  python3 -c '
import json,sys
data=json.loads(open(sys.argv[1],encoding="utf-8").read() or "[]")
asst=[m.get("text") or "" for m in data if isinstance(m, dict) and m.get("role")=="assistant"]
text=asst[-1] if asst else ""
sys.exit(0 if "Risposta interrotta" in text or "removed from memory" in text else 1)
' "$dest"
}

_campaign_composer_has() {
  local needle="$1" ui landed
  ui=$(device_dump_ui_retry </dev/null) || return 1
  landed=$(device_composer_from_ui "$ui")
  [ -n "$landed" ] && printf '%s' "$landed" | LC_ALL=C grep -qF "$needle"
}

# After kalsa://share, engine may dispose. Pronto can stay on-screen (stale).
# Wait for a new native init in logcat; if none in 20s, assume still resident.
campaign_wait_engine() {
  local offset="${1:?}" t=0 reinit=0 slice="$OUT/.engine.slice"
  while [ "$t" -lt 180 ]; do
    campaign_logcat_slice "$offset" "$slice"
    if LC_ALL=C grep -qF 'llama_model_loader' "$slice" \
      || LC_ALL=C grep -qF '"op":"init"' "$slice"; then
      reinit=1
    fi
    if [ "$reinit" -eq 1 ]; then
      if LC_ALL=C grep -qF 'KALSA_NATIVE_VARIANT' "$slice" \
        || LC_ALL=C grep -qF 'attach_threadpool' "$slice"; then
        log "engine back after ${t}s"
        sleep 3
        return 0
      fi
    elif [ "$t" -ge 20 ]; then
      log "engine: no dispose in 20s, tapping"
      return 0
    fi
    sleep 3
    t=$((t + 3))
  done
  log "engine wait 180s — tapping anyway"
  return 0
}

# am start of kalsa://share backgrounds the app and disposeEngine()s.
# Wait Pronto AFTER the text lands, THEN tap Invia — otherwise the send
# records an interrupted "model removed from memory" bubble and never
# emits KALSA_TELEMETRY (kvtranscript is not in this APK).
campaign_send_turn() {
  local msg="${1:?}" dest="$OUT/.messages.json"
  local needle try t interrupted_resends
  needle=$(printf '%s' "$msg" | awk '{s=$0} END {if (length(s)>48) print substr(s,1,48); else print s}')
  for try in 1 2 3; do
    local eng_off
    interrupted_resends=0
    device_collapse_shade
    eng_off=$(campaign_logcat_offset)
    device_share_intent "$msg" "${try}_$(date +%s)" || continue
    t=0
    while [ "$t" -lt 24 ]; do
      _campaign_composer_has "$needle" && break
      sleep 3
      t=$((t + 3))
    done
    log "share composer try=$try t=${t}s — wait engine"
    campaign_wait_engine "$eng_off"
    device_tap_send || { log "Invia miss try=$try"; continue; }
    t=0
    while [ "$t" -lt 45 ]; do
      if campaign_user_landed "$dest" "$msg"; then
        if python3 -c '
import json,sys
data=json.loads(open(sys.argv[1],encoding="utf-8").read() or "[]")
asst=[m.get("text") or "" for m in data if isinstance(m, dict) and m.get("role")=="assistant"]
text=asst[-1] if asst else ""
sys.exit(2 if "Risposta interrotta" in text or "removed from memory" in text else 0)
' "$dest"; then
          log "user landed try=$try"
          return 0
        fi
        if [ "$interrupted_resends" -ge 1 ]; then
          log "interrupted bubble — user landed; bounded resend exhausted"
          return 0
        fi
        interrupted_resends=$((interrupted_resends + 1))
        log "interrupted bubble — wait engine and resend attempt $interrupted_resends/1"
        campaign_wait_engine "$(campaign_logcat_offset)"
        device_tap_send || true
      fi
      sleep 3
      t=$((t + 3))
    done
    log "send try=$try did not land a live user turn"
  done
  return 1
}

# Wait until assistant count increases AND KALSA_TELEMETRY lands, or abort.
# An interrupted bubble completes the turn without requiring count/telemetry.
# Sets CAMPAIGN_TURN_STATUS=ok|interrupted|timeout|hang|pid-death|adb-drop
campaign_wait_turn() {
  local prev="${1:?}" dest="${2:?}" offset="${3:-0}"
  local timeout_ms="${CAMPAIGN_TURN_TIMEOUT_MS:-2700000}"
  local gap_ms="${CAMPAIGN_TELEMETRY_GAP_MS:-1800000}"
  local poll_ms="${CAMPAIGN_POLL_MS:-5000}"
  local start now elapsed last_progress pid state count poll_s last_health
  start=$(python3 -c 'import time; print(int(time.time()*1000))')
  last_progress="$start"
  last_health=0
  poll_s=$(python3 -c "print(max(1, int($poll_ms)/1000))")
  CAMPAIGN_TURN_STATUS="timeout"

  while true; do
    now=$(python3 -c 'import time; print(int(time.time()*1000))')
    elapsed=$((now - start))
    campaign_logcat_ensure
    campaign_logcat_slice "$offset" "$dest"

    state=$(campaign_adb_state)
    if [ "$state" != "device" ]; then
      CAMPAIGN_TURN_STATUS="adb-drop"
      return 1
    fi
    pid=$(campaign_pidof)
    case "$pid" in
      ''|*[!0-9]*)
        CAMPAIGN_TURN_STATUS="pid-death"
        return 1
        ;;
    esac

    count=$(campaign_assistant_count)
    case "$count" in ''|*[!0-9]*) count=0 ;; esac

    campaign_snapshot_messages "$OUT/.messages.json"
    if campaign_last_assistant_interrupted "$OUT/.messages.json"; then
      log "interrupted bubble — turn complete"
      CAMPAIGN_TURN_STATUS="interrupted"
      return 0
    fi

    if campaign_slice_has_telemetry "$dest"; then
      last_progress="$now"
      if [ "$count" -gt "$prev" ]; then
        CAMPAIGN_TURN_STATUS="ok"
        return 0
      fi
    fi

    if [ "$elapsed" -ge "$timeout_ms" ]; then
      CAMPAIGN_TURN_STATUS="timeout"
      return 1
    fi
    if [ $((now - last_progress)) -ge "$gap_ms" ]; then
      CAMPAIGN_TURN_STATUS="hang"
      return 1
    fi

    if [ $((now - last_health)) -ge 120000 ]; then
      last_health="$now"
      log "health $(campaign_health) elapsed=${elapsed}ms"
      if campaign_thermal_should_pause; then
        CAMPAIGN_TURN_STATUS="thermal"
        return 1
      fi
    fi
    sleep "$poll_s"
  done
}

campaign_collect_file() {
  local slice="$1" messages="$2" charging="$3" out="$4"
  local compaction="${COMPACTION_VAL:-off}" interrupted=false
  local tel_schema="$OUT/.telemetry-schema.json"
  if [ "${CAMPAIGN_TURN_STATUS:-}" = "interrupted" ]; then
    interrupted=true
  fi
  node "$CAMPAIGN_ROOT/collector.mjs" \
    --logcat "$slice" \
    --messages "$messages" \
    --charging "$charging" \
    --arm-compaction "$compaction" \
    --arm "${CAMPAIGN_ARM_ID:-}" \
    --variant "${CAMPAIGN_VARIANT_ID:-}" \
    --conv "${CAMPAIGN_CONV_ID:-}" \
    --turn "${CAMPAIGN_TURN_I:-0}" \
    --script "$OUT/.turn-script.json" \
    --telemetry "$tel_schema" \
    --interrupted "$interrupted" \
    --out "$out" \
    ${CAMPAIGN_RETRIED:+--retried} \
    || die "collector failed turn ${CAMPAIGN_TURN_I:-?}"
}
