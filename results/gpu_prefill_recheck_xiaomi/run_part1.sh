#!/system/bin/sh
# Part 1: interleaved CPU/GPU pp128 re-verify on Adreno 750.
# Anti-artifact: two orderings, r=1 per invocation, 5 reps each, nothing dropped.
set -u
ROOT=/data/local/tmp/gdn_750
export LD_LIBRARY_PATH="$ROOT/bin:/vendor/lib64:/system/vendor/lib64"
BIN="$ROOT/bin/llama-bench"
MODEL="$ROOT/Qwen3.5-2B-Q4_K_M.gguf"
OUT="$ROOT/recheck"
CELLS="$OUT/cells"
SUM="$OUT/part1_summary.tsv"
LOG="$OUT/part1_master.log"

mkdir -p "$CELLS"
echo "ts	cell	exit	avg_ts	batt_level	batt_temp10	ac	usb	wl	status	skin	gpu0	cpu0" > "$SUM"
echo "=== PART1 START $(date '+%Y-%m-%dT%H:%M:%S') ===" >> "$LOG"

batt_snap() {
  tag="$1"
  {
    echo "=== BATTERY ${tag} $(date '+%Y-%m-%dT%H:%M:%S') ==="
    dumpsys battery | grep -E 'AC powered|USB powered|Wireless powered|status:|level:|temperature:'
    dumpsys thermalservice 2>/dev/null | grep -E 'mName=battery|mName=skin|mName=GPU0|mName=CPU0|mName=CPU7'
  } | tee -a "$OUT/battery.log"
}

parse_batt() {
  B_LEVEL=$(dumpsys battery | awk -F': ' '/^[ ]*level:/{print $2; exit}')
  B_TEMP=$(dumpsys battery | awk -F': ' '/^[ ]*temperature:/{print $2; exit}')
  B_AC=$(dumpsys battery | awk -F': ' '/AC powered:/{print $2; exit}')
  B_USB=$(dumpsys battery | awk -F': ' '/USB powered:/{print $2; exit}')
  B_WL=$(dumpsys battery | awk -F': ' '/Wireless powered:/{print $2; exit}')
  B_ST=$(dumpsys battery | awk -F': ' '/^[ ]*status:/{print $2; exit}')
  T_SKIN=$(dumpsys thermalservice 2>/dev/null | grep 'mName=skin' | head -1)
  T_GPU=$(dumpsys thermalservice 2>/dev/null | grep 'mName=GPU0' | head -1)
  T_CPU=$(dumpsys thermalservice 2>/dev/null | grep 'mName=CPU0' | head -1)
}

extract_ts() {
  f="$1"
  if [ ! -s "$f" ]; then
    echo "NA"
    return
  fi
  awk -F: '/"avg_ts"/{gsub(/[ ,]/,"",$2); print $2; exit}' "$f"
}

run_cell() {
  name="$1"
  shift
  echo "=== START $name $(date '+%Y-%m-%dT%H:%M:%S') ===" | tee -a "$LOG"
  echo "CMD: $BIN $*" | tee -a "$LOG"
  batt_snap "BEFORE_$name"
  parse_batt
  set +e
  "$BIN" "$@" -o json > "$CELLS/${name}.json" 2> "$CELLS/${name}.err"
  ec=$?
  set -e
  echo "$ec" > "$CELLS/${name}.exit"
  tsval=$(extract_ts "$CELLS/${name}.json")
  echo "=== END $name EXIT=$ec avg_ts=$tsval $(date '+%Y-%m-%dT%H:%M:%S') ===" | tee -a "$LOG"
  batt_snap "AFTER_$name"
  parse_batt
  echo "$(date '+%Y-%m-%dT%H:%M:%S')	$name	$ec	$tsval	$B_LEVEL	$B_TEMP	$B_AC	$B_USB	$B_WL	$B_ST	$T_SKIN	$T_GPU	$T_CPU" >> "$SUM"
  sleep 2
}

# Labeled session warmup (reported, not dropped)
run_cell p1_warmup_2b_gpu_ngl99_faoff_t6_pp128 \
  -m "$MODEL" -t 6 -ngl 99 -fa off -p 128 -n 0 -r 1

# ORDER A: CPU, GPU, CPU, GPU, ...
i=1
while [ "$i" -le 5 ]; do
  run_cell p1_ordA_2b_cpu_ngl0_t6_pp128_rep${i} \
    -m "$MODEL" -t 6 -ngl 0 -p 128 -n 0 -r 1
  run_cell p1_ordA_2b_gpu_ngl99_faoff_t6_pp128_rep${i} \
    -m "$MODEL" -t 6 -ngl 99 -fa off -p 128 -n 0 -r 1
  i=$((i + 1))
done

# short settle between orderings
sleep 10

# ORDER B: GPU, CPU, GPU, CPU, ...
i=1
while [ "$i" -le 5 ]; do
  run_cell p1_ordB_2b_gpu_ngl99_faoff_t6_pp128_rep${i} \
    -m "$MODEL" -t 6 -ngl 99 -fa off -p 128 -n 0 -r 1
  run_cell p1_ordB_2b_cpu_ngl0_t6_pp128_rep${i} \
    -m "$MODEL" -t 6 -ngl 0 -p 128 -n 0 -r 1
  i=$((i + 1))
done

# decode confirmation, 2 interleaved pairs (not the disputed claim)
run_cell p1_dec_2b_cpu_ngl0_t6_pp128_tg256_rep1 \
  -m "$MODEL" -t 6 -ngl 0 -p 128 -n 256 -r 1
run_cell p1_dec_2b_gpu_ngl99_faoff_t6_pp128_tg256_rep1 \
  -m "$MODEL" -t 6 -ngl 99 -fa off -p 128 -n 256 -r 1
run_cell p1_dec_2b_gpu_ngl99_faoff_t6_pp128_tg256_rep2 \
  -m "$MODEL" -t 6 -ngl 99 -fa off -p 128 -n 256 -r 1
run_cell p1_dec_2b_cpu_ngl0_t6_pp128_tg256_rep2 \
  -m "$MODEL" -t 6 -ngl 0 -p 128 -n 256 -r 1

echo "=== PART1 DONE $(date '+%Y-%m-%dT%H:%M:%S') ===" | tee -a "$LOG"
echo PART1_DONE > "$OUT/part1_done.flag"
