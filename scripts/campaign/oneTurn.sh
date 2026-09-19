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
      if ! campaign_thermal_cooldown; then
        if [ -n "${CAMPAIGN_THERMAL_HARD_ABORT_REASON:-}" ]; then
          campaign_record_recovery "thermal-hard-abort: $CAMPAIGN_THERMAL_HARD_ABORT_REASON"
          die "thermal hard abort turn $CAMPAIGN_TURN_I: $CAMPAIGN_THERMAL_HARD_ABORT_REASON"
        fi
        die "thermal cooldown failed turn $CAMPAIGN_TURN_I"
      fi
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
  local charging rec charging_rc=0
  charging=$(campaign_charging_now) || charging_rc=$?
  if [ "$charging_rc" -ne 0 ]; then
    charging=true
    log "turn $CAMPAIGN_TURN_I charging state unreadable — recording timing invalid"
  fi
  rec="$OUT/.turn.json"
  campaign_collect_file "$slice" "$OUT/.messages.json" "$charging" "$rec"
  campaign_score_record "$rec"
  campaign_store_turn "$rec"
  log "turn $CAMPAIGN_TURN_I collected charging=$charging"
}

# Total completion signals the app has emitted since this run started reading
# logcat. Counted on the CONTINUOUS capture, which no recovery path re-cuts.
campaign_telemetry_total() {
  local file="${CAMPAIGN_LOGCAT_FILE:-}"
  [ -n "$file" ] && [ -f "$file" ] || { printf '%s\n' 0; return 0; }
  LC_ALL=C grep -cF "KALSA_TELEMETRY " "$file" 2>/dev/null || printf '%s\n' 0
}

# Run-level gate (defect 2, 2026-09-16): the completion signal is emitted once
# per finished turn. When it stops arriving the run can only repeat the same
# 30-45 min wait, and the 2026-09-16 T20C run burned 96 minutes force-stopping
# healthy engines before a human killed it. Turn 1 is tolerated (a cold launch
# can lose its marker); from turn 2 on, a signal that has genuinely stopped
# arriving stops the run.
# Called by the T20C runner only: supervisor.sh drives a different campaign on
# a different phone and must not inherit this policy.
#
# MEASURED ON THE RUN LOG, NOT THE PER-TURN SLICE (2026-09-17). The slice is
# re-cut by recovery paths, and `already-landed-skip-send` returns without
# campaign_finish_turn, so the file left on disk can start AFTER the very marker
# it is asked to find. That is how the 2026-09-17 run aborted at turn 3: the app
# logged KALSA_TELEMETRY at 00:22:11 and the slice it was judged on began at
# 00:22:20. The app was not dead, it had throttled to 2.19 tok/s from 10.69 and
# emitted the next marker 63 s after the harness gave up.
#
# The drop branch is a guard, not a live path, and the first draft of this
# comment got its reason WRONG: a logcat restart does NOT truncate —
# campaign_logcat_start reopens the same file with `>>` (logcat.sh). The only
# truncation is `: > "$CAMPAIGN_LOGCAT_FILE"` in campaign_logcat_clear_arm,
# which runs at arm start, before turn 1. So today the count cannot fall.
# The guard stays because the asymmetry is brutal: four lines here against a
# false abort that costs a whole run (96 minutes on 2026-09-16), and a count
# read as "stuck" after a truncation is exactly the false positive this
# function was rewritten to remove.
campaign_completion_signal_lost() {
  local i="${1:?}" slice="${2:?}" seen before after wait_ms wait_s after_seen max_ms waited_ms=0
  seen=$(campaign_telemetry_total)
  case "$seen" in ''|*[!0-9]*) seen=0 ;; esac

  if [ "$seen" -lt "${CAMPAIGN_TELEMETRY_SEEN:-0}" ]; then
    log "turn $i: completion-signal count dropped ${CAMPAIGN_TELEMETRY_SEEN:-0} -> $seen (logcat restarted) — re-baselining, not an abort"
    CAMPAIGN_TELEMETRY_SEEN="$seen"
    return 1
  fi
  if [ "$seen" -gt "${CAMPAIGN_TELEMETRY_SEEN:-0}" ] || campaign_slice_has_telemetry "$slice"; then
    CAMPAIGN_TELEMETRY_SEEN="$seen"
    return 1
  fi

  [ "$i" -ge 2 ] || { CAMPAIGN_TELEMETRY_SEEN="$seen"; return 1; }
  wait_ms="${CAMPAIGN_COMPLETION_PROGRESS_WAIT_MS:-30000}"
  case "$wait_ms" in ''|*[!0-9]*|0) wait_ms=30000 ;; esac
  max_ms="${CAMPAIGN_COMPLETION_PROGRESS_MAX_MS:-${CAMPAIGN_TURN_TIMEOUT_MS:-2700000}}"
  case "$max_ms" in
    ''|*[!0-9]*|0)
      max_ms="${CAMPAIGN_TURN_TIMEOUT_MS:-2700000}"
      case "$max_ms" in ''|*[!0-9]*|0) max_ms=2700000 ;; esac
      ;;
  esac
  [ "$max_ms" -ge "$wait_ms" ] || max_ms="$wait_ms"
  wait_s=$(python3 -c "print(max(0.001, int('$wait_ms') / 1000))")
  campaign_snapshot_messages "$OUT/.messages.json"
  before=$(campaign_progress_fingerprint "$(campaign_assistant_count)" "$OUT/.messages.json" "$slice")
  while [ "$waited_ms" -lt "$max_ms" ]; do
    sleep "$wait_s"
    waited_ms=$((waited_ms + wait_ms))
    campaign_logcat_ensure
    campaign_snapshot_messages "$OUT/.messages.json"
    after=$(campaign_progress_fingerprint "$(campaign_assistant_count)" "$OUT/.messages.json" "$slice")
    after_seen=$(campaign_telemetry_total)
    case "$after_seen" in ''|*[!0-9]*) after_seen="$seen" ;; esac
    if [ "$after_seen" -gt "$seen" ] || campaign_slice_has_telemetry "$slice"; then
      CAMPAIGN_TELEMETRY_SEEN="$after_seen"
      return 1
    fi
    if [ "$before" != "$after" ]; then
      log "turn $i: completion counter stayed at $seen for ${waited_ms}ms; progress fingerprint changed '$before' -> '$after' — continuing the bounded wait"
      before="$after"
      continue
    fi
    log "ABORT after turn $i: completion counter stayed at $seen for ${waited_ms}ms; progress fingerprint remained '$after' — stopping the run"
    return 0
  done
  log "ABORT after turn $i: completion counter stayed at $seen for ${waited_ms}ms; progress fingerprint kept changing through the turn-timeout backstop but no completion marker arrived — stopping the run"
  return 0
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
      if ! campaign_thermal_cooldown; then
        if [ -n "${CAMPAIGN_THERMAL_HARD_ABORT_REASON:-}" ]; then
          campaign_record_recovery "thermal-hard-abort: $CAMPAIGN_THERMAL_HARD_ABORT_REASON"
          die "thermal hard abort turn $i: $CAMPAIGN_THERMAL_HARD_ABORT_REASON"
        fi
        CAMPAIGN_TURN_STATUS=""
        campaign_record_recovery "thermal-cooldown-failed"
        return 0
      fi
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
        campaign_record_recovery "send-failed"
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
    # No path in campaign_recover_status returns 2 today (it returns 0 or
    # dies); the record keeps this from ever becoming a silent skip.
    campaign_record_recovery "recovery-refused"
    return 0
  fi
  CAMPAIGN_RETRIED=1
  if campaign_user_landed "$OUT/.messages.json" "$user"; then
    if campaign_assistant_advanced "$prev"; then
      log "turn $i user+assistant already landed — skip retry send (no duplicate share)"
      campaign_record_recovery "already-landed-skip-send"
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
  campaign_send_turn "$user" || { log "turn $i retry send failed — skip"; campaign_record_recovery "retry-send-failed"; return 0; }
  if campaign_wait_turn "$prev" "$slice" "$offset"; then
    campaign_finish_turn "$slice"
    return 0
  fi
  campaign_abort_turn "$CAMPAIGN_TURN_STATUS"
  log "turn $i skipped after retry status=$CAMPAIGN_TURN_STATUS"
  return 0
}
