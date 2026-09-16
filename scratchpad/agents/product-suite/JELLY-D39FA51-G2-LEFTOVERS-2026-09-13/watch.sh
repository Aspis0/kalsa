#!/usr/bin/env bash
# Wake only on terminal states. Diagnostics go to watch.log, tokens to stdout.
set -u
EVID=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/JELLY-D39FA51-G2-LEFTOVERS-2026-09-13
WLOG="$EVID/watch.log"
alive() { pgrep -f "$EVID/leftovers.sh" >/dev/null; }
echo "watch start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$WLOG"
missing=0
while sleep 30; do
  if [ -f "$EVID/leftovers.exit" ]; then
    c=$(tr -d '\n' < "$EVID/leftovers.exit")
    abort=$(cat "$EVID/turns-abort.txt" 2>/dev/null || echo none)
    n=$(cat "$EVID/turns-count.txt" 2>/dev/null || echo 0)
    echo "exit=$c n=$n abort=$abort" >>"$WLOG"
    if [ "$c" = "0" ] && [ -f "$EVID/oneshot.done" ]; then
      echo DONE
      exit 0
    fi
    echo "FAILED: leftovers exit=$c n=$n abort=$abort"
    exit 1
  fi
  if grep -q THERMAL_ABORT "$EVID/run.log" 2>/dev/null; then
    echo "FAILED: THERMAL_ABORT"
    exit 1
  fi
  if alive; then
    missing=0
  else
    missing=$((missing + 1))
    echo "missing=$missing utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$WLOG"
    if [ "$missing" -ge 2 ]; then
      echo "FAILED: leftovers.sh died without leftovers.exit"
      exit 1
    fi
  fi
done
