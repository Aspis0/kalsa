#!/usr/bin/env bash
# =============================================================================
# run_f2_grid.sh — greedy F2.2 / F2.3 sweeps (one variable at a time, 3 reps)
#
# PLAN F2.2/F2.3:
#   start: t=5, ctx=1024, kv=q8_0, n_gen=128, warm, short
#   order: threads {4,5,6} → ctx {512,1024,4096} → kv {f16,q8_0}
#   keep best-so-far by median eval_tok_s
#
# Uso:
#   bash scripts/run_f2_grid.sh --model ~/models/Qwen3.5-4B-Q4_K_M.gguf --phase F2.2
#   bash scripts/run_f2_grid.sh --model ~/models/LFM2-8B-A1B-Q4_K_M.gguf --phase F2.3
#
# Binary default: $HOME/src/llama.cpp/build-safe/bin/llama-cli
# NEVER uses old build/ tree.
# =============================================================================

set -euo pipefail
export LC_ALL=C

MODEL=""
PHASE="F2.2"
PROMPT_FILE="${PROMPT_FILE:-$HOME/experiments/prompts/short.txt}"
PROMPT_ID="short"
N_GEN=128
REPS=3
BINARY="${BINARY:-$HOME/src/llama.cpp/build-safe/bin/llama-cli}"
RUN_BENCH="${RUN_BENCH:-$HOME/experiments/scripts/run_bench.sh}"
CSV_PATH="${RUNS_CSV:-$HOME/experiments/results/runs.csv}"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-67d5978}"
FILE_GB=""
QUANT=""
COOLDOWN_S="${COOLDOWN_S:-15}"
MAX_START_TEMP="32.0"

# export LD path for shared build-safe
export LD_LIBRARY_PATH="${HOME}/src/llama.cpp/build-safe/bin:${LD_LIBRARY_PATH:-}"
export TMPDIR="${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
mkdir -p "$TMPDIR" 2>/dev/null || true

usage() {
    cat <<'EOF' >&2
Uso: run_f2_grid.sh --model PATH --phase F2.2|F2.3 [opts]
  --binary PATH
  --prompt-file PATH
  --n-gen N
  --reps N
  --file-gb X
  --quant NAME
  --cooldown SEC
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --model|-m) MODEL="${2:-}"; shift 2 ;;
        --phase) PHASE="${2:-}"; shift 2 ;;
        --binary) BINARY="${2:-}"; shift 2 ;;
        --prompt-file|-p) PROMPT_FILE="${2:-}"; shift 2 ;;
        --prompt-id) PROMPT_ID="${2:-}"; shift 2 ;;
        --n-gen|-n) N_GEN="${2:-}"; shift 2 ;;
        --reps) REPS="${2:-}"; shift 2 ;;
        --file-gb) FILE_GB="${2:-}"; shift 2 ;;
        --quant) QUANT="${2:-}"; shift 2 ;;
        --cooldown) COOLDOWN_S="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "arg: $1" >&2; usage; exit 3 ;;
    esac
done

if [ -z "$MODEL" ] || [ ! -f "$MODEL" ]; then
    echo "ERROR: --model required and must exist: $MODEL" >&2
    exit 3
fi
if [ ! -x "$BINARY" ] && [ ! -f "$BINARY" ]; then
    echo "ERROR: binary missing: $BINARY" >&2
    exit 6
fi
# refuse old tree
case "$BINARY" in
    */build/bin/*)
        echo "ERROR: refused old build/ tree: $BINARY (use build-safe)" >&2
        exit 6
        ;;
esac
if [ ! -f "$RUN_BENCH" ]; then
    echo "ERROR: run_bench missing: $RUN_BENCH" >&2
    exit 3
fi

STATE_DIR="$HOME/experiments/results/f2_grid_state"
mkdir -p "$STATE_DIR" "$HOME/experiments/results/logs"
STATE_FILE="$STATE_DIR/${PHASE}.state"
SUMMARY_FILE="$STATE_DIR/${PHASE}.summary.md"
LOG_FILE="$STATE_DIR/${PHASE}.runner.log"

log() { printf '%s %s\n' "$(date -Iseconds 2>/dev/null || date)" "$*" | tee -a "$LOG_FILE" >&2; }

check_alive() {
    # basic connection health: battery + binary still there
    if [ ! -f "$BINARY" ]; then
        log "BLOCKED: binary disappeared"
        exit 90
    fi
}

gate_ok() {
    check_alive
    if ! command -v termux-battery-status >/dev/null 2>&1; then
        log "BLOCKED: termux-battery-status missing"
        exit 7
    fi
    _json="$(timeout 12 termux-battery-status 2>/dev/null || true)"
    _pl="$(printf '%s' "$_json" | sed -n 's/.*"plugged"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
    _tr="$(printf '%s' "$_json" | sed -n 's/.*"temperature"[[:space:]]*:[[:space:]]*\([0-9.][0-9.]*\).*/\1/p' | head -n1)"
    _tc="$(awk -v t="${_tr:-0}" 'BEGIN{if(t+0>100) printf "%.1f",t/10; else printf "%.1f",t+0}')"
    if [ "$_pl" != "UNPLUGGED" ]; then
        log "BLOCKED: plugged=$_pl (need UNPLUGGED)"
        exit 4
    fi
    _hot="$(awk -v t="$_tc" -v m="$MAX_START_TEMP" 'BEGIN{print (t+0>m+0)?1:0}')"
    if [ "$_hot" = "1" ]; then
        log "WAIT: temp $_tc > $MAX_START_TEMP — sleeping 60s"
        sleep 60
        gate_ok
        return
    fi
    log "gate OK plugged=$_pl temp=$_tc"
}

run_one() {
    _t="$1"; _c="$2"; _k="$3"; _note="$4"
    gate_ok
    _extra=()
    [ -n "$FILE_GB" ] && _extra+=(--file-gb "$FILE_GB")
    [ -n "$QUANT" ] && _extra+=(--quant "$QUANT")
    set +e
    bash "$RUN_BENCH" \
        --binary "$BINARY" \
        -m "$MODEL" \
        -p "$PROMPT_FILE" \
        --prompt-id "$PROMPT_ID" \
        --phase "$PHASE" \
        --runtime mainline \
        --runtime-commit "$RUNTIME_COMMIT" \
        --run-type warm \
        --threads "$_t" \
        --ctx "$_c" \
        --kv-type "$_k" \
        --n-gen "$N_GEN" \
        --notes "$_note" \
        "${_extra[@]}"
    _ec=$?
    set -e
    if [ "$_ec" -eq 4 ] || [ "$_ec" -eq 5 ] || [ "$_ec" -eq 7 ]; then
        log "BLOCKED: run_bench exit $_ec for t=$_t c=$_c kv=$_k"
        exit "$_ec"
    fi
    if [ "$_ec" -ne 0 ]; then
        log "WARN: run_bench exit $_ec (row may still be FAIL) t=$_t c=$_c kv=$_k"
    fi
    # detect reboot/drop: if we cannot read battery after, stop
    if ! timeout 12 termux-battery-status >/dev/null 2>&1; then
        log "BLOCKED: lost battery/API after run — possible instability"
        exit 91
    fi
    sleep "$COOLDOWN_S"
}

median_eval_for_config() {
    # args: threads ctx kv ; reads CSV for matching phase/model basename
    _t="$1"; _c="$2"; _k="$3"
    _base="$(basename "$MODEL")"
    if [ ! -f "$CSV_PATH" ]; then
        echo ""
        return
    fi
    awk -F, -v phase="$PHASE" -v model="$_base" -v t="$_t" -v c="$_c" -v k="$_k" '
        NR==1 {
            for(i=1;i<=NF;i++) h[$i]=i
            next
        }
        $h["phase"]==phase && $h["model"]==model && $h["threads"]==t && $h["n_ctx"]==c && $h["kv_type"]==k && $h["run_type"]=="warm" {
            v=$h["eval_tok_s"]
            if (v!="" && v+0==v) { n++; a[n]=v+0 }
        }
        END {
            if (n==0) { print ""; exit }
            # sort
            for(i=1;i<=n;i++) for(j=i+1;j<=n;j++) if(a[j]<a[i]){x=a[i];a[i]=a[j];a[j]=x}
            if (n%2) printf "%.2f", a[int(n/2)+1]
            else printf "%.2f", (a[n/2]+a[n/2+1])/2
        }
    ' "$CSV_PATH"
}

count_rows_for_config() {
    _t="$1"; _c="$2"; _k="$3"
    _base="$(basename "$MODEL")"
    if [ ! -f "$CSV_PATH" ]; then echo 0; return; fi
    awk -F, -v phase="$PHASE" -v model="$_base" -v t="$_t" -v c="$_c" -v k="$_k" '
        NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
        $h["phase"]==phase && $h["model"]==model && $h["threads"]==t && $h["n_ctx"]==c && $h["kv_type"]==k && $h["run_type"]=="warm" {n++}
        END{print n+0}
    ' "$CSV_PATH"
}

measure_config() {
    _t="$1"; _c="$2"; _k="$3"; _tag="$4"
    _have="$(count_rows_for_config "$_t" "$_c" "$_k")"
    _need="$REPS"
    if [ "$_have" -ge "$_need" ]; then
        log "skip already have $_have>=$_need rows for t=$_t c=$_c kv=$_k"
        return 0
    fi
    _start=$((_have + 1))
    for _r in $(seq "$_start" "$_need"); do
        log "measure $_tag rep $_r/$_need t=$_t c=$_c kv=$_k"
        run_one "$_t" "$_c" "$_k" "${PHASE} ${_tag} t=${_t} c=${_c} kv=${_k} rep=${_r}"
    done
}

pick_best() {
    # stdin: lines "value key" → stdout best key (max value); empty if none
    awk '
        NF>=2 {
            v=$1+0; $1=""; sub(/^ /,""); k=$0
            if (k!="" && (bestk=="" || v>bestv)) {bestv=v; bestk=k}
        }
        END{print bestk}
    '
}

log "=== start $PHASE model=$MODEL binary=$BINARY ==="
echo "phase=$PHASE model=$(basename "$MODEL") start=$(date -Iseconds 2>/dev/null || date)" >"$STATE_FILE"

# declared start config
BEST_T=5
BEST_C=1024
BEST_K="q8_0"

# --- stage 1: threads ---
log "STAGE threads {4,5,6} with c=$BEST_C kv=$BEST_K"
for t in 4 5 6; do
    measure_config "$t" "$BEST_C" "$BEST_K" "threads"
done
_best_line=""
for t in 4 5 6; do
    _m="$(median_eval_for_config "$t" "$BEST_C" "$BEST_K")"
    log "median threads t=$t → ${_m:-NA}"
    if [ -n "$_m" ]; then
        _best_line="${_best_line}${_m} ${t}\n"
    fi
done
_pick="$(printf '%b' "$_best_line" | pick_best)"
if [ -n "$_pick" ]; then
    BEST_T="$_pick"
fi
log "BEST threads → $BEST_T"

# --- stage 2: ctx ---
log "STAGE ctx {512,1024,4096} with t=$BEST_T kv=$BEST_K"
for c in 512 1024 4096; do
    measure_config "$BEST_T" "$c" "$BEST_K" "ctx"
done
_best_line=""
for c in 512 1024 4096; do
    _m="$(median_eval_for_config "$BEST_T" "$c" "$BEST_K")"
    log "median ctx c=$c → ${_m:-NA}"
    if [ -n "$_m" ]; then
        _best_line="${_best_line}${_m} ${c}\n"
    fi
done
_pick="$(printf '%b' "$_best_line" | pick_best)"
if [ -n "$_pick" ]; then
    BEST_C="$_pick"
fi
log "BEST ctx → $BEST_C"

# --- stage 3: kv ---
log "STAGE kv {f16,q8_0} with t=$BEST_T c=$BEST_C"
for k in f16 q8_0; do
    measure_config "$BEST_T" "$BEST_C" "$k" "kv"
done
_best_line=""
for k in f16 q8_0; do
    _m="$(median_eval_for_config "$BEST_T" "$BEST_C" "$k")"
    log "median kv k=$k → ${_m:-NA}"
    if [ -n "$_m" ]; then
        _best_line="${_best_line}${_m} ${k}\n"
    fi
done
_pick="$(printf '%b' "$_best_line" | pick_best)"
if [ -n "$_pick" ]; then
    BEST_K="$_pick"
fi
log "BEST kv → $BEST_K"

_final_med="$(median_eval_for_config "$BEST_T" "$BEST_C" "$BEST_K")"
{
    echo "# $PHASE summary"
    echo
    echo "- model: \`$(basename "$MODEL")\`"
    echo "- best: threads=$BEST_T ctx=$BEST_C kv=$BEST_K"
    echo "- median eval_tok_s: ${_final_med:-NA}"
    echo "- n_gen: $N_GEN prompt: $PROMPT_ID"
    echo "- binary: \`$BINARY\`"
    echo "- finished: $(date -Iseconds 2>/dev/null || date)"
} | tee "$SUMMARY_FILE" >&2

echo "best_t=$BEST_T best_c=$BEST_C best_k=$BEST_K median=${_final_med:-}" >>"$STATE_FILE"
log "=== done $PHASE best t=$BEST_T c=$BEST_C kv=$BEST_K median=${_final_med:-NA} ==="
exit 0
