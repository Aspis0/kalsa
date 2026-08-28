#!/usr/bin/env bash
# One turn: send, wait, recover/skip (do not die the supervisor), collect, score, append.
set -uo pipefail

campaign_score_record() {
  local rec="${1:?}"
  # N4 (re-audit GLM): the turn is COMPLETE at this point — dying here leaves
  # the checkpoint at i-1 and the resume re-sends the user turn (duplicate).
  # Score failure -> scores:null + WARN, never die post-completion.
  if ! node "$CAMPAIGN_ROOT/scoring.mjs" --score-turn "$rec" --config "$CONFIG" --repo "$REPO"; then
    log "WARN: scorer failed turn ${CAMPAIGN_TURN_I:-?} — keeping record with scores:null"
    python3 -c '
import json, sys
rec = json.load(open(sys.argv[1]))
rec["scores"] = None
json.dump(rec, open(sys.argv[1], "w"))
' "$rec"
  fi
}

campaign_store_turn() {
  local rec="${1:?}"
  node "$CAMPAIGN_ROOT/datastore.mjs" --stamp-eviction "$OUT" "$CAMPAIGN_ARM_ID" "$CAMPAIGN_CONV_ID" "$rec"
  node "$CAMPAIGN_ROOT/datastore.mjs" --append "$OUT" "$CAMPAIGN_ARM_ID" "$CAMPAIGN_CONV_ID" "$rec"
  node "$CAMPAIGN_ROOT/datastore.mjs" --checkpoint "$OUT" "$CAMPAIGN_ARM_ID" "$CAMPAIGN_VARIANT_ID" \
    "$CAMPAIGN_CONV_ID" "${CAMPAIGN_TURN_I:-0}"
}

# Recover enough to retry the SAME turn. die only if recovery itself fails.
campaign_recover_status() {
  local status="${1:?}"
  case "$status" in
    timeout|hang)
      # A timeout/hang is usually a lost engine (zombie: app alive but
      # activeModel null / jsReady false). Restoring the KV context alone does
      # NOT reload the model — only relaunching the app does. So mirror the
      # pid-death path: pull the DB, relaunch/reinstall, wait ready. This is
      # what breaks the infinite hang loop.
      campaign_pull_db "$OUT/db-before-restart" || die "RKStorage pull failed turn $CAMPAIGN_TURN_I"
      campaign_relaunch_or_reinstall || die "reinstall/relaunch failed turn $CAMPAIGN_TURN_I"
      campaign_wait_ready || die "ready timeout after $status turn $CAMPAIGN_TURN_I"
      return 0
      ;;
    thermal)
      campaign_thermal_cooldown || die "thermal cooldown failed turn $CAMPAIGN_TURN_I"
      campaign_restore_same_conv || die "restore after thermal failed turn $CAMPAIGN_TURN_I"
      return 0
      ;;
    adb-drop)
      campaign_ensure_device || die "device lost turn $CAMPAIGN_TURN_I"
      campaign_logcat_on_reconnect
      campaign_restore_same_conv || die "restore after adb-drop failed turn $CAMPAIGN_TURN_I"
      return 0
      ;;
    pid-death)
      campaign_pull_db "$OUT/db-before-restart" || die "RKStorage pull failed turn $CAMPAIGN_TURN_I"
      campaign_relaunch_or_reinstall || die "reinstall/relaunch failed turn $CAMPAIGN_TURN_I"
      campaign_wait_ready || die "ready timeout after pid-death turn $CAMPAIGN_TURN_I"
      return 0
      ;;
    *)
      die "unknown turn status $status"
      ;;
  esac
}

campaign_finish_turn() {
  local slice="$1"
  campaign_snapshot_messages "$OUT/.messages.json"
  local charging rec
  charging=$(campaign_charging_now)
  rec="$OUT/.turn.json"
  campaign_collect_file "$slice" "$OUT/.messages.json" "$charging" "$rec"
  campaign_score_record "$rec"
  campaign_store_turn "$rec"
  log "turn $CAMPAIGN_TURN_I collected charging=$charging"
}

# Retry once (CAMPAIGN_RETRIED=1) then skip hang/timeout. Thermal/adb/pid: recover, retry, skip if still bad.
campaign_one_turn() {
  local i="$1" user="$2" prev offset slice rec_rc=0
  CAMPAIGN_TURN_I="$i"
  CAMPAIGN_RETRIED=""
  python3 -c 'import json,sys; json.dump(json.load(open(sys.argv[1]))["turns"][int(sys.argv[2])], open(sys.argv[3],"w"))' \
    "$SCRIPT" "$((i - 1))" "$OUT/.turn-script.json"
  prev=$(campaign_assistant_count)
  case "$prev" in ''|*[!0-9]*) prev=0 ;; esac
  offset=$(campaign_logcat_offset)
  slice="$OUT/.slice.txt"
  log "turn $i send: ${user:0:80}"
  if ! campaign_send_turn "$user"; then
    if [ "${CAMPAIGN_TURN_STATUS:-}" = "thermal" ]; then
      log "turn $i send aborted by thermal — cooldown then retry"
      campaign_thermal_cooldown || return 0
      CAMPAIGN_TURN_STATUS=""
      # M5 (audit GLM): after cooldown the share may already have landed (race
      # between the thermal check and the land-check, poll 3s). Re-sharing
      # would duplicate the user turn — check landing first.
      if campaign_user_landed "$OUT/.messages.json" "$user"; then
        log "turn $i already landed before thermal retry — skip re-share"
      elif campaign_send_turn "$user"; then
        log "turn $i send ok after thermal recovery"
      else
        log "WARN: share-send failed turn $i after thermal recovery"
        return 1
      fi
    else
      log "WARN: share-send failed turn $i (user never landed in SQL)"
      adb shell input keyevent 26 </dev/null >/dev/null 2>&1 || true
      sleep 1
      adb shell input keyevent 82 </dev/null >/dev/null 2>&1 || true
      sleep 1
      if ! campaign_send_turn "$user"; then
        log "WARN: share-send retry failed turn $i — skip"
        return 0
      fi
    fi
  fi
  if campaign_wait_turn "$prev" "$slice" "$offset"; then
    campaign_finish_turn "$slice"
    return 0
  fi
  campaign_abort_turn "$CAMPAIGN_TURN_STATUS"
  rec_rc=0
  campaign_recover_status "$CAMPAIGN_TURN_STATUS" || rec_rc=$?
  if [ "$rec_rc" -eq 2 ]; then
    return 0
  fi
  CAMPAIGN_RETRIED=1
  if campaign_user_landed "$OUT/.messages.json" "$user"; then
    if campaign_assistant_advanced "$prev"; then
      log "turn $i user+assistant already landed — skip retry send (no duplicate share)"
      return 0
    fi
    log "turn $i $CAMPAIGN_TURN_STATUS — user landed but assistant did not advance; post-crash resume of same user turn (no duplicate share)"
    offset=$(campaign_logcat_offset)
    if campaign_wait_turn "$prev" "$slice" "$offset"; then
      campaign_finish_turn "$slice"
      return 0
    fi
    campaign_abort_turn "failed-missing-post-crash-resume-$CAMPAIGN_TURN_STATUS"
    log "ERROR: turn $i FAILED/missing — post-crash resume status=$CAMPAIGN_TURN_STATUS; same user was not resent"
    return 0
  fi
  log "turn $i $CAMPAIGN_TURN_STATUS — retry send (user never landed)"
  prev=$(campaign_assistant_count)
  case "$prev" in ''|*[!0-9]*) prev=0 ;; esac
  offset=$(campaign_logcat_offset)
  campaign_send_turn "$user" || { log "turn $i retry send failed — skip"; return 0; }
  if campaign_wait_turn "$prev" "$slice" "$offset"; then
    campaign_finish_turn "$slice"
    return 0
  fi
  campaign_abort_turn "$CAMPAIGN_TURN_STATUS"
  log "turn $i skipped after retry status=$CAMPAIGN_TURN_STATUS"
  return 0
}
