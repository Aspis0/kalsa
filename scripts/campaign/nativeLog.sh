#!/usr/bin/env bash
# Keep INFO lines available to the campaign liveness watchdog.
set -uo pipefail

CAMPAIGN_NATIVELOG_CAPTURED=0
CAMPAIGN_NATIVELOG_PREVIOUS=""

campaign_native_log_wait_reply() {
  local previous="${1:?}" timeout="${2:-120}" elapsed=0 count
  while [ "$elapsed" -lt "$timeout" ]; do
    count=$(campaign_assistant_count)
    case "$count" in
      ''|*[!0-9]*) ;;
      *)
        if [ "$count" -gt "$previous" ]; then
          campaign_snapshot_messages "$OUT/.messages.json"
          python3 - "$OUT/.messages.json" <<'PY'
import json, sys
try:
    messages = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(1)
answers = [m.get("text") or "" for m in messages
           if isinstance(m, dict) and m.get("role") == "assistant"]
if answers:
    print(answers[-1])
    sys.exit(0)
sys.exit(1)
PY
          return $?
        fi
        ;;
    esac
    sleep 3
    elapsed=$((elapsed + 3))
  done
  return 1
}

campaign_native_log_require_on() {
  local status="${1:-}"
  if [[ "$status" == *"nativelog=on"* ]]; then
    return 0
  fi
  log "ERROR: native log mirror is not on (bench:show: ${status:-EMPTY})"
  return 1
}

campaign_native_log_setup() {
  local previous_count reply show_count show
  CAMPAIGN_NATIVELOG_PREVIOUS=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.nativelog';" 2>/dev/null) \
    || die "native log setup: could not read previous preference"
  CAMPAIGN_NATIVELOG_CAPTURED=1

  previous_count=$(campaign_assistant_count)
  case "$previous_count" in ''|*[!0-9]*) die "native log setup: assistant count unreadable" ;; esac
  device_share_send "bench:nativelog on" || die "native log setup: could not deliver bench:nativelog on"
  reply=$(campaign_native_log_wait_reply "$previous_count") \
    || die "native log setup: no assistant reply to bench:nativelog on"
  [[ "$reply" == *"nativelog=on"* ]] \
    || die "native log setup: command was not acknowledged as on (${reply:-EMPTY})"

  campaign_force_stop
  campaign_launch || die "native log setup: restart after nativelog command failed"
  campaign_wait_ready || die "native log setup: app did not become ready after restart"

  show_count=$(campaign_assistant_count)
  case "$show_count" in ''|*[!0-9]*) die "native log setup: assistant count unreadable before bench:show" ;; esac
  device_share_send "bench:show" || die "native log setup: could not deliver bench:show"
  show=$(campaign_native_log_wait_reply "$show_count") \
    || die "native log setup: no assistant reply to bench:show"
  campaign_native_log_require_on "$show" || die "native log setup refused: INFO liveness evidence is disabled"
  log "native log mirror verified on via bench:show"
}

campaign_native_log_restore() {
  [ "$CAMPAIGN_NATIVELOG_CAPTURED" -eq 1 ] || return 0
  log "native log teardown: restoring previous preference"
  campaign_force_stop
  if [ -z "$CAMPAIGN_NATIVELOG_PREVIOUS" ]; then
    _campaign_sql_del "kalsa.bench.nativelog" || {
      log "ERROR: native log teardown could not restore ABSENT preference"
      return 1
    }
  else
    _campaign_sql_put "kalsa.bench.nativelog" "$CAMPAIGN_NATIVELOG_PREVIOUS" || {
      log "ERROR: native log teardown could not restore previous preference"
      return 1
    }
  fi
  campaign_launch || {
    log "ERROR: native log teardown could not relaunch app with restored preference"
    return 1
  }
  CAMPAIGN_NATIVELOG_CAPTURED=0
  return 0
}
