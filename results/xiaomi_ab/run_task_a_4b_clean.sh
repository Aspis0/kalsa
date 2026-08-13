#!/system/bin/sh
# Task A 4B CLEAN redo — phone free, prior 4B cells discarded as contaminated.
# pp512/pp1024/pp2048 CPU vs GPU + TTFT ABBA. NEVER measure plugged.
# Logs go to logs/task_a_4b_clean so 2B and contaminated 4B stay intact.
set -u
ROOT=/data/local/tmp/gdn_750
export LD_LIBRARY_PATH="$ROOT/bin:/vendor/lib64:/system/vendor/lib64"
BIN="$ROOT/bin"
LOG="$ROOT/logs/task_a_4b_clean"
MODEL="$ROOT/Qwen3.5-4B-Q4_K_M.gguf"
PROMPT="$ROOT/prompts/ttft_2b_1000.txt"
FADV="$ROOT/bin/fadv"
T=6
STATUS="$LOG/status.txt"
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
    echo "$(ts) ABORT plugged=$PLUGGED ac=$AC usb=$USB wl=$WL level=$LEVEL tempC=$TEMP_C" | tee -a "$STATUS"
    echo ABORTED_REPLUG > "$LOG/ABORT"
    exit 4
  fi
}

cold_fadv() {
  model="$1"
  echo "$(ts) FADV begin $model" | tee -a "$STATUS"
  sync
  "$FADV" "$model" | tee -a "$LOG/fadv.txt"
  rc=$?
  echo "$(ts) FADV rc=$rc" | tee -a "$STATUS"
  return 0
}

echo "$(ts) TASK_A_4B_CLEAN begin t=$T" > "$STATUS"
batt_dump start_4b_clean
abort_if_plugged
if [ "$LEVEL" -lt 50 ]; then
  echo "$(ts) ABORT batt=$LEVEL < 50" | tee -a "$STATUS"
  echo ABORTED_BATT > "$LOG/ABORT"
  exit 5
fi
if [ ! -f "$MODEL" ]; then
  echo "$(ts) ABORT model missing $MODEL" | tee -a "$STATUS"
  echo ABORTED_MODEL > "$LOG/ABORT"
  exit 7
fi
if [ ! -f "$PROMPT" ]; then
  echo "$(ts) ABORT prompt missing $PROMPT" | tee -a "$STATUS"
  echo ABORTED_PROMPT > "$LOG/ABORT"
  exit 8
fi

# llama-bench prefill curve: for each pp size, CPU then GPU
for P in 512 1024 2048; do
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
        echo "$(ts) cool poll tempC=$TEMP_C level=$LEVEL" | tee -a "$STATUS"
        if [ "$TEMP_C" -le 38 ]; then break; fi
      done
    fi
    cold_fadv "$MODEL"
    if [ "$CELL" = "cpu" ]; then
      TAG="4b_cpu_pp${P}"
    else
      TAG="4b_gpu_pp${P}"
    fi
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

# real TTFT, ABBA: CPU GPU GPU CPU — same prompt file as 2B
i=0
for CELL in cpu gpu gpu cpu; do
  i=$((i + 1))
  abort_if_plugged
  if [ "$TEMP_C" -gt 42 ]; then
    echo "$(ts) COOLWAIT tempC=$TEMP_C before ttft_4b_${CELL}_$i" | tee -a "$STATUS"
    slept=0
    while [ "$slept" -lt 180 ]; do
      sleep 15
      slept=$((slept + 15))
      read_batt
      abort_if_plugged
      if [ "$TEMP_C" -le 38 ]; then break; fi
    done
  fi
  cold_fadv "$MODEL"
  TAG="ttft_4b_${CELL}_rep${i}"
  batt_dump "before_${TAG}"
  echo "$(ts) START llama-cli $TAG -t $T cell=$CELL -n 16 --temp 0 --no-warmup --perf" | tee -a "$STATUS"
  T0=$(date +%s)
  if [ "$CELL" = "gpu" ]; then
    "$BIN/llama-cli" -m "$MODEL" -f "$PROMPT" -n 16 --temp 0 -t "$T" -c 2048 -ngl 99 -fa off -no-cnv -st --perf --no-warmup --no-display-prompt > "$LOG/${TAG}.out" 2> "$LOG/${TAG}.err"
  else
    "$BIN/llama-cli" -m "$MODEL" -f "$PROMPT" -n 16 --temp 0 -t "$T" -c 2048 -ngl 0 -no-cnv -st --perf --no-warmup --no-display-prompt > "$LOG/${TAG}.out" 2> "$LOG/${TAG}.err"
  fi
  RC=$?
  T1=$(date +%s)
  WALL=$((T1 - T0))
  echo "$(ts) END llama-cli $TAG EXIT=$RC wall_s=$WALL" | tee -a "$STATUS"
  batt_dump "after_${TAG}"
  sleep 8
done

batt_dump end_4b_clean
read_batt
echo "$(ts) TASK_A_4B_CLEAN done plugged=$PLUGGED level=$LEVEL tempC=$TEMP_C" | tee -a "$STATUS"
echo "$LEVEL" > "$LOG/batt_after_4b_clean.txt"
