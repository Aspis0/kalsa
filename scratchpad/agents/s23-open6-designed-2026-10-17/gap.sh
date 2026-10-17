#!/bin/bash
# Idle gap before a turn: screen on, Kalsa in front, nothing sent. Samples every 30 s into raw/samples.tsv.
#
#   gap.sh <until_epoch> <label>
#
# Exit codes: 0 reached the target | 10 level under 30 | 11 still hot after 20 min | 12 plugged (pause)
#             13 keyguard up after a wake (never unlock) | 14 screen would not wake | 15 Kalsa lost focus twice
# A dozing or unfocused phone is woken first, then the guard decides on the state AFTER the wake.
# A hot phone (battery >= 42 C or thermal status >= 3) holds the gap until it cools, up to 20 min. The gap that was
# actually realised is what the turn log records, so a held gap is visible rather than hidden.
set -u
. "$(dirname "$0")/env.sh"
UNTIL=$1; LABEL=$2
hot_since=0; relaunches=0
while :; do
  now=$(date +%s)
  line=$(snapshot)
  printf '%s\t%s\t%s\n' "$now" "$LABEL" "$line" >> "$RAW/samples.tsv"
  if needs_wake "$line"; then
    if [ "$(field focus "$line")" != 1 ]; then
      relaunches=$((relaunches + 1))
      [ "$relaunches" -gt 1 ] && { echo "Kalsa lost focus twice in this gap: stop" >&2; exit 15; }
    fi
    keep_awake "$line"
    line=$(snapshot)
    printf '%s\t%s\t%s\n' "$(date +%s)" "$LABEL-after-wake" "$line" >> "$RAW/samples.tsv"
    [ "$(field wake "$line")" = Awake ] || { echo "screen would not wake: stop" >&2; exit 14; }
  fi
  g=$(guard_code "$line"); rc=$?
  if [ "$rc" = 11 ]; then
    [ "$hot_since" = 0 ] && hot_since=$now
    if [ $(( now - hot_since )) -gt "$HOT_WAIT_MAX" ]; then echo "hot for over 20 min: stop ($g)" >&2; exit 11; fi
  elif [ "$rc" != 0 ]; then
    echo "$g" >&2; exit "$rc"
  else
    hot_since=0
    [ "$now" -ge "$UNTIL" ] && { echo "gap reached: $LABEL"; exit 0; }
  fi
  # sample every 30 s; a hot hold past the target also waits 30 s, never a busy loop
  left=$(( UNTIL - now ))
  if [ "$left" -gt 0 ] && [ "$left" -lt 30 ]; then sleep "$left"; else sleep 30; fi
done
