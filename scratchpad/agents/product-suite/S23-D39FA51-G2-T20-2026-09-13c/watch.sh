#!/usr/bin/env bash
# Silent until terminal. No progress lines.
set -uo pipefail
EVID=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-D39FA51-G2-T20-2026-09-13c
PIDFILE="$EVID/leftovers.pid"
abort_msg() {
  if [ -f "$EVID/turns-abort.txt" ]; then
    tr -d '\n' < "$EVID/turns-abort.txt"
  elif [ -f "$EVID/leftovers.exit" ]; then
    printf 'leftovers.exit=%s' "$(tr -d '\n' < "$EVID/leftovers.exit")"
  else
    printf 'dead'
  fi
}
tel_n() { ls "$EVID"/turn-*-tel.txt 2>/dev/null | wc -l | tr -d ' '; }
while true; do
  if [ -f "$EVID/oneshot.done" ]; then
    n=$(tr -d '\n' < "$EVID/turns-count.txt" 2>/dev/null || echo 0)
    t=$(tel_n)
    if [ "$n" = "20" ] && [ "$t" -ge 20 ]; then
      echo DONE
      exit 0
    fi
    echo "FAILED: oneshot.done n=${n} tel=${t} abort=$(abort_msg)"
    exit 1
  fi
  if [ -f "$EVID/leftovers.exit" ]; then
    echo "FAILED: $(abort_msg) tel=$(tel_n)"
    exit 1
  fi
  if [ -f "$PIDFILE" ]; then
    pid=$(tr -d '\n' < "$PIDFILE")
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      sleep 2
      if [ -f "$EVID/oneshot.done" ]; then
        continue
      fi
      if [ -f "$EVID/leftovers.exit" ]; then
        continue
      fi
      echo "FAILED: pid $pid died abort=$(abort_msg) tel=$(tel_n)"
      exit 1
    fi
  fi
  sleep 30
done
