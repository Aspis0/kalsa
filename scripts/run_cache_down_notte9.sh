#!/data/data/com.termux/files/usr/bin/bash
# run_cache_down_notte9.sh — BINARIO A notte 9/8: sweep cache in discesa C∈{1500,1000?}
# Solo bmoe-cli.CAMPAIGN (pin). Niente ALLOW_UNPINNED.
# Baseline C2000 mediana decode tok/s = 4.608 (Cella 2, staccato2).
# Regole di lettura fisse (mandato notte-9ago):
#   C1500 entro −3% vs 4.608 → candidato, valuta C1000 se batt≥38%
#   C1500 −3%..−10%         → trade-off, non scendere a 1000
#   C1500 < −10%            → 2000 minimo sano, chiudi
# Floor batteria 30% = fine sessione. C1000 solo se batt≥38% a fine C1500.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/notte9/cache_down}"
mkdir -p "$OUTDIR"/{C1500,C1000,prompts} "$TMPDIR"
MASTER="$OUTDIR/CACHE_DOWN.master.log"
PIDFILE="$OUTDIR/cache_down.pid"
STATUS="$OUTDIR/STATUS.txt"
FLIGHT_LOG="$OUTDIR/flight.log"
FLIGHT_PIDF="$OUTDIR/flight.pid"
RUNS_CSV="${RUNS_CSV:-$HOME/experiments/results/runs.csv}"
CELL_CSV="$OUTDIR/cells.csv"
TAG_PHASE="NOTTE9-CACHE-DOWN"
BASELINE_MED=4.608

BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
PROMPTS_DIR="${PROMPTS_DIR:-$HOME/experiments/prompts}"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-cab20432}"

THREADS=4
N_CTX=4096
IO_THREADS=4
N_GEN=200
UBATCH=512
N_EXPERT=8
DIE_STOP_MC=98000
DIE_START_MC=80000
BATT_STOP=30
BATT_C1000_MIN=38

# --- campaign pin ---
_PIN_LIB=""
for _d in \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" \
  "$HOME/experiments/scripts"
do
  [ -n "$_d" ] && [ -f "$_d/lib_campaign_pin.sh" ] && _PIN_LIB="$_d/lib_campaign_pin.sh" && break
done
if [ -n "$_PIN_LIB" ]; then
  # shellcheck disable=SC1090
  source "$_PIN_LIB"
  assert_campaign_pin "$BIN"
else
  _sha_file="${CAMPAIGN_SHA_FILE:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256}"
  _exp=$(awk 'NF{print $1; exit}' "$_sha_file" 2>/dev/null || true)
  _got=$(sha256sum "$BIN" 2>/dev/null | awk '{print $1}')
  BIN_SHA256="$_got"
  case "$BIN" in *.CAMPAIGN) ;; *)
    echo "ERRORE pin: usare bmoe-cli.CAMPAIGN" >&2; exit 6;;
  esac
  if [ -z "$_exp" ] || [ "$_got" != "$_exp" ]; then
    echo "ERRORE pin sha mismatch got=$_got exp=$_exp" >&2; exit 6
  fi
fi
export BIN_SHA256="${BIN_SHA256:-}"

# --- guardrail ---
_GR_LIB=""
for _d in \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" \
  "$HOME/experiments/scripts"
do
  [ -n "$_d" ] && [ -f "$_d/lib_guardrails.sh" ] && _GR_LIB="$_d/lib_guardrails.sh" && break
done
if [ -n "$_GR_LIB" ]; then
  # shellcheck disable=SC1090
  source "$_GR_LIB"
else
  echo "WARN: lib_guardrails.sh assente — solo HARD STOP 98°C legacy" >&2
fi

BINDIR=$(dirname "$BIN")
export LD_LIBRARY_PATH="${BINDIR}:${BINDIR}/..:${LD_LIBRARY_PATH:-}"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

max_die_mc() {
  local max=0 v t z
  for z in /sys/class/thermal/thermal_zone*; do
    t=$(cat "$z/type" 2>/dev/null || true)
    case "$t" in cpu-*|cpuss-*|*cpu*|*CPU*)
      v=$(cat "$z/temp" 2>/dev/null || echo 0)
      if [ -n "$v" ] && [ "$v" -gt "$max" ] 2>/dev/null; then max=$v; fi
    ;; esac
  done
  echo "$max"
}
mc_to_c() { awk -v m="$1" 'BEGIN{ if (m>1000) printf "%.1f", m/1000; else printf "%.1f", m }'; }

batt_fields() {
  local out
  out=$(timeout 5 termux-battery-status 2>/dev/null || true)
  if [ -n "$out" ] && echo "$out" | grep -q 'percentage'; then
    echo "$out" | python3 -c '
import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get("percentage",-1), d.get("voltage",-1), d.get("current",0),
        d.get("temperature",-1), d.get("plugged","?"))
except Exception:
  print(-1,-1,0,-1,"?")
'
    return 0
  fi
  local pct temp st pl="UNPLUGGED"
  pct=$(cat /sys/class/power_supply/battery/capacity 2>/dev/null || echo -1)
  temp=$(cat /sys/class/power_supply/battery/temp 2>/dev/null || echo -1)
  if [ "$temp" -gt 100 ] 2>/dev/null; then
    temp=$(python3 -c "print(round($temp/10.0,1))" 2>/dev/null || echo -1)
  fi
  st=$(cat /sys/class/power_supply/battery/status 2>/dev/null || echo Unknown)
  case "$st" in Charging|Full) pl="PLUGGED";; esac
  echo "$pct -1 0 $temp $pl"
}

kill_bmoe() {
  local pid cmd
  for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cmd" in *"/bmoe-cli"*|*/bmoe-cli\ *)
      case "$cmd" in *run_cache_down*|*run_staccato*) ;; *)
        kill "$pid" 2>/dev/null || true
        sleep 1
        kill -9 "$pid" 2>/dev/null || true
      ;; esac
    ;; esac
  done
  sleep 1
}

start_flight() {
  if [ -f "$FLIGHT_PIDF" ] && kill -0 "$(cat "$FLIGHT_PIDF")" 2>/dev/null; then
    log "flight already running pid=$(cat "$FLIGHT_PIDF")"
    return 0
  fi
  : > "$FLIGHT_LOG"
  echo "ts_epoch,ts_local,die_c,memfree_kb,batt_pct,plugged" > "$FLIGHT_LOG"
  (
    while :; do
      now=$(date +%s.%N 2>/dev/null || date +%s)
      iso=$(date '+%Y-%m-%dT%H:%M:%S%z')
      die=$(mc_to_c "$(max_die_mc)")
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      read -r bp _ _ _ pl <<<"$(batt_fields)"
      echo "${now},${iso},${die},${mf},${bp},${pl}" >> "$FLIGHT_LOG"
      python3 -c "import os; f=open('$FLIGHT_LOG','a'); os.fsync(f.fileno()); f.close()" 2>/dev/null || true
      sleep 5
    done
  ) &
  echo $! > "$FLIGHT_PIDF"
  log "flight started pid=$(cat "$FLIGHT_PIDF")"
}

check_flight() {
  if [ ! -f "$FLIGHT_PIDF" ] || ! kill -0 "$(cat "$FLIGHT_PIDF")" 2>/dev/null; then
    log "WARN flight dead — restarting"
    start_flight
  fi
}

stop_flight() {
  if [ -f "$FLIGHT_PIDF" ]; then
    kill "$(cat "$FLIGHT_PIDF")" 2>/dev/null || true
    rm -f "$FLIGHT_PIDF"
  fi
}

repromote_termux() {
  termux-wake-lock >/dev/null 2>&1 || true
  echo "$(ts) nproc=$(nproc) cpuset=$(cat /proc/self/cpuset 2>/dev/null)" > "$OUTDIR/REPROMOTE.request"
  /system/bin/am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1 || true
  termux-notification --id cache_down --title "CACHE_DOWN nproc" \
    --content "nproc=$(nproc): tieni Termux foreground / schermo acceso" >/dev/null 2>&1 || true
}

preflight_cella() {
  local cell="$1"
  check_flight
  local n die_mc die_c
  n=$(nproc)
  die_mc=$(max_die_mc)
  die_c=$(mc_to_c "$die_mc")
  read -r batt _ _ btemp plugged <<<"$(batt_fields)"
  log "PREFLIGHT $cell nproc=$n die=${die_c}C batt=$batt% plugged=$plugged btemp=$btemp"

  if [ "$plugged" != "UNPLUGGED" ]; then
    log "FATAL PLUGGED=$plugged"
    echo "FATAL_PLUGGED $cell $(ts)" > "$STATUS"
    echo "PLUGGED" > "$OUTDIR/STOP_REASON.txt"
    return 4
  fi
  if [ "$batt" -lt 0 ] 2>/dev/null; then
    log "WARN batt unknown ($batt) — re-read"
    sleep 2
    read -r batt _ _ btemp plugged <<<"$(batt_fields)"
    log "batt re-read=$batt plugged=$plugged"
  fi
  if [ "$batt" -ge 0 ] 2>/dev/null && [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then
    log "FATAL batt=$batt < $BATT_STOP"
    echo "FATAL_BATT $cell batt=$batt $(ts)" > "$STATUS"
    echo "BATT_LOW" > "$OUTDIR/STOP_REASON.txt"
    return 92
  fi
  local t0 now
  t0=$(date +%s)
  while :; do
    n=$(nproc)
    die_mc=$(max_die_mc)
    die_c=$(mc_to_c "$die_mc")
    read -r batt _ _ _ plugged <<<"$(batt_fields)"
    if [ "$plugged" != "UNPLUGGED" ]; then
      log "FATAL became PLUGGED during preflight wait"
      return 4
    fi
    if [ "$batt" -ge 0 ] 2>/dev/null && [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then
      log "FATAL batt low during preflight wait"
      return 92
    fi
    if [ "$n" -ge 6 ] && [ "$die_mc" -le "$DIE_START_MC" ] 2>/dev/null; then
      rm -f "$OUTDIR/REPROMOTE.request"
      break
    fi
    now=$(date +%s)
    if [ $((now - t0)) -ge 600 ]; then
      if [ "$n" -lt 6 ]; then
        log "FATAL nproc=$n < 6 after 600s"
        echo "FATAL_NPROC $cell nproc=$n $(ts)" > "$STATUS"
        echo "NPROC_LOW" > "$OUTDIR/STOP_REASON.txt"
        echo "SKIPPED $cell nproc=$n after 600s re-promote" >> "$OUTDIR/SKIPPED.txt"
        return 93
      fi
      log "WARN die still ${die_c}C after 600s — proceed cautiously"
      break
    fi
    log "preflight wait cell=$cell nproc=$n die=${die_c}C — re-promote"
    repromote_termux
    sleep 30
  done
  n=$(nproc)
  if [ "$n" -lt 6 ]; then
    log "FATAL nproc=$n < 6"
    echo "FATAL_NPROC $cell $(ts)" > "$STATUS"
    echo "NPROC_LOW" > "$OUTDIR/STOP_REASON.txt"
    return 93
  fi
  log "PREFLIGHT $cell OK die=$(mc_to_c "$(max_die_mc)")C batt=$batt nproc=$n"
  return 0
}

safety_hard() {
  local die_mc
  die_mc=$(max_die_mc)
  if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
    log "HARD_STOP die=$(mc_to_c "$die_mc")C"
    kill_bmoe
    echo "HARD_STOP_DIE $(ts)" > "$STATUS"
    echo "DIE_98" > "$OUTDIR/STOP_REASON.txt"
    return 99
  fi
  read -r batt _ _ _ plugged <<<"$(batt_fields)"
  if [ "$batt" -ge 0 ] 2>/dev/null && [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then
    log "HARD_STOP batt=$batt"
    kill_bmoe
    echo "HARD_STOP_BATT $(ts)" > "$STATUS"
    echo "BATT_LOW" > "$OUTDIR/STOP_REASON.txt"
    return 92
  fi
  return 0
}

lmkd_count() {
  local n
  n=$(timeout 8 logcat -d 2>/dev/null | grep -cE 'lowmemorykiller|lmkd|Kill.*lmk' 2>/dev/null || true)
  n=${n//$'\n'/}
  n=${n//[^0-9]/}
  if [ -z "$n" ]; then n=0; fi
  printf '%s' "$n"
}

ensure_runs_header() {
  if [ ! -f "$RUNS_CSV" ] || [ ! -s "$RUNS_CSV" ]; then
    echo "run_id,date,phase,model,quant,file_gb,runtime,runtime_commit,flags,threads,n_ctx,kv_type,n_gen,run_type,prompt_id,prompt_tok_s,eval_tok_s,ttft_ms,majflt_delta,minflt_delta,read_bytes_delta,vmrss_peak_mb,memfree_min_mb,batt_temp_start,batt_temp_end,battery_pct,expert_hit_rate,nproc,affinity_mask,notes" > "$RUNS_CSV"
  fi
}

append_run() {
  ensure_runs_header
  echo "$1" >> "$RUNS_CSV"
  echo "$1" >> "$OUTDIR/runs_added.csv"
}

archive_prompts() {
  cp -f "$PROMPTS_DIR/short.txt" "$OUTDIR/prompts/short.txt"
  cp -f "$PROMPTS_DIR/f45_1_esplicativo.txt" "$OUTDIR/prompts/f45_1_esplicativo.txt"
  {
    echo "prompt,sha256,bytes"
    for name in short f45_1_esplicativo; do
      f="$OUTDIR/prompts/${name}.txt"
      [ -f "$f" ] || f="$PROMPTS_DIR/${name}.txt"
      [ -f "$f" ] || f="$PROMPTS_DIR/${name}_esplicativo.txt"
      case "$name" in
        f45_1_esplicativo) f="$OUTDIR/prompts/f45_1_esplicativo.txt" ;;
        short) f="$OUTDIR/prompts/short.txt" ;;
      esac
      sha=$(sha256sum "$f" | awk '{print $1}')
      bytes=$(wc -c < "$f" | tr -d ' ')
      echo "${name},${sha},${bytes}"
    done
  } > "$OUTDIR/prompt_sha256.txt"
  log "prompt sha archived"
  cat "$OUTDIR/prompt_sha256.txt" | tee -a "$MASTER"
  # hard-verify expected
  local s_short s_f45
  s_short=$(awk -F, '/^short,/{print $2}' "$OUTDIR/prompt_sha256.txt")
  s_f45=$(awk -F, '/^f45_1_esplicativo,/{print $2}' "$OUTDIR/prompt_sha256.txt")
  if [ "$s_short" != "197480d977685dc8bacec8c3eeaf81ab395ee33ccaf5737a4913149920c2f619" ]; then
    log "FATAL short prompt sha mismatch: $s_short"; exit 7
  fi
  if [ "$s_f45" != "bc5c1e584031aa57f53d47ecabe8139537fbd54c32421ce4ca9ef2204f55cbcf" ]; then
    log "FATAL f45_1 sha mismatch: $s_f45"; exit 7
  fi
}

run_single() {
  # args: label prompt_file prompt_id n_gen cache_mb ubatch n_expert_used run_type notes_extra out_prefix
  local label="$1" pfile="$2" pid="$3" ngen="$4" cmb="$5" ub="$6" nex="$7" rtype="$8" notesx="$9" opfx="${10}"
  local slog="${opfx}.stdout.log"
  local serr="${opfx}.stderr.log"
  local samp="${opfx}.sampler.csv"
  local sumf="${opfx}.summary.txt"
  : > "$slog"; : > "$serr"
  echo "ts_epoch_ms,die_c,vmrss_kb,vmhwm_kb,memfree_kb" > "$samp"

  log "---- single $label pid=$pid n=$ngen cache=$cmb ubatch=$ub ----"
  safety_hard || return $?
  check_flight

  read -r batt_s _ _ btemp_s plugged_s <<<"$(batt_fields)"
  if [ "$plugged_s" != "UNPLUGGED" ]; then
    log "FATAL PLUGGED before $label — skip CSV"
    return 4
  fi
  local die_s nproc_s
  die_s=$(mc_to_c "$(max_die_mc)")
  nproc_s=$(nproc)
  local lmkd_s
  lmkd_s=$(lmkd_count)

  local EXTRA=""
  if [ -n "$nex" ] && [ "$nex" != "0" ]; then
    EXTRA="--n-expert-used $nex"
  fi
  local ptext
  ptext=$(cat "$pfile")
  local FLAGS=(
    -m "$MODEL" -p "$ptext" -t "$THREADS" -c "$N_CTX" -n "$ngen"
    --temp 0 --chatml --no-think --moe-stream
    --cache-mb "$cmb" --dense-weights anon --overlap
    --io-threads "$IO_THREADS" --ubatch "$ub"
  )
  if [ -n "$EXTRA" ]; then
    FLAGS+=(--n-expert-used "$nex")
  fi

  "$BIN" "${FLAGS[@]}" > "$slog" 2> "$serr" &
  local BPID=$!
  echo "$BPID" > "${opfx}.pid"

  (
    guardrails_reset 2>/dev/null || true
    while kill -0 "$BPID" 2>/dev/null; do
      now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      die_mc=$(max_die_mc)
      die_c=$(mc_to_c "$die_mc")
      rss=0; hwm=0
      [ -r "/proc/$BPID/status" ] && rss=$(awk '/^VmRSS:/{print $2}' "/proc/$BPID/status")
      [ -r "/proc/$BPID/status" ] && hwm=$(awk '/^VmHWM:/{print $2}' "/proc/$BPID/status")
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      echo "${now_ms},${die_c},${rss},${hwm},${mf}" >> "$samp"
      if type guardrail_tick >/dev/null 2>&1; then
        guardrail_tick "$die_mc" "${mf:-0}"
        if [ "$GR_ACTION" != "CONTINUE" ]; then
          guardrail_apply_to_pid "$BPID" "$opfx"
          echo "$?" > "${opfx}.guardrail_rc"
          break
        fi
      else
        if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
          kill -TERM "$BPID" 2>/dev/null || true
        fi
      fi
      sleep 0.5
    done
  ) &
  local SPID=$!

  local wall_s wall_e elapsed
  wall_s=$(date +%s)
  set +e
  wait "$BPID"
  local brc=$?
  set -e
  wall_e=$(date +%s)
  elapsed=$((wall_e - wall_s))
  kill "$SPID" 2>/dev/null || true
  wait "$SPID" 2>/dev/null || true

  local grc=0
  if [ -f "${opfx}.guardrail_rc" ]; then
    grc=$(cat "${opfx}.guardrail_rc" 2>/dev/null || echo 0)
    rm -f "${opfx}.guardrail_rc"
  fi
  if [ "$grc" = "97" ]; then
    log "THERMAL_PAUSE $label — wait cool <80C"
    if type guardrail_thermal_wait_cool >/dev/null 2>&1; then
      if guardrail_thermal_wait_cool 600; then
        echo "THERMAL_PAUSE_COOLED $(ts) $label" > "$STATUS"
        brc=97
      else
        echo "THERMAL_PAUSE_ABORT $(ts) $label" > "$STATUS"
        echo "THERMAL_PAUSE_TIMEOUT" > "$OUTDIR/STOP_REASON.txt"
        return 97
      fi
    else
      brc=97
    fi
  elif [ "$grc" = "96" ]; then
    log "ABORT_MEM $label"
    echo "ABORT_MEM $(ts) $label" > "$STATUS"
    echo "ABORT_MEM" > "$OUTDIR/STOP_REASON.txt"
    brc=96
  elif [ "$grc" = "99" ]; then
    log "HARD_STOP_DIE $label"
    echo "HARD_STOP_DIE $(ts) $label" > "$STATUS"
    echo "DIE_98" > "$OUTDIR/STOP_REASON.txt"
    return 99
  fi

  read -r batt_e _ _ btemp_e _ <<<"$(batt_fields)"
  local die_e
  die_e=$(mc_to_c "$(max_die_mc)")
  local lmkd_e lmkd_d
  lmkd_e=$(lmkd_count)
  lmkd_s=${lmkd_s:-0}
  lmkd_e=${lmkd_e:-0}
  lmkd_d=$((lmkd_e - lmkd_s))
  if [ "$lmkd_d" -lt 0 ] 2>/dev/null; then lmkd_d=0; fi

  local prompt_tok_s="" eval_tok_s="" ttft_ms="" hit="" n_prompt=""
  local _combo
  _combo=$(cat "$slog" "$serr" 2>/dev/null || true)
  eval_tok_s=$(printf '%s\n' "$_combo" | grep -E 'generation:.*tok/s' | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  prompt_tok_s=$(printf '%s\n' "$_combo" | grep -E 'prefill:.*tok/s' | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  local prefill_s_val=""
  prefill_s_val=$(printf '%s\n' "$_combo" | grep -E 'prefill:' | tail -1 | sed -n 's/.*prefill: *[0-9]* tokens, *\([0-9.]*\) s.*/\1/p' | head -1)
  ttft_ms=$(printf '%s\n' "$_combo" | grep -E 'TTFT' | tail -1 | sed -n 's/.*TTFT *\([0-9.]*\) s.*/\1/p' | head -1)
  if [ -n "$ttft_ms" ]; then
    ttft_ms=$(python3 -c "print(int(float('$ttft_ms')*1000))")
  fi
  hit=$(printf '%s\n' "$_combo" | grep -E 'moe-cache:.*hit' | tail -1 | sed -n 's/.*moe-cache: *\([0-9.]*\)% hit.*/\1%/p' | head -1)
  n_prompt=$(printf '%s\n' "$_combo" | grep -E 'prefill: *[0-9]+ tokens' | tail -1 | sed -n 's/.*prefill: *\([0-9]*\) tokens.*/\1/p' | head -1)

  local memfree_min_kb vmhwm_max_kb
  memfree_min_kb=$(awk -F, 'NR>1{if(m==""||$5+0<m)m=$5+0} END{print m+0}' "$samp")
  vmhwm_max_kb=$(awk -F, 'NR>1{if($4+0>m)m=$4+0} END{print m+0}' "$samp")
  local memfree_min_mb vmrss_peak_mb
  memfree_min_mb=$(python3 -c "print(int($memfree_min_kb/1024))")
  vmrss_peak_mb=$(python3 -c "print(int($vmhwm_max_kb/1024))")

  {
    echo "label=$label"
    echo "rc=$brc"
    echo "wall_s=$elapsed"
    echo "prompt_tok_s=$prompt_tok_s"
    echo "eval_tok_s=$eval_tok_s"
    echo "prefill_s=$prefill_s_val"
    echo "ttft_ms=$ttft_ms"
    echo "n_prompt=$n_prompt"
    echo "expert_hit_rate=$hit"
    echo "memfree_min_mb=$memfree_min_mb"
    echo "vmhwm_mb=$vmrss_peak_mb"
    echo "lmkd_delta=$lmkd_d"
    echo "batt_s=$batt_s batt_e=$batt_e"
    echo "die_s=$die_s die_e=$die_e"
    echo "bin_sha256=$BIN_SHA256"
  } > "$sumf"
  cat "$sumf" | tee -a "$MASTER"
  log "single $label DONE eval=${eval_tok_s} prefill_tps=${prompt_tok_s} hit=$hit memfree_min=${memfree_min_mb} lmkd_d=$lmkd_d wall=${elapsed}s rc=$brc"

  local run_id flags_s
  run_id="cache_down-${label}-$(date +%Y%m%d-%H%M%S)"
  flags_s="--moe-stream --cache-mb ${cmb} --dense-weights anon --overlap --io-threads 4 --ubatch ${ub}"
  if [ -n "$EXTRA" ]; then flags_s="$flags_s $EXTRA"; fi
  append_run "${run_id},$(date -Iseconds),${TAG_PHASE},${MODEL##*/},UD-IQ2_M,11.52,bigmoe,${RUNTIME_COMMIT},${flags_s//,/;},4,4096,f16,${ngen},${rtype},${pid},${prompt_tok_s},${eval_tok_s},${ttft_ms},,,,${vmrss_peak_mb},${memfree_min_mb},${btemp_s},${btemp_e},${batt_s},${hit},${nproc_s},,bin_sha256=${BIN_SHA256};lmkd_delta=${lmkd_d};wall_s=${elapsed};n_prompt=${n_prompt};${notesx}"

  echo "${label},${pid},${ngen},${cmb},${ub},${prompt_tok_s},${eval_tok_s},${prefill_s_val},${hit},${memfree_min_mb},${vmrss_peak_mb},${lmkd_d},${batt_s},${batt_e},${die_s},${die_e},${elapsed},${brc},${BIN_SHA256}" >> "$CELL_CSV"

  if [ $brc -ne 0 ]; then
    log "WARN $label rc=$brc"
  fi
  if [ "$brc" = "96" ] || [ "$brc" = "97" ] || [ "$brc" = "99" ]; then
    return "$brc"
  fi
  return 0
}

run_tier() {
  # args: C
  local C="$1"
  local tdir="$OUTDIR/C${C}"
  mkdir -p "$tdir"
  log "==== TIER C${C} START ===="
  preflight_cella "C${C}" || return $?

  local need_cold=0 p rep
  for p in short f45_1_esplicativo; do
    for rep in 1 2; do
      if [ ! -f "$tdir/C${C}_${p}_r${rep}.summary.txt" ]; then need_cold=1; fi
    done
  done
  if [ "$need_cold" = "0" ]; then
    log "skip cache=$C (all 4 summaries present)"
    return 0
  fi

  log "cold_model for cache=$C"
  kill_bmoe
  if ! "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1; then
    log "FATAL cold cache=$C"; return 2
  fi

  for p in short f45_1_esplicativo; do
    for rep in 1 2; do
      local opfx="$tdir/C${C}_${p}_r${rep}"
      if [ -f "${opfx}.summary.txt" ]; then
        log "skip existing ${opfx}.summary.txt"
        continue
      fi
      if [ -f "${opfx}.stdout.log" ] || [ -f "${opfx}.pid" ]; then
        local bak="${opfx}.partial.$(date +%Y%m%d%H%M%S)"
        log "archive partial attempt → $bak"
        for ext in pid sampler.csv stderr.log stdout.log summary.txt KILL.txt; do
          [ -f "${opfx}.${ext}" ] && mv "${opfx}.${ext}" "${bak}.${ext}" 2>/dev/null || true
        done
      fi
      preflight_cella "C${C}_${p}_r${rep}" || return $?
      local die_mc
      die_mc=$(max_die_mc)
      if [ "$die_mc" -gt 75000 ] 2>/dev/null; then
        log "cool before C${C} $p r$rep die=$(mc_to_c $die_mc)C"
        local t0 now
        t0=$(date +%s)
        while [ "$(max_die_mc)" -gt 70000 ] 2>/dev/null; do
          now=$(date +%s)
          [ $((now-t0)) -ge 600 ] && break
          safety_hard || return $?
          sleep 10
        done
      fi
      local pfile="$PROMPTS_DIR/${p}.txt"
      [ -f "$pfile" ] || pfile="$OUTDIR/prompts/${p}.txt"
      local label="C${C}-${p}-r${rep}"
      local notesx="cache_down;cache=${C};rep=${rep};baseline_med=${BASELINE_MED}"
      if ! run_single "$label" "$pfile" "$p" "$N_GEN" "$C" "$UBATCH" "$N_EXPERT" "cold" "$notesx" "$opfx"; then
        local rc=$?
        log "run_single failed rc=$rc for $label"
        if [ "$rc" = "92" ] || [ "$rc" = "96" ] || [ "$rc" = "99" ] || [ "$rc" = "4" ] || [ "$rc" = "93" ]; then
          return "$rc"
        fi
        # thermal pause cooled: continue to next run after cool
        if [ "$rc" = "97" ]; then
          log "thermal pause handled — continue"
          continue
        fi
      fi
    done
  done
  log "==== TIER C${C} DONE ===="
  return 0
}

median4() {
  # stdin: 4 numbers one per line → stdout median of 4 (avg of 2 middle)
  python3 -c '
import sys
xs=[]
for line in sys.stdin:
  line=line.strip()
  if not line: continue
  try: xs.append(float(line))
  except: pass
xs=sorted(xs)
if not xs:
  print("nan"); sys.exit(0)
n=len(xs)
if n%2==1:
  print(f"{xs[n//2]:.4f}")
else:
  print(f"{(xs[n//2-1]+xs[n//2])/2:.4f}")
'
}

verdict_c1500() {
  # collect eval_tok_s from 4 summaries
  local tdir="$OUTDIR/C1500"
  local vals="" f
  for f in \
    "$tdir/C1500_short_r1.summary.txt" \
    "$tdir/C1500_short_r2.summary.txt" \
    "$tdir/C1500_f45_1_esplicativo_r1.summary.txt" \
    "$tdir/C1500_f45_1_esplicativo_r2.summary.txt"
  do
    if [ -f "$f" ]; then
      v=$(awk -F= '/^eval_tok_s=/{print $2}' "$f")
      if [ -n "$v" ]; then
        vals="${vals}${v}"$'\n'
      fi
    fi
  done
  if [ -z "$vals" ]; then
    echo "NODATA"
    return 1
  fi
  local med delta_pct
  med=$(printf '%s' "$vals" | median4)
  delta_pct=$(python3 -c "print(round(($med - $BASELINE_MED)/$BASELINE_MED * 100.0, 3))")
  {
    echo "baseline_med=$BASELINE_MED"
    echo "c1500_med=$med"
    echo "delta_pct=$delta_pct"
    echo "values:"
    printf '%s' "$vals"
  } > "$OUTDIR/C1500/verdict_raw.txt"
  # log to master only (NOT stdout — caller captures verdict via $())
  cat "$OUTDIR/C1500/verdict_raw.txt" >> "$MASTER"
  log "C1500 raw verdict: med=$med delta_pct=$delta_pct"

  # rules: entro -3% → CANDIDATE; -3..-10 → TRADEOFF; < -10 → MIN_SANE_2000
  local verdict
  verdict=$(python3 -c "
d=float('$delta_pct')
if d >= -3.0:
  print('CANDIDATE')
elif d >= -10.0:
  print('TRADEOFF')
else:
  print('MIN_SANE_2000')
")
  echo "verdict=$verdict" >> "$OUTDIR/C1500/verdict_raw.txt"
  log "verdict=$verdict"
  echo "$verdict" > "$OUTDIR/C1500/verdict.txt"
  echo "$med" > "$OUTDIR/C1500/median.txt"
  echo "$delta_pct" > "$OUTDIR/C1500/delta_pct.txt"
  # stdout MUST be only the verdict token (caller captures via $())
  printf '%s\n' "$verdict"
}

# ═══════════════ MAIN ═══════════════
echo $$ > "$PIDFILE"
: > "$MASTER"
: > "$OUTDIR/runs_added.csv"
echo "label,prompt_id,n_gen,cache_mb,ubatch,prompt_tok_s,eval_tok_s,prefill_s,hit,memfree_min_mb,vmhwm_mb,lmkd_delta,batt_s,batt_e,die_s,die_e,wall_s,rc,bin_sha256" > "$CELL_CSV"

log "=== CACHE_DOWN NOTTE9 START bin=$BIN sha=$BIN_SHA256 ==="
log "baseline_med=$BASELINE_MED OUTDIR=$OUTDIR"
timeout 5 termux-battery-status 2>/dev/null > "$OUTDIR/batt_start.json" || echo '{}' > "$OUTDIR/batt_start.json"
archive_prompts
start_flight
termux-wake-lock >/dev/null 2>&1 || true

FINAL_RC=0
VERDICT="PENDING"
C1000_STATUS="NOT_ATTEMPTED"

# --- C1500 always first ---
if run_tier 1500; then
  log "C1500 tier completed"
else
  FINAL_RC=$?
  log "C1500 tier aborted rc=$FINAL_RC"
  VERDICT="ABORTED_C1500_rc${FINAL_RC}"
  echo "$VERDICT" > "$OUTDIR/VERDICT.txt"
  timeout 5 termux-battery-status 2>/dev/null > "$OUTDIR/batt_end.json" || true
  stop_flight
  kill_bmoe
  echo "ABORTED $(ts) rc=$FINAL_RC" > "$STATUS"
  exit "$FINAL_RC"
fi

VERDICT=$(verdict_c1500 || echo "NODATA")
log "C1500 verdict=$VERDICT"

# --- C1000 only if candidate AND batt ≥ 38% ---
if [ "$VERDICT" = "CANDIDATE" ]; then
  read -r batt_now _ _ _ plugged_now <<<"$(batt_fields)"
  log "post-C1500 batt=$batt_now% plugged=$plugged_now (need ≥$BATT_C1000_MIN for C1000)"
  if [ "$batt_now" -ge 0 ] 2>/dev/null && [ "$batt_now" -lt "$BATT_STOP" ] 2>/dev/null; then
    log "batt floor hit after C1500 — stop session"
    C1000_STATUS="SKIPPED_BATT_FLOOR"
    FINAL_RC=92
  elif [ "$batt_now" -ge 0 ] 2>/dev/null && [ "$batt_now" -lt "$BATT_C1000_MIN" ] 2>/dev/null; then
    log "SKIPPED C1000: batt=$batt_now < $BATT_C1000_MIN"
    C1000_STATUS="SKIPPED_BATT_${batt_now}"
    echo "SKIPPED C1000 batt=$batt_now < $BATT_C1000_MIN $(ts)" >> "$OUTDIR/SKIPPED.txt"
  elif [ "$plugged_now" != "UNPLUGGED" ]; then
    log "SKIPPED C1000: PLUGGED"
    C1000_STATUS="SKIPPED_PLUGGED"
  else
    log "attempting C1000 (candidate + batt ok)"
    if run_tier 1000; then
      C1000_STATUS="DONE"
      log "C1000 tier completed"
    else
      FINAL_RC=$?
      C1000_STATUS="ABORTED_rc${FINAL_RC}"
      log "C1000 tier aborted rc=$FINAL_RC"
    fi
  fi
else
  log "C1000 not attempted: verdict=$VERDICT (only CANDIDATE proceeds)"
  C1000_STATUS="SKIPPED_VERDICT_${VERDICT}"
  echo "SKIPPED C1000 verdict=$VERDICT $(ts)" >> "$OUTDIR/SKIPPED.txt"
fi

timeout 5 termux-battery-status 2>/dev/null > "$OUTDIR/batt_end.json" || echo '{}' > "$OUTDIR/batt_end.json"
{
  echo "verdict=$VERDICT"
  echo "c1000_status=$C1000_STATUS"
  echo "final_rc=$FINAL_RC"
  echo "baseline_med=$BASELINE_MED"
  [ -f "$OUTDIR/C1500/median.txt" ] && echo "c1500_med=$(cat "$OUTDIR/C1500/median.txt")"
  [ -f "$OUTDIR/C1500/delta_pct.txt" ] && echo "c1500_delta_pct=$(cat "$OUTDIR/C1500/delta_pct.txt")"
  echo "bin_sha256=$BIN_SHA256"
  echo "ended=$(ts)"
} | tee "$OUTDIR/VERDICT.txt" | tee -a "$MASTER"

stop_flight
kill_bmoe
echo "DONE $(ts) verdict=$VERDICT c1000=$C1000_STATUS rc=$FINAL_RC" > "$STATUS"
log "=== CACHE_DOWN NOTTE9 END verdict=$VERDICT c1000=$C1000_STATUS rc=$FINAL_RC ==="
exit "$FINAL_RC"
