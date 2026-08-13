#!/system/bin/sh
# Task B RETRY — CalaQwen KEXP 35B on Xiaomi 14 after Memory Extension OFF.
# Campaign pin 1ca51420, complete DT_NEEDED (incl. libssl.so.3 / libcrypto.so.3).
# House rule: abort on MemAvailable < 300 MiB sustained 60s. NEVER MemFree.
# mksh: no `local`. Prefix every helper var. Do not clobber caller `tag`.
set -u
ROOT=/data/local/tmp/gdn_750/taskb
export LD_LIBRARY_PATH="$ROOT/bin:/vendor/lib64:/system/vendor/lib64"
BIN="$ROOT/bin/bmoe-cli"
MODEL="$ROOT/Qwen3.6-35B-A3B-KEXP.gguf"
FADV="$ROOT/bin/fadv"
LOG="$ROOT/logs/taskb_retry"
P_FACT="$ROOT/prompts/p_fact.txt"
P_CREATIVE="$ROOT/prompts/p_creative.txt"
STATUS="$LOG/status.txt"
CSV="$LOG/runs.csv"
MEMAVAIL_ABORT_KIB=307200
MEMAVAIL_STREAK_NEED=12
SAMPLE_S=5
mkdir -p "$LOG/curves" "$LOG/majflt"

ts() { date '+%Y-%m-%dT%H:%M:%S'; }

log() { echo "$(ts) $*" | tee -a "$STATUS"; }

read_meminfo_field() {
  # $1 = field name without colon, e.g. MemAvailable
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

wait_unplugged() {
  # Start gate: UNPLUGGED and batt >= 60. Mid-run floor is 45.
  _wu_n=0
  while :; do
    read_batt
    if [ "$PLUGGED" -eq 0 ] && [ "$LEVEL" -ge 60 ]; then
      log "GATE_OK unplugged level=$LEVEL tempC=$TEMP_C"
      return 0
    fi
    log "WAITER plugged=$PLUGGED level=$LEVEL tempC=$TEMP_C (need UNPLUGGED && >=60)"
    _wu_n=$((_wu_n + 1))
    if [ "$_wu_n" -ge 180 ]; then
      log "ABORT waiter timeout 90min"
      echo ABORTED_WAITER > "$LOG/ABORT"
      exit 12
    fi
    sleep 30
  done
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
}

pid_stat_fields() {
  # stdout: minflt majflt rss_pages  (empty if pid gone)
  _ps_pid="$1"
  _ps_raw=$(cat "/proc/${_ps_pid}/stat" 2>/dev/null) || { echo ""; return 1; }
  _ps_rest=${_ps_raw##*)}
  set -- $_ps_rest
  # after comm: $1=state(3) $8=minflt(10) $10=majflt(12) $22=rss(24)
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
  abort_if_bad
  if [ "$TEMP_C" -gt 42 ]; then
    log "COOLWAIT tempC=$TEMP_C before $tag"
    _ro_slept=0
    while [ "$_ro_slept" -lt 300 ]; do
      sleep 20
      _ro_slept=$((_ro_slept + 20))
      abort_if_bad
      log "cool poll tempC=$TEMP_C level=$LEVEL"
      if [ "$TEMP_C" -le 38 ]; then break; fi
    done
  fi
  # leftover guard — never two 35B processes
  _ro_old=$(pgrep -f "$BIN" 2>/dev/null || true)
  if [ -n "$_ro_old" ]; then
    log "KILL leftover bmoe-cli: $_ro_old"
    pkill -f "$BIN" 2>/dev/null || true
    sleep 2
    pkill -9 -f "$BIN" 2>/dev/null || true
  fi
  log "FADV $MODEL"
  sync
  "$FADV" "$MODEL" | tee -a "$LOG/fadv.txt"
  batt_dump "before_${tag}"
  B0=$LEVEL
  T0C=$TEMP_C
  MA0=$(read_meminfo_field MemAvailable)
  echo "$MA0" > "$LOG/curves/${tag}_memavail_before.txt"
  PROMPT=$(cat "$pfile")
  log "START $tag -t $threads prompt=$prompt_id MemAvailable_kB=$MA0"
  T0=$(date +%s)
  "$BIN" -m "$MODEL" -p "$PROMPT" -n 200 \
    --n-expert-used 6 --drop-cold-experts 0.65 \
    --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
    --io-threads 4 --ubatch 512 \
    -t "$threads" -c 4096 --temp 0 --chatml --no-think \
    > "$LOG/${tag}.out" 2> "$LOG/${tag}.err" &
  BPID=$!
  echo "$BPID" > "$LOG/${tag}.pid"
  # first sample ASAP (load phase)
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
  # last curve row has the final majflt if pid already reaped; also keep ST0
  echo "t1 $(ts) pid=$BPID fields=$ST1 rc=$RC wall=$WALL" >> "$LOG/majflt/${tag}.txt"
  # majflt from last non-empty curve row
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
  echo "$(ts),$tag,$prompt_id,$threads,$METRICS,$B0,$LEVEL,$T0C,$TEMP_C,$WALL,$RC,$MA0,$MA1,$MAJ_DELTA,$MAJ_PER,UNPLUGGED" >> "$CSV"
  log "CSV $tag $METRICS batt=$B0->$LEVEL temp=$T0C->$TEMP_C wall=$WALL rc=$RC ma=$MA0->$MA1 majflt=$MAJ_DELTA ($MAJ_PER/tok)"
  if [ -f "$LOG/ABORT_RAM.txt" ]; then
    log "ABORT_RAM after $tag — stop campaign"
    echo ABORTED_RAM > "$LOG/ABORT"
    exit 6
  fi
  sleep 10
}

# ---------- begin ----------
: > "$STATUS"
log "TASK_B_RETRY begin"
log "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"

if [ ! -x "$BIN" ]; then
  log "BLOCKED_B no bmoe-cli at $BIN"
  echo BLOCKED_B_NOBIN > "$LOG/ABORT"
  exit 8
fi
if [ ! -f "$MODEL" ]; then
  log "BLOCKED_B no model at $MODEL"
  echo BLOCKED_B_NOMODEL > "$LOG/ABORT"
  exit 9
fi
if [ ! -f "$P_FACT" ] || [ ! -f "$P_CREATIVE" ]; then
  log "BLOCKED_B missing prompts"
  echo BLOCKED_B_NOPROMPT > "$LOG/ABORT"
  exit 10
fi

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
ls -l "$ROOT/bin"/libssl.so.3 "$ROOT/bin"/libcrypto.so.3 >> "$LOG/binary_id.txt" 2>&1
"$BIN" --version >> "$LOG/binary_id.txt" 2>&1 || true

echo "=== model $(ts) ===" > "$LOG/model_sha.txt"
ls -l "$MODEL" >> "$LOG/model_sha.txt"
sha256sum "$MODEL" >> "$LOG/model_sha.txt"

# stay awake while unplugged
svc power stayon true 2>/dev/null || true
am kill-all 2>/dev/null || true
am memory-factor set NORMAL 2>/dev/null || true
sleep 2
{
  echo "=== mem_after_kill $(ts) ==="
  grep -E 'MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree|AnonPages|^Cached:' /proc/meminfo
} > "$LOG/mem_after_kill.txt"

wait_unplugged
abort_if_bad

echo "ts,tag,prompt_id,threads,decode_tps,mib_per_tok,hit_pct,ttft_s,load_s,n_gen,batt_start,batt_end,temp_start,temp_end,wall_s,rc,memavail_start,memavail_end,majflt_delta,majflt_per_tok,plugged" > "$CSV"
batt_dump start_b

# ABBA primary -t 6
run_one "t6_fact_o1" fact 6 "$P_FACT"
run_one "t6_creative_o2" creative 6 "$P_CREATIVE"
run_one "t6_creative_o3" creative 6 "$P_CREATIVE"
run_one "t6_fact_o4" fact 6 "$P_FACT"

# -t 4 reference per prompt
run_one "t4_fact_ref" fact 4 "$P_FACT"
run_one "t4_creative_ref" creative 4 "$P_CREATIVE"

batt_dump end_b
read_batt
log "TASK_B_RETRY done plugged=$PLUGGED level=$LEVEL tempC=$TEMP_C"
echo "$LEVEL" > "$LOG/batt_after_b.txt"
svc power stayon false 2>/dev/null || true
am memory-factor reset 2>/dev/null || true
echo DONE > "$LOG/DONE"
exit 0
