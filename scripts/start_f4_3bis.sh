#!/usr/bin/env bash
# start_f4_3bis.sh — F4.3-bis: baseline top-app + paired thread sweep t={3,4,5,6}
# Detached via nohup/setsid. Survives ssh drop. Does NOT open F5 / touch quant.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C
mkdir -p "$TMPDIR" "$HOME/experiments/results/logs" "$HOME/experiments/results/f4_state"

BINARY="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
EXPECTED_SIZE="11522702304"
GRID="$HOME/experiments/scripts/run_f4.sh"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-b0c4e5b}"
STATE_DIR="$HOME/experiments/results/f4_state"
MASTER_LOG="$STATE_DIR/F4.3-bis.master.log"
PIDFILE="$STATE_DIR/f4_3bis.pid"
PREFLIGHT_4B_MODEL="${PREFLIGHT_4B_MODEL:-$HOME/models/Qwen3.5-4B-Q4_K_M.gguf}"
PREFLIGHT_4B_TIMEOUT=30
# Paired design: 3 measure rounds interleaved, then per-t sentinel.
# Round r: t4, t5, t3, t6 (baseline first in each round).
PAIRED_ORDER=(C3bis-t4 C3bis-t5 C3bis-t3 C3bis-t6)
ROUNDS=3

log() {
  printf '%s %s\n' "$(date -Iseconds 2>/dev/null || date)" "$*" | tee -a "$MASTER_LOG" >&2
}

if ps -ef 2>/dev/null | grep -E 'run_f4\.sh|run_f3\.sh|run_f2_grid\.sh|run_bench\.sh|llama-cli|bmoe-cli|run_f2_thermal|start_f4_compute|start_f4_3bis' | grep -v grep | grep -v "$$" >/dev/null; then
  log "ERROR: residual campaign process present:"
  ps -ef 2>/dev/null | grep -E 'run_f4\.sh|run_f3\.sh|run_f2_grid\.sh|run_bench\.sh|llama-cli|bmoe-cli|run_f2_thermal|start_f4' | grep -v grep || true
  exit 9
fi

SIZE="$(stat -c '%s' "$MODEL" 2>/dev/null || stat -f '%z' "$MODEL" 2>/dev/null || echo 0)"
if [ "$SIZE" != "$EXPECTED_SIZE" ]; then
  log "ERROR: model size $SIZE != $EXPECTED_SIZE"
  exit 3
fi

if [ ! -x "$BINARY" ]; then
  for _c in \
    "$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN" \
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

if [ "${1:-}" = "--detach" ]; then
  shift
  echo "detaching start_f4_3bis (nohup setsid)"
  nohup setsid bash "$0" --run "$@" >"$MASTER_LOG" 2>&1 &
  echo $! >"$PIDFILE"
  echo "pid=$(cat "$PIDFILE") log=$MASTER_LOG"
  exit 0
fi

if [ "${1:-}" != "--run" ]; then
  echo "Uso: start_f4_3bis.sh --detach"
  echo "     start_f4_3bis.sh --run"
  exit 3
fi
shift || true

{
  echo "=== F4.3-bis start $(date -Iseconds 2>/dev/null || date) ==="
  echo "binary=$BINARY"
  echo "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
  echo "runtime_commit=$RUNTIME_COMMIT"
  echo "model=$MODEL size=$SIZE"
  echo "pid=$$"
  echo "nproc=$(nproc 2>/dev/null || echo ?)"
  echo "affinity=$(taskset -p $$ 2>/dev/null || echo ?)"
  echo "cgroup=$(cat /proc/self/cgroup 2>/dev/null | tr '\n' ' ' | head -c 400)"
} | tee -a "$MASTER_LOG" >&2
echo $$ >"$PIDFILE"

termux-wake-lock 2>/dev/null || log "WARN: termux-wake-lock failed"
_bat="$(termux-battery-status 2>/dev/null || true)"
log "battery: $_bat"

_np="$(nproc 2>/dev/null || echo 0)"
_mask="$(taskset -p $$ 2>/dev/null | awk '{print $NF}' | tr A-F a-f | sed 's/^0x//')"
_cg="$(cat /proc/self/cgroup 2>/dev/null | awk -F: '/cpuset/{print $3; exit}')"
_bits=0
if [ -n "$_mask" ]; then
  _bits="$(bash -c 'm="$1"; v=$((16#$m)); c=0; while [ $v -gt 0 ]; do c=$((c+(v&1))); v=$((v>>1)); done; echo $c' bash "$_mask" 2>/dev/null || echo 0)"
fi
_bad=0
if [ -z "$_np" ] || [ "$_np" -lt 6 ] 2>/dev/null; then _bad=1; fi
case "$_cg" in *background*|*system-background*) _bad=1 ;; esac
if [ -n "$_mask" ] && [ "$_bits" -lt 6 ] 2>/dev/null; then _bad=1; fi
if [ "$_bad" -eq 1 ]; then
  log "BLOCKED/cpuset early: nproc=$_np mask=$_mask bits=$_bits cgroup=$_cg"
  echo "BLOCKED cpuset nproc=$_np mask=$_mask" >"$STATE_DIR/F4.3-bis.state"
  exit 93
fi
log "cpuset early OK nproc=$_np mask=$_mask bits=$_bits cgroup=$_cg"

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
  log "WARN: ISA preflight skipped"
fi

_MAIN_BIN="${BINARY_MAINLINE:-$HOME/src/llama.cpp/build-safe2/bin/llama-cli}"
_PROMPT_TXT="You are a helpful assistant. Say hi in one sentence."
if [ -f "$HOME/experiments/prompts/short.txt" ]; then
  _PROMPT_TXT="$(head -c 400 "$HOME/experiments/prompts/short.txt" 2>/dev/null || echo "$_PROMPT_TXT")"
fi
if [ -f "$PREFLIGHT_4B_MODEL" ] && [ -x "$_MAIN_BIN" ]; then
  log "=== preflight 4B mainline (timeout ${PREFLIGHT_4B_TIMEOUT}s) ==="
  _saved_ld="$LD_LIBRARY_PATH"
  export LD_LIBRARY_PATH="$(cd "$(dirname "$_MAIN_BIN")" && pwd):${_saved_ld}"
  set +e
  timeout "$PREFLIGHT_4B_TIMEOUT" "$_MAIN_BIN" \
    -m "$PREFLIGHT_4B_MODEL" -p "$_PROMPT_TXT" \
    -n 4 -t 4 -c 512 -ctk q8_0 -ctv q8_0 --temp 0 \
    --load-mode mmap --no-display-prompt --no-conversation --single-turn --simple-io \
    < /dev/null >>"$MASTER_LOG" 2>&1
  _pf_ec=$?
  set -e
  export LD_LIBRARY_PATH="$_saved_ld"
  log "preflight 4B exit=$_pf_ec"
  if [ "$_pf_ec" -ne 0 ] && [ "$_pf_ec" -ne 124 ]; then
    if ! grep -qE 'Generation:|eval time|tokens per second|Exiting' "$MASTER_LOG" 2>/dev/null; then
      log "ERROR: preflight 4B failed exit=$_pf_ec"
      exit 10
    fi
  fi
  "$BINARY" --version 2>&1 | head -3 | tee -a "$MASTER_LOG" >&2 || {
    log "ERROR: bmoe --version failed"
    exit 6
  }
else
  log "WARN: 4B preflight skipped"
fi

{
  echo "=== i8mm / CPU feature evidence (F4.3-bis) ==="
  grep -m1 Features /proc/cpuinfo || true
  if [ -n "$_bdir" ]; then
    grep -E 'GGML_NATIVE|GGML_CPU_ARM' "$_bdir/CMakeCache.txt" 2>/dev/null || true
    grep -m1 'armv8.2-a+dotprod+i8mm+fp16' "$_bdir/compile_commands.json" 2>/dev/null | head -c 400 || true
  fi
  echo "cpu online: $(cat /sys/devices/system/cpu/online 2>/dev/null || echo ?)"
  for c in 0 1 2 3 4 5 6 7; do
    f=$(cat /sys/devices/system/cpu/cpu$c/cpufreq/cpuinfo_max_freq 2>/dev/null || echo ?)
    echo "cpu$c max_freq=$f"
  done
  echo "note: top-app typically excludes CPU 6-7 (prime/X3)"
} | tee -a "$MASTER_LOG" >&2

count_tag() {
  _tag="$1"
  _csv="$HOME/experiments/results/runs.csv"
  if [ ! -f "$_csv" ]; then echo 0; return; fi
  awk -F, -v tag="$_tag" '
    NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
    $h["phase"]=="F4.3-bis" && index($h["notes"], tag)>0 { n++ }
    END{print n+0}
  ' "$_csv"
}

run_one_rep() {
  _cell="$1"
  _first_rt="$2"
  _reps="${3:-1}"
  _no_sent="${4:-1}"
  termux-wake-lock 2>/dev/null || true
  log "=== cell $_cell first=$_first_rt reps=$_reps no_sentinel=$_no_sent ==="
  set +e
  _args=(--cell "$_cell" --first-run-type "$_first_rt" --reps "$_reps" --binary "$BINARY" --runtime-commit "$RUNTIME_COMMIT" --cold-method fadv)
  if [ "$_no_sent" -eq 1 ]; then
    _args+=(--no-sentinel)
  fi
  bash "$GRID" "${_args[@]}" >>"$MASTER_LOG" 2>&1
  _ec=$?
  set -e
  log "cell $_cell exit=$_ec"
  if [ "$_ec" -eq 92 ]; then
    log "CHARGE_NEEDED"
    echo "CHARGE_NEEDED" >"$STATE_DIR/F4.3-bis.state"
    exit 92
  fi
  if [ "$_ec" -eq 93 ]; then
    log "BLOCKED/cpuset"
    echo "BLOCKED cpuset" >"$STATE_DIR/F4.3-bis.state"
    exit 93
  fi
  if [ "$_ec" -eq 4 ] || [ "$_ec" -eq 5 ] || [ "$_ec" -eq 6 ] || [ "$_ec" -eq 7 ] || [ "$_ec" -eq 90 ] || [ "$_ec" -eq 91 ]; then
    log "BLOCKED cell=$_cell exit=$_ec"
    echo "BLOCKED cell=$_cell exit=$_ec" >"$STATE_DIR/F4.3-bis.state"
    exit "$_ec"
  fi
  return 0
}

# 1) BASELINE C-topapp: 3 measure + sentinel; first cold=fadv
_have_base="$(count_tag C-topapp)"
if [ "$_have_base" -ge 4 ]; then
  log "skip baseline C-topapp: already have $_have_base rows"
else
  if [ "$_have_base" -eq 0 ]; then
    run_one_rep C-topapp cold 3 0
  else
    run_one_rep C-topapp warm 3 0
  fi
fi

# 2) PAIRED thread sweep: 3 rounds of t4,t5,t3,t6
# Pass --reps=$_round so run_f4 skip logic appends only the new rep
# (calling --reps 1 thrice would skip after the first row).
for _round in $(seq 1 "$ROUNDS"); do
  log "=== paired round $_round/$ROUNDS order=${PAIRED_ORDER[*]} ==="
  termux-wake-lock 2>/dev/null || true
  for _cell in "${PAIRED_ORDER[@]}"; do
    _have="$(count_tag "$_cell")"
    if [ "$_have" -ge "$_round" ]; then
      log "skip $_cell round $_round: have $_have"
      continue
    fi
    run_one_rep "$_cell" warm "$_round" 1
  done
done

# 3) Sentinel per t after all measures
for _cell in "${PAIRED_ORDER[@]}"; do
  _have="$(count_tag "$_cell")"
  if [ "$_have" -ge 4 ]; then
    log "skip sentinel $_cell: have $_have"
    continue
  fi
  run_one_rep "$_cell" warm 3 0
done

{
  echo "phase=F4.3-bis"
  echo "finished=$(date -Iseconds 2>/dev/null || date)"
  echo "status=DONE"
  echo "nproc=$(nproc 2>/dev/null || echo ?)"
  echo "affinity=$(taskset -p $$ 2>/dev/null | awk '{print $NF}' || echo ?)"
} >"$STATE_DIR/F4.3-bis.state"
log "=== F4.3-bis DONE ==="
exit 0
