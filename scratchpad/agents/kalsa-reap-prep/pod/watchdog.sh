#!/usr/bin/env bash
# watchdog.sh — global deadline enforcement, independent of the stages.
# Responsibility: kill the job when the deadline passes, whatever the stages
# are doing. The orchestrator's own trap then handles upload/terminate.
# Usage: watchdog.sh <DEADLINE_EPOCH> <JOB_PID> [POLL_SECONDS=20]
set -uo pipefail

DEADLINE="${1:?deadline epoch}"
JOB_PID="${2:?job pid}"
POLL="${3:-20}"
LOG="${POD_ROOT:-/workspace}/runs/watchdog.log"

echo "watchdog: pid=$$ deadline=$DEADLINE job=$JOB_PID poll=${POLL}s" >> "$LOG"
while :; do
  if ! kill -0 "$JOB_PID" 2>/dev/null; then
    echo "watchdog: job $JOB_PID gone; exiting" >> "$LOG"
    exit 0
  fi
  now=$(date +%s)
  if [ "$now" -ge "$DEADLINE" ]; then
    echo "watchdog: DEADLINE HIT at $now (>= $DEADLINE) — killing job tree" >> "$LOG"
    # TERM the job's whole process group (run_all's trap still runs), then
    # KILL after 60s stragglers; fall back to per-PID if the group is gone
    kill -TERM -- "-$JOB_PID" 2>/dev/null || pkill -TERM -P "$JOB_PID" 2>/dev/null
    kill -TERM "$JOB_PID" 2>/dev/null
    sleep 60
    kill -KILL -- "-$JOB_PID" 2>/dev/null || pkill -KILL -P "$JOB_PID" 2>/dev/null
    kill -KILL "$JOB_PID" 2>/dev/null
    echo "watchdog: job tree killed; run_all trap will upload/terminate" >> "$LOG"
    exit 0
  fi
  sleep "$POLL"
done
