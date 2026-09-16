#!/usr/bin/env bash
# Per-turn health predicates + abort that writes a jsonl RECOVERY record.
# The wait loop lives in turn.sh (campaign_wait_turn). Do not add a second loop.
set -uo pipefail

campaign_adb_state() {
  adb get-state </dev/null 2>/dev/null | tr -d '\r' || echo unknown
}

campaign_pidof() {
  adb shell "pidof $PKG" </dev/null 2>/dev/null | tr -d '\r' | awk '{print $1}'
}

campaign_slice_has_telemetry() {
  local slice="$1"
  [ -f "$slice" ] || return 1
  LC_ALL=C grep -qF "KALSA_TELEMETRY " "$slice"
}

# Append a RECOVERY-shaped record for the current turn and advance the
# checkpoint. Never just stdout. Split out of campaign_abort_turn (2026-09-16)
# so a SKIP path can leave a trace without force-stopping an app that is still
# holding a live generation: a turn that produced no TURN record must still be
# explainable in the jsonl (resume.mjs treats RECOVERY rows as markers, not as
# a filled turn, so the hole stays visible).
campaign_record_recovery() {
  local reason="${1:-timeout}" rec="$OUT/.recovery.json" retried=0
  [ -n "${CAMPAIGN_RETRIED:-}" ] && retried=1
  python3 -c '
import json, sys
rec = {
    "i": int(sys.argv[1]),
    "arm": sys.argv[2],
    "variant": sys.argv[3],
    "conv": sys.argv[4],
    "event": "RECOVERY",
    "reason": sys.argv[5],
    "retried": sys.argv[6] == "1",
    "scores": None,
}
json.dump(rec, open(sys.argv[7], "w"))
json.dump(rec, sys.stdout)
sys.stdout.write("\n")
' "${CAMPAIGN_TURN_I:-0}" "${CAMPAIGN_ARM_ID:-}" "${CAMPAIGN_VARIANT_ID:-}" \
  "${CAMPAIGN_CONV_ID:-}" "$reason" "$retried" "$rec"
  if [ -n "${CAMPAIGN_ARM_ID:-}" ] && [ -n "${CAMPAIGN_CONV_ID:-}" ]; then
    node "$CAMPAIGN_ROOT/datastore.mjs" --append "$OUT" "$CAMPAIGN_ARM_ID" "$CAMPAIGN_CONV_ID" "$rec"
    node "$CAMPAIGN_ROOT/datastore.mjs" --checkpoint "$OUT" "$CAMPAIGN_ARM_ID" "$CAMPAIGN_VARIANT_ID" \
      "$CAMPAIGN_CONV_ID" "${CAMPAIGN_TURN_I:-0}"
  fi
}

# Force-stop and append a recovery record. Never just stdout.
campaign_abort_turn() {
  local reason="${1:-timeout}"
  log "RECOVERY reason=$reason (force-stop $PKG)"
  campaign_force_stop
  campaign_record_recovery "$reason"
}

campaign_health() {
  local state pid thermal
  state=$(campaign_adb_state)
  pid=$(campaign_pidof)
  thermal=$(device_thermal_status)
  printf '%s %s %s\n' "$state" "${pid:-none}" "${thermal:-unknown}"
}
