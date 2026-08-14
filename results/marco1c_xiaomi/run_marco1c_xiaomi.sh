#!/system/bin/sh
# Marco1c Xiaomi 14 + optional CalaQwen perf-mode follow-up.
# Campaign pin 1ca51420. Reuses taskb ROOT / bin / prompts / fadv.
# mksh: no `local`. Prefix every helper var. Do not clobber caller `tag`.
# PHASE: decode | sustained | perf_cq | perf_m1c | t4
set -u
ROOT=/data/local/tmp/gdn_750/taskb
export LD_LIBRARY_PATH="$ROOT/bin:/vendor/lib64:/system/vendor/lib64"
BIN="$ROOT/bin/bmoe-cli"
M_MARCO="$ROOT/Marco-Mini-Instruct-KEXP.gguf"
M_CALA="$ROOT/Qwen3.6-35B-A3B-KEXP.gguf"
FADV="$ROOT/bin/fadv"
LOG="$ROOT/logs/marco1c_xiaomi"
P_FACT="$ROOT/prompts/p_fact.txt"
P_CREATIVE="$ROOT/prompts/p_creative.txt"
STATUS="$LOG/status.txt"
CSV="$LOG/runs.csv"
MEMAVAIL_ABORT_KIB=307200
MEMAVAIL_STREAK_NEED=12
SAMPLE_S=5
PHASE="${1:-}"

mkdir -p "$LOG/curves" "$LOG/majflt"

ts() { date '+%Y-%m-%dT%H:%M:%S'; }

log() { echo "$(ts) $*" | tee -a "$STATUS"; }

read_meminfo_field() {
  awk -v k="$1:" '$1==k {print $2; exit}' /proc/meminfo
}

batt_dump() {
  _bd_tag="$1"
  {
    echo "=== battery ${_bd_tag} $(ts) ==="
    dumpsys battery | grep -E 'AC powered|USB powered|Wireless powered|Dock powered|^  level:|^  temperature:|^  status:'
    _bd_max=0
    for _bd_f in /sys/class/thermal/thermal_zone*/temp; do
      _bd_v=$(cat "$_bd_f" 2>/dev/null) || continue
      case "$_bd_v" in
        ''|*[!0-9-]*) continue ;;
      esac
      if [ "$_bd_v" -gt "$_bd_max" ] 2>/dev/null; then _bd_max=$_bd_v; fi
    done
    echo "max_therm_mC=$_bd_max"
    echo "MemAvailable_kB=$(read_meminfo_field MemAvailable)"
    echo "MemFree_kB=$(read_meminfo_field MemFree)"
    echo "SwapFree_kB=$(read_meminfo_field SwapFree)"
    echo "AnonPages_kB=$(read_meminfo_field AnonPages)"
    echo "speed_mode=$(settings get system speed_mode)"
    echo "screen_game_mode=$(settings get system screen_game_mode)"
    echo "gb_boosting=$(settings get secure gb_boosting)"
    echo "POWER_SAVE_MODE_OPEN=$(settings get system POWER_SAVE_MODE_OPEN)"
    echo "POWER_BALANCED_MODE_OPEN=$(settings get system POWER_BALANCED_MODE_OPEN)"
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

abort_if_bad() {
  read_batt
  if [ "$PLUGGED" -ne 0 ]; then
    log "ABORT plugged level=$LEVEL tempC=$TEMP_C"
    echo ABORTED_REPLUG > "$LOG/ABORT"
    exit 4
  fi
  if [ "$LEVEL" -lt 45 ]; then
    log "ABORT batt=$LEVEL < 45"
    echo ABORTED_BATT > "$LOG/ABORT"
    exit 5
  fi
  if [ "$TEMP_C" -ge 43 ]; then
    log "ABORT tempC=$TEMP_C >= 43"
    echo ABORTED_TEMP > "$LOG/ABORT"
    exit 7
  fi
}

pid_stat_fields() {
  _ps_pid="$1"
  _ps_raw=$(cat "/proc/${_ps_pid}/stat" 2>/dev/null) || { echo ""; return 1; }
  _ps_rest=${_ps_raw##*)}
  set -- $_ps_rest
  echo "$8 $10 $22"
}

parse_run_file() {
  _pr_file="$1"
  tps=$(sed -n 's/.*generation: .*(\([0-9.]*\) tok\/s).*/\1/p' "$_pr_file" | head -1)
  ngen=$(sed -n 's/.*generation: \([0-9]*\) tokens.*/\1/p' "$_pr_file" | head -1)
  mib=$(sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p' "$_pr_file" | head -1)
  hit=$(sed -n 's/.*moe-cache: \([0-9.]*\)% hit.*/\1/p' "$_pr_file" | head -1)
  ttft=$(sed -n 's/.*TTFT \([0-9.]*\) s.*/\1/p' "$_pr_file" | head -1)
  load=$(sed -n 's/.*model load \([0-9.]*\) s.*/\1/p' "$_pr_file" | head -1)
  [ -n "$tps" ] || tps=NA
  [ -n "$mib" ] || mib=NA
  [ -n "$hit" ] || hit=NA
  [ -n "$ttft" ] || ttft=NA
  [ -n "$load" ] || load=NA
  [ -n "$ngen" ] || ngen=NA
  printf '%s,%s,%s,%s,%s,%s' "$tps" "$mib" "$hit" "$ttft" "$load" "$ngen"
}

watch_mem() {
  _wm_pid="$1"
  _wm_csv="$2"
  _wm_abort="$3"
  _wm_bad=0
  echo "iso,memfree_kib,memavail_kib,swapfree_kib,anon_kib,cached_kib,pid_minflt,pid_majflt,pid_rss_pages" > "$_wm_csv"
  while kill -0 "$_wm_pid" 2>/dev/null; do
    _wm_iso=$(ts)
    _wm_mf=$(read_meminfo_field MemFree)
    _wm_ma=$(read_meminfo_field MemAvailable)
    _wm_sf=$(read_meminfo_field SwapFree)
    _wm_an=$(read_meminfo_field AnonPages)
    _wm_ca=$(read_meminfo_field Cached)
    _wm_st=$(pid_stat_fields "$_wm_pid")
    _wm_minf=NA
    _wm_maj=NA
    _wm_rss=NA
    if [ -n "$_wm_st" ]; then
      set -- $_wm_st
      _wm_minf=$1
      _wm_maj=$2
      _wm_rss=$3
    fi
    echo "${_wm_iso},${_wm_mf},${_wm_ma},${_wm_sf},${_wm_an},${_wm_ca},${_wm_minf},${_wm_maj},${_wm_rss}" >> "$_wm_csv"
    if [ -n "$_wm_ma" ] && [ "$_wm_ma" -lt "$MEMAVAIL_ABORT_KIB" ] 2>/dev/null; then
      _wm_bad=$((_wm_bad + 1))
      echo "${_wm_iso} LOW MemAvailable=${_wm_ma} KiB consec=${_wm_bad}/${MEMAVAIL_STREAK_NEED}" >> "$_wm_csv"
      if [ "$_wm_bad" -ge "$MEMAVAIL_STREAK_NEED" ]; then
        echo "${_wm_iso} ABORT MemAvailable=${_wm_ma} KiB < 300 MiB sustained 60s" | tee -a "$_wm_csv" >> "$STATUS"
        echo "ABORT_RAM ma=${_wm_ma}" > "$_wm_abort"
        kill "$_wm_pid" 2>/dev/null
        sleep 2
        kill -9 "$_wm_pid" 2>/dev/null
        return 0
      fi
    else
      _wm_bad=0
    fi
    sleep "$SAMPLE_S"
  done
}

run_one() {
  tag="$1"
  prompt_id="$2"
  threads="$3"
  pfile="$4"
  model="$5"
  mode="$6"
  abort_if_bad
  _ro_old=$(pgrep -f "$BIN" 2>/dev/null || true)
  if [ -n "$_ro_old" ]; then
    log "KILL leftover bmoe-cli: $_ro_old"
    pkill -f "$BIN" 2>/dev/null || true
    sleep 2
    pkill -9 -f "$BIN" 2>/dev/null || true
  fi
  if [ "$mode" = "cold" ]; then
    log "FADV $model"
    sync
    "$FADV" "$model" | tee -a "$LOG/fadv.txt"
  else
    log "NO_FADV sustained $tag"
  fi
  batt_dump "before_${tag}"
  B0=$LEVEL
  T0C=$TEMP_C
  MA0=$(read_meminfo_field MemAvailable)
  echo "$MA0" > "$LOG/curves/${tag}_memavail_before.txt"
  PROMPT=$(cat "$pfile")
  log "START $tag -t $threads prompt=$prompt_id mode=$mode MemAvailable_kB=$MA0 model=$(basename "$model")"
  T0=$(date +%s)
  "$BIN" -m "$model" -p "$PROMPT" -n 200 \
    --n-expert-used 6 --drop-cold-experts 0.65 \
    --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
    --io-threads 4 --ubatch 512 \
    -t "$threads" -c 4096 --temp 0 --chatml --no-think \
    > "$LOG/${tag}.out" 2> "$LOG/${tag}.err" &
  BPID=$!
  echo "$BPID" > "$LOG/${tag}.pid"
  sleep 1
  ST0=$(pid_stat_fields "$BPID")
  echo "t0 $(ts) pid=$BPID fields=$ST0" > "$LOG/majflt/${tag}.txt"
  watch_mem "$BPID" "$LOG/curves/${tag}_mem.csv" "$LOG/ABORT_RAM.txt" &
  WPID=$!
  wait "$BPID"
  RC=$?
  T1=$(date +%s)
  WALL=$((T1 - T0))
  wait "$WPID" 2>/dev/null || true
  ST1=$(pid_stat_fields "$BPID" 2>/dev/null || echo "")
  echo "t1 $(ts) pid=$BPID fields=$ST1 rc=$RC wall=$WALL" >> "$LOG/majflt/${tag}.txt"
  MAJ_END=$(awk -F, 'NF>=8 && $8 ~ /^[0-9]+$/ {m=$8} END{print m+0}' "$LOG/curves/${tag}_mem.csv")
  MAJ_START=$(awk -F, 'NR>1 && $8 ~ /^[0-9]+$/ {print $8; exit}' "$LOG/curves/${tag}_mem.csv")
  [ -n "$MAJ_START" ] || MAJ_START=0
  MAJ_DELTA=$((MAJ_END - MAJ_START))
  echo "majflt_start=$MAJ_START majflt_end=$MAJ_END majflt_delta=$MAJ_DELTA" >> "$LOG/majflt/${tag}.txt"
  log "END $tag EXIT=$RC wall_s=$WALL majflt_delta=$MAJ_DELTA"
  batt_dump "after_${tag}"
  MA1=$(read_meminfo_field MemAvailable)
  METRICS=$(parse_run_file "$LOG/${tag}.out")
  NGEN=$(echo "$METRICS" | awk -F, '{print $6}')
  MAJ_PER=NA
  if [ "$NGEN" != "NA" ] && [ -n "$NGEN" ] && [ "$NGEN" -gt 0 ] 2>/dev/null; then
    MAJ_PER=$(awk -v d="$MAJ_DELTA" -v n="$NGEN" 'BEGIN{printf "%.4f", d/n}')
  fi
  RSS_END=$(awk -F, 'NF>=9 && $9 ~ /^[0-9]+$/ {r=$9} END{print r+0}' "$LOG/curves/${tag}_mem.csv")
  RSS_MIB=$(awk -v p="$RSS_END" 'BEGIN{printf "%.1f", p*4/1024}')
  echo "$(ts),$tag,$prompt_id,$threads,$METRICS,$B0,$LEVEL,$T0C,$TEMP_C,$WALL,$RC,$MA0,$MA1,$MAJ_DELTA,$MAJ_PER,$RSS_MIB,$mode,UNPLUGGED" >> "$CSV"
  log "CSV $tag $METRICS batt=$B0->$LEVEL temp=$T0C->$TEMP_C wall=$WALL rc=$RC ma=$MA0->$MA1 majflt=$MAJ_DELTA rss_mib=$RSS_MIB"
  if [ -f "$LOG/ABORT_RAM.txt" ]; then
    log "ABORT_RAM after $tag — stop campaign"
    echo ABORTED_RAM > "$LOG/ABORT"
    exit 6
  fi
  if [ "$mode" = "cold" ]; then
    sleep 10
  fi
}

preflight() {
  mkdir -p "$LOG/curves" "$LOG/majflt"
  if [ ! -f "$CSV" ]; then
    echo "ts,tag,prompt_id,threads,decode_tps,mib_per_tok,hit_pct,ttft_s,load_s,n_gen,batt_start,batt_end,temp_start,temp_end,wall_s,rc,memavail_start,memavail_end,majflt_delta,majflt_per_tok,rss_mib,mode,plugged" > "$CSV"
  fi
  if [ ! -x "$BIN" ]; then
    log "BLOCKED no bmoe-cli at $BIN"
    echo BLOCKED_NOBIN > "$LOG/ABORT"
    exit 8
  fi
  if [ ! -f "$P_FACT" ] || [ ! -f "$P_CREATIVE" ]; then
    log "BLOCKED missing prompts"
    echo BLOCKED_NOPROMPT > "$LOG/ABORT"
    exit 10
  fi
  svc power stayon true 2>/dev/null || true
  abort_if_bad
}

case "$PHASE" in
  decode)
    : > "$STATUS"
    preflight
    log "PHASE decode begin (Marco1c t6, 2 cold reps: fact then creative)"
    {
      echo "=== extm $(ts) ==="
      echo -n "persist.miui.extm.enable="; getprop persist.miui.extm.enable
      echo -n "persist.miui.extm.bdsize="; getprop persist.miui.extm.bdsize
      echo -n "persist.miui.extm.version="; getprop persist.miui.extm.version
      echo "getprop_grep_extm:"
      getprop | grep extm || echo "(none)"
      if [ -e /data/extm/extm_file ]; then echo EXTM_FILE_EXISTS
      elif [ -d /data/extm ]; then echo EXTM_DIR_EXISTS_NO_FILE
      else echo EXTM_GONE_OR_DENIED
      fi
    } > "$LOG/extm_verify.txt"
    echo "=== binary $(ts) ===" > "$LOG/binary_id.txt"
    ls -l "$BIN" >> "$LOG/binary_id.txt"
    sha256sum "$BIN" >> "$LOG/binary_id.txt"
    "$BIN" --version >> "$LOG/binary_id.txt" 2>&1 || true
    echo "=== model marco $(ts) ===" > "$LOG/model_sha.txt"
    ls -l "$M_MARCO" >> "$LOG/model_sha.txt"
    sha256sum "$M_MARCO" >> "$LOG/model_sha.txt"
    am kill-all 2>/dev/null || true
    am memory-factor set NORMAL 2>/dev/null || true
    sleep 2
    {
      echo "=== mem_after_kill $(ts) ==="
      grep -E 'MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree|AnonPages|^Cached:' /proc/meminfo
    } > "$LOG/mem_after_kill.txt"
    batt_dump start_decode
    run_one "m1c_t6_fact_r1" fact 6 "$P_FACT" "$M_MARCO" cold
    run_one "m1c_t6_creative_r2" creative 6 "$P_CREATIVE" "$M_MARCO" cold
    log "PHASE decode done"
    echo DECODE_DONE > "$LOG/PHASE_DECODE"
    ;;
  sustained)
    preflight
    log "PHASE sustained begin (Marco1c t6 creative, NO fadvise, no cooldown)"
    run_one "m1c_t6_creative_sust" creative 6 "$P_CREATIVE" "$M_MARCO" hot
    log "PHASE sustained done"
    echo SUSTAINED_DONE > "$LOG/PHASE_SUSTAINED"
    ;;
  perf_cq)
    preflight
    log "PHASE perf_cq begin (CalaQwen t6 fact, 2 cold, perf-mode ON)"
    echo "=== model cala $(ts) ===" >> "$LOG/model_sha.txt"
    ls -l "$M_CALA" >> "$LOG/model_sha.txt"
    sha256sum "$M_CALA" >> "$LOG/model_sha.txt"
    batt_dump start_perf_cq
    run_one "cq_t6_fact_perf_r1" fact 6 "$P_FACT" "$M_CALA" cold
    run_one "cq_t6_fact_perf_r2" fact 6 "$P_FACT" "$M_CALA" cold
    log "PHASE perf_cq done"
    echo PERF_CQ_DONE > "$LOG/PHASE_PERF_CQ"
    ;;
  perf_m1c)
    preflight
    log "PHASE perf_m1c begin (Marco1c t6 fact, 1 cold, perf-mode ON)"
    batt_dump start_perf_m1c
    run_one "m1c_t6_fact_perf" fact 6 "$P_FACT" "$M_MARCO" cold
    log "PHASE perf_m1c done"
    echo PERF_M1C_DONE > "$LOG/PHASE_PERF_M1C"
    ;;
  t4)
    preflight
    log "PHASE t4 begin (Marco1c t4 fact, 1 cold)"
    batt_dump start_t4
    run_one "m1c_t4_fact" fact 4 "$P_FACT" "$M_MARCO" cold
    log "PHASE t4 done"
    echo T4_DONE > "$LOG/PHASE_T4"
    ;;
  *)
    echo "usage: $0 decode|sustained|perf_cq|perf_m1c|t4" >&2
    exit 2
    ;;
esac

read_batt
log "PHASE $PHASE exit plugged=$PLUGGED level=$LEVEL tempC=$TEMP_C"
exit 0
