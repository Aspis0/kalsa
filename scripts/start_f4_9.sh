#!/usr/bin/env bash
# start_f4_9.sh — F4.9 REGIME VALIDO, SCOLLEGATO
# Cella A (PRIMA): F4.9-batt-control  — short, n_gen=64, 3rep+sent, batt>=90%
# Cella B (DOPO):  F4.9-real-workload — long_conversational_it, n_gen=512, 2rep+sent
# + campionamento /proc 500ms su B (io, VmRSS, max cpu-* thermal)
# Detached via nohup/setsid. SSH drop ≠ fail. LD_LIBRARY_PATH = dir binario.
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

BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"

# --- campaign binary pin (fix-bloccanti-audit §C) ---
_PIN_LIB=""
for _d in \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" \
  "$HOME/experiments/scripts" \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." 2>/dev/null && pwd)/scripts" \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." 2>/dev/null && pwd)/scripts"
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
  if [ "${ALLOW_UNPINNED:-0}" != "1" ]; then
    case "$BIN" in *.CAMPAIGN) ;; *)
      echo "ERRORE pin campagna: usare bmoe-cli.CAMPAIGN (got $BIN). ALLOW_UNPINNED=1 per override." >&2
      exit 6
    ;; esac
    if [ -z "$_exp" ] || [ "$_got" != "$_exp" ]; then
      echo "ERRORE pin campagna: sha mismatch got=$_got expected=$_exp ($_sha_file)" >&2
      exit 6
    fi
  fi
fi
export BIN_SHA256="${BIN_SHA256:-}"
# --- end pin ---

MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
EXPECTED_SIZE="11522702304"
RUN_BENCH="${RUN_BENCH:-$HOME/experiments/scripts/run_bench.sh}"
CSV="${RUNS_CSV:-$HOME/experiments/results/runs.csv}"
OUTDIR="$HOME/experiments/results/f4.9"
STATE_DIR="$HOME/experiments/results/f4_state"
MASTER_LOG="$OUTDIR/F4.9.master.log"
PIDFILE="$OUTDIR/f4_9.pid"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-b0c4e5b}"
FLAGS='--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4'
THREADS=4
N_CTX=512
RUN_TIMEOUT_S="${RUN_TIMEOUT_S:-2700}"
COOLDOWN_S="${COOLDOWN_S:-180}"
MAX_START_TEMP="${MAX_START_TEMP:-32.0}"
MAX_COOL_TEMP="${MAX_COOL_TEMP:-30.0}"
MAX_COOL_WAIT_S="${MAX_COOL_WAIT_S:-1800}"
PREFLIGHT_4B_MODEL="${PREFLIGHT_4B_MODEL:-$HOME/models/Qwen3.5-4B-Q4_K_M.gguf}"
PREFLIGHT_4B_TIMEOUT=30
SHORT_PROMPT="${SHORT_PROMPT:-$HOME/experiments/prompts/short.txt}"
LONG_PROMPT="${LONG_PROMPT:-$HOME/experiments/prompts/long_conversational_it.txt}"
SUMMARY_CSV="$OUTDIR/f4_9_summary.csv"
CELL_A_FLOOR=90
CELL_B_FLOOR=15

log() { printf '%s %s\n' "$(date -Iseconds 2>/dev/null || date)" "$*" | tee -a "$MASTER_LOG" >&2; }

if [ "${1:-}" = "--detach" ]; then
  shift
  echo "detaching start_f4_9 (nohup setsid)"
  nohup setsid bash "$0" --run "$@" >"$MASTER_LOG" 2>&1 &
  echo $! >"$PIDFILE"
  echo "pid=$(cat "$PIDFILE") log=$MASTER_LOG"
  exit 0
fi

if [ "${1:-}" != "--run" ]; then
  echo "Uso: start_f4_9.sh --detach"
  echo "     start_f4_9.sh --run"
  exit 3
fi
shift || true

# residual check — exact names only, no broad pkill
if ps -ef 2>/dev/null | grep -E 'run_f4\.sh|run_f3\.sh|run_f2_grid\.sh|run_bench\.sh|llama-cli|bmoe-cli|start_f4_9|start_f4_7|start_f4_5|start_f4_3bis|start_f4_compute' | grep -v grep | grep -v "$$" >/dev/null; then
  log "ERROR: residual campaign process present:"
  ps -ef 2>/dev/null | grep -E 'run_f4\.sh|run_f3\.sh|run_bench\.sh|llama-cli|bmoe-cli|start_f4' | grep -v grep || true
  exit 9
fi

SIZE="$(stat -c '%s' "$MODEL" 2>/dev/null || echo 0)"
if [ "$SIZE" != "$EXPECTED_SIZE" ]; then
  log "ERROR: model size $SIZE != $EXPECTED_SIZE"; exit 3
fi
if [ ! -x "$BIN" ]; then
  for _c in \
    "$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN" \
    "$HOME/src/BigMoeOnEdge/build-bmoe/bin/bmoe-cli"
  do
    [ -x "$_c" ] && BIN="$_c" && break
  done
fi
[ -x "$BIN" ] || { log "ERROR: binary missing $BIN"; exit 6; }
[ -f "$RUN_BENCH" ] || { log "ERROR: run_bench missing $RUN_BENCH"; exit 3; }
[ -f "$SHORT_PROMPT" ] || { log "ERROR: short prompt missing $SHORT_PROMPT"; exit 3; }
[ -f "$LONG_PROMPT" ] || { log "ERROR: long prompt missing $LONG_PROMPT"; exit 3; }
[ -x "$COLD_MODEL_SH" ] || { log "ERROR: cold_model.sh missing $COLD_MODEL_SH"; exit 3; }

# CRITICAL: LD_LIBRARY_PATH = binary dir (stub .so root cause)
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
  echo "=== F4.9 start $(date -Iseconds 2>/dev/null || date) ==="
  echo "binary=$BIN"
  echo "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
  echo "runtime_commit=$RUNTIME_COMMIT"
  echo "model=$MODEL size=$SIZE"
  echo "pid=$$"
  echo "nproc=$(nproc 2>/dev/null || echo ?)"
  echo "affinity=$(taskset -p $$ 2>/dev/null || echo ?)"
  echo "cgroup=$(cat /proc/self/cgroup 2>/dev/null | tr '\n' ' ' | head -c 400)"
  echo "flags=$FLAGS"
} | tee -a "$MASTER_LOG" >&2

termux-wake-lock 2>/dev/null || log "WARN: termux-wake-lock failed"

if [ ! -f "$SUMMARY_CSV" ]; then
  echo "ts,cell,phase,rep,run_type,battery_pct_start,battery_pct_end,temp_start,temp_end,eval_tok_s,nproc,affinity_mask,run_id,rc,notes" >"$SUMMARY_CSV"
fi

read_batt() {
  # stdout: plugged temp_c pct
  _json="$(timeout 12 termux-battery-status 2>/dev/null || true)"
  _pl="$(printf '%s' "$_json" | sed -n 's/.*"plugged"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  _tr="$(printf '%s' "$_json" | sed -n 's/.*"temperature"[[:space:]]*:[[:space:]]*\([0-9.][0-9.]*\).*/\1/p' | head -n1)"
  _lv="$(printf '%s' "$_json" | sed -n 's/.*"percentage"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1)"
  _tc="$(awk -v t="${_tr:-}" 'BEGIN{
    if (t=="") {print ""; exit}
    if (t+0>100) printf "%.1f", t/10.0; else printf "%.1f", t+0
  }')"
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
    log "WAIT/cpuset: nproc=${np:-?} mask=${mask:-?} bits=${bits:-?} cgroup=${cg:-?} waited=${waited}s"
    sleep 30
    waited=$((waited + 30))
    if [ "$waited" -ge "$MAX_COOL_WAIT_S" ]; then
      log "BLOCKED/cpuset: no recovery within ${MAX_COOL_WAIT_S}s — STOP (non misurare su <6 core)"
      return 93
    fi
  done
}

gate_thermal_batt() {
  # $1 = battery floor
  local floor="${1:-40}"
  local waited=0
  while true; do
    # shellcheck disable=SC2046
    set -- $(read_batt)
    local pl="${1:-}" tc="${2:-}" lv="${3:-}"
    if [ -z "$pl" ] || [ -z "$tc" ]; then
      log "WAIT: battery API empty waited=${waited}s"
      sleep 30; waited=$((waited+30))
      if [ "$waited" -ge "$MAX_COOL_WAIT_S" ]; then
        log "BLOCKED: battery API unavailable"; return 91
      fi
      continue
    fi
    if [ "$pl" != "UNPLUGGED" ]; then
      log "BLOCKED: plugged=$pl (need UNPLUGGED)"; return 4
    fi
    if [ -n "$lv" ]; then
      local low
      low="$(awk -v l="$lv" -v f="$floor" 'BEGIN{print (l+0 < f+0)?1:0}')"
      if [ "$low" = "1" ]; then
        log "CHARGE_NEEDED: battery ${lv}% < floor ${floor}% — STOP cell"
        return 92
      fi
    fi
    local hot
    hot="$(awk -v t="$tc" -v m="$MAX_COOL_TEMP" 'BEGIN{print (t+0>m+0)?1:0}')"
    if [ "$hot" = "1" ]; then
      log "WAIT: temp $tc > $MAX_COOL_TEMP lvl=${lv:-?} waited=${waited}s"
      sleep 30; waited=$((waited+30))
      if [ "$waited" -ge "$MAX_COOL_WAIT_S" ]; then
        log "BLOCKED: could not cool to ≤$MAX_COOL_TEMP (last=$tc)"; return 5
      fi
      continue
    fi
    # also enforce absolute start gate 32C (harness will re-check)
    hot="$(awk -v t="$tc" -v m="$MAX_START_TEMP" 'BEGIN{print (t+0>m+0)?1:0}')"
    if [ "$hot" = "1" ]; then
      log "WAIT: temp $tc > $MAX_START_TEMP abs waited=${waited}s"
      sleep 30; waited=$((waited+30))
      if [ "$waited" -ge "$MAX_COOL_WAIT_S" ]; then
        log "BLOCKED: could not cool to ≤$MAX_START_TEMP (last=$tc)"; return 5
      fi
      continue
    fi
    log "gate OK plugged=$pl temp=$tc lvl=${lv:-?} floor=$floor"
    return 0
  done
}

preflight_4b() {
  local main_bin="${BINARY_MAINLINE:-$HOME/src/llama.cpp/build-safe2/bin/llama-cli}"
  if [ ! -f "$PREFLIGHT_4B_MODEL" ] || [ ! -x "$main_bin" ]; then
    log "WARN: 4B preflight skipped (model/bin missing)"; return 0
  fi
  log "=== preflight 4B mainline (timeout ${PREFLIGHT_4B_TIMEOUT}s) ==="
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
  # restore bmoe binary still works
  "$BIN" --version 2>&1 | head -3 | tee -a "$MASTER_LOG" >&2 || {
    log "ERROR: bmoe --version failed after 4B preflight"; return 6
  }
  return 0
}

count_phase_rows() {
  local phase="$1"
  if [ ! -f "$CSV" ]; then echo 0; return; fi
  awk -F, -v p="$phase" '
    NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
    $h["phase"]==p { n++ }
    END{print n+0}
  ' "$CSV"
}

last_csv_row_phase() {
  local phase="$1"
  awk -F, -v p="$phase" '
    NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
    $h["phase"]==p { line=$0 }
    END{print line}
  ' "$CSV" 2>/dev/null || true
}

# sampler: every 500ms while pid alive — /proc/pid/io + status VmRSS + max cpu-* thermal
start_sampler() {
  local pid="$1"
  local out="$2"
  {
    echo "ts_ms,read_bytes,rchar,vmrss_kb,max_cpu_temp_mC,n_cpu_zones"
    while kill -0 "$pid" 2>/dev/null; do
      local ts rb rc vr max_t ncz
      ts="$(date +%s%3N 2>/dev/null || echo $(($(date +%s)*1000)))"
      rb=""; rc=""; vr=""
      if [ -r "/proc/$pid/io" ]; then
        rb="$(awk '/^read_bytes:/{print $2}' "/proc/$pid/io" 2>/dev/null || true)"
        rc="$(awk '/^rchar:/{print $2}' "/proc/$pid/io" 2>/dev/null || true)"
      fi
      if [ -r "/proc/$pid/status" ]; then
        vr="$(awk '/^VmRSS:/{print $2}' "/proc/$pid/status" 2>/dev/null || true)"
      fi
      max_t=0; ncz=0
      for z in /sys/class/thermal/thermal_zone*; do
        [ -d "$z" ] || continue
        local typ
        typ="$(cat "$z/type" 2>/dev/null || true)"
        case "$typ" in
          cpu-*|cpuss-*)
            local t
            t="$(cat "$z/temp" 2>/dev/null || echo 0)"
            ncz=$((ncz+1))
            if [ "${t:-0}" -gt "$max_t" ] 2>/dev/null; then max_t="$t"; fi
            ;;
        esac
      done
      echo "${ts},${rb:-},${rc:-},${vr:-},${max_t},${ncz}"
      sleep 0.5
    done
  } >"$out" 2>/dev/null &
  echo $!
}

run_one() {
  # args: phase prompt_file prompt_id n_gen run_type rep_tag batt_floor do_cold do_sample
  local phase="$1"
  local prompt_file="$2"
  local prompt_id="$3"
  local n_gen="$4"
  local run_type="$5"
  local rep_tag="$6"
  local batt_floor="$7"
  local do_cold="$8"
  local do_sample="$9"

  log "=== PREP $phase rep=$rep_tag rtype=$run_type floor=$batt_floor cold=$do_cold sample=$do_sample ==="

  log "cooldown ${COOLDOWN_S}s"
  sleep "$COOLDOWN_S"

  gate_cpuset || return $?
  gate_thermal_batt "$batt_floor" || return $?

  # shellcheck disable=SC2046
  set -- $(read_batt)
  local batt_start_pl="${1:-}" batt_start_t="${2:-}" batt_start_pct="${3:-}"
  log "batt_start plugged=$batt_start_pl T=$batt_start_t pct=$batt_start_pct"

  if [ "$do_cold" = "1" ]; then
    log "cold_model fadv: $COLD_MODEL_SH $MODEL"
    set +e
    "$COLD_MODEL_SH" "$MODEL" >>"$MASTER_LOG" 2>&1
    local cec=$?
    set -e
    if [ "$cec" -ne 0 ]; then
      log "BLOCKED: cold_model exit $cec"; return 3
    fi
    log "cold_model OK"
  fi

  local np_now mask_now
  np_now="$(nproc 2>/dev/null || echo ?)"
  mask_now=""
  if command -v taskset >/dev/null 2>&1; then
    mask_now="$(taskset -p $$ 2>/dev/null | awk '{print $NF}' | tr 'A-F' 'a-f' | sed 's/^0x//')"
  fi

  local notes="${phase} rep=${rep_tag} rtype=${run_type} cool${COOLDOWN_S}s T<=${MAX_COOL_TEMP} t=${THREADS} nproc=${np_now} mask=${mask_now:-\?} screen=on batt_start=${batt_start_pct:-?} UNPLUGGED fixed-gate-config"
  if [ "$do_cold" = "1" ]; then notes="${notes} cold=fadv"; fi

  local sample_pid="" sample_file=""
  local run_log="$OUTDIR/${phase}-${rep_tag}-${run_type}.runner.log"

  # For sampling: start run_bench in background? Better: launch bmoe via run_bench normally
  # and poll for bmoe-cli pid. Sampler attaches when pid appears.
  if [ "$do_sample" = "1" ]; then
    sample_file="$OUTDIR/sample_${phase}_${rep_tag}_${run_type}.csv"
    log "sampler target file=$sample_file"
    (
      # wait for bmoe-cli pid belonging to this user, attach sampler
      local waited=0 bpid=""
      while [ "$waited" -lt 120 ]; do
        bpid="$(pgrep -n -x bmoe-cli 2>/dev/null || true)"
        if [ -n "$bpid" ]; then
          log "sampler attach pid=$bpid after ${waited}s"
          start_sampler "$bpid" "$sample_file"
          exit 0
        fi
        sleep 0.5
        waited=$((waited+1)) # approx; 0.5s * 2 ≈ seconds if we count pairs, rough
      done
      log "WARN: sampler could not find bmoe-cli within ~60s"
    ) >>"$MASTER_LOG" 2>&1 &
    sample_pid=$!
  fi

  log "=== RUN $phase rep=$rep_tag n_gen=$n_gen ==="
  set +e
  bash "$RUN_BENCH" \
    --binary "$BIN" \
    -m "$MODEL" \
    -p "$prompt_file" \
    --prompt-id "$prompt_id" \
    --phase "$phase" \
    --runtime bigmoe \
    --runtime-commit "$RUNTIME_COMMIT" \
    --run-type "$run_type" \
    --threads "$THREADS" \
    --ctx "$N_CTX" \
    --kv-type q8_0 \
    --n-gen "$n_gen" \
    --file-gb 11.52 \
    --quant UD-IQ2_M \
    --flags "$FLAGS" \
    --run-timeout "$RUN_TIMEOUT_S" \
    --csv "$CSV" \
    --notes "$notes" >>"$run_log" 2>&1
  local rc=$?
  set -e
  log "=== END $phase rep=$rep_tag rc=$rc ==="

  if [ -n "$sample_pid" ]; then
    wait "$sample_pid" 2>/dev/null || true
  fi
  # ensure no leftover sampler
  pkill -f "sample_${phase}_${rep_tag}" 2>/dev/null || true

  # shellcheck disable=SC2046
  set -- $(read_batt)
  local batt_end_pl="${1:-}" batt_end_t="${2:-}" batt_end_pct="${3:-}"
  log "batt_end plugged=$batt_end_pl T=$batt_end_t pct=$batt_end_pct"

  # parse last CSV row
  local last run_id eval_s nproc_c mask_c batt_csv
  last="$(last_csv_row_phase "$phase")"
  run_id="$(printf '%s' "$last" | cut -d, -f1)"
  eval_s="$(printf '%s' "$last" | cut -d, -f17)"
  batt_csv="$(printf '%s' "$last" | cut -d, -f26)"
  nproc_c="$(printf '%s' "$last" | cut -d, -f28)"
  mask_c="$(printf '%s' "$last" | cut -d, -f29)"

  # append batt_end into a sidecar note file for the report
  echo "run_id=${run_id} phase=${phase} rep=${rep_tag} batt_start=${batt_start_pct} batt_end=${batt_end_pct} T_start=${batt_start_t} T_end=${batt_end_t} eval=${eval_s} rc=${rc} sample=${sample_file:-none}" \
    >>"$OUTDIR/batt_end_log.txt"

  echo "$(date -Iseconds 2>/dev/null || date),${phase},${phase},${rep_tag},${run_type},${batt_start_pct:-},${batt_end_pct:-},${batt_start_t:-},${batt_end_t:-},${eval_s:-},${nproc_c:-},${mask_c:-},${run_id:-},${rc},batt_start=${batt_start_pct} batt_end=${batt_end_pct}" \
    >>"$SUMMARY_CSV"

  # hard stop conditions
  if [ "$rc" -eq 4 ] || [ "$rc" -eq 5 ] || [ "$rc" -eq 6 ] || [ "$rc" -eq 7 ] || [ "$rc" -eq 91 ] || [ "$rc" -eq 92 ] || [ "$rc" -eq 93 ]; then
    log "BLOCKED hard rc=$rc — stop cell"
    return "$rc"
  fi
  # thermal reject from harness: discard, do not invent numbers
  if [ "$rc" -eq 5 ]; then
    log "thermal reject — rep discarded"
    return 5
  fi
  return 0
}

# ---------------- main sequence ----------------
log "F4.9 main begin"
gate_cpuset || { log "FATAL early cpuset"; exit 93; }
# shellcheck disable=SC2046
set -- $(read_batt)
log "battery now: plugged=$1 T=$2 pct=$3"

# preflight 4B once before block A
preflight_4b || { log "FATAL preflight 4B"; exit 10; }

# ========== CELL A: F4.9-batt-control ==========
# Config IDENTICA al gate: short.txt, n_gen 64, t=4, cache 2000, dense anon, overlap, io 4
# 3 rep + sentinella. first=cold (come gate), poi warm warm + sentinel.
# Battery >= 90% per tutte.
PHASE_A="F4.9-batt-control"
have_a="$(count_phase_rows "$PHASE_A")"
log "CELL A start have_rows=$have_a floor=$CELL_A_FLOOR"

if [ "$have_a" -lt 1 ]; then
  run_one "$PHASE_A" "$SHORT_PROMPT" short 64 cold 1 "$CELL_A_FLOOR" 1 0 || {
    ec=$?; log "CELL A rep1 FAIL rc=$ec"; if [ "$ec" -eq 92 ] || [ "$ec" -eq 93 ] || [ "$ec" -eq 4 ]; then exit "$ec"; fi
  }
else
  log "skip A rep1 (already have rows)"
fi

have_a="$(count_phase_rows "$PHASE_A")"
if [ "$have_a" -lt 2 ]; then
  run_one "$PHASE_A" "$SHORT_PROMPT" short 64 warm 2 "$CELL_A_FLOOR" 0 0 || {
    ec=$?; log "CELL A rep2 FAIL rc=$ec"; if [ "$ec" -eq 92 ] || [ "$ec" -eq 93 ] || [ "$ec" -eq 4 ]; then exit "$ec"; fi
  }
else
  log "skip A rep2"
fi

have_a="$(count_phase_rows "$PHASE_A")"
if [ "$have_a" -lt 3 ]; then
  run_one "$PHASE_A" "$SHORT_PROMPT" short 64 warm 3 "$CELL_A_FLOOR" 0 0 || {
    ec=$?; log "CELL A rep3 FAIL rc=$ec"; if [ "$ec" -eq 92 ] || [ "$ec" -eq 93 ] || [ "$ec" -eq 4 ]; then exit "$ec"; fi
  }
else
  log "skip A rep3"
fi

have_a="$(count_phase_rows "$PHASE_A")"
if [ "$have_a" -lt 4 ]; then
  run_one "$PHASE_A" "$SHORT_PROMPT" short 64 warm sentinel "$CELL_A_FLOOR" 0 0 || {
    ec=$?; log "CELL A sentinel FAIL rc=$ec"; if [ "$ec" -eq 92 ] || [ "$ec" -eq 93 ] || [ "$ec" -eq 4 ]; then exit "$ec"; fi
  }
else
  log "skip A sentinel"
fi

log "CELL A DONE rows=$(count_phase_rows "$PHASE_A")"
# shellcheck disable=SC2046
set -- $(read_batt)
log "post-A battery: plugged=$1 T=$2 pct=$3"

# preflight 4B again before block B
preflight_4b || log "WARN: preflight 4B before B failed (non-fatal if A worked)"

# ========== CELL B: F4.9-real-workload ==========
# long_conversational_it, n_gen 512, 2 rep + sentinella, sample 500ms
PHASE_B="F4.9-real-workload"
have_b="$(count_phase_rows "$PHASE_B")"
log "CELL B start have_rows=$have_b floor=$CELL_B_FLOOR"

if [ "$have_b" -lt 1 ]; then
  run_one "$PHASE_B" "$LONG_PROMPT" long_conversational_it 512 warm 1 "$CELL_B_FLOOR" 1 1 || {
    ec=$?; log "CELL B rep1 FAIL rc=$ec"; if [ "$ec" -eq 92 ] || [ "$ec" -eq 93 ] || [ "$ec" -eq 4 ]; then exit "$ec"; fi
  }
else
  log "skip B rep1"
fi

have_b="$(count_phase_rows "$PHASE_B")"
if [ "$have_b" -lt 2 ]; then
  run_one "$PHASE_B" "$LONG_PROMPT" long_conversational_it 512 warm 2 "$CELL_B_FLOOR" 0 1 || {
    ec=$?; log "CELL B rep2 FAIL rc=$ec"; if [ "$ec" -eq 92 ] || [ "$ec" -eq 93 ] || [ "$ec" -eq 4 ]; then exit "$ec"; fi
  }
else
  log "skip B rep2"
fi

have_b="$(count_phase_rows "$PHASE_B")"
if [ "$have_b" -lt 3 ]; then
  run_one "$PHASE_B" "$LONG_PROMPT" long_conversational_it 512 warm sentinel "$CELL_B_FLOOR" 0 1 || {
    ec=$?; log "CELL B sentinel FAIL rc=$ec"; if [ "$ec" -eq 92 ] || [ "$ec" -eq 93 ] || [ "$ec" -eq 4 ]; then exit "$ec"; fi
  }
else
  log "skip B sentinel"
fi

log "CELL B DONE rows=$(count_phase_rows "$PHASE_B")"
# shellcheck disable=SC2046
set -- $(read_batt)
log "FINAL battery: plugged=$1 T=$2 pct=$3"
log "F4.9 ALL DONE"
echo "DONE $(date -Iseconds 2>/dev/null || date)" >"$OUTDIR/DONE"
exit 0
