#!/usr/bin/env bash
# Task 1 of docs/PLAN-CHAT-ON-DISK.md, one command.
#
# The two measurements the panel's numbers depend on:
#   1. what two devices talking at once costs, per stream  (pinned iSWA model)
#   2. does a chat switch come back warm without --swa-full
#
# Both write a stripped artifact under dev/results/ (no prompt text, no
# completion text, no user content). Raw engine logs go to $WORK, which is
# outside the repo, and are never committed - the repo gitignores *.log for
# exactly this reason.
#
# Run this ONLY on a quiet machine. Both scripts refuse to start an engine
# while the 1-minute load average is above --max-load, and the concurrency run
# additionally rejects any A/B/A2 attempt whose control arm drifts from A by
# more than --bracket-tol (a decode rate measured under other load is not a
# number the panel may print). Raise --max-load only on purpose.
#
# BIN is required and passed to both measurements: which binary the panel's
# number describes is the owner's decision, so this script refuses to pick one.
# (The old default silently measured the installed release instead of the
# build the committed artifacts came from.)
#
# Usage:   BIN=/path/to/kalsa-server dev/run-task1-measurements.sh
# Env:     BIN (required)  WORK=/tmp/kalsa-task1  PY=/opt/homebrew/bin/python3  MAX_LOAD=6

set -euo pipefail

: "${BIN:?set BIN to the engine binary under test - which binary the panel's number describes is the owner's decision, so there is no default}"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

PY="${PY:-/opt/homebrew/bin/python3}"
WORK="${WORK:-/tmp/kalsa-task1}"
MAX_LOAD="${MAX_LOAD:-6}"
mkdir -p "$WORK"

echo "== task 1 measurements =="
echo "repo:     $ROOT"
echo "python:   $PY"
echo "bin:      $BIN"
echo "work:     $WORK"
echo "max load: $MAX_LOAD"
echo "load now: $(uptime | sed 's/.*load/load/')"
echo

echo "-- 1/2  concurrency cost (one engine, --parallel 2) --"
"$PY" dev/measure-concurrency.py \
  --bin "$BIN" \
  --out dev/results/concurrency-cost/results.json \
  --log "$WORK/concurrency-server.log" \
  --slots-dir "$WORK/concurrency-slots" \
  --n-predict 256 --prompt-tokens 512 \
  --attempts 5 --bracket-tol 0.03 --max-load "$MAX_LOAD"

echo
echo "-- 2/2  slot restore, --swa-full off and on, + the RAM prompt cache control --"
"$PY" dev/measure-slot-restore.py \
  --bin "$BIN" \
  --out dev/results/slot-restore-swa/results.json \
  --work "$WORK/slot-restore" \
  --sizes 600,1900 --n-predict 8 --max-load "$MAX_LOAD"

echo
echo "== artifacts =="
ls -l dev/results/concurrency-cost/results.json dev/results/slot-restore-swa/results.json
echo
echo "Next: write dev/results/concurrency-cost/summary.md and"
echo "dev/results/slot-restore-swa/summary.md from these two JSON files,"
echo "then commit the scripts, the artifacts and the summaries together."
