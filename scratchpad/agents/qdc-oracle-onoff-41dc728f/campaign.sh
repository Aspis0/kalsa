#!/usr/bin/env bash
# usage: BOARD=x DEADLINE=<epoch> campaign.sh part1|part2 — ordered turns. A turn is SKIPPED (logged) if it cannot start and
# finish (EST_TURN_S, cooldown included) before DEADLINE. A turn that was already started is never re-run.
set -u; . "$(dirname "$0")/env.sh"
PART=$1; LOG=$OUT/campaign.log; EST=${EST_TURN_S:-540}
: "${DEADLINE:?set DEADLINE (epoch seconds)}"
run() {  # LABEL KIND [A_LABEL]
  local label=$1; shift
  [ -f "$OUT/$label-kind.txt" ] && { echo "already started: $label (not re-run)" >> $LOG; return; }
  if [ $(( $(date +%s) + EST )) -gt "$DEADLINE" ]; then echo "SKIP $label: no time before deadline $(date -r "$DEADLINE" +%H:%M:%S)" >> $LOG; return; fi
  echo "START $label $* at $(date +%H:%M:%S) skin_now=$(skin_c)" >> $LOG
  bash "$LAB/arm.sh" "$label" "$@"; rc=$?
  echo "END $label rc=$rc at $(date +%H:%M:%S) skin_now=$(skin_c)" >> $LOG
}
case $PART in
  part1)
    run p1a1 P1A
    run p1b1 P1B p1a1
    run p1a2 P1A
    run p1b2 P1B p1a2
    run p1a3 P1A
    run p1b3 P1B p1a3
    run p1c P1C p1a1 ;;
  part2)
    run on-short-1 ON
    run off-short-1 OFF
    run on-short-2 ON
    run off-short-2 OFF
    run xon-short-1 XON ;;
  *) echo "unknown part $PART"; exit 2 ;;
esac
echo "CAMPAIGN $PART DONE at $(date +%H:%M:%S)" >> $LOG
