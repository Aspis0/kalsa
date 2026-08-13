#!/system/bin/sh
# Resume remaining Task B cells after harness death (tag-overwrite redirect).
# Remaining: t6 fact o4, t4 fact ref, t4 creative ref.
# k4 static binary. Floor mid-block 35%. Never plugged.
set -u
ROOT=/data/local/tmp/gdn_750/taskb
export LD_LIBRARY_PATH="$ROOT/bin:/vendor/lib64:/system/vendor/lib64"
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
  bd_tag="$1"
  {
    echo "=== battery ${bd_tag} $(ts) ==="
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

abort_if_mid_floor() {
  abort_if_plugged
  if [ "$LEVEL" -lt 35 ]; then
    echo "$(ts) ABORT mid-block batt=$LEVEL < 35" | tee -a "$STATUS"
    echo ABORTED_BATT_MID > "$LOG/ABORT"
    exit 6
  fi
}

parse_run() {
  _file="$1"
  if [ ! -f "$_file" ]; then
    printf 'NA,NA,NA,NA,NA,NA'
    return
  fi
  _blob=$(cat "$_file")
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
  r_tag="$1"
  r_prompt="$2"
  r_threads="$3"
  r_pfile="$4"
  abort_if_mid_floor
  if [ "$TEMP_C" -gt 42 ]; then
    echo "$(ts) COOLWAIT tempC=$TEMP_C before $r_tag" | tee -a "$STATUS"
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
  batt_dump "before_${r_tag}"
  B0=$LEVEL
  T0C=$TEMP_C
  PROMPT=$(cat "$r_pfile")
  echo "$(ts) START $r_tag -t $r_threads prompt=$r_prompt" | tee -a "$STATUS"
  T0=$(date +%s)
  "$BIN" -m "$MODEL" -p "$PROMPT" -n 200 \
    --n-expert-used 6 --drop-cold-experts 0.65 \
    --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
    --io-threads 4 --ubatch 512 \
    -t "$r_threads" -c 4096 --temp 0 --chatml --no-think \
    > "$LOG/${r_tag}.out" 2> "$LOG/${r_tag}.err"
  RC=$?
  T1=$(date +%s)
  WALL=$((T1 - T0))
  echo "$(ts) END $r_tag EXIT=$RC wall_s=$WALL" | tee -a "$STATUS"
  batt_dump "after_${r_tag}"
  METRICS=$(parse_run "$LOG/${r_tag}.out")
  echo "$(ts),$r_tag,$r_prompt,$r_threads,$METRICS,$B0,$LEVEL,$T0C,$TEMP_C,$WALL,$RC,UNPLUGGED" >> "$CSV"
  echo "CSV $r_tag $METRICS batt=$B0->$LEVEL temp=$T0C->$TEMP_C wall=$WALL rc=$RC" | tee -a "$STATUS"
  sleep 10
}

echo "$(ts) TASK_B_REST begin remaining=t6_fact_o4,t4_fact_ref,t4_creative_ref BIN=$BIN" | tee -a "$STATUS"
abort_if_mid_floor
echo "$(ts) REST_FLOOR_OK level=$LEVEL tempC=$TEMP_C" | tee -a "$STATUS"

run_one "t6_fact_o4" fact 6 "$P_FACT"
run_one "t4_fact_ref" fact 4 "$P_FACT"
run_one "t4_creative_ref" creative 4 "$P_CREATIVE"

batt_dump end_b
read_batt
echo "$(ts) TASK_B done plugged=$PLUGGED level=$LEVEL tempC=$TEMP_C" | tee -a "$STATUS"
echo "$LEVEL" > "$LOG/batt_after_b.txt"
echo REST_DONE > "$LOG/DONE"
