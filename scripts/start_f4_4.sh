#!/usr/bin/env bash
# start_f4_4.sh — F4.4 I/O attack: two cells max, battery-budgeted.
# Cella1 F4.4-io5 (t=3 io=5), Cella2 F4.4-cache3000 (fallback 2500 if lmkd).
# Stop if battery <= 42% before a cell. Detached via nohup/setsid.
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
MASTER_LOG="$STATE_DIR/F4.4.master.log"
PIDFILE="$STATE_DIR/f4_4.pid"
BATTERY_STOP=42
CELLS=(F4.4-io5 F4.4-cache3000)

log() {
  printf '%s %s\n' "$(date -Iseconds 2>/dev/null || date)" "$*" | tee -a "$MASTER_LOG" >&2
}

if [ "${1:-}" = "--detach" ]; then
  shift
  echo "detaching start_f4_4 (nohup setsid)"
  nohup setsid bash "$0" --run "$@" >"$MASTER_LOG" 2>&1 &
  echo $! >"$PIDFILE"
  echo "pid=$(cat "$PIDFILE") log=$MASTER_LOG"
  exit 0
fi
if [ "${1:-}" != "--run" ]; then
  echo "Uso: start_f4_4.sh --detach | --run"
  exit 3
fi
shift || true

# residual (exact names)
if ps -ef 2>/dev/null | grep -E 'run_f4\.sh|run_bench\.sh|bmoe-cli|start_f4_3bis|start_f4_4' | grep -v grep | grep -v "$$" >/dev/null; then
  log "ERROR: residual campaign process present"
  ps -ef 2>/dev/null | grep -E 'run_f4\.sh|run_bench\.sh|bmoe-cli|start_f4' | grep -v grep || true
  exit 9
fi

SIZE="$(stat -c '%s' "$MODEL" 2>/dev/null || stat -f '%z' "$MODEL" 2>/dev/null || echo 0)"
if [ "$SIZE" != "$EXPECTED_SIZE" ]; then
  log "ERROR: model size $SIZE != $EXPECTED_SIZE"
  exit 3
fi
if [ ! -x "$BINARY" ]; then
  for _c in "$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN" "$HOME/src/BigMoeOnEdge/build-bmoe/bin/bmoe-cli"; do
    if [ -x "$_c" ]; then BINARY="$_c"; break; fi
  done
fi
if [ ! -x "$BINARY" ]; then log "ERROR: missing binary"; exit 6; fi
if [ ! -f "$GRID" ]; then log "ERROR: run_f4 missing"; exit 3; fi

export LD_LIBRARY_PATH="$(cd "$(dirname "$BINARY")" && pwd):${LD_LIBRARY_PATH:-}"
_bindir="$(cd "$(dirname "$BINARY")" && pwd)"
for _extra in "$_bindir" "$_bindir/.." "$_bindir/../bin"; do
  if [ -d "$_extra" ]; then
    _ea="$(cd "$_extra" && pwd)"
    case ":$LD_LIBRARY_PATH:" in *":$_ea:"*) ;; *) export LD_LIBRARY_PATH="$LD_LIBRARY_PATH:$_ea" ;; esac
  fi
done

{
  echo "=== F4.4 start $(date -Iseconds 2>/dev/null || date) ==="
  echo "binary=$BINARY commit=$RUNTIME_COMMIT"
  echo "cells=${CELLS[*]}"
  echo "pid=$$"
  echo "nproc=$(nproc 2>/dev/null || echo ?)"
  echo "affinity=$(taskset -p $$ 2>/dev/null || echo ?)"
  echo "cgroup=$(cat /proc/self/cgroup 2>/dev/null | tr '\n' ' ' | head -c 400)"
} | tee -a "$MASTER_LOG" >&2
echo $$ >"$PIDFILE"
termux-wake-lock 2>/dev/null || log "WARN: wake-lock failed"

batt_pct() {
  _j="$(termux-battery-status 2>/dev/null || true)"
  printf '%s' "$_j" | sed -n 's/.*"percentage"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1
}

# early cpuset gate
_np="$(nproc 2>/dev/null || echo 0)"
_mask="$(taskset -p $$ 2>/dev/null | awk '{print $NF}' | tr A-F a-f | sed 's/^0x//')"
_cg="$(cat /proc/self/cgroup 2>/dev/null | awk -F: '/cpuset/{print $3; exit}')"
_bits=0
if [ -n "$_mask" ]; then
  _bits="$(bash -c 'm="$1"; v=$((16#$m)); c=0; while [ $v -gt 0 ]; do c=$((c+(v&1))); v=$((v>>1)); done; echo $c' bash "$_mask" 2>/dev/null || echo 0)"
fi
_bad=0
if [ -z "$_np" ] || [ "$_np" -lt 6 ] 2>/dev/null; then _bad=1; fi
case "$_cg" in *background*|*system-background*|*moderate*) _bad=1 ;; esac
if [ -n "$_mask" ] && [ "$_bits" -lt 6 ] 2>/dev/null; then _bad=1; fi
if [ "$_bad" -eq 1 ]; then
  log "BLOCKED/cpuset early: nproc=$_np mask=$_mask bits=$_bits cgroup=$_cg"
  echo "BLOCKED cpuset" >"$STATE_DIR/F4.4.state"
  exit 93
fi
log "cpuset early OK nproc=$_np mask=$_mask bits=$_bits cgroup=$_cg"

_bat0="$(batt_pct)"
log "battery start pct=${_bat0:-?} stop_floor=$BATTERY_STOP"

count_tag() {
  _tag="$1"
  _csv="$HOME/experiments/results/runs.csv"
  if [ ! -f "$_csv" ]; then echo 0; return; fi
  awk -F, -v tag="$_tag" '
    NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
    $h["phase"]=="F4.4" && index($h["notes"], tag)>0 { n++ }
    END{print n+0}
  ' "$_csv"
}

run_cell() {
  _cell="$1"
  _first="${2:-warm}"
  termux-wake-lock 2>/dev/null || true
  _pct="$(batt_pct)"
  log "pre-cell $_cell battery=${_pct:-?}"
  if [ -n "$_pct" ] && [ "$_pct" -le "$BATTERY_STOP" ] 2>/dev/null; then
    log "BATTERY_STOP pct=$_pct <= $BATTERY_STOP — no more cells"
    echo "BATTERY_STOP pct=$_pct" >"$STATE_DIR/F4.4.state"
    return 92
  fi
  log "=== cell $_cell first=$_first reps=3+sentinel ==="
  set +e
  bash "$GRID" \
    --cell "$_cell" \
    --first-run-type "$_first" \
    --reps 3 \
    --binary "$BINARY" \
    --runtime-commit "$RUNTIME_COMMIT" \
    --cold-method fadv \
    >>"$MASTER_LOG" 2>&1
  _ec=$?
  set -e
  log "cell $_cell exit=$_ec"
  if [ "$_ec" -eq 92 ]; then
    echo "CHARGE_NEEDED" >"$STATE_DIR/F4.4.state"
    return 92
  fi
  if [ "$_ec" -eq 93 ]; then
    echo "BLOCKED cpuset" >"$STATE_DIR/F4.4.state"
    return 93
  fi
  if [ "$_ec" -eq 4 ] || [ "$_ec" -eq 5 ] || [ "$_ec" -eq 6 ] || [ "$_ec" -eq 7 ] || [ "$_ec" -eq 90 ] || [ "$_ec" -eq 91 ]; then
    echo "BLOCKED cell=$_cell exit=$_ec" >"$STATE_DIR/F4.4.state"
    return "$_ec"
  fi
  # exit 1 = possible lmkd: still record, caller may switch to cache2500
  return "$_ec"
}

FIRST=1
for _cell in "${CELLS[@]}"; do
  _have="$(count_tag "$_cell")"
  if [ "$_have" -ge 4 ]; then
    log "skip $_cell: already have $_have rows"
    FIRST=0
    continue
  fi
  if [ "$FIRST" -eq 1 ]; then
    _rt=cold
  else
    _rt=warm
  fi
  set +e
  run_cell "$_cell" "$_rt"
  _ec=$?
  set -e
  FIRST=0
  if [ "$_ec" -eq 92 ] || [ "$_ec" -eq 93 ]; then
    log "stop after $_cell ec=$_ec"
    exit "$_ec"
  fi
  if [ "$_ec" -eq 4 ] || [ "$_ec" -eq 5 ] || [ "$_ec" -eq 6 ] || [ "$_ec" -eq 7 ] || [ "$_ec" -eq 90 ] || [ "$_ec" -eq 91 ]; then
    exit "$_ec"
  fi
  # If cache3000 got lmkd/crash (exit 1) and no valid rows, try 2500 once
  if [ "$_cell" = "F4.4-cache3000" ] && [ "$_ec" -eq 1 ]; then
    _n3000="$(count_tag F4.4-cache3000)"
    if [ "$_n3000" -lt 1 ]; then
      log "cache3000 failed (likely lmkd) — fallback F4.4-cache2500"
      set +e
      run_cell F4.4-cache2500 warm
      _ec2=$?
      set -e
      if [ "$_ec2" -eq 92 ] || [ "$_ec2" -eq 93 ] || [ "$_ec2" -eq 4 ] || [ "$_ec2" -eq 5 ] || [ "$_ec2" -eq 6 ] || [ "$_ec2" -eq 7 ]; then
        exit "$_ec2"
      fi
    fi
  fi
done

_batf="$(batt_pct)"
{
  echo "phase=F4.4"
  echo "finished=$(date -Iseconds 2>/dev/null || date)"
  echo "status=DONE"
  echo "battery_end=${_batf:-?}"
  echo "nproc=$(nproc 2>/dev/null || echo ?)"
  echo "affinity=$(taskset -p $$ 2>/dev/null | awk '{print $NF}' || echo ?)"
} >"$STATE_DIR/F4.4.state"
log "=== F4.4 DONE battery_end=${_batf:-?} ==="
exit 0
