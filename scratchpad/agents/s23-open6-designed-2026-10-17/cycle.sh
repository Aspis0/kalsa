#!/bin/bash
# One designed turn: new chat -> idle gap (sampled, guarded) -> typed fixed prompt -> send -> wait for the completion
# row -> post-sample. Appends one JSON line to raw/turns.jsonl and writes the completion epoch to raw/last_done.txt.
#
#   cycle.sh <turn_no> <short|long> <gap_min> <prev_done_epoch>
#
# Exit: 0 done | 4 keyguard/screen | 5 typing failed | 6 send failed | 7 new chat failed | 8 no row in 30 min
#       | 10 level | 11 hot 20 min | 12 plugged (pause) | 13 keyguard | 15 focus lost twice
# The gap is measured from prev_done (when the previous row last changed) to the send tap, so a gap of 0 still
# includes the new-chat step. Nothing is force-stopped mid-turn: a hot or low reading during a turn only ends the
# run after that turn finishes (the schedule runner checks the gate before the next one).
. "$(dirname "$0")/env.sh"
HERE=$(dirname "$0")
N=$1; KIND=$2; GAP=$3; PREV=$4
LOG=$RAW/turns.jsonl

"$HERE/newchat.sh" || { rc=$?; echo "turn $N: new chat failed (rc $rc)" >&2; exit 7; }

UNTIL=$(( PREV + GAP * 60 ))
"$HERE/gap.sh" "$UNTIL" "gap-t$N"; rc=$?
[ "$rc" = 0 ] || { echo "turn $N: gap stopped (rc $rc)" >&2; exit "$rc"; }

ROWS_BEFORE=$(rows_now)
"$HERE/turn.sh" "$KIND" > "$RAW/.turn-$N.log" 2>&1; rc=$?
if [ "$rc" != 0 ]; then
  cat "$RAW/.turn-$N.log" >&2
  case $rc in 3|4) exit 4;; 5) exit 5;; *) exit 6;; esac
fi
SEND=$(sed -n 's/^SENT: [a-z]* \([0-9]*\)$/\1/p' "$RAW/.turn-$N.log")
[ -n "$SEND" ] || { echo "turn $N: no send epoch in turn log" >&2; exit 6; }

# wait for the completion row. Polled every 10 s; done when the count is above the start and has not moved for 30 s.
LAST_CHANGE=$SEND; PREV_COUNT=$ROWS_BEFORE; POLLS=0; FLAGS=""
while :; do
  sleep 10
  NOW=$(date +%s); CNT=$(rows_now)
  POLLS=$((POLLS + 1))
  if [ $(( POLLS % 3 )) = 0 ]; then
    LINE=$(snapshot); printf '%s\t%s\t%s\n' "$NOW" "turn-t$N" "$LINE" >> "$RAW/samples.tsv"
    g=$(guard_code "$LINE"); grc=$?
    [ "$grc" = 0 ] || FLAGS="$FLAGS;$g"
  fi
  if [ "$CNT" != "$PREV_COUNT" ]; then PREV_COUNT=$CNT; LAST_CHANGE=$NOW; fi
  if [ "$CNT" -gt "$ROWS_BEFORE" ] && [ $(( NOW - LAST_CHANGE )) -ge 30 ]; then COMPLETED=1; break; fi
  if [ $(( NOW - SEND )) -gt 1800 ]; then COMPLETED=0; break; fi
done
ROWS_AFTER=$CNT
printf '%s\t%s\t%s\n' "$(date +%s)" "post-t$N" "$(snapshot)" >> "$RAW/samples.tsv"

python3 -I - "$N" "$KIND" "$GAP" "$PREV" "$SEND" "$ROWS_BEFORE" "$ROWS_AFTER" "$COMPLETED" "$LAST_CHANGE" "$FLAGS" >> "$LOG" <<'PY'
import datetime, json, sys
n, kind, gap, prev, send, before, after, done, last, flags = sys.argv[1:11]
print(json.dumps({
    "turn": int(n), "length": kind, "gap_min_target": int(gap),
    "prev_done": int(prev), "send": int(send), "gap_actual_s": int(send) - int(prev),
    "rows_before": int(before), "rows_after": int(after), "new_rows": int(after) - int(before),
    "completed": int(done), "done_epoch": int(last), "in_turn_flags": flags.strip(";"),
    "at": datetime.datetime.fromtimestamp(int(send)).isoformat(timespec="seconds"),
}))
PY
echo "$LAST_CHANGE" > "$RAW/last_done.txt"
[ "$COMPLETED" = 1 ] || { echo "turn $N: NO ROW after 30 min" >&2; exit 8; }
echo "OK turn $N: +$((ROWS_AFTER - ROWS_BEFORE)) row(s), gap_actual $((SEND - PREV)) s"
exit 0
