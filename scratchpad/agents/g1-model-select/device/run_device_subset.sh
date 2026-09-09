#!/usr/bin/env bash
# Run one phone x one model through a G1 case file (on-device protocol).
#
#   run_device_subset.sh <serial> <model-id> <cases-file> <out.jsonl>
#
# Per case: thermal gate -> force-stop -> (model pref via SQL if changed) ->
# NEW conversation via SQL -> launch -> wait Ready (KALSA_PREWARM done or UI
# "Ready"/"Pronto") -> deliver each user turn through the share deep link
# (device_share_send, proves submission) -> poll the RKStorage messages store
# for the reply -> record reply text + raw modelEmittedText + KALSA_TELEMETRY
# / KALSA_TOOLCALL + RSS/thermal/battery. Timeouts and send failures land in
# the row, never dropped. Keep-awake armed for the whole run; every adb call
# gets </dev/null. One experiment per phone at a time.
#
# Env knobs:
#   OUT            evidence dir (default: <out.jsonl>.d)
#   CASE_IDS       comma-separated id filter (dry runs), e.g. CASE_IDS=C01,T09
#   REPLY_TIMEOUT  per-turn reply poll cap (default 240; 600 on the Jelly)
#   READY_TIMEOUT  launch-ready cap (default 240; 480 on the Jelly)
#   THERMAL_*      ci-lib thermal constants; defaults implement the G1 rule:
#                  pause when status>=3 or battery>41.0C, resume only when
#                  status<=1 and battery<38.0C, 30s polls, 1200s cap.
#
# Sources the kalsa device harness (device-share-send.sh -> device-env.sh ->
# ci-lib.sh) for sql/sql_write, device_share_send, keep-awake and the thermal
# gate. Row assembly is delegated to g1_row.py (pure python, no adb).
set -uo pipefail

if [ $# -ne 4 ]; then
  echo "usage: run_device_subset.sh <serial> <model-id> <cases-file> <out.jsonl>" >&2
  exit 2
fi
SERIAL="$1"
MODEL_ID="$2"
CASES_FILE="$3"
OUT_JSONL="$4"

ANDROID_SERIAL="$SERIAL"
export ANDROID_SERIAL
BENCH_TARGET=device
export BENCH_TARGET

RUN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KALSA_DIR="$(cd "$RUN_DIR/../../../../../kalsa" && pwd)"
# shellcheck source=/Users/marco/Projects/kalsa/scripts/device-share-send.sh
source "$KALSA_DIR/scripts/device-share-send.sh"

OUT="${OUT:-$OUT_JSONL.d}"
mkdir -p "$OUT"
ACTIVITY="${ACTIVITY:-com.kalsa.app/.MainActivity}"
CASE_IDS="${CASE_IDS:-}"

case "$SERIAL" in
  *JELLY*)
    REPLY_TIMEOUT="${REPLY_TIMEOUT:-600}"
    READY_TIMEOUT="${READY_TIMEOUT:-600}"
    ;;
  *)
    # MiniCPM dev build: its n_predict=0 prewarm never reports timings
    # (prewarm skip eval-failed after ~2.5 min prefill on the S23) and each
    # case's first turn re-runs that prefill after the share-triggered
    # reload — it needs longer caps than LFM.
    case "$MODEL_ID" in
      dev-minicpm5-2b)
        REPLY_TIMEOUT="${REPLY_TIMEOUT:-480}"
        READY_TIMEOUT="${READY_TIMEOUT:-360}"
        ;;
      *)
        REPLY_TIMEOUT="${REPLY_TIMEOUT:-240}"
        READY_TIMEOUT="${READY_TIMEOUT:-240}"
        ;;
    esac
    ;;
esac
export REPLY_TIMEOUT READY_TIMEOUT

# G1 thermal watchdog thresholds. ci-lib defaults are overridden AFTER
# sourcing so the gate uses the protocol's numbers. Never disables protections.
THERMAL_STATUS_PAUSE="${THERMAL_STATUS_PAUSE:-3}"
THERMAL_STATUS_RESUME="${THERMAL_STATUS_RESUME:-1}"
THERMAL_BATTERY_PAUSE_DECI="${THERMAL_BATTERY_PAUSE_DECI:-410}"
THERMAL_BATTERY_RESUME_DECI="${THERMAL_BATTERY_RESUME_DECI:-380}"
THERMAL_POLL_S="${THERMAL_POLL_S:-30}"
THERMAL_WAIT_CAP_S="${THERMAL_WAIT_CAP_S:-1200}"

# ── device state snapshot: one adb shell, key=value, never fatal ─────────
device_state_snapshot() {
  local outfile="$1" tag="$2" stamp epoch
  stamp=$(date +%Y-%m-%dT%H:%M:%S)
  epoch=$(date +%s)
  {
    printf 'ts=%s epoch=%s tag=%s\n' "$stamp" "$epoch" "$tag"
    adb shell '
      p=$(pidof com.kalsa.app 2>/dev/null | awk "{print \$1}")
      if [ -z "$p" ]; then printf "pid=\n"; else
        printf "pid=%s\n" "$p"
        awk "/^VmRSS:|^VmHWM:|^VmSwap:|^RssAnon:|^RssFile:/ {print}" "/proc/$p/status" 2>/dev/null
        [ -r "/proc/$p/cpuset" ] && printf "cpuset=%s\n" "$(cat /proc/$p/cpuset 2>/dev/null | tr -d "\r\n")"
        dumpsys power 2>/dev/null | grep -m1 "mWakefulness=" | sed "s/.*mWakefulness=\([A-Za-z]*\).*/wakefulness=\1/"
      fi
    ' </dev/null 2>/dev/null | tr -d '\r'
    printf 'thermal_status=%s\n' "$(device_thermal_status)"
    printf 'battery_deci=%s\n' "$(device_battery_temp_deci)"
    printf 'battery_c=%s\n' "$(device_battery_temp_c)"
    printf 'battery_level=%s\n' "$(device_battery_level)"
  } > "$outfile"
}

# Fresh uiautomator dump: the xml is removed BEFORE the dump so a stale file
# (uiautomator dump fails often on the S23) can never be read as current UI.
dump_fresh() {
  local attempt ui
  for attempt in 1 2 3; do
    adb shell rm -f /data/local/tmp/ui.xml </dev/null >/dev/null 2>&1
    adb shell uiautomator dump /data/local/tmp/ui.xml </dev/null >/dev/null 2>&1
    ui=$(adb shell cat /data/local/tmp/ui.xml </dev/null 2>/dev/null | tr -d '\r')
    if printf '%s' "$ui" | grep -q '<hierarchy'; then
      printf '%s\n' "$ui"
      return 0
    fi
    sleep 2
  done
  return 1
}

# ── conversation plumbing ─────────────────────────────────────────────────
model_pref_value() {
  sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.model.id';" 2>/dev/null || true
}

# set_model_pref <model-id> — requires the app to be STOPPED (sql_write gate).
set_model_pref() {
  sql_write "INSERT OR REPLACE INTO catalystLocalStorage(key,value) VALUES('kalsa.model.id','$1');" \
    "kalsa.model.id" "$1"
  log "model pref: kalsa.model.id=$1 (verified by read-back)"
}

# new_conversation <case-id> — app must be STOPPED. Appends one conversation
# to the existing index, makes it active, seeds an empty message list.
# Prints the conversation id. Never deletes existing rows.
new_conversation() {
  local case_id="$1" cid index_raw new_index
  cid="conv-g1-$(printf '%s' "$case_id" | tr 'A-Z' 'a-z')-$(date +%s)"
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  new_index=$(python3 - "$index_raw" "$cid" <<'PY'
import json, sys, time
raw, cid = sys.argv[1], sys.argv[2]
try:
    state = json.loads(raw) if raw else {"activeId": "", "items": []}
except Exception:
    state = {"activeId": "", "items": []}
items = [it for it in state.get("items", []) if isinstance(it, dict) and it.get("id") != cid]
now = int(time.time() * 1000)
items.append({"id": cid, "title": "", "updatedAt": now, "preview": "",
              "searchBlob": "", "hasMessages": False})
items.sort(key=lambda it: it.get("updatedAt", 0), reverse=True)
print(json.dumps({"activeId": cid, "items": items}, ensure_ascii=False, separators=(",", ":")))
PY
)
  local esc_index
  esc_index=${new_index//\'/\'\'}
  sql_write "INSERT OR REPLACE INTO catalystLocalStorage(key,value) VALUES('$CONVERSATIONS_INDEX_KEY','$esc_index');" \
    "$CONVERSATIONS_INDEX_KEY" "$new_index"
  sql_write "INSERT OR REPLACE INTO catalystLocalStorage(key,value) VALUES('$(messages_storage_key "$cid")','[]');" \
    "$(messages_storage_key "$cid")" "[]"
  printf '%s\n' "$cid"
}

# ── ready / reply waits ───────────────────────────────────────────────────
# Ready after a cold launch = the static system/tool prefix is cached in KV:
# logcat KALSA_PREWARM {"op":"done"}. Fallback: UI model bar "Ready"/"Pronto"
# (the S23 uiautomator dumps are flaky, so the logcat marker is primary).
wait_ready() {
  local t=0 ui
  # Engine-idle markers after a cold launch:
  #   LFM:     KALSA_PREWARM {"op":"done"} (prefix cached, engine idle)
  #   MiniCPM: KALSA_PREWARM {"op":"skip","reason":"eval-failed"} — its
  #            n_predict=0 prewarm never reports timings (promptMs:0), so
  #            "done" is never logged, but the prefill DID run
  #            (tokensEvaluated=2112) and the engine is idle afterwards.
  #            Measured on the S23 2026-09-09.
  # Sharing while the engine is busy (loading or prewarming) disposes it
  # mid-job and the turn dies with the "model changed or removed" bubble.
  while [ "$t" -lt "$READY_TIMEOUT" ]; do
    if adb logcat -d </dev/null 2>/dev/null \
      | grep -qE 'KALSA_PREWARM \{"op":"done"\}|KALSA_PREWARM \{"op":"skip","reason":"eval-failed"'; then
      log "ready after ${t}s (KALSA_PREWARM idle marker)"
      return 0
    fi
    # UI "Ready"/"Pronto" on the model bar is a last resort only: it appears
    # at load end, before the idle prewarm, so sharing then still races it.
    if [ "$t" -ge $((READY_TIMEOUT * 2 / 3)) ] && ui=$(dump_fresh); then
      if device_ui_has_any "$ui" "${_SHARE_READY_LABELS[@]}"; then
        log "ready after ${t}s (UI label fallback; engine idle marker never seen)"
        return 0
      fi
    fi
    sleep 5
    t=$((t + 5))
  done
  return 1
}

# pull_messages <cid> — pull the case conversation's message list into
# $OUT/.messages.json (one json array; empty file on failure).
pull_messages() {
  local cid="$1" key
  key=$(messages_storage_key "$cid")
  sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" > "$OUT/.messages.json" 2>/dev/null \
    || : > "$OUT/.messages.json"
}

# messages_state <file> — prints "<assistant_count>|<last_assistant_text>"
# (empty text when none). Pure python on a pulled store.
messages_state() {
  python3 - "$1" <<'PY'
import json, sys
count = 0
last = ""
interrupted = None
try:
    msgs = json.load(open(sys.argv[1], encoding="utf-8"))
    if isinstance(msgs, list):
        for m in msgs:
            if not isinstance(m, dict):
                continue
            if m.get("role") == "assistant":
                count += 1
                if isinstance(m.get("text"), str) and m["text"].strip():
                    last = m["text"]
                if m.get("interrupted"):
                    interrupted = True
            elif m.get("role") == "user":
                interrupted = None
except Exception:
    pass
print("%d|%s|%s" % (count, last.replace("|", " "), "1" if interrupted else "0"))
PY
}

# wait_reply <cid> — end of turn = the persisted assistant text is STABLE
# AND the engine went quiet. Persistence is progressive while streaming; a
# tool round can freeze the text for ~10 s while the tool runs and the next
# round prefills (measured: round gap 10 s on the S23), and the final
# modelEmittedText is written only at the last persist. So: text stable
# across polls + no NEW KALSA telemetry/toolcall/save line for 20 s + the
# last telemetry is not interrupted -> the turn is complete.
# Interrupted turns (no completion) run to the cap and are recorded as
# reply_timeout with whatever persisted (never dropped).
wait_reply() {
  local cid="$1" t=0 prev_text="" stable=0 count text quiet=0 last_n=-1 n tel_last tel_n
  while [ "$t" -lt "$REPLY_TIMEOUT" ]; do
    pull_messages "$cid"
    IFS='|' read -r count text _ <<EOF
$(messages_state "$OUT/.messages.json")
EOF
    if [ -n "$text" ] && [ "$text" = "$prev_text" ] && [ "$count" -gt 0 ]; then
      stable=$((stable + 1))
    else
      stable=0
      prev_text="$text"
    fi
    n=$(adb logcat -d </dev/null 2>/dev/null | grep -acE 'KALSA_TELEMETRY|KALSA_TOOLCALL|KALSA_SESSION' || true)
    if [ "$n" -eq "$last_n" ]; then
      quiet=$((quiet + 1))
    else
      quiet=0
      last_n="$n"
    fi
    tel_n=$(adb logcat -d </dev/null 2>/dev/null | grep -ac 'KALSA_TELEMETRY' || true)
    if [ "$tel_n" -gt 0 ]; then
      tel_last=$(adb logcat -d </dev/null 2>/dev/null | grep -a 'KALSA_TELEMETRY' | tail -1 | grep -c '"interrupted":true' || true)
    else
      tel_last=1  # no completion yet — never settle on a dead turn
    fi
    if [ "$stable" -ge 2 ] && [ "$quiet" -ge 4 ] && [ "$tel_last" -eq 0 ]; then
      log "reply settled after ${t}s (stable x2, quiet 20s, telemetry clean)"
      return 0
    fi
    sleep 5
    t=$((t + 5))
  done
  log "reply: TIMEOUT after ${REPLY_TIMEOUT}s (last text: ${prev_text:0:60})"
  return 1
}

# ── case body ─────────────────────────────────────────────────────────────
run_case() {
  local case_id="$1" lang="$2" category="$3" turns_json="$4"
  local cid i n_turns turn_text status replied prev turn_row
  local ev_base row_meta out_row state
  local epoch_started epoch_ended

  log "=== case $case_id ($category/$lang) model=$MODEL_ID serial=$SERIAL ==="
  epoch_started=$(date +%s)
  ev_base="$OUT/case-$case_id"

  device_thermal_gate || return 1

  adb shell am force-stop com.kalsa.app </dev/null >/dev/null 2>&1
  sleep 3
  device_state_snapshot "$ev_base.pre" stopped

  if [ "$(model_pref_value)" != "$MODEL_ID" ]; then
    log "model change: kalsa.model.id -> $MODEL_ID"
    set_model_pref "$MODEL_ID" || return 1
  fi

  cid=$(new_conversation "$case_id") || return 1
  log "conversation: $cid"

  adb logcat -c </dev/null >/dev/null 2>&1 || true
  adb shell am start -n "$ACTIVITY" </dev/null >/dev/null 2>&1
  if ! wait_ready; then
    log "case $case_id: NOT ready after ${READY_TIMEOUT}s"
    state="ready_timeout"
  else
    state="running"
  fi
  device_state_snapshot "$ev_base.ready" ready
  adb logcat -d </dev/null 2>/dev/null \
    | grep -aE 'KALSA_NATIVE_VARIANT|llama_model_loader: loaded meta data' \
    > "$ev_base.engine.ev" 2>/dev/null || : > "$ev_base.engine.ev"

  n_turns=$(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$turns_json")
  : > "$ev_base.turns.jsonl"
  for i in $(seq 0 $((n_turns - 1))); do
    turn_text=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])[int(sys.argv[2])])' "$turns_json" "$i")
    log "  turn $((i + 1))/$n_turns: ${turn_text:0:70}"
    adb logcat -c </dev/null >/dev/null 2>&1 || true
    status="not_run"
    if [ "$state" != "running" ]; then
      log "  turn $((i + 1)): skipped (case state=$state)"
    elif device_share_send "$turn_text"; then
      if wait_reply "$cid"; then
        status="ok"
      else
        status="reply_timeout"
      fi
    else
      status="send_failed"
    fi
    pull_messages "$cid"
    adb logcat -d </dev/null 2>/dev/null \
      | grep -aE 'KALSA_TELEMETRY|KALSA_TOOLCALL|KALSA_TOOLROUND_EXHAUSTED|KALSA_PREWARM|KALSA_SESSION|KALSA_NATIVE_VARIANT|llama_model_loader: loaded meta data' \
      > "$ev_base.turn$i.ev" 2>/dev/null || : > "$ev_base.turn$i.ev"
    python3 "$RUN_DIR/g1_row.py" turn "$turn_text" "$status" "$ev_base.turn$i.ev" \
      "$OUT/.messages.json" >> "$ev_base.turns.jsonl"
  done
  device_state_snapshot "$ev_base.end" end
  epoch_ended=$(date +%s)

  # Case-level row: metadata + states + turns (+ model/phone/lang/category).
  python3 "$RUN_DIR/g1_row.py" case "$case_id" "$MODEL_ID" "$SERIAL" "$lang" "$category" \
    "$epoch_started" "$epoch_ended" "$ev_base.pre" "$ev_base.ready" "$ev_base.end" \
    "$ev_base.turns.jsonl" "$cid" "$ev_base.engine.ev" >> "$OUT_JSONL"
  log "case $case_id done (rows appended to $OUT_JSONL)"
  sleep 5
  return 0
}

# ── main ──────────────────────────────────────────────────────────────────
main() {
  local attached picked serial_arg="" line n=0 case_id lang category turns
  mkdir -p "$OUT" "$(dirname "$OUT_JSONL")"
  attached=$(adb devices 2>/dev/null | awk '$2=="device" {print $1}')
  picked=$(device_pick_serial "$ANDROID_SERIAL" "$attached") \
    || die "need a serial (attached: $(printf '%s' "$attached" | tr '\n' ' '))"
  export ANDROID_SERIAL="$picked"
  log "serial=$ANDROID_SERIAL model=$MODEL_ID out=$OUT_JSONL reply_timeout=$REPLY_TIMEOUT"

  device_keepawake_begin

  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$(printf '%s' "$line" | tr -d ' \t')" ] || continue
    case_id=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["id"])' "$line")
    if [ -n "$CASE_IDS" ]; then
      case ",$CASE_IDS," in *",$case_id,"*) ;; *) continue ;; esac
    fi
    lang=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["lang"])' "$line")
    category=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["category"])' "$line")
    turns=$(python3 -c 'import json,sys; c=json.loads(sys.argv[1]); print(json.dumps([t["content"] for t in c["turns"] if t["role"]=="user"], ensure_ascii=False))' "$line")
    n=$((n + 1))
    run_case "$case_id" "$lang" "$category" "$turns"
  done < "$CASES_FILE"

  adb shell am force-stop com.kalsa.app </dev/null >/dev/null 2>&1 || true
  log "run complete: $n cases -> $OUT_JSONL"
  sleep 5
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
