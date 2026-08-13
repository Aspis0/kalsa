#!/data/data/com.termux/files/usr/bin/bash
# One N1/N2 cell + MemFree sampler. ABORT after 12 consecutive samples <300 MiB (60s).
# Usage: run_cell.sh <logdir> <name> -- <bmoe-cli args...>
set -u
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
LOGDIR="$1"; shift
NAME="$1"; shift
if [ "${1:-}" = "--" ]; then shift; fi
export LD_LIBRARY_PATH="${HOME}/gdn_k2/k4split/bin:/vendor/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$LOGDIR"
CSV="$LOGDIR/memfree_${NAME}.csv"
echo "iso,memfree_kib,memavail_kib" > "$CSV"
awk '/MemFree:|MemAvailable:|MemTotal:|Cached:/{print}' /proc/meminfo > "$LOGDIR/mem_${NAME}_pre.txt"
termux-battery-status 2>/dev/null > "$LOGDIR/batt_${NAME}_pre.json" || true
(
  bad=0
  while true; do
    mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
    ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
    echo "$(date -Iseconds),$mf,$ma" >> "$CSV"
    if [ "$mf" -lt 307200 ]; then
      bad=$((bad + 1))
      echo "LOW MemFree=${mf} KiB consec=${bad}" >> "$CSV"
      if [ "$bad" -ge 12 ]; then
        echo "ABORT MemFree=${mf} KiB < 300 MiB sustained (12x5s=60s)" | tee -a "$CSV"
        pkill -f "$HOME/gdn_k2/k4split/bin/bmoe-cli" 2>/dev/null || true
      fi
    else
      bad=0
    fi
    sleep 5
  done
) &
SPID=$!
t0=$(date +%s)
set +e
"$@" > "$LOGDIR/${NAME}.out" 2> "$LOGDIR/${NAME}.err"
rc=$?
t1=$(date +%s)
kill "$SPID" 2>/dev/null || true
wait "$SPID" 2>/dev/null || true
awk '/MemFree:|MemAvailable:|MemTotal:|Cached:/{print}' /proc/meminfo > "$LOGDIR/mem_${NAME}_post.txt"
termux-battery-status 2>/dev/null > "$LOGDIR/batt_${NAME}_post.json" || true
echo "$NAME wall_s=$((t1 - t0)) rc=$rc" | tee -a "$LOGDIR/summary.txt"
if grep -q "ABORT MemFree" "$CSV" 2>/dev/null; then
  echo "$NAME ABORTED_RAM" | tee -a "$LOGDIR/summary.txt"
  exit 99
fi
exit $rc
