#!/usr/bin/env bash
# Start compliant F2.3c-bis LFM2 Q4_0 reduced grid (safe binary only).
# Fixed cell from F2.3c best: t=4 c=512 kv=q8_0; 3 reps + sentinel.
# No broad pkill. No network. Scripts never download models.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/src/llama.cpp/build-safe/bin:${LD_LIBRARY_PATH:-}"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
mkdir -p "$TMPDIR" "$HOME/experiments/results/logs" "$HOME/experiments/results/f2_grid_state"

BINARY="$HOME/src/llama.cpp/build-safe/bin/llama-cli"
MODEL="$HOME/models/LFM2-8B-A1B-Q4_0.gguf"
GRID="$HOME/experiments/scripts/run_f2_grid.sh"
EXPECTED_SIZE="4733893312"

SIZE="$(stat -c '%s' "$MODEL" 2>/dev/null || stat -f '%z' "$MODEL" 2>/dev/null || echo 0)"
if [ "$SIZE" != "$EXPECTED_SIZE" ]; then
  echo "ERROR: LFM2 Q4_0 size $SIZE != $EXPECTED_SIZE (scripts never download; fix/copy file)" >&2
  exit 3
fi

if ps -ef 2>/dev/null | grep -E 'run_f2_grid\.sh|run_bench\.sh|llama-cli|run_f2_thermal' | grep -v grep >/dev/null; then
  echo "ERROR: residual campaign process present; stop exact PIDs first:" >&2
  ps -ef 2>/dev/null | grep -E 'run_f2_grid\.sh|run_bench\.sh|llama-cli|run_f2_thermal' | grep -v grep || true
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
echo "LFM2 Q4_0 size=$SIZE OK (no download)"

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
_lv="$(printf '%s' "$_json" | sed -n 's/.*"percentage"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1)"
_tc="$(awk -v t="${_tr:-}" 'BEGIN{
  if (t=="") {print ""; exit}
  if (t+0>100) printf "%.1f", t/10.0; else printf "%.1f", t+0
}')"
echo "plugged=${_pl:-?} temp=${_tc:-?} lvl=${_lv:-?}"
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
if [ -n "$_lv" ]; then
  _low="$(awk -v l="$_lv" 'BEGIN{print (l+0 < 40)?1:0}')"
  if [ "$_low" = "1" ]; then
    echo "ERROR: battery $_lv% <40% floor (CHARGE_NEEDED before F2.3c-bis)" >&2
    exit 92
  fi
fi

OUT="$HOME/experiments/results/f2_3c_bis_console.txt"
PIDF="$HOME/experiments/results/f2_3c_bis.pid"

nohup bash "$GRID" \
  --model "$MODEL" \
  --phase F2.3c-bis \
  --file-gb 4.73 \
  --quant Q4_0 \
  --n-gen 128 \
  --reps 3 \
  --cooldown 180 \
  --max-cool-temp 30.0 \
  --majflt-max 50000 \
  >"$OUT" 2>&1 &
echo $! >"$PIDF"
echo "PID=$(cat "$PIDF") phase=F2.3c-bis cell=t4/c512/q8_0 cooldown=180 cool≤30.0 LFM2 Q4_0 size OK"
sleep 3
head -40 "$OUT" || true
ps -ef 2>/dev/null | grep -E "run_f2_grid|run_bench|llama-cli" | grep -v grep || true
