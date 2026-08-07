#!/usr/bin/env bash
# start_f4_compute.sh — F4.3 compute-attack block (thread sweep + n-expert-used probe)
# Detached via nohup/setsid. Survives ssh drop. LD_LIBRARY_PATH from binary dir.
# Does NOT run cache-mb sweep (already negative). Does NOT touch quant.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C
mkdir -p "$TMPDIR" "$HOME/experiments/results/logs" "$HOME/experiments/results/f4_state"

BINARY="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli}"
MODEL="$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf"
EXPECTED_SIZE="11522702304"
GRID="$HOME/experiments/scripts/run_f4.sh"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-b0c4e5b}"
STATE_DIR="$HOME/experiments/results/f4_state"
MASTER_LOG="$STATE_DIR/F4.3-compute.master.log"
PIDFILE="$STATE_DIR/f4_compute.pid"
PREFLIGHT_4B_MODEL="${PREFLIGHT_4B_MODEL:-$HOME/models/Qwen3.5-4B-Q4_K_M.gguf}"
PREFLIGHT_4B_TIMEOUT=30

log() {
  printf '%s %s\n' "$(date -Iseconds 2>/dev/null || date)" "$*" | tee -a "$MASTER_LOG" >&2
}

# --- residual process check (exact names, no broad pkill) ---
if ps -ef 2>/dev/null | grep -E 'run_f4\.sh|run_f3\.sh|run_f2_grid\.sh|run_bench\.sh|llama-cli|bmoe-cli|run_f2_thermal|start_f4_compute' | grep -v grep | grep -v "$$" >/dev/null; then
  log "ERROR: residual campaign process present:"
  ps -ef 2>/dev/null | grep -E 'run_f4\.sh|run_f3\.sh|run_f2_grid\.sh|run_bench\.sh|llama-cli|bmoe-cli|run_f2_thermal' | grep -v grep || true
  exit 9
fi

SIZE="$(stat -c '%s' "$MODEL" 2>/dev/null || stat -f '%z' "$MODEL" 2>/dev/null || echo 0)"
if [ "$SIZE" != "$EXPECTED_SIZE" ]; then
  log "ERROR: model size $SIZE != $EXPECTED_SIZE"
  exit 3
fi

if [ ! -x "$BINARY" ]; then
  for _c in \
    "$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli" \
    "$HOME/src/BigMoeOnEdge/build-bmoe/bin/bmoe-cli"
  do
    if [ -x "$_c" ]; then BINARY="$_c"; break; fi
  done
fi
if [ ! -x "$BINARY" ]; then
  log "ERROR: missing binary: $BINARY"
  exit 6
fi

export LD_LIBRARY_PATH="$(cd "$(dirname "$BINARY")" && pwd):${LD_LIBRARY_PATH:-}"
_bindir="$(cd "$(dirname "$BINARY")" && pwd)"
for _extra in "$_bindir" "$_bindir/.." "$_bindir/../bin" "$_bindir/bin"; do
  if [ -d "$_extra" ]; then
    _ea="$(cd "$_extra" && pwd)"
    case ":$LD_LIBRARY_PATH:" in *":$_ea:"*) ;; *) export LD_LIBRARY_PATH="$LD_LIBRARY_PATH:$_ea" ;; esac
  fi
done

if [ ! -f "$GRID" ]; then
  log "ERROR: run_f4.sh missing: $GRID"
  exit 3
fi

# Detach path: if --detach, re-exec under nohup/setsid and exit parent.
if [ "${1:-}" = "--detach" ]; then
  shift
  echo "detaching start_f4_compute (nohup setsid)"
  nohup setsid bash "$0" --run "$@" >"$MASTER_LOG" 2>&1 &
  echo $! >"$PIDFILE"
  echo "pid=$(cat "$PIDFILE") log=$MASTER_LOG"
  exit 0
fi

# Only --run continues as the worker.
if [ "${1:-}" != "--run" ]; then
  echo "Uso: start_f4_compute.sh --detach   # launch detached worker"
  echo "     start_f4_compute.sh --run      # foreground worker (internal)"
  exit 3
fi
shift || true

{
  echo "=== F4.3 compute-attack start $(date -Iseconds 2>/dev/null || date) ==="
  echo "binary=$BINARY"
  echo "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
  echo "runtime_commit=$RUNTIME_COMMIT"
  echo "model=$MODEL size=$SIZE"
  echo "pid=$$"
} | tee -a "$MASTER_LOG" >&2
echo $$ >"$PIDFILE"

# wake-lock + battery snapshot
termux-wake-lock 2>/dev/null || log "WARN: termux-wake-lock failed"
_bat="$(termux-battery-status 2>/dev/null || true)"
log "battery: $_bat"

# ISA preflight on bmoe build
PREFLIGHT="$HOME/experiments/scripts/preflight_llama_isa.sh"
_bdir=""
_bin_dir="$(cd "$(dirname "$BINARY")" && pwd -P)"
for _cand in "$_bin_dir/.." "$_bin_dir/../.." "$_bin_dir"; do
  if [ -f "$_cand/CMakeCache.txt" ]; then
    _bdir="$(cd "$_cand" && pwd -P)"
    break
  fi
done
if [ -n "$_bdir" ] && [ -f "$PREFLIGHT" ]; then
  log "=== preflight ISA ==="
  bash "$PREFLIGHT" --binary "$BINARY" --build-dir "$_bdir" || {
    log "ERROR: preflight ISA failed"
    exit 6
  }
else
  log "WARN: ISA preflight skipped (missing cache or script)"
fi

# 4B preflight (30s) — direct mainline smoke (run_bench floors run-timeout at 2700s)
_MAIN_BIN="${BINARY_MAINLINE:-$HOME/src/llama.cpp/build-safe2/bin/llama-cli}"
_PROMPT_TXT="You are a helpful assistant. Say hi in one sentence."
if [ -f "$HOME/experiments/prompts/short.txt" ]; then
  _PROMPT_TXT="$(head -c 400 "$HOME/experiments/prompts/short.txt" 2>/dev/null || echo "$_PROMPT_TXT")"
fi
if [ -f "$PREFLIGHT_4B_MODEL" ] && [ -x "$_MAIN_BIN" ]; then
  log "=== preflight 4B mainline (timeout ${PREFLIGHT_4B_TIMEOUT}s) binary=$_MAIN_BIN ==="
  _saved_ld="$LD_LIBRARY_PATH"
  export LD_LIBRARY_PATH="$(cd "$(dirname "$_MAIN_BIN")" && pwd):${_saved_ld}"
  set +e
  timeout "$PREFLIGHT_4B_TIMEOUT" "$_MAIN_BIN" \
    -m "$PREFLIGHT_4B_MODEL" \
    -p "$_PROMPT_TXT" \
    -n 4 -t 4 -c 512 -ctk q8_0 -ctv q8_0 --temp 0 \
    --load-mode mmap --no-display-prompt --no-conversation --single-turn --simple-io \
    < /dev/null >>"$MASTER_LOG" 2>&1
  _pf_ec=$?
  set -e
  export LD_LIBRARY_PATH="$_saved_ld"
  log "preflight 4B exit=$_pf_ec"
  # 0=ok, 124=timeout (acceptable if load slow), non-zero crash = fail
  if [ "$_pf_ec" -ne 0 ] && [ "$_pf_ec" -ne 124 ]; then
    # still check if generation happened before crash
    if ! grep -qE 'Generation:|eval time|tokens per second|Exiting' "$MASTER_LOG" 2>/dev/null; then
      log "ERROR: preflight 4B failed exit=$_pf_ec with no generation markers"
      exit 10
    fi
  fi
  log "=== smoke bmoe --version (LD of bmoe) ==="
  "$BINARY" --version 2>&1 | head -3 | tee -a "$MASTER_LOG" >&2 || {
    log "ERROR: bmoe --version failed"
    exit 6
  }
else
  log "WARN: 4B preflight skipped (model/mainline missing)"
fi

# Record CPU feature evidence once (compile-time + /proc)
{
  echo "=== i8mm / CPU feature evidence ==="
  echo "cpuinfo Features:"
  grep -m1 Features /proc/cpuinfo || true
  echo "CMakeCache:"
  grep -E 'GGML_NATIVE|GGML_CPU_ARM' "$_bdir/CMakeCache.txt" 2>/dev/null || true
  echo "compile -march sample:"
  grep -m1 'armv8.2-a+dotprod+i8mm+fp16' "$_bdir/compile_commands.json" 2>/dev/null | head -c 400 || true
  echo
  echo "taskset: $(command -v taskset || echo MISSING)"
  echo "cpu online: $(cat /sys/devices/system/cpu/online 2>/dev/null || echo ?)"
  for c in 0 1 2 3 4 5 6 7; do
    f=$(cat /sys/devices/system/cpu/cpu$c/cpufreq/cpuinfo_max_freq 2>/dev/null || echo ?)
    echo "cpu$c max_freq=$f"
  done
  echo "binary version:"
  "$BINARY" --version 2>&1 | head -5 || true
} | tee -a "$MASTER_LOG" >&2

# Cell plan:
# 1) Thread sweep: t4, t5, t6, t8 (warm; first cell cold=fadv once for protocol)
# 2) Optional pin: C3-t5-pin if taskset available (after seeing best of sweep — always run after t5)
# 3) n-expert-used LOSSY: k8, k6, k4 with best threads (default 5; override via BEST_THREADS file)
#
# Order chosen so first cell is cold, rest warm. ~7 cells × (3+1) × ~4 min ≈ 2h + cooldowns.

CELLS_THREAD=(C3-t4 C3-t5 C3-t6 C3-t8)
# pin only if taskset exists
if command -v taskset >/dev/null 2>&1; then
  CELLS_PIN=(C3-t5-pin)
else
  CELLS_PIN=()
  log "taskset not available — skipping C3-t5-pin"
fi
CELLS_K=(C3-k8 C3-k6 C3-k4)

FIRST=1
run_cell() {
  _cell="$1"
  _first_rt="$2"
  termux-wake-lock 2>/dev/null || true
  log "=== cell $_cell first=$_first_rt ==="
  set +e
  bash "$GRID" \
    --cell "$_cell" \
    --first-run-type "$_first_rt" \
    --reps 3 \
    --binary "$BINARY" \
    --runtime-commit "$RUNTIME_COMMIT" \
    --cold-method fadv \
    >>"$MASTER_LOG" 2>&1
  _ec=$?
  set -e
  log "cell $_cell exit=$_ec"
  if [ "$_ec" -eq 92 ]; then
    log "CHARGE_NEEDED — stop compute block"
    echo "CHARGE_NEEDED" >"$STATE_DIR/F4.3-compute.state"
    exit 92
  fi
  if [ "$_ec" -eq 4 ] || [ "$_ec" -eq 5 ] || [ "$_ec" -eq 6 ] || [ "$_ec" -eq 7 ] || [ "$_ec" -eq 90 ] || [ "$_ec" -eq 91 ]; then
    log "BLOCKED cell=$_cell exit=$_ec"
    echo "BLOCKED cell=$_cell exit=$_ec" >"$STATE_DIR/F4.3-compute.state"
    exit "$_ec"
  fi
  # continue on 1/8/9 (annotate, don't kill whole block)
}

for _c in "${CELLS_THREAD[@]}"; do
  if [ "$FIRST" -eq 1 ]; then
    run_cell "$_c" cold
    FIRST=0
  else
    run_cell "$_c" warm
  fi
done

for _c in "${CELLS_PIN[@]:-}"; do
  [ -n "$_c" ] || continue
  run_cell "$_c" warm
done

# Pick best threads from CSV for k-probe (median warm eval_tok_s among C3-t*)
BEST_T=5
CSV="$HOME/experiments/results/runs.csv"
if [ -f "$CSV" ]; then
  _pick="$(awk -F, '
    NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
    $h["phase"]=="F4.3" && $h["run_type"]=="warm" {
      n=$h["notes"]
      if (n !~ /C3-t[0-9]/ || n ~ /C3-t5-pin/ || n ~ /sentinel/) next
      if (n ~ /C3-t4/) t=4
      else if (n ~ /C3-t5/) t=5
      else if (n ~ /C3-t6/) t=6
      else if (n ~ /C3-t8/) t=8
      else next
      v=$h["eval_tok_s"]+0
      if (v<=0) next
      c[t]++; s[t]+=v
      if (!(t in mx) || v>mx[t]) mx[t]=v
      # collect for median later: store values
      k=t SUBSEP c[t]; a[k]=v
    }
    END {
      best_t=5; best_m=-1
      for (t in c) {
        n=c[t]; if(n==0) continue
        # simple mean as proxy (median of 3 ≈ middle; mean ok for pick)
        m=s[t]/n
        if (m>best_m) { best_m=m; best_t=t }
      }
      print best_t
    }
  ' "$CSV" 2>/dev/null || echo 5)"
  case "$_pick" in
    4|5|6|8) BEST_T="$_pick" ;;
  esac
fi
log "BEST_THREADS for k-probe = $BEST_T"
echo "$BEST_T" >"$STATE_DIR/F4.3-best-threads.txt"

# Export THREADS for k cells via env (run_f4 reads THREADS default; k cells bump 4→5,
# so pass --threads through a thin wrapper by setting env THREADS before each k cell).
for _c in "${CELLS_K[@]}"; do
  # Inject best threads: rewrite by running with THREADS override via env
  # run_f4 initializes THREADS=4 then k-cells force 5 if still 4; for other best, export.
  export THREADS_OVERRIDE="$BEST_T"
  # Patch: call run_f4 with --threads if supported
  termux-wake-lock 2>/dev/null || true
  log "=== cell $_c first=warm threads=$BEST_T (LOSSY) ==="
  set +e
  bash "$GRID" \
    --cell "$_c" \
    --first-run-type warm \
    --reps 3 \
    --binary "$BINARY" \
    --runtime-commit "$RUNTIME_COMMIT" \
    --cold-method fadv \
    --threads "$BEST_T" \
    >>"$MASTER_LOG" 2>&1
  _ec=$?
  set -e
  log "cell $_c exit=$_ec"
  if [ "$_ec" -eq 92 ]; then
    log "CHARGE_NEEDED — stop"
    echo "CHARGE_NEEDED" >"$STATE_DIR/F4.3-compute.state"
    exit 92
  fi
  if [ "$_ec" -eq 4 ] || [ "$_ec" -eq 5 ] || [ "$_ec" -eq 6 ] || [ "$_ec" -eq 7 ] || [ "$_ec" -eq 90 ] || [ "$_ec" -eq 91 ]; then
    log "BLOCKED cell=$_c exit=$_ec"
    echo "BLOCKED cell=$_c exit=$_ec" >"$STATE_DIR/F4.3-compute.state"
    exit "$_ec"
  fi
done

{
  echo "phase=F4.3-compute"
  echo "finished=$(date -Iseconds 2>/dev/null || date)"
  echo "best_threads=$BEST_T"
  echo "status=DONE"
} >"$STATE_DIR/F4.3-compute.state"
log "=== F4.3 compute-attack DONE best_threads=$BEST_T ==="
exit 0
