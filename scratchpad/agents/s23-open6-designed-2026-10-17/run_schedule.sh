#!/bin/bash
# Run the randomised designed schedule on the S23. Refuses to start unless RUN_GO=1 is set: the owner says go only
# after unplugging the phone. Without it this prints the plan and exits 3.
#
#   RUN_GO=1 run_schedule.sh
#
# Before the first turn: records the screen-off timeout and raises it to 30 min for the run; the EXIT trap restores it.
# Stops at the first turn that does not complete (any exit code from cycle.sh), and leaves Kalsa on an empty new chat.
. "$(dirname "$0")/env.sh"
HERE=$(dirname "$0")
SCHED=$RAW/schedule.tsv
[ -f "$SCHED" ] || { echo "no schedule: run python3 -I schedule.py raw first" >&2; exit 2; }

if [ "${RUN_GO:-0}" != 1 ]; then
  echo "DRY: plan only (RUN_GO=1 to start). $(($(wc -l < "$SCHED") - 1)) turns, schedule_sha256 $(shasum -a 256 "$SCHED" | cut -c1-16)"
  exit 3
fi

LINE=$(snapshot)
[ "$(field plug "$LINE")" = none ] || { echo "PLUGGED: unplug the phone first" >&2; exit 12; }

ORIG_TIMEOUT=$(ad shell "settings get system screen_off_timeout" 2>/dev/null | tr -d '\r')
[ -n "$ORIG_TIMEOUT" ] && [ "$ORIG_TIMEOUT" != null ] || { echo "cannot read screen_off_timeout" >&2; exit 2; }
echo "screen_off_timeout before: $ORIG_TIMEOUT" > "$RAW/device-before.txt"
restore_timeout() { ad shell "settings put system screen_off_timeout $ORIG_TIMEOUT" >/dev/null 2>&1
  echo "screen_off_timeout restored: $ORIG_TIMEOUT" >> "$RAW/device-before.txt"; }
trap restore_timeout EXIT
ad shell "settings put system screen_off_timeout 1800000" >/dev/null 2>&1

N0=$(rows_now)
PREV=$(date +%s)
# Anchor the run's epoch window to the device monotonic clock the observation rows carry in `wall`, so the
# post-run filter can restrict to rows written between the first send and the last completion by time and not
# only by line count. Both are read as close together as possible.
UP_MS=$(ad shell "cat /proc/uptime" 2>/dev/null | awk '{printf "%d", $1 * 1000}' | tr -d '\r')
printf '{"start": %s, "rows_before_run": %s, "pin": "%s", "schedule_sha256": "%s", "uptime_ms_at_start": %s}\n' \
  "$PREV" "$N0" "$PIN" "$(shasum -a 256 "$SCHED" | cut -d' ' -f1)" "${UP_MS:-0}" > "$RAW/run-manifest.json"

STATUS=finished
# One cold start before the first turn. Unplugging this S23 can leave the Hexagon session wedged
# (fastrpc_mmap: "Connection reset by peer", domain 3), and a wedged session fails every generation with
# "Context is busy" and writes no row. A force-stop plus relaunch takes a fresh DSP session; it writes nothing
# into app data. Verified on this device at 10:43: the turn right after it produced a normal row.
ad shell "am force-stop $APP" >/dev/null 2>&1; sleep 5
ad shell "monkey -p $APP -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1; sleep 12
echo "app cold start for a fresh DSP session at $(date +%s)" > "$RAW/runner-coldstart.txt"

while IFS=$'\t' read -r TURN KIND GAP REP; do
  [ "$TURN" = turn ] && continue
  # WHY < /dev/null: the loop reads the schedule on stdin, and cycle.sh's adb children inherit that fd and eat the
  # remaining turns. Without this the run stops after turn 1 and still reports "finished" (seen on 2026-10-17).
  "$HERE/cycle.sh" "$TURN" "$KIND" "$GAP" "$PREV" < /dev/null; rc=$?
  if [ "$rc" != 0 ]; then STATUS="stopped at turn $TURN rc=$rc"; break; fi
  PREV=$(cat "$RAW/last_done.txt")
done < "$SCHED"

"$HERE/newchat.sh" >/dev/null 2>&1 || echo "final new chat failed: check the phone" >&2
echo "run $STATUS at $(date +%s)" | tee "$RAW/run-status.txt"
exit 0
