#!/usr/bin/env bash
# start_f4_9_b.sh — F4.9 cella B ONLY (real-workload), n_ctx=2048 (come long_512 storico)
# Conta solo righe con eval_tok_s non vuoto (i FAIL n_ctx=512 restano in CSV come FAIL).
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C
mkdir -p "$TMPDIR" \
  "$HOME/experiments/results/logs" \
  "$HOME/experiments/results/f4.9" \
  "$HOME/experiments/results/f4_state"

BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli}"
MODEL="${MODEL:-$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf}"
EXPECTED_SIZE="11522702304"
RUN_BENCH="${RUN_BENCH:-$HOME/experiments/scripts/run_bench.sh}"
CSV="${RUNS_CSV:-$HOME/experiments/results/runs.csv}"
OUTDIR="$HOME/experiments/results/f4.9"
MASTER_LOG="$OUTDIR/F4.9-B.master.log"
PIDFILE="$OUTDIR/f4_9_b.pid"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-b0c4e5b}"
FLAGS='--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4'
THREADS=4
N_CTX=2048
N_GEN=512
RUN_TIMEOUT_S="${RUN_TIMEOUT_S:-2700}"
COOLDOWN_S="${COOLDOWN_S:-180}"
MAX_START_TEMP="${MAX_START_TEMP:-32.0}"
# F4.9 steering gualt: gate termico 31.5 SOLO cella B (carico lungo). Cella A resta 30.0.
MAX_COOL_TEMP="${MAX_COOL_TEMP:-31.5}"
MAX_COOL_WAIT_S="${MAX_COOL_WAIT_S:-1800}"
PREFLIGHT_4B_MODEL="${PREFLIGHT_4B_MODEL:-$HOME/models/Qwen3.5-4B-Q4_K_M.gguf}"
PREFLIGHT_4B_TIMEOUT=30
LONG_PROMPT="${LONG_PROMPT:-$HOME/experiments/prompts/long_conversational_it.txt}"
SUMMARY_CSV="$OUTDIR/f4_9_summary.csv"
PHASE="F4.9-real-workload"
BATT_FLOOR=15
# need 2 measure + 1 sentinel valid
NEED_VALID=3

log() { printf '%s %s\n' "$(date -Iseconds 2>/dev/null || date)" "$*" | tee -a "$MASTER_LOG" >&2; }

if [ "${1:-}" = "--detach" ]; then
  shift
  echo "detaching start_f4_9_b (nohup setsid)"
  nohup setsid bash "$0" --run "$@" >"$MASTER_LOG" 2>&1 &
  echo $! >"$PIDFILE"
  echo "pid=$(cat "$PIDFILE") log=$MASTER_LOG"
  exit 0
fi
if [ "${1:-}" != "--run" ]; then
  echo "Uso: start_f4_9_b.sh --detach|--run"; exit 3
fi
shift || true

if ps -ef 2>/dev/null | grep -E 'run_f4\.sh|run_bench\.sh|llama-cli|bmoe-cli|start_f4_9' | grep -v grep | grep -v "$$" >/dev/null; then
  log "ERROR: residual campaign process present:"
  ps -ef 2>/dev/null | grep -E 'run_bench|bmoe-cli|start_f4_9' | grep -v grep || true
  exit 9
fi

SIZE="$(stat -c '%s' "$MODEL" 2>/dev/null || echo 0)"
[ "$SIZE" = "$EXPECTED_SIZE" ] || { log "ERROR: model size $SIZE"; exit 3; }
[ -x "$BIN" ] || { log "ERROR: binary $BIN"; exit 6; }
[ -f "$RUN_BENCH" ] || { log "ERROR: run_bench"; exit 3; }
[ -f "$LONG_PROMPT" ] || { log "ERROR: long prompt"; exit 3; }
[ -x "$COLD_MODEL_SH" ] || { log "ERROR: cold_model"; exit 3; }

export LD_LIBRARY_PATH="$(cd "$(dirname "$BIN")" && pwd):${LD_LIBRARY_PATH:-}"
_bindir="$(cd "$(dirname "$BIN")" && pwd)"
for _extra in "$_bindir" "$_bindir/.." "$_bindir/../bin" "$_bindir/bin"; do
  if [ -d "$_extra" ]; then
    _ea="$(cd "$_extra" && pwd)"
    case ":$LD_LIBRARY_PATH:" in *":$_ea:"*) ;; *) export LD_LIBRARY_PATH="$LD_LIBRARY_PATH:$_ea" ;; esac
  fi
done

echo $$ >"$PIDFILE"
{
  echo "=== F4.9-B start $(date -Iseconds 2>/dev/null || date) ==="
  echo "binary=$BIN LD=$LD_LIBRARY_PATH"
  echo "n_ctx=$N_CTX n_gen=$N_GEN flags=$FLAGS"
  echo "NOTE: n_ctx=2048 (historical long_512); FAIL rows with n_ctx=512 remain in CSV as FAIL"
  echo "pid=$$ nproc=$(nproc) affinity=$(taskset -p $$ 2>/dev/null || true)"
} | tee -a "$MASTER_LOG" >&2

termux-wake-lock 2>/dev/null || true
[ -f "$SUMMARY_CSV" ] || echo "ts,cell,phase,rep,run_type,battery_pct_start,battery_pct_end,temp_start,temp_end,eval_tok_s,nproc,affinity_mask,run_id,rc,notes" >"$SUMMARY_CSV"

read_batt() {
  _json="$(timeout 12 termux-battery-status 2>/dev/null || true)"
  _pl="$(printf '%s' "$_json" | sed -n 's/.*"plugged"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  _tr="$(printf '%s' "$_json" | sed -n 's/.*"temperature"[[:space:]]*:[[:space:]]*\([0-9.][0-9.]*\).*/\1/p' | head -n1)"
  _lv="$(printf '%s' "$_json" | sed -n 's/.*"percentage"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1)"
  _tc="$(awk -v t="${_tr:-}" 'BEGIN{ if(t==""){print"";exit} if(t+0>100) printf "%.1f",t/10.0; else printf "%.1f",t+0 }')"
  echo "${_pl:-} ${_tc:-} ${_lv:-}"
}

gate_cpuset() {
  local waited=0
  while true; do
    local np mask cg bits ok
    np="$(nproc 2>/dev/null || echo 0)"
    mask=""
    if command -v taskset >/dev/null 2>&1; then
      mask="$(taskset -p $$ 2>/dev/null | awk '{print $NF}' | tr 'A-F' 'a-f' | sed 's/^0x//')"
    fi
    cg="$(cat /proc/self/cgroup 2>/dev/null | awk -F: '/cpuset/{print $3; exit}')"
    bits=0
    if [ -n "$mask" ]; then
      bits="$(bash -c 'm="$1"; v=$((16#$m)); c=0; while [ $v -gt 0 ]; do c=$((c+(v&1))); v=$((v>>1)); done; echo $c' bash "$mask" 2>/dev/null || echo 0)"
    fi
    ok=1
    if [ -z "$np" ] || [ "$np" -lt 6 ] 2>/dev/null; then ok=0; fi
    case "$cg" in *background*|*system-background*|*moderate*) ok=0 ;; esac
    if [ -n "$mask" ] && [ "$bits" -lt 6 ] 2>/dev/null; then ok=0; fi
    if [ "$ok" -eq 1 ]; then
      log "cpuset OK nproc=$np mask=${mask:-?} bits=${bits:-?} cgroup=${cg:-?}"
      return 0
    fi
    log "WAIT/cpuset nproc=${np:-?} mask=${mask:-?} bits=${bits:-?} cgroup=${cg:-?} waited=${waited}s"
    sleep 30; waited=$((waited+30))
    if [ "$waited" -ge "$MAX_COOL_WAIT_S" ]; then
      log "BLOCKED/cpuset"; return 93
    fi
  done
}

gate_thermal_batt() {
  local floor="${1:-15}" waited=0
  while true; do
    # shellcheck disable=SC2046
    set -- $(read_batt)
    local pl="${1:-}" tc="${2:-}" lv="${3:-}"
    if [ -z "$pl" ] || [ -z "$tc" ]; then
      log "WAIT battery API empty waited=${waited}s"; sleep 30; waited=$((waited+30))
      [ "$waited" -ge "$MAX_COOL_WAIT_S" ] && { log "BLOCKED battery API"; return 91; }
      continue
    fi
    [ "$pl" = "UNPLUGGED" ] || { log "BLOCKED plugged=$pl"; return 4; }
    if [ -n "$lv" ]; then
      local low
      low="$(awk -v l="$lv" -v f="$floor" 'BEGIN{print (l+0 < f+0)?1:0}')"
      [ "$low" = "1" ] && { log "CHARGE_NEEDED ${lv}% < ${floor}%"; return 92; }
    fi
    local hot
    hot="$(awk -v t="$tc" -v m="$MAX_COOL_TEMP" 'BEGIN{print (t+0>m+0)?1:0}')"
    if [ "$hot" = "1" ]; then
      log "WAIT temp $tc > $MAX_COOL_TEMP lvl=${lv:-?} waited=${waited}s"
      sleep 30; waited=$((waited+30))
      [ "$waited" -ge "$MAX_COOL_WAIT_S" ] && { log "BLOCKED cool"; return 5; }
      continue
    fi
    hot="$(awk -v t="$tc" -v m="$MAX_START_TEMP" 'BEGIN{print (t+0>m+0)?1:0}')"
    if [ "$hot" = "1" ]; then
      log "WAIT temp $tc > $MAX_START_TEMP waited=${waited}s"
      sleep 30; waited=$((waited+30))
      [ "$waited" -ge "$MAX_COOL_WAIT_S" ] && { log "BLOCKED cool abs"; return 5; }
      continue
    fi
    log "gate OK plugged=$pl temp=$tc lvl=${lv:-?} floor=$floor"
    return 0
  done
}

preflight_4b() {
  local main_bin="${BINARY_MAINLINE:-$HOME/src/llama.cpp/build-safe2/bin/llama-cli}"
  if [ ! -f "$PREFLIGHT_4B_MODEL" ] || [ ! -x "$main_bin" ]; then
    log "WARN: 4B preflight skipped"; return 0
  fi
  log "=== preflight 4B ==="
  local saved_ld="$LD_LIBRARY_PATH"
  export LD_LIBRARY_PATH="$(cd "$(dirname "$main_bin")" && pwd):${saved_ld}"
  set +e
  timeout "$PREFLIGHT_4B_TIMEOUT" "$main_bin" \
    -m "$PREFLIGHT_4B_MODEL" \
    -p "You are a helpful assistant. Say hi in one sentence." \
    -n 4 -t 4 -c 512 -ctk q8_0 -ctv q8_0 --temp 0 \
    --load-mode mmap --no-display-prompt --no-conversation --single-turn --simple-io \
    < /dev/null >>"$MASTER_LOG" 2>&1
  local ec=$?
  set -e
  export LD_LIBRARY_PATH="$saved_ld"
  log "preflight 4B exit=$ec"
  "$BIN" --version 2>&1 | head -3 | tee -a "$MASTER_LOG" >&2 || return 6
  return 0
}

count_valid_phase() {
  # rows with phase match AND non-empty eval_tok_s
  if [ ! -f "$CSV" ]; then echo 0; return; fi
  awk -F, -v p="$PHASE" '
    NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
    $h["phase"]==p {
      v=$h["eval_tok_s"]
      if (v!="" && v+0==v) n++
    }
    END{print n+0}
  ' "$CSV"
}

last_valid_row() {
  awk -F, -v p="$PHASE" '
    NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
    $h["phase"]==p {
      v=$h["eval_tok_s"]
      if (v!="" && v+0==v) line=$0
    }
    END{print line}
  ' "$CSV" 2>/dev/null || true
}

# sampler every 500ms
sampler_loop() {
  local pid="$1" out="$2"
  echo "ts_ms,read_bytes,rchar,vmrss_kb,max_cpu_temp_mC,n_cpu_zones" >"$out"
  while kill -0 "$pid" 2>/dev/null; do
    local ts rb rc vr max_t ncz t typ
    ts="$(date +%s%3N 2>/dev/null || echo $(($(date +%s)*1000)))"
    rb=""; rc=""; vr=""; max_t=0; ncz=0
    if [ -r "/proc/$pid/io" ]; then
      rb="$(awk '/^read_bytes:/{print $2}' "/proc/$pid/io" 2>/dev/null || true)"
      rc="$(awk '/^rchar:/{print $2}' "/proc/$pid/io" 2>/dev/null || true)"
    fi
    if [ -r "/proc/$pid/status" ]; then
      vr="$(awk '/^VmRSS:/{print $2}' "/proc/$pid/status" 2>/dev/null || true)"
    fi
    for z in /sys/class/thermal/thermal_zone*; do
      [ -d "$z" ] || continue
      typ="$(cat "$z/type" 2>/dev/null || true)"
      case "$typ" in
        cpu-*|cpuss-*)
          t="$(cat "$z/temp" 2>/dev/null || echo 0)"
          ncz=$((ncz+1))
          if [ "${t:-0}" -gt "$max_t" ] 2>/dev/null; then max_t="$t"; fi
          ;;
      esac
    done
    echo "${ts},${rb:-},${rc:-},${vr:-},${max_t},${ncz}" >>"$out"
    sleep 0.5
  done
}

run_one() {
  local run_type="$1" rep_tag="$2" do_cold="$3"
  log "=== PREP $PHASE rep=$rep_tag rtype=$run_type cold=$do_cold n_ctx=$N_CTX ==="
  log "cooldown ${COOLDOWN_S}s"
  sleep "$COOLDOWN_S"
  gate_cpuset || return $?
  gate_thermal_batt "$BATT_FLOOR" || return $?

  # shellcheck disable=SC2046
  set -- $(read_batt)
  local batt_start_pl="${1:-}" batt_start_t="${2:-}" batt_start_pct="${3:-}"
  log "batt_start plugged=$batt_start_pl T=$batt_start_t pct=$batt_start_pct"

  if [ "$do_cold" = "1" ]; then
    log "cold_model fadv"
    set +e
    "$COLD_MODEL_SH" "$MODEL" >>"$MASTER_LOG" 2>&1
    local cec=$?
    set -e
    [ "$cec" -eq 0 ] || { log "BLOCKED cold_model $cec"; return 3; }
    log "cold_model OK"
  fi

  local np_now mask_now
  np_now="$(nproc 2>/dev/null || echo ?)"
  mask_now=""
  if command -v taskset >/dev/null 2>&1; then
    mask_now="$(taskset -p $$ 2>/dev/null | awk '{print $NF}' | tr 'A-F' 'a-f' | sed 's/^0x//')"
  fi
  local notes="${PHASE} rep=${rep_tag} rtype=${run_type} cool${COOLDOWN_S}s T<=${MAX_COOL_TEMP} t=${THREADS} n_ctx=${N_CTX} nproc=${np_now} mask=${mask_now:-\?} screen=on batt_start=${batt_start_pct:-?} UNPLUGGED fixed-gate-config n_ctx=2048-as-long_512"
  [ "$do_cold" = "1" ] && notes="${notes} cold=fadv"

  local sample_file="$OUTDIR/sample_${PHASE}_${rep_tag}_${run_type}.csv"
  local run_log="$OUTDIR/${PHASE}-${rep_tag}-${run_type}.runner.log"
  local sample_pid="" bpid=""

  log "=== RUN $PHASE rep=$rep_tag n_gen=$N_GEN n_ctx=$N_CTX sample=$sample_file ==="

  # launch run_bench in background so we can attach sampler to bmoe-cli
  set +e
  bash "$RUN_BENCH" \
    --binary "$BIN" \
    -m "$MODEL" \
    -p "$LONG_PROMPT" \
    --prompt-id long_conversational_it \
    --phase "$PHASE" \
    --runtime bigmoe \
    --runtime-commit "$RUNTIME_COMMIT" \
    --run-type "$run_type" \
    --threads "$THREADS" \
    --ctx "$N_CTX" \
    --kv-type q8_0 \
    --n-gen "$N_GEN" \
    --file-gb 11.52 \
    --quant UD-IQ2_M \
    --flags "$FLAGS" \
    --run-timeout "$RUN_TIMEOUT_S" \
    --csv "$CSV" \
    --notes "$notes" >>"$run_log" 2>&1 &
  local bench_pid=$!
  set -e

  # attach sampler: Android truncates comm, so match full path in args
  # poll up to ~180s (0.25s steps)
  local waited=0
  while [ "$waited" -lt 720 ]; do
    bpid="$(ps -A -o pid,args 2>/dev/null | awk '/build-bmoe\/cli\/bmoe-cli/ && !/awk/ && !/run_bench/ && !/bash / {print $1; exit}')"
    if [ -n "$bpid" ]; then
      log "sampler attach bmoe-cli pid=$bpid after ~$((waited/4))s"
      # write header then stream samples (sampler_loop also writes header — avoid double)
      : >"$sample_file"
      sampler_loop "$bpid" "$sample_file" &
      sample_pid=$!
      break
    fi
    if ! kill -0 "$bench_pid" 2>/dev/null; then
      log "WARN: run_bench exited before bmoe-cli seen"
      break
    fi
    sleep 0.25
    waited=$((waited+1))
  done

  set +e
  wait "$bench_pid"
  local rc=$?
  set -e
  log "=== END $PHASE rep=$rep_tag rc=$rc ==="

  if [ -n "$sample_pid" ]; then
    # give sampler one more cycle then stop
    sleep 1
    kill "$sample_pid" 2>/dev/null || true
    wait "$sample_pid" 2>/dev/null || true
  fi
  # if bmoe still alive (shouldn't), leave it — harness owns lifecycle

  # shellcheck disable=SC2046
  set -- $(read_batt)
  local batt_end_pl="${1:-}" batt_end_t="${2:-}" batt_end_pct="${3:-}"
  log "batt_end plugged=$batt_end_pl T=$batt_end_t pct=$batt_end_pct"

  local last run_id eval_s nproc_c mask_c
  last="$(last_valid_row)"
  # also grab absolute last phase row (may be FAIL)
  local last_any
  last_any="$(awk -F, -v p="$PHASE" 'NR==1{for(i=1;i<=NF;i++)h[$i]=i;next} $h["phase"]==p{line=$0} END{print line}' "$CSV")"
  run_id="$(printf '%s' "$last_any" | cut -d, -f1)"
  eval_s="$(printf '%s' "$last_any" | cut -d, -f17)"
  nproc_c="$(printf '%s' "$last_any" | cut -d, -f28)"
  mask_c="$(printf '%s' "$last_any" | cut -d, -f29)"

  echo "run_id=${run_id} phase=${PHASE} rep=${rep_tag} batt_start=${batt_start_pct} batt_end=${batt_end_pct} T_start=${batt_start_t} T_end=${batt_end_t} eval=${eval_s} rc=${rc} sample=${sample_file} n_ctx=${N_CTX}" \
    >>"$OUTDIR/batt_end_log.txt"
  echo "$(date -Iseconds 2>/dev/null || date),${PHASE},${PHASE},${rep_tag},${run_type},${batt_start_pct:-},${batt_end_pct:-},${batt_start_t:-},${batt_end_t:-},${eval_s:-},${nproc_c:-},${mask_c:-},${run_id:-},${rc},batt_start=${batt_start_pct} batt_end=${batt_end_pct} n_ctx=${N_CTX}" \
    >>"$SUMMARY_CSV"

  if [ "$rc" -eq 4 ] || [ "$rc" -eq 5 ] || [ "$rc" -eq 6 ] || [ "$rc" -eq 7 ] || [ "$rc" -eq 91 ] || [ "$rc" -eq 92 ] || [ "$rc" -eq 93 ]; then
    log "BLOCKED hard rc=$rc"; return "$rc"
  fi
  return 0
}

# ---- main ----
log "F4.9-B main begin"
gate_cpuset || exit 93
# shellcheck disable=SC2046
set -- $(read_batt)
log "battery now: plugged=$1 T=$2 pct=$3"
preflight_4b || { log "FATAL preflight 4B"; exit 10; }

valid="$(count_valid_phase)"
log "valid B rows so far: $valid (need $NEED_VALID); FAIL n_ctx=512 rows ignored for counting"

# rep plan: if 0 valid → cold+sample for first, then warm, then sentinel
# tags: 1, 2, sentinel — only run missing valid slots
# We track by valid count, not by tag (simpler, resilient)

if [ "$valid" -lt 1 ]; then
  run_one warm 1 1 || { ec=$?; log "B rep1 rc=$ec"; [ "$ec" -eq 92 ] || [ "$ec" -eq 93 ] || [ "$ec" -eq 4 ] && exit "$ec"; }
fi
valid="$(count_valid_phase)"
if [ "$valid" -lt 2 ]; then
  run_one warm 2 0 || { ec=$?; log "B rep2 rc=$ec"; [ "$ec" -eq 92 ] || [ "$ec" -eq 93 ] || [ "$ec" -eq 4 ] && exit "$ec"; }
fi
valid="$(count_valid_phase)"
if [ "$valid" -lt 3 ]; then
  run_one warm sentinel 0 || { ec=$?; log "B sentinel rc=$ec"; [ "$ec" -eq 92 ] || [ "$ec" -eq 93 ] || [ "$ec" -eq 4 ] && exit "$ec"; }
fi

valid="$(count_valid_phase)"
# shellcheck disable=SC2046
set -- $(read_batt)
log "CELL B DONE valid_rows=$valid final_batt plugged=$1 T=$2 pct=$3"
echo "DONE_B $(date -Iseconds 2>/dev/null || date) valid=$valid" >"$OUTDIR/DONE_B"
log "F4.9-B ALL DONE"
exit 0
