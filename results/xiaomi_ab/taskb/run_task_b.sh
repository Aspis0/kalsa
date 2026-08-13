#!/system/bin/sh
# Task B — CalaQwen KEXP 35B first flagship number on Xiaomi 14.
# Campaign flags, ABBA on two byte-identical S23 prompts, primary -t 6, ref -t 4.
# NEVER measure plugged. Cold fadvise per run.
# Floor 45% at ABBA start; abort <35% mid-block (partial CSV kept).
set -u
ROOT=/data/local/tmp/gdn_750/taskb
export LD_LIBRARY_PATH="$ROOT/bin:/vendor/lib64:/system/vendor/lib64"
# Campaign pin 1ca51420 failed to link on Xiaomi: libllama-common.so.0
# needs libssl.so.3 + libcrypto.so.3 (Android OpenSSL 3, not on device).
# Documented fallback: k4 static bmoe-cli sha b8b1c732… — LABEL every run.
BIN="$ROOT/bin/bmoe-cli.k4"
MODEL="$ROOT/Qwen3.6-35B-A3B-KEXP.gguf"
FADV="$ROOT/bin/fadv"
LOG="$ROOT/logs"
P_FACT="$ROOT/prompts/p_fact.txt"
P_CREATIVE="$ROOT/prompts/p_creative.txt"
STATUS="$LOG/status.txt"
CSV="$LOG/runs.csv"
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
    echo "$(ts) ABORT plugged level=$LEVEL tempC=$TEMP_C" | tee -a "$STATUS"
    echo ABORTED_REPLUG > "$LOG/ABORT"
    exit 4
  fi
}

abort_if_start_floor() {
  abort_if_plugged
  if [ "$LEVEL" -lt 45 ]; then
    echo "$(ts) ABORT start batt=$LEVEL < 45" | tee -a "$STATUS"
    echo ABORTED_BATT_START > "$LOG/ABORT"
    exit 5
  fi
}

abort_if_mid_floor() {
  abort_if_plugged
  if [ "$LEVEL" -lt 35 ]; then
    echo "$(ts) ABORT mid-block batt=$LEVEL < 35" | tee -a "$STATUS"
    echo ABORTED_BATT_MID > "$LOG/ABORT"
    exit 6
  fi
}

parse_run() {
  # stdin = stdout of bmoe-cli; busybox-awk safe (no gawk capture arrays)
  # prints decode_tps,mib_per_tok,hit_pct,ttft_s,load_s,n_gen
  _blob=$(cat)
  tps=$(printf '%s\n' "$_blob" | sed -n 's/.*generation: .*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  ngen=$(printf '%s\n' "$_blob" | sed -n 's/.*generation: \([0-9]*\) tokens.*/\1/p' | head -1)
  mib=$(printf '%s\n' "$_blob" | sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p' | head -1)
  hit=$(printf '%s\n' "$_blob" | sed -n 's/.*moe-cache: \([0-9.]*\)% hit.*/\1/p' | head -1)
  ttft=$(printf '%s\n' "$_blob" | sed -n 's/.*TTFT \([0-9.]*\) s.*/\1/p' | head -1)
  load=$(printf '%s\n' "$_blob" | sed -n 's/.*model load \([0-9.]*\) s.*/\1/p' | head -1)
  [ -n "$tps" ] || tps=NA
  [ -n "$mib" ] || mib=NA
  [ -n "$hit" ] || hit=NA
  [ -n "$ttft" ] || ttft=NA
  [ -n "$load" ] || load=NA
  [ -n "$ngen" ] || ngen=NA
  printf '%s,%s,%s,%s,%s,%s' "$tps" "$mib" "$hit" "$ttft" "$load" "$ngen"
}

run_one() {
  tag="$1"
  prompt_id="$2"
  threads="$3"
  pfile="$4"
  abort_if_mid_floor
  if [ "$TEMP_C" -gt 42 ]; then
    echo "$(ts) COOLWAIT tempC=$TEMP_C before $tag" | tee -a "$STATUS"
    slept=0
    while [ "$slept" -lt 300 ]; do
      sleep 20
      slept=$((slept + 20))
      abort_if_mid_floor
      echo "$(ts) cool poll tempC=$TEMP_C level=$LEVEL" | tee -a "$STATUS"
      if [ "$TEMP_C" -le 38 ]; then break; fi
    done
  fi
  echo "$(ts) FADV $MODEL" | tee -a "$STATUS"
  sync
  "$FADV" "$MODEL" | tee -a "$LOG/fadv.txt"
  batt_dump "before_${tag}"
  B0=$LEVEL
  T0C=$TEMP_C
  PROMPT=$(cat "$pfile")
  echo "$(ts) START $tag -t $threads prompt=$prompt_id" | tee -a "$STATUS"
  T0=$(date +%s)
  "$BIN" -m "$MODEL" -p "$PROMPT" -n 200 \
    --n-expert-used 6 --drop-cold-experts 0.65 \
    --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
    --io-threads 4 --ubatch 512 \
    -t "$threads" -c 4096 --temp 0 --chatml --no-think \
    > "$LOG/${tag}.out" 2> "$LOG/${tag}.err"
  RC=$?
  T1=$(date +%s)
  WALL=$((T1 - T0))
  echo "$(ts) END $tag EXIT=$RC wall_s=$WALL" | tee -a "$STATUS"
  batt_dump "after_${tag}"
  METRICS=$(parse_run < "$LOG/${tag}.out")
  echo "$(ts),$tag,$prompt_id,$threads,$METRICS,$B0,$LEVEL,$T0C,$TEMP_C,$WALL,$RC,UNPLUGGED" >> "$CSV"
  echo "CSV $tag $METRICS batt=$B0->$LEVEL temp=$T0C->$TEMP_C wall=$WALL rc=$RC" | tee -a "$STATUS"
  # If cache-mb 2000 was refused, leave a marker (caller inspects .err)
  if grep -q -E 'cache-mb|failed to allocate|out of memory|OOM|cannot allocate' "$LOG/${tag}.err" "$LOG/${tag}.out" 2>/dev/null; then
    echo "$(ts) WARN possible cache/alloc issue in $tag" | tee -a "$STATUS"
  fi
  sleep 10
}

echo "$(ts) TASK_B begin BIN=$BIN (k4 static b8b1c732, NOT campaign 1ca51420; libssl.so.3 missing)" > "$STATUS"
if [ ! -x "$BIN" ]; then
  echo "$(ts) BLOCKED_B no bmoe-cli at $BIN" | tee -a "$STATUS"
  echo BLOCKED_B_NOBIN > "$LOG/ABORT"
  exit 8
fi
if [ ! -f "$MODEL" ]; then
  echo "$(ts) BLOCKED_B no model at $MODEL" | tee -a "$STATUS"
  echo BLOCKED_B_NOMODEL > "$LOG/ABORT"
  exit 9
fi

echo "ts,tag,prompt_id,threads,decode_tps,mib_per_tok,hit_pct,ttft_s,load_s,n_gen,batt_start,batt_end,temp_start,temp_end,wall_s,rc,plugged" > "$CSV"
batt_dump start_b
abort_if_start_floor
echo "$(ts) START_FLOOR_OK level=$LEVEL tempC=$TEMP_C" | tee -a "$STATUS"

# drop Task A models from page cache so 2000 MiB expert cache has a chance
if [ -x "$FADV" ]; then
  "$FADV" /data/local/tmp/gdn_750/Qwen3.5-2B-Q4_K_M.gguf 2>/dev/null || true
  "$FADV" /data/local/tmp/gdn_750/Qwen3.5-4B-Q4_K_M.gguf 2>/dev/null || true
fi

# ABBA primary -t 6: fact, creative, creative, fact
run_one "t6_fact_o1" fact 6 "$P_FACT"
run_one "t6_creative_o2" creative 6 "$P_CREATIVE"
run_one "t6_creative_o3" creative 6 "$P_CREATIVE"
run_one "t6_fact_o4" fact 6 "$P_FACT"

# one -t 4 reference per prompt (S23-comparable)
run_one "t4_fact_ref" fact 4 "$P_FACT"
run_one "t4_creative_ref" creative 4 "$P_CREATIVE"

batt_dump end_b
read_batt
echo "$(ts) TASK_B done plugged=$PLUGGED level=$LEVEL tempC=$TEMP_C" | tee -a "$STATUS"
echo "$LEVEL" > "$LOG/batt_after_b.txt"
