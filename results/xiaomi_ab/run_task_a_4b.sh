#!/system/bin/sh
# Task A 4B add-on: pp512 + pp2048, CPU and GPU. Only if batt>=85 and UNPLUGGED.
set -u
ROOT=/data/local/tmp/gdn_750
export LD_LIBRARY_PATH="$ROOT/bin:/vendor/lib64:/system/vendor/lib64"
BIN="$ROOT/bin"
LOG="$ROOT/logs/task_a"
MODEL="$ROOT/Qwen3.5-4B-Q4_K_M.gguf"
FADV="$ROOT/bin/fadv"
T=6
STATUS="$LOG/status_4b.txt"
mkdir -p "$LOG"

ts() { date '+%Y-%m-%dT%H:%M:%S'; }

batt_dump() {
  tag="$1"
  {
    echo "=== battery ${tag} $(ts) ==="
    dumpsys battery | grep -E 'AC powered|USB powered|Wireless powered|Dock powered|^  level:|^  temperature:|^  status:'
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

abort_if_plugged() {
  read_batt
  if [ "$PLUGGED" -ne 0 ]; then
    echo "$(ts) ABORT plugged=$PLUGGED level=$LEVEL tempC=$TEMP_C" | tee -a "$STATUS"
    echo ABORTED_REPLUG > "$LOG/ABORT_4B"
    exit 4
  fi
}

echo "$(ts) TASK_A_4B begin t=$T" > "$STATUS"
batt_dump start_4b
abort_if_plugged
if [ "$LEVEL" -lt 85 ]; then
  echo "$(ts) SKIP_4B batt=$LEVEL < 85" | tee -a "$STATUS"
  echo SKIP_BATT > "$LOG/SKIP_4B"
  exit 6
fi
if [ ! -f "$MODEL" ]; then
  echo "$(ts) SKIP_4B model missing $MODEL" | tee -a "$STATUS"
  echo SKIP_MODEL > "$LOG/SKIP_4B"
  exit 7
fi

for P in 512 2048; do
  for CELL in cpu gpu; do
    abort_if_plugged
    if [ "$TEMP_C" -gt 42 ]; then
      echo "$(ts) COOLWAIT tempC=$TEMP_C before 4b_${CELL}_pp${P}" | tee -a "$STATUS"
      slept=0
      while [ "$slept" -lt 180 ]; do
        sleep 15
        slept=$((slept + 15))
        read_batt
        abort_if_plugged
        if [ "$TEMP_C" -le 38 ]; then break; fi
      done
    fi
    echo "$(ts) FADV 4b $MODEL" | tee -a "$STATUS"
    sync
    "$FADV" "$MODEL" | tee -a "$LOG/fadv.txt"
    TAG="4b_${CELL}_pp${P}"
    batt_dump "before_${TAG}"
    echo "$(ts) START llama-bench $TAG -t $T -p $P -n 0 -r 2" | tee -a "$STATUS"
    if [ "$CELL" = "gpu" ]; then
      "$BIN/llama-bench" -m "$MODEL" -t "$T" -ngl 99 -fa off -p "$P" -n 0 -r 2 -o json > "$LOG/bench_${TAG}.json" 2> "$LOG/bench_${TAG}.err"
    else
      "$BIN/llama-bench" -m "$MODEL" -t "$T" -ngl 0 -p "$P" -n 0 -r 2 -o json > "$LOG/bench_${TAG}.json" 2> "$LOG/bench_${TAG}.err"
    fi
    echo "$(ts) END llama-bench $TAG EXIT=$?" | tee -a "$STATUS"
    batt_dump "after_${TAG}"
    sleep 8
  done
done

batt_dump end_4b
read_batt
echo "$(ts) TASK_A_4B done plugged=$PLUGGED level=$LEVEL tempC=$TEMP_C" | tee -a "$STATUS"
echo "$LEVEL" > "$LOG/batt_after_4b.txt"
