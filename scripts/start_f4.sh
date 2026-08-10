#!/usr/bin/env bash
# start_f4.sh — detach F4 cell on phone. Safe binary only. No broad pkill.
# Cold via ~/bin/cold_model.sh. SSH-only control.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
mkdir -p "$TMPDIR" "$HOME/experiments/results/logs" "$HOME/experiments/results/f4_state"

CELL="C"
FIRST_RUN_TYPE="cold"
REPS=3
NO_SENTINEL=0
COLD_METHOD="${COLD_METHOD:-fadv}"
BINARY="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
GRID="$HOME/experiments/scripts/run_f4.sh"
EXPECTED_SIZE="11522702304"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --cell) CELL="${2:-}"; shift 2 ;;
    --first-run-type) FIRST_RUN_TYPE="${2:-}"; shift 2 ;;
    --reps) REPS="${2:-}"; shift 2 ;;
    --no-sentinel) NO_SENTINEL=1; shift ;;
    --cold-method) COLD_METHOD="${2:-}"; shift 2 ;;
    --binary) BINARY="${2:-}"; shift 2 ;;
    --runtime-commit) RUNTIME_COMMIT="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Uso: start_f4.sh --cell C|C2-... [--first-run-type cold|warm] [--reps N] [--no-sentinel]"
      exit 0
      ;;
    *) echo "arg: $1" >&2; exit 3 ;;
  esac
done

case "$FIRST_RUN_TYPE" in cold|warm) ;; *) echo "ERROR: --first-run-type cold|warm" >&2; exit 3 ;; esac
case "$COLD_METHOD" in fadv|reboot) ;; *) echo "ERROR: --cold-method fadv|reboot" >&2; exit 3 ;; esac

SIZE="$(stat -c '%s' "$MODEL" 2>/dev/null || stat -f '%z' "$MODEL" 2>/dev/null || echo 0)"
if [ "$SIZE" != "$EXPECTED_SIZE" ]; then
  echo "ERROR: model size $SIZE != $EXPECTED_SIZE" >&2
  exit 3
fi

if ps -ef 2>/dev/null | grep -E 'run_f4\.sh|run_f3\.sh|run_f2_grid\.sh|run_bench\.sh|llama-cli|bmoe-cli|run_f2_thermal' | grep -v grep >/dev/null; then
  echo "ERROR: residual campaign process present; stop exact PIDs first:" >&2
  ps -ef 2>/dev/null | grep -E 'run_f4\.sh|run_f3\.sh|run_f2_grid\.sh|run_bench\.sh|llama-cli|bmoe-cli|run_f2_thermal' | grep -v grep || true
  exit 9
fi

if [ ! -x "$BINARY" ]; then
  for _c in \
    "$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN" \
    "$HOME/src/BigMoeOnEdge/build-bmoe/bin/bmoe-cli" \
    "$HOME/src/BigMoeOnEdge/build-termux/cli/bmoe-cli"
  do
    if [ -x "$_c" ]; then BINARY="$_c"; break; fi
  done
fi
if [ "$CELL" = "C2-dio-mainline" ]; then
  BINARY="${BINARY_MAINLINE:-$HOME/src/llama.cpp/build-safe2/bin/llama-cli}"
fi
if [ ! -x "$BINARY" ]; then
  echo "ERROR: missing binary: $BINARY" >&2
  exit 6
fi
export LD_LIBRARY_PATH="$(cd "$(dirname "$BINARY")" && pwd):${LD_LIBRARY_PATH:-}"
_bindir="$(cd "$(dirname "$BINARY")" && pwd)"
for _extra in "$_bindir" "$_bindir/.." "$_bindir/../bin"; do
  if [ -d "$_extra" ]; then
    _ea="$(cd "$_extra" && pwd)"
    case ":$LD_LIBRARY_PATH:" in *":$_ea:"*) ;; *) export LD_LIBRARY_PATH="$LD_LIBRARY_PATH:$_ea" ;; esac
  fi
done

echo "=== start_f4 cell=$CELL binary=$BINARY LD=$LD_LIBRARY_PATH ==="
"$BINARY" --version 2>&1 | head -5 || "$BINARY" --help 2>&1 | head -10 || true

PREFLIGHT="$HOME/experiments/scripts/preflight_llama_isa.sh"
_bdir=""
_bin_dir="$(cd "$(dirname "$BINARY")" && pwd -P)"
for _cand in "$_bin_dir/.." "$_bin_dir/../.." "$_bin_dir"; do
  if [ -f "$_cand/CMakeCache.txt" ]; then
    _bdir="$(cd "$_cand" && pwd -P)"
    break
  fi
done
if [ -z "$_bdir" ]; then
  echo "ERROR: no CMakeCache near binary — rebuild with build_bmoe_termux.sh BUILD_DIR=build-bmoe" >&2
  exit 6
fi
if [ -f "$PREFLIGHT" ]; then
  echo "=== preflight ISA ==="
  bash "$PREFLIGHT" --binary "$BINARY" --build-dir "$_bdir" || {
    echo "ERROR: preflight ISA failed" >&2
    exit 6
  }
else
  echo "ERROR: preflight_llama_isa.sh missing" >&2
  exit 6
fi
echo "=== smoke binary OK ==="

if [ -z "$RUNTIME_COMMIT" ]; then
  if [ -d "$HOME/src/BigMoeOnEdge/.git" ] || [ -f "$HOME/src/BigMoeOnEdge/.git" ]; then
    RUNTIME_COMMIT="$(git -C "$HOME/src/BigMoeOnEdge" rev-parse --short=7 HEAD 2>/dev/null || echo b0c4e5b)"
  else
    RUNTIME_COMMIT="b0c4e5b"
  fi
fi

if [ ! -f "$GRID" ]; then
  echo "ERROR: run_f4.sh missing: $GRID" >&2
  exit 3
fi

_args=(--cell "$CELL" --first-run-type "$FIRST_RUN_TYPE" --reps "$REPS" --binary "$BINARY" --runtime-commit "$RUNTIME_COMMIT" --cold-method "$COLD_METHOD")
if [ "$NO_SENTINEL" -eq 1 ]; then
  _args+=(--no-sentinel)
fi

LOG="$HOME/experiments/results/f4_state/start_${CELL}.console.txt"
PIDFILE="$HOME/experiments/results/f4_state/f4_${CELL}.pid"
echo "detaching: bash $GRID ${_args[*]}"
nohup bash "$GRID" "${_args[@]}" >"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo "pid=$(cat "$PIDFILE") log=$LOG"
echo "tail: tail -f $LOG"
