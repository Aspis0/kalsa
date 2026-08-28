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
  adb shell am start -n "$CAMPAIGN_ACTIVITY" </dev/null >/dev/null 2>&1
  sleep 5
}

campaign_wait_ready() {
  local t=0 ui
  while [ "$t" -lt "$CAMPAIGN_READY_TIMEOUT" ]; do
    if ui=$(device_dump_ui_retry </dev/null); then
      if device_ui_has_any "$ui" "${_SHARE_READY_LABELS[@]}"; then
        log "ready after ${t}s"
        sleep 8
        return 0
      fi
    fi
    sleep 5
    t=$((t + 5))
  done
  log "never reported Pronto/Ready after ${CAMPAIGN_READY_TIMEOUT}s"
  return 1
}

# New conversation: force-stop → wipe → relaunch → Pronto.
campaign_new_conversation() {
  campaign_force_stop
  campaign_wipe_chat
  campaign_launch
  campaign_wait_ready || die "new conversation: app never reached Pronto/Ready"
}

# Same conversation recovery (KV restore). Expect seconds, not the 1.8s KEXP figure.
# Does NOT wipe chat. Caller must have pulled RKStorage already if it wanted a snapshot.
campaign_restore_same_conv() {
  campaign_force_stop
  COMPACTION_VAL="${COMPACTION_VAL:?}" MEMORY_VAL="${MEMORY_VAL:?}" TOOLHELP_VAL="${TOOLHELP_VAL:?}" \
    campaign_write_flags
  campaign_launch
  campaign_wait_ready || die "restore: app never reached Pronto/Ready"
}
