#!/usr/bin/env bash
# Start F3 "Il muro" variant on phone (safe binary only). Detached.
# Cold runs use ~/bin/cold_model.sh (fadvise DONTNEED + mincore). Reboot is NOT required.
# No broad pkill. No network. Scripts never download models. SSH-only control (no adb).
#
# Exact operator sequence (promoted rows B / B2 = cold+warm same session):
#   1. bash start_f3.sh --variant default --first-run-type cold --reps 3
#        → cold_model.sh then rep1 cold + rep2 warm + rep3 warm (PAIR cold+warm)
#   2. bash start_f3.sh --variant numa --first-run-type cold --reps 3
#        → same pairing for F3-numa (B2); cold_model again before its cold rep
#   3. if battery ≥40% AND binary supports --no-warmup:
#        bash start_f3.sh --variant nowarmup --first-run-type cold --reps 1 --no-sentinel
#      else: skip nowarmup gracefully (logged, not error)
#   Sentinel warm rep is optional (default on; --no-sentinel to skip).
#   Notes always mark cold=fadv (or cold=reboot only with --cold-method reboot).
#
# Uso:
#   bash start_f3.sh --variant default --first-run-type cold
#   bash start_f3.sh --variant numa --first-run-type cold
#   bash start_f3.sh --variant nowarmup --first-run-type cold --reps 1 --no-sentinel
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
# Default build-safe; overridden below if BINARY is build-safe2.
export LD_LIBRARY_PATH="$HOME/src/llama.cpp/build-safe/bin:${LD_LIBRARY_PATH:-}"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
mkdir -p "$TMPDIR" "$HOME/experiments/results/logs" "$HOME/experiments/results/f3_state"

VARIANT="default"
FIRST_RUN_TYPE="cold"
REPS=3
NO_SENTINEL=0
COLD_METHOD="${COLD_METHOD:-fadv}"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
BINARY="$HOME/src/llama.cpp/build-safe/bin/llama-cli"
MODEL="$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf"
GRID="$HOME/experiments/scripts/run_f3.sh"
EXPECTED_SIZE="11522702304"

while [ $# -gt 0 ]; do
  case "$1" in
    --variant) VARIANT="${2:-}"; shift 2 ;;
    --first-run-type) FIRST_RUN_TYPE="${2:-}"; shift 2 ;;
    --reps) REPS="${2:-}"; shift 2 ;;
    --no-sentinel) NO_SENTINEL=1; shift ;;
    --cold-method) COLD_METHOD="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Uso: start_f3.sh --variant default|numa|nowarmup [--first-run-type cold|warm] [--reps N] [--no-sentinel] [--cold-method fadv|reboot]"
      exit 0
      ;;
    *) echo "arg: $1" >&2; exit 3 ;;
  esac
done

case "$VARIANT" in
  default|numa|nowarmup) ;;
  *) echo "ERROR: --variant default|numa|nowarmup" >&2; exit 3 ;;
esac
case "$FIRST_RUN_TYPE" in
  cold|warm) ;;
  *) echo "ERROR: --first-run-type cold|warm" >&2; exit 3 ;;
esac
case "$COLD_METHOD" in
  fadv|reboot) ;;
  *) echo "ERROR: --cold-method fadv|reboot" >&2; exit 3 ;;
esac

SIZE="$(stat -c '%s' "$MODEL" 2>/dev/null || stat -f '%z' "$MODEL" 2>/dev/null || echo 0)"
if [ "$SIZE" != "$EXPECTED_SIZE" ]; then
  echo "ERROR: Qwen3.6-35B-A3B-UD-IQ2_M size $SIZE != $EXPECTED_SIZE (scripts never download; fix/copy file)" >&2
  exit 3
fi

# Exact residual campaign PIDs only — never touch sshd
if ps -ef 2>/dev/null | grep -E 'run_f3\.sh|run_f2_grid\.sh|run_bench\.sh|llama-cli|run_f2_thermal' | grep -v grep >/dev/null; then
  echo "ERROR: residual campaign process present; stop exact PIDs first:" >&2
  ps -ef 2>/dev/null | grep -E 'run_f3\.sh|run_f2_grid\.sh|run_bench\.sh|llama-cli|run_f2_thermal' | grep -v grep || true
  exit 9
fi

# cold_model required for fadv cold (no reboot assumption)
if [ "$FIRST_RUN_TYPE" = "cold" ] && [ "$COLD_METHOD" = "fadv" ]; then
  if [ ! -x "$COLD_MODEL_SH" ]; then
    echo "ERROR: cold_model.sh missing/not executable: $COLD_MODEL_SH" >&2
    exit 3
  fi
  if [ ! -x "${FADV:-$HOME/bin/fadv}" ] && [ ! -x "$HOME/bin/fadv" ]; then
    echo "ERROR: ~/bin/fadv missing (needed by cold_model.sh)" >&2
    exit 3
  fi
  echo "cold_model OK: $COLD_MODEL_SH (method=fadv)"
fi

echo "=== preflight binary (build-safe / build-safe2 only) ==="
if [ ! -x "$BINARY" ]; then
  echo "ERROR: missing safe binary: $BINARY" >&2
  exit 6
fi
case "$BINARY" in
  */build-safe/*|*/build-safe2/*) ;;
  *) echo "ERROR: binary not under build-safe/build-safe2: $BINARY" >&2; exit 6 ;;
esac
export LD_LIBRARY_PATH="$(cd "$(dirname "$BINARY")" && pwd):${LD_LIBRARY_PATH:-}"
"$BINARY" --version 2>&1 | head -5 || true
echo "model size=$SIZE OK (no download) variant=$VARIANT first=$FIRST_RUN_TYPE reps=$REPS"

# 30s load preflight on 4B: catch degraded environment before multi-hour 35B block.
# Uses same --load-mode mmap the harness always passes (pin 67d5978).
PREFLIGHT_MODEL="${PREFLIGHT_MODEL:-$HOME/models/Qwen3.5-4B-Q4_K_M.gguf}"
PREFLIGHT_TIMEOUT_S="${PREFLIGHT_TIMEOUT_S:-30}"
if [ ! -f "$PREFLIGHT_MODEL" ]; then
  echo "ERROR: preflight model missing: $PREFLIGHT_MODEL" >&2
  exit 3
fi
echo "=== preflight 4B load (${PREFLIGHT_TIMEOUT_S}s, -n 4, --load-mode mmap) ==="
_pf_log="$HOME/experiments/results/f3_state/preflight_${VARIANT}.log"
mkdir -p "$(dirname "$_pf_log")"
set +e
if command -v timeout >/dev/null 2>&1; then
  timeout "$PREFLIGHT_TIMEOUT_S" "$BINARY" \
    -m "$PREFLIGHT_MODEL" \
    -p 'ping' -n 4 -t 4 -c 256 \
    --temp 0 --no-display-prompt --no-conversation --single-turn \
    --load-mode mmap --simple-io \
    < /dev/null >"$_pf_log" 2>&1
  _pf_rc=$?
else
  "$BINARY" \
    -m "$PREFLIGHT_MODEL" \
    -p 'ping' -n 4 -t 4 -c 256 \
    --temp 0 --no-display-prompt --no-conversation --single-turn \
    --load-mode mmap --simple-io \
    < /dev/null >"$_pf_log" 2>&1
  _pf_rc=$?
fi
set -e
if [ "$_pf_rc" -ne 0 ]; then
  echo "ERROR: preflight FAILED rc=$_pf_rc (env degraded; block NOT started)" >&2
  echo "       log: $_pf_log" >&2
  tail -30 "$_pf_log" 2>/dev/null || true
  exit 10
fi
if ! grep -qE 'Prompt:|Generation:|tokens per second|eval time|Exiting' "$_pf_log" 2>/dev/null; then
  echo "ERROR: preflight produced no timing/exit markers (rc=0 but silent)" >&2
  tail -30 "$_pf_log" 2>/dev/null || true
  exit 10
fi
echo "preflight OK rc=0 timings present (log=$_pf_log)"

# Flag support sanity (never load the 35B here)
_help="$("$BINARY" --help 2>&1 || true)"
case "$VARIANT" in
  numa)
    if ! printf '%s' "$_help" | grep -q -- '--numa'; then
      echo "ERROR: pinned binary lacks --numa; cannot run F3-numa" >&2
      exit 3
    fi
    ;;
  nowarmup)
    if ! printf '%s' "$_help" | grep -q -- '--no-warmup'; then
      # Graceful drop (not error): log and exit 0 so campaign can continue.
      echo "NOTE: pinned binary lacks --no-warmup — dropping F3-nowarmup gracefully (not an error)"
      echo "nowarmup_dropped=1 reason=flag_unsupported binary=$BINARY" >>"$HOME/experiments/results/f3_state/F3.runner.log" 2>/dev/null || true
      exit 0
    fi
    ;;
esac

if [ ! -f "$GRID" ]; then
  echo "ERROR: grid script missing: $GRID" >&2
  exit 3
fi

echo "=== battery (fail-closed on charge / missing API / floor) ==="
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
  echo "WARN: temp $_tc >30.0 — runner will wait until ≤30.0 before each rep"
fi
if [ -n "$_lv" ]; then
  _low="$(awk -v l="$_lv" 'BEGIN{print (l+0 < 40)?1:0}')"
  if [ "$_low" = "1" ]; then
    echo "ERROR: battery $_lv% <40% floor (CHARGE_NEEDED before F3)" >&2
    exit 92
  fi
fi

case "$VARIANT" in
  default) PHASE_TAG="F3" ;;
  numa) PHASE_TAG="F3-numa" ;;
  nowarmup) PHASE_TAG="F3-nowarmup" ;;
esac

OUT="$HOME/experiments/results/f3_${VARIANT}_console.txt"
PIDF="$HOME/experiments/results/f3_${VARIANT}.pid"
STATE_DIR="$HOME/experiments/results/f3_state"
mkdir -p "$STATE_DIR"
# aggregate state pointer
echo "variant=$VARIANT phase=$PHASE_TAG pid_file=$PIDF start=$(date -Iseconds 2>/dev/null || date)" >"$STATE_DIR/F3.state"

_extra=()
if [ "$NO_SENTINEL" -eq 1 ]; then
  _extra+=(--no-sentinel)
fi

nohup bash "$GRID" \
  --variant "$VARIANT" \
  --first-run-type "$FIRST_RUN_TYPE" \
  --reps "$REPS" \
  --model "$MODEL" \
  --binary "$BINARY" \
  --cooldown 180 \
  --max-cool-temp 30.0 \
  --majflt-max 50000 \
  --cold-method "$COLD_METHOD" \
  "${_extra[@]}" \
  >"$OUT" 2>&1 &
echo $! >"$PIDF"
echo "PID=$(cat "$PIDF") phase=$PHASE_TAG variant=$VARIANT first=$FIRST_RUN_TYPE reps=$REPS cooldown=180 cool≤30.0 run_timeout=2700 classic_perf=1 cold_method=$COLD_METHOD size OK"
if [ "$FIRST_RUN_TYPE" = "cold" ] && [ "$REPS" -ge 2 ]; then
  echo "PAIR cold+warm same session: rep1=cold($COLD_METHOD), reps 2..$REPS=warm (no reboot between)"
fi
sleep 3
head -40 "$OUT" || true
ps -ef 2>/dev/null | grep -E "run_f3|run_bench|llama-cli" | grep -v grep || true
