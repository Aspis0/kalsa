#!/usr/bin/env bash
# Start compliant F2.2c grid (safe binary only). No broad pkill. No network.
# Declared start config: t=5 ctx=1024 kv=q8_0 (enforced inside run_f2_grid.sh).
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/src/llama.cpp/build-safe/bin:${LD_LIBRARY_PATH:-}"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
mkdir -p "$TMPDIR" "$HOME/experiments/results/logs" "$HOME/experiments/results/f2_grid_state"

BINARY="$HOME/src/llama.cpp/build-safe/bin/llama-cli"
MODEL="$HOME/models/Qwen3.5-4B-Q4_K_M.gguf"
GRID="$HOME/experiments/scripts/run_f2_grid.sh"

# Refuse if residual campaign runners exist (exact names; no pkill)
if ps -ef 2>/dev/null | grep -E 'run_f2_grid\.sh|run_bench\.sh|llama-cli' | grep -v grep >/dev/null; then
  echo "ERROR: residual campaign process present; stop exact PIDs first:" >&2
  ps -ef 2>/dev/null | grep -E 'run_f2_grid\.sh|run_bench\.sh|llama-cli' | grep -v grep || true
  exit 9
fi

echo "=== preflight binary (build-safe only) ==="
if [ ! -x "$BINARY" ]; then
  echo "ERROR: missing safe binary: $BINARY" >&2
  exit 6
fi
case "$BINARY" in
  */build-safe/*) ;;
  *) echo "ERROR: binary not under build-safe: $BINARY" >&2; exit 6 ;;
esac
"$BINARY" --version 2>&1 | head -5 || true

if [ ! -f "$MODEL" ]; then
  echo "ERROR: model missing: $MODEL (scripts never download)" >&2
  exit 3
fi
if [ ! -f "$GRID" ]; then
  echo "ERROR: grid script missing: $GRID" >&2
  exit 3
fi

echo "=== battery (fail-closed on charge / missing API) ==="
_json="$(timeout 12 termux-battery-status 2>/dev/null || true)"
if [ -z "$_json" ]; then
  echo "ERROR: termux-battery-status empty/hung — refuse start" >&2
  exit 7
fi
_pl="$(printf '%s' "$_json" | sed -n 's/.*"plugged"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
_tr="$(printf '%s' "$_json" | sed -n 's/.*"temperature"[[:space:]]*:[[:space:]]*\([0-9.][0-9.]*\).*/\1/p' | head -n1)"
_tc="$(awk -v t="${_tr:-}" 'BEGIN{
  if (t=="") {print ""; exit}
  if (t+0>100) printf "%.1f", t/10.0; else printf "%.1f", t+0
}')"
echo "plugged=${_pl:-?} temp=${_tc:-?} (raw json ok)"
if [ "$_pl" != "UNPLUGGED" ]; then
  echo "ERROR: need UNPLUGGED, got ${_pl:-empty}" >&2
  exit 4
fi
if [ -z "$_tc" ]; then
  echo "ERROR: temperature unreadable" >&2
  exit 7
fi
_hot_abs="$(awk -v t="$_tc" 'BEGIN{print (t+0>32.0)?1:0}')"
if [ "$_hot_abs" = "1" ]; then
  echo "ERROR: start temp $_tc >32°C — cool phone first" >&2
  exit 5
fi
# cool≤30 is enforced per-rep inside run_f2_grid; warn if currently warm
_hot_cool="$(awk -v t="$_tc" 'BEGIN{print (t+0>30.0)?1:0}')"
if [ "$_hot_cool" = "1" ]; then
  echo "WARN: temp $_tc >30.0 — grid will wait until ≤30.0 before each rep"
fi

OUT="$HOME/experiments/results/f2_2c_console.txt"
PIDF="$HOME/experiments/results/f2_2c.pid"

nohup bash "$GRID" \
  --model "$MODEL" \
  --phase F2.2c \
  --file-gb 2.74 \
  --quant Q4_K_M \
  --n-gen 128 \
  --reps 3 \
  --cooldown 180 \
  --max-cool-temp 30.0 \
  >"$OUT" 2>&1 &
echo $! >"$PIDF"
echo "PID=$(cat "$PIDF") phase=F2.2c cooldown=180 cool≤30.0 start=t5/c1024"
sleep 2
head -40 "$OUT" || true
ps -ef 2>/dev/null | grep -E "run_f2_grid|run_bench|llama-cli" | grep -v grep || true
