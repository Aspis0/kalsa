#!/usr/bin/env bash
# watchdog.sh — global deadline enforcement, independent of the stages.
# Responsibility: kill the job when the deadline passes, whatever the stages
# are doing. The orchestrator's own trap then terminates the pod.
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
    # TERM the whole process group of the job, then KELL after 60s stragglers
    pkill -TERM -P "$JOB_PID" 2>/dev/null
    kill -TERM "$JOB_PID" 2>/dev/null
    sleep 60
    pkill -KILL -P "$JOB_PID" 2>/dev/null
    kill -KILL "$JOB_PID" 2>/dev/null
    echo "watchdog: job tree killed; run_all trap will terminate the pod" >> "$LOG"
    exit 0
  fi
  sleep "$POLL"
done
