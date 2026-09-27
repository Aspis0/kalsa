#!/usr/bin/env bash
# Governor engagement for a governor campaign: write the pref before the
# launch whose load gate reads it, then prove engagement from that load's
# own KALSA_GOVERNOR_PLAN line. The pref alone proves nothing — a device
# whose fit is not Fit keeps the pref set and runs CPU-only.
set -uo pipefail

GOVERNOR_PREF_KEY="kalsa.governor.enabled"

# Must run BEFORE the launch that loads the model: the load gate reads the
# pref, and only a pref-on load emits KALSA_GOVERNOR_PLAN at all. The app
# must be stopped for the SQL write (same rule as campaign_write_flags); the
# launches that follow pick the pref up.
campaign_governor_enable() {
  log "flags: force-stop $PKG before governor pref write"
  campaign_force_stop
  _campaign_sql_put "$GOVERNOR_PREF_KEY" "1" || return 1
  log "governor pref: $GOVERNOR_PREF_KEY=1 written before launch"
  return 0
}

# Wait for a parseable KALSA_GOVERNOR_PLAN payload in the logcat file and
# print it. Polls every CAMPAIGN_GOVERNOR_PLAN_POLL_S (default 3) up to the
# timeout; the plan lands when the model finishes loading.
campaign_governor_wait_plan() {
  local file="${1:?}" timeout_s="${2:-90}" poll_s plan_json waited=0
  poll_s="${CAMPAIGN_GOVERNOR_PLAN_POLL_S:-3}"
  case "$poll_s" in ''|*[!0-9]*|0) poll_s=3 ;; esac
  case "$timeout_s" in ''|*[!0-9]*) timeout_s=90 ;; esac
  while [ "$waited" -lt "$timeout_s" ]; do
    if [ -f "$file" ]; then
      plan_json=$(python3 - "$file" <<'PY'
import json, sys

needle = "KALSA_GOVERNOR_PLAN "
last = None
with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
    for line in fh:
        at = line.rfind(needle)
        if at < 0:
            continue
        brace = line.find("{", at)
        if brace < 0:
            continue
        try:
            payload = json.loads(line[brace:].strip())
        except ValueError:
            continue  # a truncated logcat line is not a plan
        if isinstance(payload, dict):
            last = payload
if last is None:
    sys.exit(1)
print(json.dumps(last, separators=(",", ":")))
PY
      ) || plan_json=""
      if [ -n "$plan_json" ]; then
        printf '%s\n' "$plan_json"
        return 0
      fi
    fi
    sleep "$poll_s"
    waited=$((waited + poll_s))
  done
  return 1
}

# Engagement = pref read back as 1 AND the load plan says gpu_fit Fit.
# The pref value is an argument (the caller reads it back from the store),
# so this function stays testable without a device.
campaign_governor_verify() {
  local plan_json="${1:-}" pref="${2:-}"
  if [ "$pref" != "1" ]; then
    log "governor verify FAILED: $GOVERNOR_PREF_KEY=${pref:-ABSENT}"
    return 1
  fi
  local fit
  fit=$(printf '%s' "$plan_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("gpu_fit"))' 2>/dev/null) || fit=""
  if [ "$fit" != "Fit" ]; then
    log "governor verify FAILED: gpu_fit=${fit:-unreadable} (pref=1 but the load plan refuses the governor)"
    return 1
  fi
  log "governor verified: $GOVERNOR_PREF_KEY=1 gpu_fit=Fit plan=$plan_json"
  return 0
}
