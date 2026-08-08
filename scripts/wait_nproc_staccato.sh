#!/data/data/com.termux/files/usr/bin/bash
# Wait until nproc>=6 (top-app), then resume staccato from cella2.
# No input/am calls (they hang under /moderate). Only wake-lock + poll.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export LC_ALL=C

OUT="${OUTDIR:-$HOME/experiments/results/staccato}"
mkdir -p "$OUT"
LOG="$OUT/nproc_wait.log"
: > "$LOG"
echo $$ > "$OUT/waiter.pid"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }

log "waiting for nproc>=6 (now=$(nproc) cpuset=$(cat /proc/self/cpuset 2>/dev/null || echo '?'))"
termux-wake-lock >/dev/null 2>&1 || true
# non-blocking notification (ignore failures)
termux-notification --id staccato --title "STACCATO nproc" --content "Sblocca schermo e tieni Termux in foreground (nproc>=6)" >/dev/null 2>&1 || true

t0=$(date +%s)
last_min=-1
while [ "$(nproc)" -lt 6 ]; do
  termux-wake-lock >/dev/null 2>&1 || true
  now=$(date +%s)
  elapsed=$((now - t0))
  if [ "$elapsed" -ge 1800 ]; then
    log "TIMEOUT nproc=$(nproc) after ${elapsed}s"
    echo "NPROC_TIMEOUT" > "$OUT/STOP_REASON.txt"
    exit 93
  fi
  min=$((elapsed / 60))
  if [ "$min" -ne "$last_min" ]; then
    log "still nproc=$(nproc) cpuset=$(cat /proc/self/cpuset 2>/dev/null || echo '?') waited ${elapsed}s batt=$(termux-battery-status 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get(\"percentage\"),d.get(\"plugged\"))' 2>/dev/null || echo '?')"
    last_min=$min
  fi
  sleep 10
done

log "READY nproc=$(nproc) cpuset=$(cat /proc/self/cpuset 2>/dev/null || echo '?') — launch --from-cella2"
bash "$HOME/experiments/scripts/run_staccato.sh" --from-cella2 >"$OUT/nohup_c2.out" 2>&1
rc=$?
log "run_staccato exit=$rc"
exit $rc
