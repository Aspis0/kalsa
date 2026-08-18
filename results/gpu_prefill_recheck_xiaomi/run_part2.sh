#!/system/bin/sh
# Part 2: squeeze GPU prefill. One knob at a time from known-good point.
# 2B length curve first, then knobs at pp1024, then 4B.
set -u
ROOT=/data/local/tmp/gdn_750
export LD_LIBRARY_PATH="$ROOT/bin:/vendor/lib64:/system/vendor/lib64"
BIN="$ROOT/bin/llama-bench"
M2="$ROOT/Qwen3.5-2B-Q4_K_M.gguf"
M4="$ROOT/Qwen3.5-4B-Q4_K_M.gguf"
OUT="$ROOT/recheck"
CELLS="$OUT/cells"
SUM="$OUT/part2_summary.tsv"
LOG="$OUT/part2_master.log"

mkdir -p "$CELLS"
if [ ! -f "$SUM" ]; then
  echo "ts|cell|exit|avg_ts|batt_level|batt_temp10|ac|usb|wl|status" > "$SUM"
fi
echo "=== PART2 START $(date '+%Y-%m-%dT%H:%M:%S') ===" >> "$LOG"

batt_snap() {
  tag="$1"
  {
    echo "=== BATTERY ${tag} $(date '+%Y-%m-%dT%H:%M:%S') ==="
    dumpsys battery | grep -E 'AC powered|USB powered|Wireless powered|status:|level:|temperature:'
  } | tee -a "$OUT/battery.log"
}

parse_batt() {
  B_LEVEL=$(dumpsys battery | awk -F': ' '/^[ ]*level:/{print $2; exit}')
  B_TEMP=$(dumpsys battery | awk -F': ' '/^[ ]*temperature:/{print $2; exit}')
  B_AC=$(dumpsys battery | awk -F': ' '/AC powered:/{print $2; exit}')
  B_USB=$(dumpsys battery | awk -F': ' '/USB powered:/{print $2; exit}')
  B_WL=$(dumpsys battery | awk -F': ' '/Wireless powered:/{print $2; exit}')
  B_ST=$(dumpsys battery | awk -F': ' '/^[ ]*status:/{print $2; exit}')
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
  echo "$(date '+%Y-%m-%dT%H:%M:%S')|$name|$ec|$tsval|$B_LEVEL|$B_TEMP|$B_AC|$B_USB|$B_WL|$B_ST" >> "$SUM"
  sleep 2
}

# ---------- 2B pp-length curve (512/1024/2048), interleaved, r=3 ----------
for p in 512 1024 2048; do
  i=1
  while [ "$i" -le 3 ]; do
    run_cell p2_2b_cpu_ngl0_t6_pp${p}_rep${i} \
      -m "$M2" -t 6 -ngl 0 -p "$p" -n 0 -r 1
    run_cell p2_2b_gpu_ngl99_faoff_t6_pp${p}_rep${i} \
      -m "$M2" -t 6 -ngl 99 -fa off -p "$p" -n 0 -r 1
    i=$((i + 1))
  done
done

# ---------- CPU thread sweep at pp1024 (best CPU baseline) ----------
for t in 4 8; do
  run_cell p2_2b_cpu_ngl0_t${t}_pp1024_rep1 \
    -m "$M2" -t "$t" -ngl 0 -p 1024 -n 0 -r 1
  run_cell p2_2b_cpu_ngl0_t${t}_pp1024_rep2 \
    -m "$M2" -t "$t" -ngl 0 -p 1024 -n 0 -r 1
done

# ---------- FA on (expected to fail on this ICD; show the error) ----------
run_cell p2_2b_gpu_ngl99_faon_t6_pp1024_rep1 \
  -m "$M2" -t 6 -ngl 99 -fa on -p 1024 -n 0 -r 1

# ---------- ngl partial at pp1024 ----------
for ngl in 8 16 24; do
  run_cell p2_2b_gpu_ngl${ngl}_faoff_t6_pp1024_rep1 \
    -m "$M2" -t 6 -ngl "$ngl" -fa off -p 1024 -n 0 -r 1
  run_cell p2_2b_gpu_ngl${ngl}_faoff_t6_pp1024_rep2 \
    -m "$M2" -t 6 -ngl "$ngl" -fa off -p 1024 -n 0 -r 1
done

# ---------- ubatch at pp1024, full offload ----------
for ub in 128 256 1024; do
  run_cell p2_2b_gpu_ngl99_faoff_t6_ub${ub}_pp1024_rep1 \
    -m "$M2" -t 6 -ngl 99 -fa off -ub "$ub" -p 1024 -n 0 -r 1
  run_cell p2_2b_gpu_ngl99_faoff_t6_ub${ub}_pp1024_rep2 \
    -m "$M2" -t 6 -ngl 99 -fa off -ub "$ub" -p 1024 -n 0 -r 1
done

# ---------- batch size (ub stays default 512 unless b < 512) ----------
run_cell p2_2b_gpu_ngl99_faoff_t6_b512_ub512_pp1024_rep1 \
  -m "$M2" -t 6 -ngl 99 -fa off -b 512 -ub 512 -p 1024 -n 0 -r 1
run_cell p2_2b_gpu_ngl99_faoff_t6_b512_ub512_pp1024_rep2 \
  -m "$M2" -t 6 -ngl 99 -fa off -b 512 -ub 512 -p 1024 -n 0 -r 1

# ---------- GPU thread counts ----------
for t in 4 8; do
  run_cell p2_2b_gpu_ngl99_faoff_t${t}_pp1024_rep1 \
    -m "$M2" -t "$t" -ngl 99 -fa off -p 1024 -n 0 -r 1
  run_cell p2_2b_gpu_ngl99_faoff_t${t}_pp1024_rep2 \
    -m "$M2" -t "$t" -ngl 99 -fa off -p 1024 -n 0 -r 1
done

# ---------- 4B smoke + length curve if GPU cell works ----------
run_cell p2_4b_cpu_ngl0_t6_pp128_rep1 \
  -m "$M4" -t 6 -ngl 0 -p 128 -n 0 -r 1
run_cell p2_4b_gpu_ngl99_faoff_t6_pp128_rep1 \
  -m "$M4" -t 6 -ngl 99 -fa off -p 128 -n 0 -r 1

gpu4_ec=$(cat "$CELLS/p2_4b_gpu_ngl99_faoff_t6_pp128_rep1.exit" 2>/dev/null || echo 1)
if [ "$gpu4_ec" = "0" ]; then
  i=2
  while [ "$i" -le 3 ]; do
    run_cell p2_4b_cpu_ngl0_t6_pp128_rep${i} \
      -m "$M4" -t 6 -ngl 0 -p 128 -n 0 -r 1
    run_cell p2_4b_gpu_ngl99_faoff_t6_pp128_rep${i} \
      -m "$M4" -t 6 -ngl 99 -fa off -p 128 -n 0 -r 1
    i=$((i + 1))
  done
  for p in 512 1024 2048; do
    i=1
    while [ "$i" -le 3 ]; do
      run_cell p2_4b_cpu_ngl0_t6_pp${p}_rep${i} \
        -m "$M4" -t 6 -ngl 0 -p "$p" -n 0 -r 1
      run_cell p2_4b_gpu_ngl99_faoff_t6_pp${p}_rep${i} \
        -m "$M4" -t 6 -ngl 99 -fa off -p "$p" -n 0 -r 1
      i=$((i + 1))
    done
  done
  # apply the 2B-best-looking ubatch 1024 on 4B at pp1024 (if we get here)
  run_cell p2_4b_gpu_ngl99_faoff_t6_ub1024_pp1024_rep1 \
    -m "$M4" -t 6 -ngl 99 -fa off -ub 1024 -p 1024 -n 0 -r 1
  run_cell p2_4b_gpu_ngl99_faoff_t6_ub1024_pp1024_rep2 \
    -m "$M4" -t 6 -ngl 99 -fa off -ub 1024 -p 1024 -n 0 -r 1
  run_cell p2_4b_gpu_ngl99_faoff_t6_ub256_pp1024_rep1 \
    -m "$M4" -t 6 -ngl 99 -fa off -ub 256 -p 1024 -n 0 -r 1
  run_cell p2_4b_gpu_ngl99_faoff_t6_ub256_pp1024_rep2 \
    -m "$M4" -t 6 -ngl 99 -fa off -ub 256 -p 1024 -n 0 -r 1
else
  echo "=== 4B GPU SMOKE FAILED exit=$gpu4_ec — skip 4B sweep ===" | tee -a "$LOG"
  echo "=== 4B GPU ERR ===" | tee -a "$LOG"
  tail -80 "$CELLS/p2_4b_gpu_ngl99_faoff_t6_pp128_rep1.err" | tee -a "$LOG"
fi

echo "=== PART2 DONE $(date '+%Y-%m-%dT%H:%M:%S') ===" | tee -a "$LOG"
echo PART2_DONE > "$OUT/part2_done.flag"
