#!/system/bin/sh
# Phase 3 speed: NEVER bench plugged. Wait unplug+batt>=60+temp<=35C, else SPEED_PENDING_UNPLUG.
set -u
ROOT=/data/local/tmp/gdn_750
export LD_LIBRARY_PATH="$ROOT/bin:/vendor/lib64:/system/vendor/lib64"
BIN="$ROOT/bin"
LOG="$ROOT/logs"
MODEL="$ROOT/Qwen3.5-2B-Q4_K_M.gguf"
T=6
STATUS="$LOG/phase3_status.txt"
WAITLOG="$LOG/phase3_wait.txt"
MAX_WAIT_SEC=2700   # 45 min

ts() { date '+%Y-%m-%dT%H:%M:%S'; }

batt_dump() {
  tag="$1"
  {
    echo "=== battery ${tag} $(ts) ==="
    dumpsys battery
    max=0
    for f in /sys/class/thermal/thermal_zone*/temp; do
      v=$(cat "$f" 2>/dev/null) || continue
      case "$v" in
        ''|*[!0-9-]*) continue ;;
      esac
      if [ "$v" -gt "$max" ] 2>/dev/null; then max=$v; fi
    done
    echo "max_therm_mC=$max"
  } | tee -a "$LOG/battery_notes.txt"
}

read_batt() {
  # sets: LEVEL PLUGGED TEMP_C
  LEVEL=$(dumpsys battery | awk -F': ' '/^[ ]*level:/{print $2; exit}')
  AC=$(dumpsys battery | awk -F': ' '/AC powered:/{print $2; exit}')
  USB=$(dumpsys battery | awk -F': ' '/USB powered:/{print $2; exit}')
  WL=$(dumpsys battery | awk -F': ' '/Wireless powered:/{print $2; exit}')
  DOCK=$(dumpsys battery | awk -F': ' '/Dock powered:/{print $2; exit}')
  TEMP10=$(dumpsys battery | awk -F': ' '/^[ ]*temperature:/{print $2; exit}')
  TEMP_C=$((TEMP10 / 10))
  PLUGGED=1
  if [ "$AC" = "false" ] && [ "$USB" = "false" ] && [ "$WL" = "false" ] && [ "$DOCK" = "false" ]; then
    PLUGGED=0
  fi
}

echo "$(ts) PHASE3 wait begin t=$T max_wait=${MAX_WAIT_SEC}s" > "$STATUS"
echo "$(ts) PHASE3 wait begin" > "$WAITLOG"
batt_dump wait_start

elapsed=0
while [ "$elapsed" -lt "$MAX_WAIT_SEC" ]; do
  read_batt
  echo "$(ts) poll elapsed=${elapsed}s plugged=$PLUGGED level=$LEVEL tempC=$TEMP_C ac=$AC usb=$USB wl=$WL" | tee -a "$WAITLOG"
  if [ "$PLUGGED" -eq 0 ] && [ "$LEVEL" -ge 60 ] && [ "$TEMP_C" -le 35 ]; then
    echo "$(ts) READY unplugged level=$LEVEL tempC=$TEMP_C" | tee -a "$WAITLOG" "$STATUS"
    break
  fi
  sleep 60
  elapsed=$((elapsed + 60))
done

read_batt
if [ "$PLUGGED" -ne 0 ] || [ "$LEVEL" -lt 60 ] || [ "$TEMP_C" -gt 35 ]; then
  echo "$(ts) SPEED_PENDING_UNPLUG plugged=$PLUGGED level=$LEVEL tempC=$TEMP_C elapsed=${elapsed}s" | tee -a "$WAITLOG" "$STATUS"
  echo SPEED_PENDING_UNPLUG > "$LOG/SPEED_PENDING_UNPLUG"
  exit 3
fi

# --- CPU cell ---
batt_dump before_bench_cpu
echo "$(ts) START bench_cpu -t $T -ngl 0 -p 128 -n 256 -r 2" | tee -a "$STATUS"
"$BIN/llama-bench" -m "$MODEL" -t "$T" -ngl 0 -p 128 -n 256 -r 2 -o json > "$LOG/bench_cpu.json" 2> "$LOG/bench_cpu.err"
echo "$(ts) END bench_cpu EXIT=$?" | tee -a "$STATUS"
batt_dump after_bench_cpu

# cool a bit between cells
sleep 15
read_batt
if [ "$PLUGGED" -ne 0 ]; then
  echo "$(ts) ABORT plugged during gap after CPU" | tee -a "$STATUS"
  echo SPEED_ABORTED_REPLUG > "$LOG/SPEED_PENDING_UNPLUG"
  exit 4
fi

# --- GPU cell ---
batt_dump before_bench_gpu
echo "$(ts) START bench_gpu -t $T -ngl 99 -fa off -p 128 -n 256 -r 2" | tee -a "$STATUS"
"$BIN/llama-bench" -m "$MODEL" -t "$T" -ngl 99 -fa off -p 128 -n 256 -r 2 -o json > "$LOG/bench_gpu_faoff.json" 2> "$LOG/bench_gpu_faoff.err"
echo "$(ts) END bench_gpu EXIT=$?" | tee -a "$STATUS"
batt_dump after_bench_gpu

echo "$(ts) PHASE3 done" | tee -a "$STATUS"
