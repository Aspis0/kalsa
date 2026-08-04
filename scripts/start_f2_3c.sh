#!/usr/bin/env bash
# Start compliant F2.3c LFM2 grid (safe binary only). No broad pkill. No network.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/src/llama.cpp/build-safe/bin:${LD_LIBRARY_PATH:-}"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
mkdir -p "$TMPDIR" "$HOME/experiments/results/logs" "$HOME/experiments/results/f2_grid_state"

BINARY="$HOME/src/llama.cpp/build-safe/bin/llama-cli"
MODEL="$HOME/models/LFM2-8B-A1B-Q4_K_M.gguf"
GRID="$HOME/experiments/scripts/run_f2_grid.sh"
EXPECTED_SIZE="5044779712"

SIZE="$(stat -c '%s' "$MODEL" 2>/dev/null || stat -f '%z' "$MODEL" 2>/dev/null || echo 0)"
if [ "$SIZE" != "$EXPECTED_SIZE" ]; then
  echo "ERROR: LFM2 size $SIZE != $EXPECTED_SIZE (scripts never download; fix/copy file)" >&2
  exit 3
fi

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
echo "LFM2 size=$SIZE OK (no download)"

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
echo "plugged=${_pl:-?} temp=${_tc:-?}"
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
_hot_cool="$(awk -v t="$_tc" 'BEGIN{print (t+0>30.0)?1:0}')"
if [ "$_hot_cool" = "1" ]; then
  echo "WARN: temp $_tc >30.0 — grid will wait until ≤30.0 before each rep"
fi

OUT="$HOME/experiments/results/f2_3c_console.txt"
PIDF="$HOME/experiments/results/f2_3c.pid"

nohup bash "$GRID" \
  --model "$MODEL" \
  --phase F2.3c \
  --file-gb 5.04 \
  --quant Q4_K_M \
  --n-gen 128 \
  --reps 3 \
  --cooldown 180 \
  --max-cool-temp 30.0 \
  >"$OUT" 2>&1 &
echo $! >"$PIDF"
echo "PID=$(cat "$PIDF") phase=F2.3c cooldown=180 cool≤30.0 LFM2 size OK"
sleep 3
head -40 "$OUT" || true
ps -ef 2>/dev/null | grep -E "run_f2_grid|run_bench|llama-cli" | grep -v grep || true
