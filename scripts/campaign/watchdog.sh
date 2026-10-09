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

# A single empty pidof is not a death: one failed wireless `adb shell` returns
# nothing, and the S23 G2 run of 2026-10-09 force-stopped a decoding app on it
# (every ApplicationExitInfo was FORCE STOP from adb, none a crash). Dead means
# three empty reads one second apart; the first live pid wins.
campaign_pidof_settled() {
  local p previous="" empty_reads=0
  while :; do
    p=$(campaign_pidof) || true
    if [ -z "$p" ]; then
      previous=""
      empty_reads=$((empty_reads + 1))
      if [ "$empty_reads" -ge 3 ]; then
        printf '\n'
        return 0
      fi
    else
      empty_reads=0
      case "$p" in
        *[!0-9]*)
          log "pidof returned non-numeric output: '$p'"
          printf '\n'
          return 0
          ;;
        *)
          if [ "$p" = "$previous" ]; then
            printf '%s\n' "$p"
            return 0
          fi
          previous="$p"
          ;;
      esac
    fi
    sleep 1
  done
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
