#!/usr/bin/env bash
# =============================================================================
# run_f2_thermal.sh — F2.4 thermal curve: continuous 4B, 30s blocks, 10 minutes
#
# Logs each block: timestamp, batt temp, eval_tok_s (if parseable), notes.
# Uses safe binary only. Stops if charging, temp gate fails at start of a block
# in a way that indicates instability, or process dies.
#
# Uso:
#   bash scripts/run_f2_thermal.sh
#   bash scripts/run_f2_thermal.sh --duration 600 --block 30
# =============================================================================

set -euo pipefail
export LC_ALL=C

MODEL="${MODEL:-$HOME/models/Qwen3.5-4B-Q4_K_M.gguf}"
BINARY="${BINARY:-$HOME/src/llama.cpp/build-safe/bin/llama-cli}"
PROMPT_FILE="${PROMPT_FILE:-$HOME/experiments/prompts/short.txt}"
DURATION_S="${DURATION_S:-600}"
BLOCK_S="${BLOCK_S:-30}"
THREADS="${THREADS:-5}"
N_CTX="${N_CTX:-1024}"
KV_TYPE="${KV_TYPE:-q8_0}"
N_GEN_BLOCK="${N_GEN_BLOCK:-64}"
OUT_CSV="${OUT_CSV:-$HOME/experiments/results/thermal_f2.csv}"
MAX_START_TEMP="32.0"

export LD_LIBRARY_PATH="${HOME}/src/llama.cpp/build-safe/bin:${LD_LIBRARY_PATH:-}"
export TMPDIR="${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
mkdir -p "$TMPDIR" "$(dirname "$OUT_CSV")"

usage() {
    cat <<'EOF' >&2
Uso: run_f2_thermal.sh [--duration 600] [--block 30] [--threads N] [--ctx N]
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --duration) DURATION_S="${2:-}"; shift 2 ;;
        --block) BLOCK_S="${2:-}"; shift 2 ;;
        --threads|-t) THREADS="${2:-}"; shift 2 ;;
        --ctx|-c) N_CTX="${2:-}"; shift 2 ;;
        --kv-type) KV_TYPE="${2:-}"; shift 2 ;;
        --model|-m) MODEL="${2:-}"; shift 2 ;;
        --binary) BINARY="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "arg $1" >&2; usage; exit 3 ;;
    esac
done

case "$BINARY" in
    */build/bin/*)
        echo "ERROR: refused old build/ tree" >&2
        exit 6
        ;;
esac

read_batt() {
    _json="$(timeout 12 termux-battery-status 2>/dev/null || true)"
    _pl="$(printf '%s' "$_json" | sed -n 's/.*"plugged"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
    _tr="$(printf '%s' "$_json" | sed -n 's/.*"temperature"[[:space:]]*:[[:space:]]*\([0-9.][0-9.]*\).*/\1/p' | head -n1)"
    _tc="$(awk -v t="${_tr:-}" 'BEGIN{
        if (t=="") {print ""; exit}
        if (t+0>100) printf "%.1f", t/10.0; else printf "%.1f", t+0
    }')"
    echo "$_pl $_tc"
}

if [ ! -f "$OUT_CSV" ]; then
    echo "block,date,elapsed_s,batt_temp,plugged,prompt_tok_s,eval_tok_s,exit_code,notes" >"$OUT_CSV"
fi

_prompt="$(cat "$PROMPT_FILE")"
_t0_wall="$(date +%s)"
_bat0="$(read_batt)"
_pl0="$(printf '%s' "$_bat0" | awk '{print $1}')"
_temp0="$(printf '%s' "$_bat0" | awk '{print $2}')"
if [ "$_pl0" != "UNPLUGGED" ]; then
    echo "ERROR: need UNPLUGGED, got $_pl0" >&2
    exit 4
fi
if [ -n "$_temp0" ]; then
    _hot="$(awk -v t="$_temp0" -v m="$MAX_START_TEMP" 'BEGIN{print (t+0>m+0)?1:0}')"
    if [ "$_hot" = "1" ]; then
        echo "ERROR: start temp $_temp0 > $MAX_START_TEMP" >&2
        exit 5
    fi
fi

echo "F2.4 thermal start temp=$_temp0 duration=${DURATION_S}s block=${BLOCK_S}s t=$THREADS c=$N_CTX kv=$KV_TYPE" >&2
_block=0
while :; do
    _now="$(date +%s)"
    _elapsed=$((_now - _t0_wall))
    if [ "$_elapsed" -ge "$DURATION_S" ]; then
        break
    fi
    _block=$((_block + 1))
    _bat="$(read_batt)"
    _pl="$(printf '%s' "$_bat" | awk '{print $1}')"
    _temp="$(printf '%s' "$_bat" | awk '{print $2}')"
    if [ "$_pl" != "UNPLUGGED" ]; then
        echo "$_block,$(date -Iseconds 2>/dev/null || date),$_elapsed,$_temp,$_pl,,,4,BLOCKED charging" >>"$OUT_CSV"
        echo "BLOCKED charging at block $_block" >&2
        exit 4
    fi
    # stop if clearly overheating badly (soft stop >42°C mid-run)
    if [ -n "$_temp" ]; then
        _over="$(awk -v t="$_temp" 'BEGIN{print (t+0>42.0)?1:0}')"
        if [ "$_over" = "1" ]; then
            echo "$_block,$(date -Iseconds 2>/dev/null || date),$_elapsed,$_temp,$_pl,,,5,STOP thermal>42" >>"$OUT_CSV"
            echo "STOP temp $_temp > 42" >&2
            exit 5
        fi
    fi

    _log="$HOME/experiments/results/logs/thermal_block_${_block}.log"
    set +e
    # bounded generation per block (~BLOCK_S wall if n_gen large enough)
    timeout "$((BLOCK_S + 90))" "$BINARY" \
        -m "$MODEL" \
        -p "$_prompt" \
        -n "$N_GEN_BLOCK" \
        -t "$THREADS" \
        -c "$N_CTX" \
        -ctk "$KV_TYPE" -ctv "$KV_TYPE" \
        --temp 0 \
        --no-display-prompt \
        --no-conversation \
        --single-turn \
        --simple-io \
        >"$_log" 2>&1
    _ec=$?
    set -e

    _pt=""; _et=""
    if [ -f "$_log" ]; then
        _sum="$(grep -E '\[\s*Prompt:[[:space:]]*[0-9.]+[[:space:]]*t/s' "$_log" 2>/dev/null | tail -n1 || true)"
        if [ -n "$_sum" ]; then
            _pt="$(printf '%s\n' "$_sum" | sed -n -E 's/.*Prompt:[[:space:]]*([0-9.]+)[[:space:]]*t\/s.*/\1/p')"
            _et="$(printf '%s\n' "$_sum" | sed -n -E 's/.*Generation:[[:space:]]*([0-9.]+)[[:space:]]*t\/s.*/\1/p')"
        fi
        if [ -z "$_et" ]; then
            _eline="$(grep -E '[[:space:]]eval time' "$_log" 2>/dev/null | grep -v 'prompt eval' | tail -n1 || true)"
            _et="$(printf '%s\n' "$_eline" | sed -n -E 's/.*[[:space:]]([0-9.]+)[[:space:]]+tokens per second.*/\1/p')"
        fi
    fi
    _bat1="$(read_batt)"
    _temp1="$(printf '%s' "$_bat1" | awk '{print $2}')"
    _now="$(date +%s)"
    _elapsed=$((_now - _t0_wall))
    echo "$_block,$(date -Iseconds 2>/dev/null || date),$_elapsed,${_temp1:-$_temp},$_pl,${_pt},${_et},${_ec}," >>"$OUT_CSV"
    echo "block=$_block elapsed=$_elapsed temp=${_temp1:-$_temp} eval=${_et:-NA} ec=$_ec" >&2

    if [ "$_ec" -ge 128 ]; then
        echo "STOP signal/kill ec=$_ec" >&2
        exit 91
    fi
done

echo "F2.4 complete blocks=$_block csv=$OUT_CSV" >&2
exit 0
