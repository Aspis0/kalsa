#!/data/data/com.termux/files/usr/bin/bash
# run_speed_dropcold_065.sh — gate SOSTITUZIONE F=0.65 vs default 0.50 (non-regressione)
# Disegno A/B dichiarato PRIMA dei numeri (mandates/speed-dropcold-065.md):
#   A = --drop-cold-experts 0.50  (default campagna attuale)
#   B = --drop-cold-experts 0.65  (override esplicito, candidato sostituzione)
# Celle: 2 prompt (short + f45_1) × 2 rep × 2 bracci, n=200
# Ordine ABBA per prompt (A,B,B,A). Fadvise cold PRIMA DI OGNI run.
# Smoke KV con B (atteso n_past t1=71). Opzionale sostenuto n=512 se batt≥38%.
# Gate NON-REGRESSIONE: mediana decode B ≥ A − 2% → SOSTITUZIONE RACCOMANDATA.
# Banda attesa B: MiB/tok ≈ 28.6±10%, hit ≈ 82.4, drop ≈ 6.1%.
# Floor batteria 30% = fine sessione. Solo bmoe-cli.CAMPAIGN (pin). NESSUN rebuild.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/dropcold/speed065}"
mkdir -p "$OUTDIR"/{A,B,smoke_kv,sostenuto,prompts} "$TMPDIR"
MASTER="$OUTDIR/SPEED_DROPCOLD065.master.log"
PIDFILE="$OUTDIR/speed_dropcold065.pid"
STATUS="$OUTDIR/STATUS.txt"
FLIGHT_LOG="$OUTDIR/flight.log"
FLIGHT_PIDF="$OUTDIR/flight.pid"
RUNS_CSV="${RUNS_CSV:-$HOME/experiments/results/runs.csv}"
CELL_CSV="$OUTDIR/runs.csv"
TAG_PHASE="SPEED-DROPCOLD-065"
DROP_F_A="0.50"
DROP_F_B="0.65"
DROP_F="$DROP_F_B"   # default for smoke/sostenuto = B
EXPECTED_DROP_PCT_B="6.1"
EXPECTED_HIT_B="82.4"
EXPECTED_MIB_B="28.6"
EXPECTED_MIB_TOL="0.10"  # ±10%
NCOMMON_EXPECTED=71

BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf}"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
PROMPTS_DIR="${PROMPTS_DIR:-$HOME/experiments/prompts}"
SMOKE_IN="${SMOKE_IN:-$HOME/experiments/results/adopt_dense2/smoke/gk1_in.jsonl}"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-1ca51420}"

THREADS=4
N_CTX=4096
IO_THREADS=4
N_GEN=200
UBATCH=512
CACHE_MB=2000
N_EXPERT=8
DIE_STOP_MC=98000
DIE_START_MC=80000
BATT_STOP=30
BATT_SOSTENUTO_MIN=38
N_SOSTENUTO=512

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
      case "$cmd" in *run_speed_dropcold*|*run_cache_down*|*run_staccato*|*speed_dropcold065*) ;; *)
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
  termux-notification --id speed_dropcold065 --title "SPEED_DROPCOLD065 nproc" \
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
      sha=$(sha256sum "$f" | awk '{print $1}')
      bytes=$(wc -c < "$f" | tr -d ' ')
      echo "${name},${sha},${bytes}"
    done
  } > "$OUTDIR/prompt_sha256.txt"
  log "prompt sha archived"
  cat "$OUTDIR/prompt_sha256.txt" | tee -a "$MASTER"
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
  # args: label prompt_file prompt_id n_gen arm(A|B) run_type notes_extra out_prefix
  local label="$1" pfile="$2" pid="$3" ngen="$4" arm="$5" rtype="$6" notesx="$7" opfx="$8"
  local slog="${opfx}.stdout.log"
  local serr="${opfx}.stderr.log"
  local samp="${opfx}.sampler.csv"
  local sumf="${opfx}.summary.txt"
  : > "$slog"; : > "$serr"
  echo "ts_epoch_ms,die_c,vmrss_kb,vmhwm_kb,memfree_kb" > "$samp"

  log "---- single $label arm=$arm n=$ngen ----"
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

  local ptext
  ptext=$(cat "$pfile")
  local FLAGS=(
    -m "$MODEL" -p "$ptext" -t "$THREADS" -c "$N_CTX" -n "$ngen"
    --temp 0 --chatml --no-think --moe-stream
    --cache-mb "$CACHE_MB" --dense-weights anon --overlap
    --io-threads "$IO_THREADS" --ubatch "$UBATCH"
    --n-expert-used "$N_EXPERT"
  )
  if [ "$arm" = "A" ]; then
    FLAGS+=(--drop-cold-experts "$DROP_F_A")
  else
    FLAGS+=(--drop-cold-experts "$DROP_F_B")
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
  local mib_tok="" drop_pct="" drop_n="" drop_tot="" read_mib=""
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
  hit=$(printf '%s\n' "$_combo" | grep -E 'moe-cache:.*hit' | tail -1 | sed -n 's/.*moe-cache: *\([0-9.]*\)% hit.*/\1/p' | head -1)
  n_prompt=$(printf '%s\n' "$_combo" | grep -E 'prefill: *[0-9]+ tokens' | tail -1 | sed -n 's/.*prefill: *\([0-9]*\) tokens.*/\1/p' | head -1)
  mib_tok=$(printf '%s\n' "$_combo" | grep -E 'MiB/token' | tail -1 | sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p' | head -1)
  read_mib=$(printf '%s\n' "$_combo" | grep -E 'moe-stream: read' | tail -1 | sed -n 's/.*read \([0-9.]*\) MiB.*/\1/p' | head -1)
  drop_n=$(printf '%s\n' "$_combo" | grep -E 'moe-drop:' | tail -1 | sed -n 's/.*moe-drop: *\([0-9]*\)\/.*/\1/p' | head -1)
  drop_tot=$(printf '%s\n' "$_combo" | grep -E 'moe-drop:' | tail -1 | sed -n 's/.*moe-drop: *[0-9]*\/\([0-9]*\).*/\1/p' | head -1)
  drop_pct=$(printf '%s\n' "$_combo" | grep -E 'moe-drop:' | tail -1 | sed -n 's/.*(\([0-9.]*\)%).*/\1/p' | head -1)
  if [ -z "$drop_pct" ]; then drop_pct="0"; fi
  if [ -z "$drop_n" ]; then drop_n="0"; fi

  local memfree_min_kb vmhwm_max_kb die_max_c
  memfree_min_kb=$(awk -F, 'NR>1{if(m==""||$5+0<m)m=$5+0} END{print m+0}' "$samp")
  vmhwm_max_kb=$(awk -F, 'NR>1{if($4+0>m)m=$4+0} END{print m+0}' "$samp")
  die_max_c=$(awk -F, 'NR>1{if($2+0>m)m=$2+0} END{printf "%.1f", m+0}' "$samp")
  local memfree_min_mb vmrss_peak_mb
  memfree_min_mb=$(python3 -c "print(int($memfree_min_kb/1024))")
  vmrss_peak_mb=$(python3 -c "print(int($vmhwm_max_kb/1024))")

  {
    echo "label=$label"
    echo "arm=$arm"
    echo "rc=$brc"
    echo "wall_s=$elapsed"
    echo "prompt_tok_s=$prompt_tok_s"
    echo "eval_tok_s=$eval_tok_s"
    echo "prefill_s=$prefill_s_val"
    echo "ttft_ms=$ttft_ms"
    echo "n_prompt=$n_prompt"
    echo "expert_hit_rate=$hit"
    echo "mib_per_token=$mib_tok"
    echo "read_mib=$read_mib"
    echo "drop_n=$drop_n"
    echo "drop_tot=$drop_tot"
    echo "drop_pct=$drop_pct"
    echo "memfree_min_mb=$memfree_min_mb"
    echo "vmhwm_mb=$vmrss_peak_mb"
    echo "die_max_c=$die_max_c"
    echo "lmkd_delta=$lmkd_d"
    echo "batt_s=$batt_s batt_e=$batt_e"
    echo "die_s=$die_s die_e=$die_e"
    echo "bin_sha256=$BIN_SHA256"
  } > "$sumf"
  cat "$sumf" | tee -a "$MASTER"
  log "single $label DONE eval=${eval_tok_s} prefill=${prompt_tok_s} hit=${hit}% drop=${drop_pct}% mib/tok=${mib_tok} die_max=${die_max_c} memfree_min=${memfree_min_mb} wall=${elapsed}s rc=$brc"

  local run_id flags_s
  run_id="speed-dropcold-${label}-$(date +%Y%m%d-%H%M%S)"
  flags_s="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads 4 --ubatch ${UBATCH} --n-expert-used ${N_EXPERT}"
  if [ "$arm" = "A" ]; then flags_s="$flags_s --drop-cold-experts ${DROP_F_A}"; else flags_s="$flags_s --drop-cold-experts ${DROP_F_B}"; fi
  append_run "${run_id},$(date -Iseconds),${TAG_PHASE},${MODEL##*/},UD-IQ2_M,11.52,bigmoe,${RUNTIME_COMMIT},${flags_s//,/;},4,4096,f16,${ngen},${rtype},${pid},${prompt_tok_s},${eval_tok_s},${ttft_ms},,,,${vmrss_peak_mb},${memfree_min_mb},${btemp_s},${btemp_e},${batt_s},${hit}%,${nproc_s},,bin_sha256=${BIN_SHA256};arm=${arm};drop_pct=${drop_pct};mib_tok=${mib_tok};die_max=${die_max_c};lmkd_delta=${lmkd_d};wall_s=${elapsed};n_prompt=${n_prompt};${notesx}"

  # cell csv: label,arm,prompt,n_gen,eval,prefill,hit,mib_tok,drop_pct,memfree_min,vmhwm,die_max,lmkd,batt_s,batt_e,die_s,die_e,wall,rc,bin_sha
  echo "${label},${arm},${pid},${ngen},${eval_tok_s},${prompt_tok_s},${hit},${mib_tok},${drop_pct},${memfree_min_mb},${vmrss_peak_mb},${die_max_c},${lmkd_d},${batt_s},${batt_e},${die_s},${die_e},${elapsed},${brc},${BIN_SHA256}" >> "$CELL_CSV"

  if [ $brc -ne 0 ]; then
    log "WARN $label rc=$brc"
  fi
  if [ "$brc" = "96" ] || [ "$brc" = "97" ] || [ "$brc" = "99" ]; then
    return "$brc"
  fi
  return 0
}

# ABBA schedule per prompt: A,B,B,A with labels arm-prompt-seq
# short:  A-short-1, B-short-1, B-short-2, A-short-2
# f45_1:  A-f45_1-1, B-f45_1-1, B-f45_1-2, A-f45_1-2
run_abba_cells() {
  log "==== ABBA CELLS START ===="
  # schedule: arm,prompt_key,seq
  local schedule=(
    "A short 1"
    "B short 1"
    "B short 2"
    "A short 2"
    "A f45_1 1"
    "B f45_1 1"
    "B f45_1 2"
    "A f45_1 2"
  )
  local entry arm pkey seq pfile pid label opfx adir
  for entry in "${schedule[@]}"; do
    # shellcheck disable=SC2086
    set -- $entry
    arm="$1"; pkey="$2"; seq="$3"
    if [ "$pkey" = "short" ]; then
      pfile="$PROMPTS_DIR/short.txt"
      pid="short"
    else
      pfile="$PROMPTS_DIR/f45_1_esplicativo.txt"
      pid="f45_1_esplicativo"
    fi
    adir="$OUTDIR/$arm"
    mkdir -p "$adir"
    label="${arm}-${pkey}-r${seq}"
    opfx="$adir/${label}"
    if [ -f "${opfx}.summary.txt" ]; then
      log "skip existing ${opfx}.summary.txt"
      continue
    fi
    if [ -f "${opfx}.stdout.log" ] || [ -f "${opfx}.pid" ]; then
      local bak="${opfx}.partial.$(date +%Y%m%d%H%M%S)"
      log "archive partial → $bak"
      for ext in pid sampler.csv stderr.log stdout.log summary.txt KILL.txt; do
        [ -f "${opfx}.${ext}" ] && mv "${opfx}.${ext}" "${bak}.${ext}" 2>/dev/null || true
      done
    fi
    preflight_cella "$label" || return $?
    # cool if hot
    local die_mc
    die_mc=$(max_die_mc)
    if [ "$die_mc" -gt 75000 ] 2>/dev/null; then
      log "cool before $label die=$(mc_to_c $die_mc)C"
      local t0 now
      t0=$(date +%s)
      while [ "$(max_die_mc)" -gt 70000 ] 2>/dev/null; do
        now=$(date +%s)
        [ $((now-t0)) -ge 600 ] && break
        safety_hard || return $?
        sleep 10
      done
    fi
    # FADVISE COLD before EVERY run (cache-dependent drop)
    log "cold_model before $label"
    kill_bmoe
    if ! "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1; then
      log "FATAL cold_model $label"; return 2
    fi
    local _f="${DROP_F_A}"; [ "$arm" = "B" ] && _f="${DROP_F_B}"; local notesx="speed_dropcold065;arm=${arm};F=${_f};seq=${seq};abba"
    if ! run_single "$label" "$pfile" "$pid" "$N_GEN" "$arm" "cold" "$notesx" "$opfx"; then
      local rc=$?
      log "run_single failed rc=$rc for $label"
      if [ "$rc" = "92" ] || [ "$rc" = "96" ] || [ "$rc" = "99" ] || [ "$rc" = "4" ] || [ "$rc" = "93" ]; then
        return "$rc"
      fi
      if [ "$rc" = "97" ]; then
        log "thermal pause handled — continue"
        continue
      fi
    fi
  done
  log "==== ABBA CELLS DONE ===="
  return 0
}

run_smoke_kv_drop() {
  local sdir="$OUTDIR/smoke_kv"
  mkdir -p "$sdir"
  log "==== SMOKE KV with --drop-cold-experts ${DROP_F} ===="
  preflight_cella "smoke_kv" || return $?
  log "cold_model before smoke_kv"
  kill_bmoe
  if ! "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1; then
    log "FATAL cold smoke_kv"; return 2
  fi
  if [ ! -f "$SMOKE_IN" ]; then
    log "FATAL smoke input missing: $SMOKE_IN"
    return 2
  fi
  set +e
  "$BIN" -m "$MODEL" -t 4 -c 2048 -n 32 --temp 0 --chatml --no-think \
    --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 \
    --n-expert-used 8 --drop-cold-experts "$DROP_F" --session \
    < "$SMOKE_IN" > "$sdir/smoke.stdout" 2> "$sdir/smoke.stderr"
  local rc=$?
  set -e
  log "smoke_kv rc=$rc"
  grep -E "n_common|n_prompt|n_past|BMOE_|prefill|turn|kv|moe-drop" "$sdir/smoke.stderr" 2>/dev/null | head -80 | tee -a "$MASTER" || true
  grep -E "n_common|n_prompt|n_past" "$sdir/smoke.stdout" 2>/dev/null | head -40 | tee -a "$MASTER" || true
  SMOKE_RC=$rc SDIR="$sdir" NCOMMON_EXPECTED=$NCOMMON_EXPECTED BIN_SHA256="$BIN_SHA256" DROP_F="$DROP_F" python3 - <<'PY'
import re, json, os
from pathlib import Path
sdir = Path(os.environ["SDIR"])
rc = int(os.environ["SMOKE_RC"])
expected = int(os.environ["NCOMMON_EXPECTED"])
err = (sdir/"smoke.stderr").read_text(encoding="utf-8", errors="replace")
out = (sdir/"smoke.stdout").read_text(encoding="utf-8", errors="replace")
text = err + "\n" + out
nc = [int(x) for x in re.findall(r"n_common[=: ]+(\d+)", text)]
np = [int(x) for x in re.findall(r'"n_prompt"\s*:\s*(\d+)', text)]
npast = [int(x) for x in re.findall(r'"n_past"\s*:\s*(\d+)', text)]
# Prefer BMOE_DONE JSON lines (authoritative)
done = re.findall(r'BMOE_DONE (\{.*?\})(?=\n|$)', text)
prompts=[]; pasts=[]
for d in done:
    try:
        obj = json.loads(d)
        if "n_prompt" in obj: prompts.append(int(obj["n_prompt"]))
        if "n_past" in obj: pasts.append(int(obj["n_past"]))
        if "n_common" in obj: nc.append(int(obj["n_common"]))
    except Exception:
        pass
if prompts: np = prompts
if pasts: npast = pasts
# binary may not emit n_common; t1 n_past == expected is the KV-prefix check
n_common_equiv = nc[0] if nc else (npast[0] if npast else None)
if n_common_equiv is not None and not nc:
    nc = [n_common_equiv]
verdict = "PASS" if (n_common_equiv == expected) else "FAIL"
meta = {
  "rc": rc,
  "n_common": nc,
  "n_prompt": np,
  "n_past": npast,
  "expected_n_common": expected,
  "verdict": verdict,
  "note": "n_common may be derived from t1 n_past on BMOE_DONE when field absent",
  "bin_sha256": os.environ["BIN_SHA256"],
  "drop_f": float(os.environ["DROP_F"]),
}
(sdir/"smoke_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
(sdir/"STATUS_SMOKE.txt").write_text(
    f"DONE {verdict} n_common={n_common_equiv} n_prompt={np} n_past={npast} expected={expected} rc={rc}\n",
    encoding="utf-8")
print(json.dumps(meta, indent=2))
if verdict != "PASS":
    raise SystemExit(71)
PY
  local smrc=$?
  cat "$sdir/STATUS_SMOKE.txt" | tee -a "$MASTER"
  if [ "$smrc" != "0" ]; then
    log "FATAL smoke KV n_common changed or missing — STOP"
    echo "SMOKE_KV_FAIL" > "$OUTDIR/STOP_REASON.txt"
    echo "STOP_SMOKE_KV $(ts)" > "$STATUS"
    return 71
  fi
  log "smoke_kv PASS n_common=$NCOMMON_EXPECTED"
  return 0
}

run_sostenuto() {
  local sdir="$OUTDIR/sostenuto"
  mkdir -p "$sdir"
  log "==== SOSTENUTO n=${N_SOSTENUTO} arm=B (optional) ===="
  read -r batt_now _ _ _ plugged_now <<<"$(batt_fields)"
  log "pre-sostenuto batt=$batt_now% plugged=$plugged_now (need ≥$BATT_SOSTENUTO_MIN)"
  if [ "$batt_now" -ge 0 ] 2>/dev/null && [ "$batt_now" -lt "$BATT_STOP" ] 2>/dev/null; then
    log "SKIPPED sostenuto: batt floor"
    echo "SKIPPED_BATT_FLOOR" > "$sdir/STATUS.txt"
    return 0
  fi
  if [ "$batt_now" -ge 0 ] 2>/dev/null && [ "$batt_now" -lt "$BATT_SOSTENUTO_MIN" ] 2>/dev/null; then
    log "SKIPPED sostenuto: batt=$batt_now < $BATT_SOSTENUTO_MIN"
    echo "SKIPPED_BATT_${batt_now}" > "$sdir/STATUS.txt"
    echo "SKIPPED sostenuto batt=$batt_now < $BATT_SOSTENUTO_MIN $(ts)" >> "$OUTDIR/SKIPPED.txt"
    return 0
  fi
  if [ "$plugged_now" != "UNPLUGGED" ]; then
    log "SKIPPED sostenuto: PLUGGED"
    echo "SKIPPED_PLUGGED" > "$sdir/STATUS.txt"
    return 0
  fi
  preflight_cella "sostenuto" || return $?
  log "cold_model before sostenuto"
  kill_bmoe
  if ! "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1; then
    log "FATAL cold sostenuto"; return 2
  fi
  local pfile="$PROMPTS_DIR/short.txt"
  local opfx="$sdir/B-short-n${N_SOSTENUTO}"
  local notesx="speed_dropcold065;arm=B;F=${DROP_F_B};sostenuto;n=${N_SOSTENUTO}"
  if ! run_single "B-short-n${N_SOSTENUTO}" "$pfile" "short" "$N_SOSTENUTO" "B" "cold" "$notesx" "$opfx"; then
    local rc=$?
    log "sostenuto failed rc=$rc"
    echo "FAILED_rc${rc}" > "$sdir/STATUS.txt"
    if [ "$rc" = "92" ] || [ "$rc" = "96" ] || [ "$rc" = "99" ] || [ "$rc" = "4" ] || [ "$rc" = "93" ]; then
      return "$rc"
    fi
  fi
  echo "DONE" > "$sdir/STATUS.txt"
  log "==== SOSTENUTO DONE ===="
  return 0
}

median4() {
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

compute_verdict() {
  log "==== COMPUTE VERDICT ===="
  OUTDIR="$OUTDIR" DROP_F_A="$DROP_F_A" DROP_F_B="$DROP_F_B" EXPECTED_DROP_PCT_B="$EXPECTED_DROP_PCT_B" EXPECTED_MIB_B="$EXPECTED_MIB_B" EXPECTED_MIB_TOL="$EXPECTED_MIB_TOL" EXPECTED_HIT_B="$EXPECTED_HIT_B" BIN_SHA256="$BIN_SHA256" python3 - <<'PY'
import json, os, statistics, re
from pathlib import Path

outdir = Path(os.environ["OUTDIR"])
drop_f_a = float(os.environ["DROP_F_A"])
drop_f_b = float(os.environ["DROP_F_B"])
exp_drop = float(os.environ["EXPECTED_DROP_PCT_B"])
exp_mib = float(os.environ["EXPECTED_MIB_B"])
exp_mib_tol = float(os.environ["EXPECTED_MIB_TOL"])
exp_hit = float(os.environ["EXPECTED_HIT_B"])
bin_sha = os.environ["BIN_SHA256"]

def load_sums(arm):
    rows = []
    adir = outdir / arm
    if not adir.exists():
        return rows
    for f in sorted(adir.glob("*.summary.txt")):
        d = {}
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                d[k.strip()] = v.strip()
        d["_file"] = f.name
        rows.append(d)
    return rows

A = load_sums("A")
B = load_sums("B")

def nums(rows, key):
    out = []
    for r in rows:
        v = r.get(key, "")
        if v in ("", None):
            continue
        try:
            out.append(float(str(v).replace("%", "")))
        except Exception:
            pass
    return out

def med(xs):
    if not xs:
        return None
    s = sorted(xs)
    n = len(s)
    if n % 2:
        return s[n // 2]
    return (s[n // 2 - 1] + s[n // 2]) / 2.0

a_eval = nums(A, "eval_tok_s")
b_eval = nums(B, "eval_tok_s")
a_pref = nums(A, "prompt_tok_s")
b_pref = nums(B, "prompt_tok_s")
a_hit = nums(A, "expert_hit_rate")
b_hit = nums(B, "expert_hit_rate")
a_mib = nums(A, "mib_per_token")
b_mib = nums(B, "mib_per_token")
b_drop = nums(B, "drop_pct")
a_lmkd = nums(A, "lmkd_delta")
b_lmkd = nums(B, "lmkd_delta")

med_a = med(a_eval)
med_b = med(b_eval)
delta_pct = None
if med_a is not None and med_b is not None and med_a != 0:
    delta_pct = 100.0 * (med_b - med_a) / med_a

# coherence: B MiB/tok ≈ 28.6 ±10% (primary), drop≈6.1, hit≈82.4 secondary
drop_med = med(b_drop)
mib_med_b = med(b_mib)
hit_med_b = med(b_hit)
coherent = True
coherent_reason = "ok"
mib_lo = exp_mib * (1.0 - exp_mib_tol)
mib_hi = exp_mib * (1.0 + exp_mib_tol)
if mib_med_b is None:
    coherent = False
    coherent_reason = "mib_per_token missing on B"
elif not (mib_lo <= mib_med_b <= mib_hi):
    coherent = False
    coherent_reason = f"mib_B={mib_med_b} outside {mib_lo:.2f}..{mib_hi:.2f} (knee 28.6±10%)"
elif drop_med is None:
    coherent = False
    coherent_reason = "drop_pct missing on B"
drop_band_ok = True
if drop_med is not None and (drop_med < 2.0 or drop_med > 12.0):
    drop_band_ok = False

lmkd_total = int(sum(a_lmkd) + sum(b_lmkd)) if (a_lmkd or b_lmkd) else 0

# per-prompt medians (critical: pooling can inflate Δ)
def prompt_key(label):
    m = re.match(r"^[AB]-(short|f45_1)", label or "")
    return m.group(1) if m else "other"

def by_prompt(rows, key):
    out = {"short": [], "f45_1": [], "other": []}
    for r in rows:
        lab = r.get("label", r.get("_file", ""))
        pk = prompt_key(lab)
        v = r.get(key, "")
        if v in ("", None):
            continue
        try:
            out[pk].append(float(str(v).replace("%", "")))
        except Exception:
            pass
    return {k: med(vs) for k, vs in out.items() if vs}

per_prompt_A = by_prompt(A, "eval_tok_s")
per_prompt_B = by_prompt(B, "eval_tok_s")
per_prompt_delta = {}
for pk in sorted(set(per_prompt_A) | set(per_prompt_B)):
    a = per_prompt_A.get(pk); b = per_prompt_B.get(pk)
    if a and b and a != 0:
        per_prompt_delta[pk] = 100.0 * (b - a) / a
    else:
        per_prompt_delta[pk] = None

# smoke
smoke_path = outdir / "smoke_kv" / "smoke_meta.json"
smoke = {}
if smoke_path.exists():
    smoke = json.loads(smoke_path.read_text(encoding="utf-8"))

# sostenuto
sost_status = "NOT_ATTEMPTED"
sost_sum = outdir / "sostenuto"
if (sost_sum / "STATUS.txt").exists():
    sost_status = (sost_sum / "STATUS.txt").read_text(encoding="utf-8").strip()
sost_rows = []
for f in sorted(sost_sum.glob("*.summary.txt")) if sost_sum.exists() else []:
    d = {}
    for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip()
    sost_rows.append(d)

# Gate NON-REGRESSIONE (mandato speed-dropcold-065):
# B ≥ A − 2% → SOSTITUZIONE_RACCOMANDATA
# B > A + 3% → SOSTITUZIONE_RACCOMANDATA_PLUS
# B < A − 2% → TIENE_0.50
# incoerenza banda MiB → STOP
if not coherent:
    verdict = "STOP_INCOHERENT_BANDA"
elif med_a is None or med_b is None or len(a_eval) < 4 or len(b_eval) < 4:
    verdict = "INCOMPLETE"
elif smoke and smoke.get("verdict") != "PASS":
    verdict = "STOP_SMOKE_KV"
elif delta_pct is not None and delta_pct >= -2.0:
    if delta_pct > 3.0:
        verdict = "SOSTITUZIONE_RACCOMANDATA_PLUS"
    else:
        verdict = "SOSTITUZIONE_RACCOMANDATA"
else:
    verdict = "TIENE_0.50"

meta = {
    "verdict": verdict,
    "med_eval_A": med_a,
    "med_eval_B": med_b,
    "delta_pct": delta_pct,
    "gate_threshold_pct": -2.0,
    "per_prompt_med_A": per_prompt_A,
    "per_prompt_med_B": per_prompt_B,
    "per_prompt_delta_pct": per_prompt_delta,
    "n_A": len(a_eval),
    "n_B": len(b_eval),
    "values_A": a_eval,
    "values_B": b_eval,
    "med_prefill_A": med(a_pref),
    "med_prefill_B": med(b_pref),
    "med_hit_A": med(a_hit),
    "med_hit_B": med(b_hit),
    "med_mib_A": med(a_mib),
    "med_mib_B": mib_med_b,
    "med_drop_A": med(nums(A, "drop_pct")),
    "med_drop_B": drop_med,
    "expected_drop_pct_B": exp_drop,
    "expected_mib_B": exp_mib,
    "expected_mib_band": [mib_lo, mib_hi],
    "expected_hit_B": exp_hit,
    "drop_band_ok": drop_band_ok,
    "coherent": coherent,
    "coherent_reason": coherent_reason,
    "lmkd_total": lmkd_total,
    "smoke": smoke,
    "sostenuto_status": sost_status,
    "sostenuto": sost_rows,
    "runs_A": A,
    "runs_B": B,
    "bin_sha256": bin_sha,
    "drop_f_A": drop_f_a,
    "drop_f_B": drop_f_b,
    "delta_ppl_quality_knee": 0.104,
}
(outdir / "verdict.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
(outdir / "VERDICT.txt").write_text(
    f"verdict={verdict}\nmed_A={med_a}\nmed_B={med_b}\ndelta_pct={delta_pct}\n"
    f"per_prompt_delta={per_prompt_delta}\nmib_B={mib_med_b}\ndrop_med_B={drop_med}\n"
    f"lmkd={lmkd_total}\ncoherent={coherent} ({coherent_reason})\n"
    f"smoke={smoke.get('verdict')}\nsostenuto={sost_status}\n",
    encoding="utf-8",
)
print(json.dumps({k: meta[k] for k in (
    "verdict","med_eval_A","med_eval_B","delta_pct","per_prompt_delta_pct",
    "med_mib_B","med_drop_B","coherent","coherent_reason",
    "lmkd_total","sostenuto_status","n_A","n_B"
)}, indent=2))
PY
  cat "$OUTDIR/VERDICT.txt" | tee -a "$MASTER"
}

# ═══════════════ MAIN ═══════════════
echo $$ > "$PIDFILE"
: > "$MASTER"
: > "$OUTDIR/runs_added.csv"
echo "label,arm,prompt_id,n_gen,eval_tok_s,prompt_tok_s,hit_pct,mib_per_token,drop_pct,memfree_min_mb,vmhwm_mb,die_max_c,lmkd_delta,batt_s,batt_e,die_s,die_e,wall_s,rc,bin_sha256" > "$CELL_CSV"

log "=== SPEED DROPCOLD-065 START bin=$BIN sha=$BIN_SHA256 A=F${DROP_F_A} B=F${DROP_F_B} ==="
log "OUTDIR=$OUTDIR design=ABBA cold_every_run n=$N_GEN cache=$CACHE_MB ubatch=$UBATCH k=$N_EXPERT"
timeout 5 termux-battery-status 2>/dev/null > "$OUTDIR/batt_start.json" || echo '{}' > "$OUTDIR/batt_start.json"
archive_prompts
start_flight
termux-wake-lock >/dev/null 2>&1 || true

FINAL_RC=0
PHASE="init"

# 1) ABBA cells first (main speed measure)
PHASE="abba"
if run_abba_cells; then
  log "ABBA cells completed"
else
  FINAL_RC=$?
  log "ABBA aborted rc=$FINAL_RC"
  echo "ABORTED_ABBA rc=$FINAL_RC $(ts)" > "$STATUS"
  timeout 5 termux-battery-status 2>/dev/null > "$OUTDIR/batt_end.json" || true
  compute_verdict || true
  stop_flight
  kill_bmoe
  exit "$FINAL_RC"
fi

# 2) Smoke KV with flag ON
PHASE="smoke_kv"
if run_smoke_kv_drop; then
  log "smoke_kv completed PASS"
else
  FINAL_RC=$?
  log "smoke_kv FAIL rc=$FINAL_RC — STOP per mandato"
  echo "STOP_SMOKE_KV rc=$FINAL_RC $(ts)" > "$STATUS"
  timeout 5 termux-battery-status 2>/dev/null > "$OUTDIR/batt_end.json" || true
  compute_verdict || true
  stop_flight
  kill_bmoe
  exit "$FINAL_RC"
fi

# 3) Optional sostenuto
PHASE="sostenuto"
if run_sostenuto; then
  log "sostenuto phase done"
else
  FINAL_RC=$?
  log "sostenuto aborted rc=$FINAL_RC"
fi

timeout 5 termux-battery-status 2>/dev/null > "$OUTDIR/batt_end.json" || echo '{}' > "$OUTDIR/batt_end.json"
compute_verdict
stop_flight
kill_bmoe
echo "DONE $(ts) $(cat "$OUTDIR/VERDICT.txt" | tr '\n' ' ') rc=$FINAL_RC" > "$STATUS"
log "=== SPEED DROPCOLD-065 END $(cat "$OUTDIR/VERDICT.txt" | tr '\n' '; ') rc=$FINAL_RC ==="
exit "$FINAL_RC"
