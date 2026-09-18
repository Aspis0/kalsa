#!/usr/bin/env bash
# One campaign turn: share-send, watchdog wait, snapshot messages, collect.
set -uo pipefail

campaign_charging_now() {
  local dump serial
  serial="${ANDROID_SERIAL:-${CAMPAIGN_SERIAL:-}}"
  if [ -z "$serial" ] || ! dump=$(adb -s "$serial" shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r'); then
    printf '%s\n' false
    return 2
  fi
  if ! printf '%s\n' "$dump" | grep -qE '(AC|USB|Wireless) powered:[[:space:]]*(true|false)'; then
    printf '%s\n' false
    return 2
  fi
  if printf '%s\n' "$dump" | grep -qE '(AC|USB|Wireless) powered:[[:space:]]*true'; then
    echo true
  else
    echo false
  fi
}

# NAMED LIMITATION (kv-land privacy package, deliberately NOT fixed there):
# this function still writes the WHOLE conversation — user text and every
# modelEmittedText — to $dest (in practice $OUT/.messages.json), a dotfile
# in the kept output directory. c63a952 converted the device-share-send.sh
# family to stdin-only; this campaign family was left leaking on purpose:
# four consumers read the file back (campaign_collect_file at oneTurn.sh,
# campaign_user_landed twice, campaign_progress_fingerprint and
# campaign_last_assistant_interrupted here) and
# campaign/selftest_fakedevice.sh models the file's shape, so converting
# means refactoring a device campaign harness that was about to go to a
# phone. Convert it as its own change, with the selftest updated.
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

# Did the ENGINE start a turn after this offset?
#
# campaign_user_landed proves the send by reading the user message back out of
# the device DB, and the app does not necessarily persist it while it is busy
# generating. On a throttled phone that proof can be minutes late, so the 45 s
# wait below expired and the turn was re-shared — discarding work the engine had
# already begun. 2026-09-17, S23 turn 3: the app logged
# `KALSA_THINKING {"turnId":"4"}` 0.3 s after the send, the harness re-sent 92 s
# later, the engine restarted the same question as turn 5, and the run died
# waiting for a marker that arrived 63 s after it gave up.
#
# A new KALSA_THINKING after our own offset IS the send landing: the app cannot
# start a turn it did not receive. Cheaper and earlier than the DB round trip.
#
# Could a LATE marker from the previous send confirm this one? Measured over the
# seven T20C runs in out/: worst send->marker latency 28.4 s
# (t20c-fixprotocol-20260915), tightest send->send gap 26.2 s
# (t20c-rerun2-20260914). The two never met in one run, and the offset is
# re-taken before every share, but the margin is thin — if that latency ever
# passes 45 s the retry below can adopt the previous turn's marker.
campaign_engine_turn_started() {
  local offset="${1:?}" probe
  probe="$OUT/.engine-start-probe.txt"
  campaign_logcat_slice "$offset" "$probe" || return 1
  LC_ALL=C grep -qF "KALSA_THINKING " "$probe"
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
  # M7 (audit GLM): needle must be cut by CHARACTERS, not bytes — awk substr
  # on multibyte (it/fr accents) splits a codepoint, so the composer check and
  # campaign_user_landed would never match and the turn would re-share
  # (duplicate user turn). Python cuts by chars.
  needle=$(python3 -c 'import sys; s = sys.argv[1]; print(s[:48])' "$msg")
  for try in 1 2 3; do
    local eng_off
    interrupted_resends=0
    device_collapse_shade
    eng_off=$(campaign_logcat_offset)
    device_share_intent "$msg" "${try}_$(date +%s)" || continue
    t=0
    while [ "$t" -lt 24 ]; do
      _campaign_composer_has "$needle" && break
      if campaign_thermal_should_pause; then
        CAMPAIGN_TURN_STATUS="thermal"
        return 1
      fi
      sleep 3
      t=$((t + 3))
    done
    log "share composer try=$try t=${t}s — wait engine"
    campaign_wait_engine "$eng_off"
    device_tap_send || { log "Invia miss try=$try"; continue; }
    t=0
    while [ "$t" -lt 45 ]; do
      # ORDER MATTERS: ask the engine BEFORE the thermostat. A throttled phone
      # is exactly the one that starts a turn and cannot persist it in time, and
      # the thermal branch below returns 1, which sends the caller down
      # oneTurn.sh's cooldown path — campaign_thermal_cooldown force-stops the
      # app (recovery.sh), destroying a turn already in flight. Reading the
      # marker first costs one logcat slice and loses no safety: on `return 0`
      # the caller enters campaign_wait_turn, whose health poll starts with
      # last_health=0 and therefore evaluates campaign_thermal_should_pause on
      # its FIRST iteration, ~5 s later, with the full recovery machinery.
      if campaign_engine_turn_started "$eng_off"; then
        log "engine started the turn try=$try t=${t}s — send landed (DB copy may lag)"
        return 0
      fi
      if campaign_thermal_should_pause; then
        CAMPAIGN_TURN_STATUS="thermal"
        return 1
      fi
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

# Evidence that the turn is still producing something, from state the wait loop
# already collects: assistant bubble count, length of the last assistant text
# (a reply streaming on screen), and native engine lines in this turn's slice.
# Grounded on the 2026-09-16 run: PID 19312/8213 logged zero native lines for
# 30+ min after their last loadPrompt (dead), PID 26488 logged 934 "Grammar
# still awaiting trigger" lines in 17 min (alive but slow).
campaign_progress_fingerprint() {
  local count="${1:?}" messages="${2:?}" slice="${3:?}" asst_len native
  asst_len=$(python3 -c '
import json, sys
try:
    data = json.loads(open(sys.argv[1], encoding="utf-8").read() or "[]")
except Exception:
    data = []
asst = [m.get("text") or "" for m in data if isinstance(m, dict) and m.get("role") == "assistant"]
print(len(asst[-1]) if asst else 0)
' "$messages" 2>/dev/null) || asst_len=0
  case "$asst_len" in ''|*[!0-9]*) asst_len=0 ;; esac
  native=$(LC_ALL=C grep -cE 'loadPrompt|KALSA_NATIVE |llama_' "$slice" 2>/dev/null) || native=0
  case "$native" in ''|*[!0-9]*) native=0 ;; esac
  printf '%s:%s:%s\n' "$count" "$asst_len" "$native"
}

# Wait until assistant count increases AND KALSA_TELEMETRY lands, or abort.
# An interrupted bubble completes the turn without requiring count/telemetry.
# Liveness (the hang watchdog) is NOT the completion marker: see
# campaign_progress_fingerprint above.
# Sets CAMPAIGN_TURN_STATUS=ok|interrupted|timeout|hang|pid-death|adb-drop
campaign_wait_turn() {
  local prev="${1:?}" dest="${2:?}" offset="${3:-0}"
  local timeout_ms="${CAMPAIGN_TURN_TIMEOUT_MS:-2700000}"
  local gap_ms="${CAMPAIGN_TELEMETRY_GAP_MS:-1800000}"
  local poll_ms="${CAMPAIGN_POLL_MS:-5000}"
  local start now elapsed last_progress pid state count poll_s last_health fingerprint last_fingerprint
  start=$(python3 -c 'import time; print(int(time.time()*1000))')
  last_progress="$start"
  last_health=0
  last_fingerprint=""
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
    # Liveness advances on ANY evidence of progress. Reading it from the
    # completion marker is the 2026-09-16 defect: the app emitted
    # KALSA_TELEMETRY once in 32,683 logcat lines, and every later turn could
    # only end as "hang" while the engine was still producing text.
    fingerprint=$(campaign_progress_fingerprint "$count" "$OUT/.messages.json" "$dest")
    if [ "$fingerprint" != "$last_fingerprint" ]; then
      last_progress="$now"
      last_fingerprint="$fingerprint"
    fi
    # H2 (audit GLM): the interrupted-bubble check must run AFTER count>prev —
    # at turn N+1 following an interrupted turn N, the stale bubble of N is the
    # last assistant message and would "complete" N+1 at the first poll (~5s)
    # with N's text. Only a NEW bubble (count advanced) means a fresh turn.
    if campaign_slice_has_telemetry "$dest"; then
      last_progress="$now"
      if [ "$count" -gt "$prev" ]; then
        if campaign_last_assistant_interrupted "$OUT/.messages.json"; then
          log "interrupted bubble — turn complete"
          CAMPAIGN_TURN_STATUS="interrupted"
          return 0
        fi
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
  if node "$CAMPAIGN_ROOT/collector.mjs" \
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
    ${CAMPAIGN_RETRIED:+--retried}; then
    return 0
  fi
  # M3 (audit GLM): the turn is COMPLETE at this point — dying here would
  # leave the checkpoint at i-1 and the resume would RE-SEND the same user
  # turn (duplicate). Write a partial record so the checkpoint advances.
  log "WARN: collector failed turn ${CAMPAIGN_TURN_I:-?} — writing partial record (checkpoint must advance, no re-send)"
  local partial="$OUT/.partial-turn.json"
  python3 -c '
import json, sys
messages = json.loads(open(sys.argv[1], encoding="utf-8").read() or "[]")
users = [m.get("text") or "" for m in messages if isinstance(m, dict) and m.get("role") == "user"]
asst = [m.get("text") or "" for m in messages if isinstance(m, dict) and m.get("role") == "assistant"]
json.dump({
  "i": int(sys.argv[2] or 0),
  "arm": sys.argv[3],
  "variant": sys.argv[4],
  "conv": sys.argv[5],
  "event": "COLLECT_FAIL",
  "user": users[-1] if users else "",
  "assistant": asst[-1] if asst else "",
  "telemetry": {},
  "charging": sys.argv[6] == "true",
  "timingValid": False,
  "retried": False,
  "recovery": "collect-failed",
  "scores": None,
}, open(sys.argv[7], "w"))
' "$messages" "${CAMPAIGN_TURN_I:-0}" "${CAMPAIGN_ARM_ID:-}" "${CAMPAIGN_VARIANT_ID:-}" "${CAMPAIGN_CONV_ID:-}" "$charging" "$partial"
  node "$CAMPAIGN_ROOT/datastore.mjs" --append "$OUT" "${CAMPAIGN_ARM_ID:-}" "${CAMPAIGN_CONV_ID:-}" "$partial"
  return 0
}
