#!/usr/bin/env bash
# New-conversation primitive: force-stop, wipe index+messages+compactor+summary
# +kalsa.memory.facts, relaunch, wait Pronto/Ready.
#
# sql_write DIES if the app is RUNNING — always force-stop before any wipe.
# Recovery of the SAME conversation: force-stop + relaunch WITHOUT this wipe,
# with kalsa.bench.kvtranscript=1 (see campaign_restore_same_conv).
set -uo pipefail

CAMPAIGN_READY_TIMEOUT="${CAMPAIGN_READY_TIMEOUT:-240}"
CAMPAIGN_ACTIVITY="${CAMPAIGN_ACTIVITY:-com.kalsa.app/.MainActivity}"
CAMPAIGN_LAUNCHED_PID=""

# campaign_wipe_chat — app MUST already be force-stopped.
campaign_wipe_chat() {
  local index_raw id msg_key c_key s_key
  log "conversation: wipe chat+compactor+summary+memory.facts (app stopped)"
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  while IFS= read -r id || [ -n "${id-}" ]; do
    [ -z "${id-}" ] && continue
    msg_key=$(messages_storage_key "$id")
    c_key=$(compactor_storage_key "$id")
    s_key=$(summary_storage_key "$id")
    sql_write "DELETE FROM catalystLocalStorage WHERE key='$msg_key';" "$msg_key" "__ABSENT__"
    sql_write "DELETE FROM catalystLocalStorage WHERE key='$c_key';" "$c_key" "__ABSENT__"
    sql_write "DELETE FROM catalystLocalStorage WHERE key='$s_key';" "$s_key" "__ABSENT__"
  done <<EOF
$(list_conversation_ids "$index_raw")
EOF
  sql_write "DELETE FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" "$CONVERSATIONS_INDEX_KEY" "__ABSENT__"
  sql_write "DELETE FROM catalystLocalStorage WHERE key='$LEGACY_MESSAGES_KEY';" "$LEGACY_MESSAGES_KEY" "__ABSENT__"
  sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.chat.compactor.default';" "kalsa.chat.compactor.default" "__ABSENT__"
  sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.chat.summary.default';" "kalsa.chat.summary.default" "__ABSENT__"
  sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.memory.facts';" "kalsa.memory.facts" "__ABSENT__"
}

# N2/N3 (re-audit GLM): a cell with holes must NOT be resumed — its jsonl is
# quarantined (preserved, excluded from analysis), the device chat gets wiped
# by campaign_arm_begin, and the conversation restarts from turn 1 clean.
# Called on action=invalid from the resume plan, before campaign_arm_begin.
campaign_quarantine_conv() {
  local src="$OUT/$CAMPAIGN_ARM_ID/$CAMPAIGN_CONV_ID.jsonl"
  local qdir="$OUT/quarantine"
  if [ -f "$src" ]; then
    mkdir -p "$qdir"
    local dest="$qdir/$CAMPAIGN_ARM_ID-$CAMPAIGN_CONV_ID-$(date +%Y%m%d-%H%M%S).jsonl"
    mv "$src" "$dest"
    log "quarantined $src -> $dest (holes: resume would poison chat / duplicate turns)"
  fi
  local prof="$OUT/$CAMPAIGN_ARM_ID/$CAMPAIGN_CONV_ID.profile.json"
  [ -f "$prof" ] && mv "$prof" "$qdir/" 2>/dev/null || true
  local ev="$OUT/$CAMPAIGN_ARM_ID/$CAMPAIGN_CONV_ID.eviction.json"
  [ -f "$ev" ] && mv "$ev" "$qdir/" 2>/dev/null || true
}

campaign_launch() {
  local logcat_offset launched_pid startup_timeout start_epoch elapsed remaining
  startup_timeout="${CAMPAIGN_STARTUP_MARKER_TIMEOUT_S:-240}"
  case "$startup_timeout" in
    ''|*[!0-9]*|0)
      log "launch failed: CAMPAIGN_STARTUP_MARKER_TIMEOUT_S must be a positive integer"
      return 1
      ;;
  esac
  CAMPAIGN_LAUNCHED_PID=""
  logcat_offset=$(campaign_logcat_offset)
  # The readiness gate counts a KALSA_PREWARM op=done only from THIS launch:
  # captured BEFORE am start, so nothing this launch writes lands before it.
  _CAMPAIGN_LAUNCH_LOG_OFFSET="$logcat_offset"
  start_epoch=$(date +%s)
  adb shell am start -n "$CAMPAIGN_ACTIVITY" </dev/null >/dev/null 2>&1 || return 1
  launched_pid=""
  while true; do
    launched_pid=$(campaign_pidof)
    case "$launched_pid" in
      ''|*[!0-9]*) ;;
      *) break ;;
    esac
    elapsed=$(( $(date +%s) - start_epoch ))
    [ "$elapsed" -lt "$startup_timeout" ] || {
      log "launch failed: app PID did not appear within ${startup_timeout}s"
      return 1
    }
    sleep 1
  done
  elapsed=$(( $(date +%s) - start_epoch ))
  remaining=$((startup_timeout - elapsed))
  [ "$remaining" -gt 0 ] || {
    log "launch failed: no startup-marker budget remains after PID appeared"
    return 1
  }
  campaign_logcat_require_startup_marker "$logcat_offset" "$launched_pid" "$remaining" || return 1
  CAMPAIGN_LAUNCHED_PID="$launched_pid"
  log "launch gated for PID $CAMPAIGN_LAUNCHED_PID"
}

# Check the process immediately before a share intent. A process death must
# relaunch and pass the startup-marker gate before another message is sent.
campaign_ensure_launch_pid() {
  local expected="${CAMPAIGN_LAUNCHED_PID:-}" current
  current=$(campaign_pidof_settled)
  case "$expected" in ''|*[!0-9]*) ;; *)
    case "$current" in
      ''|*[!0-9]*) ;;
      *) [ "$expected" = "$current" ] && return 0 ;;
    esac
  esac
  log "share preflight: launch PID changed or missing (expected=${expected:-none} current=${current:-none}); relaunching"
  campaign_force_stop || return 1
  campaign_launch || return 1
  campaign_wait_ready || return 1
}

# Dead-load marker (product safety net, src/engine/loadMarker.ts): key
# kalsa.load.dead.<modelId>, value "1", written before a load starts and
# cleared when the load settles — a marker that outlives its process proves
# that load never settled, and the app then refuses the model (KALSA_LOAD
# refusedBy=marker, KALSA_PREWARM op=skip reason=not_ready). The preflight
# clears it LOUDLY and records the fact; never silently.
campaign_load_dead_preflight() {
  local key="kalsa.load.dead.${MODEL_ID:?}" val
  val=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" 2>/dev/null | tr -d '[:space:]') || val=""
  if [ -z "$val" ]; then
    campaign_run_record_load_dead false || return 1
    return 0
  fi
  log "LOAD DEAD MARKER: $key=$val — the previous load never settled; clearing it so this run can load (run record: load_dead_marker_cleared=true)"
  campaign_force_stop # sql_write dies on a running app — same rule as the flags
  _campaign_sql_del "$key" || return 1
  CAMPAIGN_LOAD_DEAD_MARKER_CLEARED=1
  campaign_run_record_load_dead true
}

campaign_load_dead_marker_present() {
  local val
  val=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.load.dead.${MODEL_ID:-}';" 2>/dev/null | tr -d '[:space:]') || val=""
  [ -n "$val" ]
}

campaign_run_record_load_dead() {
  python3 - "$OUT/run-record.json" "$1" <<'PY'
import json, sys

path, cleared = sys.argv[1], sys.argv[2] == "true"
try:
    with open(path, encoding="utf-8") as fh:
        rec = json.load(fh)
except (OSError, ValueError):
    rec = {}
rec["load_dead_marker_cleared"] = cleared
with open(path, "w", encoding="utf-8") as fh:
    json.dump(rec, fh)
PY
}

campaign_model_load_died_snapshot() {
  local file="${CAMPAIGN_LOGCAT_FILE:-}" dest="$OUT/model-load-died.logcat"
  : > "$dest"
  if [ -n "$file" ] && [ -f "$file" ]; then
    tail -n 400 "$file" >> "$dest" 2>/dev/null || true
  fi
  log "model load died: last logcat lines snapshotted to $dest"
}

campaign_wait_ready() {
  local t=0 offset="${_CAMPAIGN_LAUNCH_LOG_OFFSET:-0}"
  while [ "$t" -lt "$CAMPAIGN_READY_TIMEOUT" ]; do
    if device_ready_log_seen "$offset" && device_composer_enabled; then
      log "ready after ${t}s (KALSA_PREWARM op=done since launch + composer enabled)"
      sleep 8
      return 0
    fi
    sleep 5
    t=$((t + 5))
  done
  # A load that died again is not "not ready yet": the dead-load marker is
  # back, or this run cleared one at preflight and no prewarm ever landed
  # inside the cap. Die with evidence, not with the generic timeout.
  if campaign_load_dead_marker_present || [ "${CAMPAIGN_LOAD_DEAD_MARKER_CLEARED:-0}" = 1 ]; then
    campaign_model_load_died_snapshot
    die "model load died: no KALSA_PREWARM op=done after launch within ${CAMPAIGN_READY_TIMEOUT}s"
  fi
  log "never became ready after ${CAMPAIGN_READY_TIMEOUT}s (no KALSA_PREWARM op=done since launch, or the composer is not enabled)"
  return 1
}

# New conversation: force-stop → wipe → relaunch → Pronto.
campaign_new_conversation() {
  campaign_force_stop
  campaign_wipe_chat
  campaign_launch || die "new conversation: launch startup marker proof failed"
  campaign_wait_ready || die "new conversation: app never reached Pronto/Ready"
}

# Same conversation recovery (KV restore). Expect seconds, not the 1.8s KEXP figure.
# Does NOT wipe chat. Caller must have pulled RKStorage already if it wanted a snapshot.
campaign_restore_same_conv() {
  campaign_force_stop
  COMPACTION_VAL="${COMPACTION_VAL:?}" MEMORY_VAL="${MEMORY_VAL:?}" TOOLHELP_VAL="${TOOLHELP_VAL:?}" \
    campaign_write_flags
  campaign_launch || die "restore: launch startup marker proof failed"
  campaign_wait_ready || die "restore: app never reached Pronto/Ready"
}
