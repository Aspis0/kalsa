#!/usr/bin/env bash
# usage: BOARD=x campaign.sh — the four planned turns in order: NOLANE, ON, NOLANE, OFF.
# Stops at the first failed turn (a watchdog KILL at 48 C means the board stops, so no further turn runs).
set -u; . "$(dirname "$0")/env.sh"
for spec in nolane-1:NOLANE on-1:ON nolane-2:NOLANE off-1:OFF; do
  label=${spec%%:*}; kind=${spec#*:}
  bash "$LAB/arm.sh" "$label" "$kind" > "$OUT/$label-campaign.log" 2>&1; rc=$?
  echo "$label kind=$kind rc=$rc" | tee -a "$OUT/campaign.log"
  [ "$rc" = 0 ] || { echo "STOP after $label rc=$rc" | tee -a "$OUT/campaign.log"; exit "$rc"; }
done
echo "campaign done" | tee -a "$OUT/campaign.log"
