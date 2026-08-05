#!/usr/bin/env bash
# =============================================================================
# run_f2_grid.sh — greedy F2.2 / F2.3 sweeps (one variable at a time, 3 reps)
#
# PLAN F2.2/F2.3 + §8.2 (2026-08-04):
#   start: t=5, ctx=1024, kv=q8_0, n_gen=128, warm, short
#   order: threads {4,5,6} → ctx {512,1024,4096} → kv {f16,q8_0}
#   keep best-so-far by median eval_tok_s (low-majflt preferred)
#   cooldown: ≥3 min idle + batt temp ≤30.0°C before EVERY rep
#   sentinel: re-run stage winner; >15% drift → stage invalid, redo once
#   majflt: rows with majflt_delta >50k excluded from baseline medians when
#           at least one low-majflt row exists for that config
#
# Uso:
#   bash scripts/run_f2_grid.sh --model ~/models/Qwen3.5-4B-Q4_K_M.gguf --phase F2.2c
#   bash scripts/run_f2_grid.sh --model ~/models/LFM2-8B-A1B-Q4_K_M.gguf --phase F2.3c
#   bash scripts/run_f2_grid.sh --model ~/models/LFM2-8B-A1B-Q4_0.gguf --phase F2.3c-bis
#
# Binary default: $HOME/src/llama.cpp/build-safe/bin/llama-cli
# NEVER uses old build/ tree.
# =============================================================================

set -euo pipefail
export LC_ALL=C

MODEL=""
PHASE="F2.2c"
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
# §8.2: ≥3 min idle between runs
COOLDOWN_S="${COOLDOWN_S:-180}"
# absolute hard reject (run_bench also enforces 32)
MAX_START_TEMP="32.0"
# §8.2 cool gate before every rep
MAX_COOL_TEMP="30.0"
# majflt baseline filter
MAJFLT_BASELINE_MAX="${MAJFLT_BASELINE_MAX:-50000}"
# sentinel max relative drift
SENTINEL_MAX_DRIFT="${SENTINEL_MAX_DRIFT:-0.15}"
# max wait for cool (seconds) before BLOCKED
MAX_COOL_WAIT_S="${MAX_COOL_WAIT_S:-1800}"

export LD_LIBRARY_PATH="${HOME}/src/llama.cpp/build-safe/bin:${LD_LIBRARY_PATH:-}"
export TMPDIR="${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
mkdir -p "$TMPDIR" 2>/dev/null || true

usage() {
    cat <<'EOF' >&2
Uso: run_f2_grid.sh --model PATH --phase F2.2c|F2.3c|F2.3c-bis [opts]
  --binary PATH           (must be build-safe llama-cli)
  --prompt-file PATH
  --n-gen N
  --reps N
  --file-gb X
  --quant NAME
  --cooldown SEC          (default 180; floor 180, cannot lower)
  --max-cool-temp C       (default 30.0; ceiling 30.0, cannot raise)
  --majflt-max N          (default 50000)

Legacy phases F2.2/F2.3 are REFUSED (noncompliant protocol). Use F2.2c/F2.3c.
F2.3c-bis = reduced single-cell (t=4 c=512 kv=q8_0 from F2.3c best) + sentinel.
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
        --max-cool-temp) MAX_COOL_TEMP="${2:-}"; shift 2 ;;
        --majflt-max) MAJFLT_BASELINE_MAX="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "arg: $1" >&2; usage; exit 3 ;;
    esac
done

if [ -z "$MODEL" ] || [ ! -f "$MODEL" ]; then
    echo "ERROR: --model required and must exist: $MODEL" >&2
    exit 3
fi

# Only compliant phase tags (legacy F2.2/F2.3 refuse — no silent remap)
case "$PHASE" in
    F2.2c|F2.3c|F2.3c-bis) ;;
    F2.2|F2.3)
        echo "ERROR: phase $PHASE refused (legacy/noncompliant). Use ${PHASE}c with cooldown≥180 and cool≤30.0" >&2
        exit 3
        ;;
    *)
        echo "ERROR: phase must be F2.2c, F2.3c, or F2.3c-bis (got: $PHASE)" >&2
        exit 3
        ;;
esac

# Safety floors/ceilings — no bypass (reject, do not clamp silently to hide intent)
_cd_lo="$(awk -v c="$COOLDOWN_S" 'BEGIN{print (c+0 < 180)?1:0}')"
if [ "$_cd_lo" = "1" ]; then
    echo "ERROR: --cooldown $COOLDOWN_S < 180 (PLAN §8.2 ≥3 min idle; no bypass)" >&2
    exit 3
fi
_ct_hi="$(awk -v t="$MAX_COOL_TEMP" 'BEGIN{print (t+0 > 30.0)?1:0}')"
if [ "$_ct_hi" = "1" ]; then
    echo "ERROR: --max-cool-temp $MAX_COOL_TEMP > 30.0 (PLAN §8.2 sentinel start; no bypass)" >&2
    exit 3
fi
_ct_bad="$(awk -v t="$MAX_COOL_TEMP" 'BEGIN{print (t+0 <= 0)?1:0}')"
if [ "$_ct_bad" = "1" ]; then
    echo "ERROR: --max-cool-temp invalid: $MAX_COOL_TEMP" >&2
    exit 3
fi

if [ ! -x "$BINARY" ] && [ ! -f "$BINARY" ]; then
    echo "ERROR: binary missing: $BINARY" >&2
    exit 6
fi
case "$BINARY" in
    */build/bin/*)
        echo "ERROR: refused old build/ tree: $BINARY (use build-safe)" >&2
        exit 6
        ;;
esac
case "$BINARY" in
    */build-safe/*) ;;
    *)
        echo "ERROR: binary must be under build-safe/: $BINARY" >&2
        exit 6
        ;;
esac
if [ ! -f "$RUN_BENCH" ]; then
    echo "ERROR: run_bench missing: $RUN_BENCH" >&2
    exit 3
fi

# F2.3c / F2.3c-bis: explicit LFM2 size gate (no network download ever)
if [ "$PHASE" = "F2.3c" ]; then
    _msz="$(stat -c '%s' "$MODEL" 2>/dev/null || stat -f '%z' "$MODEL" 2>/dev/null || echo 0)"
    if [ "$_msz" != "5044779712" ]; then
        echo "ERROR: F2.3c model size $_msz != 5044779712 (LFM2 Q4_K_M). Fix file on device; scripts never download." >&2
        exit 3
    fi
fi
if [ "$PHASE" = "F2.3c-bis" ]; then
    _msz="$(stat -c '%s' "$MODEL" 2>/dev/null || stat -f '%z' "$MODEL" 2>/dev/null || echo 0)"
    if [ "$_msz" != "4733893312" ]; then
        echo "ERROR: F2.3c-bis model size $_msz != 4733893312 (LFM2 Q4_0). Fix file on device; scripts never download." >&2
        exit 3
    fi
fi

STATE_DIR="$HOME/experiments/results/f2_grid_state"
mkdir -p "$STATE_DIR" "$HOME/experiments/results/logs"
STATE_FILE="$STATE_DIR/${PHASE}.state"
SUMMARY_FILE="$STATE_DIR/${PHASE}.summary.md"
LOG_FILE="$STATE_DIR/${PHASE}.runner.log"

log() { printf '%s %s\n' "$(date -Iseconds 2>/dev/null || date)" "$*" | tee -a "$LOG_FILE" >&2; }

read_batt() {
    _json="$(timeout 12 termux-battery-status 2>/dev/null || true)"
    _pl="$(printf '%s' "$_json" | sed -n 's/.*"plugged"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
    _tr="$(printf '%s' "$_json" | sed -n 's/.*"temperature"[[:space:]]*:[[:space:]]*\([0-9.][0-9.]*\).*/\1/p' | head -n1)"
    _lv="$(printf '%s' "$_json" | sed -n 's/.*"percentage"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1)"
    _tc="$(awk -v t="${_tr:-}" 'BEGIN{
        if (t=="") {print ""; exit}
        if (t+0>100) printf "%.1f", t/10.0; else printf "%.1f", t+0
    }')"
    echo "${_pl:-} ${_tc:-} ${_lv:-}"
}

check_alive() {
    if [ ! -f "$BINARY" ]; then
        log "BLOCKED: binary disappeared"
        exit 90
    fi
}

# Wait until UNPLUGGED and temp ≤ MAX_COOL_TEMP (and ≤ MAX_START_TEMP).
# Enforces idle cooldown already applied by caller; here only thermal/plug gate.
gate_ok() {
    check_alive
    if ! command -v termux-battery-status >/dev/null 2>&1; then
        log "BLOCKED: termux-battery-status missing"
        exit 7
    fi
    _waited=0
    while true; do
        _bat="$(read_batt)"
        _pl="$(printf '%s' "$_bat" | awk '{print $1}')"
        _tc="$(printf '%s' "$_bat" | awk '{print $2}')"
        _lv="$(printf '%s' "$_bat" | awk '{print $3}')"
        if [ -z "$_pl" ] || [ -z "$_tc" ]; then
            log "WAIT: battery API empty/hung — sleep 30s (waited ${_waited}s)"
            sleep 30
            _waited=$((_waited + 30))
            if [ "$_waited" -ge "$MAX_COOL_WAIT_S" ]; then
                log "BLOCKED: battery API unavailable after ${MAX_COOL_WAIT_S}s"
                exit 91
            fi
            continue
        fi
        if [ "$_pl" != "UNPLUGGED" ]; then
            log "BLOCKED: plugged=$_pl (need UNPLUGGED)"
            exit 4
        fi
        # §8.2 battery floor: no measurement rep starts below 40%
        if [ -n "$_lv" ]; then
            _low_batt="$(awk -v l="$_lv" 'BEGIN{print (l+0 < 40)?1:0}')"
            if [ "$_low_batt" = "1" ]; then
                log "CHARGE_NEEDED: battery $_lv% <40% floor — wait (no measure below floor; charge only between phases)"
                sleep 30
                _waited=$((_waited + 30))
                if [ "$_waited" -ge "$MAX_COOL_WAIT_S" ]; then
                    log "BLOCKED: battery below 40% floor for ${MAX_COOL_WAIT_S}s (last=$_lv%)"
                    exit 92
                fi
                continue
            fi
        fi
        _hot_abs="$(awk -v t="$_tc" -v m="$MAX_START_TEMP" 'BEGIN{print (t+0>m+0)?1:0}')"
        _hot_cool="$(awk -v t="$_tc" -v m="$MAX_COOL_TEMP" 'BEGIN{print (t+0>m+0)?1:0}')"
        if [ "$_hot_abs" = "1" ] || [ "$_hot_cool" = "1" ]; then
            log "WAIT: temp $_tc need ≤$MAX_COOL_TEMP (abs≤$MAX_START_TEMP) lvl=${_lv:-?} — sleep 30s (waited ${_waited}s)"
            sleep 30
            _waited=$((_waited + 30))
            if [ "$_waited" -ge "$MAX_COOL_WAIT_S" ]; then
                log "BLOCKED: could not cool to ≤$MAX_COOL_TEMP within ${MAX_COOL_WAIT_S}s (last=$_tc)"
                exit 5
            fi
            continue
        fi
        log "gate OK plugged=$_pl temp=$_tc lvl=${_lv:-?} cool≤$MAX_COOL_TEMP cooldown=${COOLDOWN_S}s"
        return 0
    done
}

cooldown_idle() {
    log "cooldown idle ${COOLDOWN_S}s"
    sleep "$COOLDOWN_S"
}

run_one() {
    _t="$1"; _c="$2"; _k="$3"; _note="$4"
    # §8.2: ≥3 min idle BEFORE every rep, then cool/plug gate
    cooldown_idle
    gate_ok
    _extra=()
    [ -n "$FILE_GB" ] && _extra+=(--file-gb "$FILE_GB")
    [ -n "$QUANT" ] && _extra+=(--quant "$QUANT")
    # Do NOT pass harness options via --flags: run_bench treats --flags as EXTRA
    # binary flags and refuses -t/-c/-ctk/-ctv/--temp/--no-conversation (reserved).
    # threads/ctx/kv already have dedicated CSV columns; notes carry protocol tags.
    set +e
    # keep run_bench chatter on stderr/log only so callers can capture status
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
        --notes "$_note majflt_gate=${MAJFLT_BASELINE_MAX}" \
        "${_extra[@]}" >>"$LOG_FILE" 2>&1
    _ec=$?
    set -e
    if [ "$_ec" -eq 3 ] || [ "$_ec" -eq 4 ] || [ "$_ec" -eq 5 ] || [ "$_ec" -eq 6 ] || [ "$_ec" -eq 7 ]; then
        log "BLOCKED: run_bench exit $_ec for t=$_t c=$_c kv=$_k (config/safety/binary)"
        exit "$_ec"
    fi
    if [ "$_ec" -ne 0 ]; then
        log "WARN: run_bench exit $_ec (row may still be FAIL) t=$_t c=$_c kv=$_k"
    fi
    # detect drop: if we cannot read battery after, stop
    _bat_post="$(read_batt)"
    if [ -z "$(printf '%s' "$_bat_post" | awk '{print $1}')" ]; then
        log "BLOCKED: lost battery/API after run — possible instability"
        exit 91
    fi
}

# Median eval_tok_s for config over the LAST REPS rows (current batch).
# Prefers low-majflt (≤ MAJFLT_BASELINE_MAX) among that batch when any exist.
# High-majflt-only batches still return a median (pressure regime) but log warns.
median_eval_for_config() {
    _t="$1"; _c="$2"; _k="$3"
    _base="$(basename "$MODEL")"
    if [ ! -f "$CSV_PATH" ]; then
        echo ""
        return
    fi
    awk -F, -v phase="$PHASE" -v model="$_base" -v t="$_t" -v c="$_c" -v k="$_k" \
        -v mjmax="$MAJFLT_BASELINE_MAX" -v reps="$REPS" '
        NR==1 {
            for(i=1;i<=NF;i++) h[$i]=i
            next
        }
        $h["phase"]==phase && $h["model"]==model && $h["threads"]==t && $h["n_ctx"]==c && $h["kv_type"]==k && $h["run_type"]=="warm" {
            v=$h["eval_tok_s"]
            mj=$h["majflt_delta"]
            if (v!="" && v+0==v) {
                n_all++
                a_all[n_all]=v+0
                m_all[n_all]=(mj=="" ? -1 : mj+0)
            }
        }
        function med(arr, n,    i,j,x) {
            if (n==0) return ""
            for(i=1;i<=n;i++) for(j=i+1;j<=n;j++) if(arr[j]<arr[i]){x=arr[i];arr[i]=arr[j];arr[j]=x}
            if (n%2) return sprintf("%.2f", arr[int(n/2)+1])
            return sprintf("%.2f", (arr[n/2]+arr[n/2+1])/2)
        }
        END {
            if (n_all==0) { print ""; exit }
            start = n_all - reps + 1
            if (start < 1) start = 1
            n_batch = 0
            n_low = 0
            for (i = start; i <= n_all; i++) {
                n_batch++
                b_all[n_batch] = a_all[i]
                if (m_all[i] >= 0 && m_all[i] <= mjmax+0) {
                    n_low++
                    b_low[n_low] = a_all[i]
                }
            }
            if (n_low > 0) print med(b_low, n_low)
            else print med(b_all, n_batch)
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

last_eval_for_config() {
    _t="$1"; _c="$2"; _k="$3"
    _base="$(basename "$MODEL")"
    if [ ! -f "$CSV_PATH" ]; then echo ""; return; fi
    awk -F, -v phase="$PHASE" -v model="$_base" -v t="$_t" -v c="$_c" -v k="$_k" '
        NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
        $h["phase"]==phase && $h["model"]==model && $h["threads"]==t && $h["n_ctx"]==c && $h["kv_type"]==k && $h["run_type"]=="warm" {
            v=$h["eval_tok_s"]
            if (v!="" && v+0==v) last=v
        }
        END{print last}
    ' "$CSV_PATH"
}

# measure_config t c k tag [need_total]
# need_total defaults to REPS. On sentinel-fail redo, pass REPS*attempt so new
# rows are collected; median uses last REPS only (no reuse of invalidated batch).
measure_config() {
    _t="$1"; _c="$2"; _k="$3"; _tag="$4"
    _need="${5:-$REPS}"
    _have="$(count_rows_for_config "$_t" "$_c" "$_k")"
    if [ "$_have" -ge "$_need" ]; then
        log "skip already have $_have>=$_need rows for t=$_t c=$_c kv=$_k"
        return 0
    fi
    _start=$((_have + 1))
    for _r in $(seq "$_start" "$_need"); do
        log "measure $_tag rep $_r/$_need t=$_t c=$_c kv=$_k"
        run_one "$_t" "$_c" "$_k" "${PHASE} ${_tag} t=${_t} c=${_c} kv=${_k} rep=${_r} cool${COOLDOWN_S}s T<=${MAX_COOL_TEMP}"
    done
}

# Sentinel: one extra run of winner; fail if |last-median|/median > 15%
sentinel_check() {
    _t="$1"; _c="$2"; _k="$3"; _stage="$4"
    _med="$(median_eval_for_config "$_t" "$_c" "$_k")"
    if [ -z "$_med" ]; then
        log "SENTINEL skip $_stage: no median for t=$_t c=$_c kv=$_k"
        echo "fail"
        return 0
    fi
    log "SENTINEL $_stage winner t=$_t c=$_c kv=$_k median=$_med — extra run"
    run_one "$_t" "$_c" "$_k" "${PHASE} sentinel_${_stage} t=${_t} c=${_c} kv=${_k} cool${COOLDOWN_S}s T<=${MAX_COOL_TEMP}"
    _last="$(last_eval_for_config "$_t" "$_c" "$_k")"
    # recompute median excluding nothing: use pre-sentinel median vs last
    _drift="$(awk -v m="$_med" -v l="${_last:-0}" 'BEGIN{
        if (m+0<=0) {print 1; exit}
        d=(l+0)-(m+0); if (d<0) d=-d;
        printf "%.4f", d/(m+0)
    }')"
    log "SENTINEL $_stage last=$_last median=$_med drift=$_drift (max $SENTINEL_MAX_DRIFT)"
    _bad="$(awk -v d="$_drift" -v m="$SENTINEL_MAX_DRIFT" 'BEGIN{print (d+0>m+0)?1:0}')"
    if [ "$_bad" = "1" ]; then
        log "SENTINEL FAIL $_stage drift $_drift > $SENTINEL_MAX_DRIFT"
        echo "fail"
    else
        log "SENTINEL PASS $_stage"
        echo "pass"
    fi
}

pick_best() {
    awk '
        NF>=2 {
            v=$1+0; $1=""; sub(/^ /,""); k=$0
            if (k!="" && (bestk=="" || v>bestv)) {bestv=v; bestk=k}
        }
        END{print bestk}
    '
}

log "=== start $PHASE model=$MODEL binary=$BINARY cooldown=${COOLDOWN_S}s cool_temp≤${MAX_COOL_TEMP} majflt_max=${MAJFLT_BASELINE_MAX} ==="
echo "phase=$PHASE model=$(basename "$MODEL") start=$(date -Iseconds 2>/dev/null || date) protocol=cool${COOLDOWN_S}_T${MAX_COOL_TEMP}_maj${MAJFLT_BASELINE_MAX}" >"$STATE_FILE"

# need_for_attempt t c k → REPS on first try; have+REPS on redo (always REPS fresh rows)
need_for_attempt() {
    if [ "$_stage_try" -le 1 ]; then
        echo "$REPS"
    else
        _h="$(count_rows_for_config "$1" "$2" "$3")"
        echo $((_h + REPS))
    fi
}

if [ "$PHASE" = "F2.3c-bis" ]; then
    # Reduced single-cell from F2.3c best (PLAN 2026-08-05): t=4 c=512 kv=q8_0
    # 3 reps + sentinel; redo once on sentinel fail. One variable at a time = fixed cell.
    BEST_T=4
    BEST_C=512
    BEST_K="q8_0"
    log "F2.3c-bis reduced grid: fixed cell t=$BEST_T c=$BEST_C kv=$BEST_K (from F2.3c best)"
    _stage_try=1
    while [ "$_stage_try" -le 2 ]; do
        log "STAGE reduced-cell t=$BEST_T c=$BEST_C kv=$BEST_K (attempt $_stage_try)"
        _need_total="$(need_for_attempt "$BEST_T" "$BEST_C" "$BEST_K")"
        measure_config "$BEST_T" "$BEST_C" "$BEST_K" "reduced" "$_need_total"
        _m="$(median_eval_for_config "$BEST_T" "$BEST_C" "$BEST_K")"
        log "median reduced t=$BEST_T c=$BEST_C kv=$BEST_K → ${_m:-NA} (last ${REPS} rows, low-majflt preferred)"
        _sres="$(sentinel_check "$BEST_T" "$BEST_C" "$BEST_K" "reduced")"
        if [ "$_sres" = "pass" ]; then
            break
        fi
        log "STAGE reduced INVALID — will redo with new reps (attempt was $_stage_try)"
        _stage_try=$((_stage_try + 1))
        if [ "$_stage_try" -gt 2 ]; then
            log "WARN: reduced sentinel failed twice — keeping cell t=$BEST_T c=$BEST_C kv=$BEST_K with warning"
        fi
    done
else
    # declared start config (PLAN F2.2 / F2.3c full greedy)
    BEST_T=5
    BEST_C=1024
    BEST_K="q8_0"

    # --- stage 1: threads ---
    # Declared start: BEST_T=5 BEST_C=1024 BEST_K=q8_0 (measure all of {4,5,6})
    _stage_try=1
    while [ "$_stage_try" -le 2 ]; do
        log "STAGE threads {4,5,6} with c=$BEST_C kv=$BEST_K (attempt $_stage_try)"
        for t in 4 5 6; do
            _need_total="$(need_for_attempt "$t" "$BEST_C" "$BEST_K")"
            measure_config "$t" "$BEST_C" "$BEST_K" "threads" "$_need_total"
        done
        _best_line=""
        for t in 4 5 6; do
            _m="$(median_eval_for_config "$t" "$BEST_C" "$BEST_K")"
            log "median threads t=$t → ${_m:-NA} (last ${REPS} rows, low-majflt preferred)"
            if [ -n "$_m" ]; then
                _best_line="${_best_line}${_m} ${t}\n"
            fi
        done
        _pick="$(printf '%b' "$_best_line" | pick_best)"
        if [ -n "$_pick" ]; then
            BEST_T="$_pick"
        fi
        log "BEST threads → $BEST_T"
        _sres="$(sentinel_check "$BEST_T" "$BEST_C" "$BEST_K" "threads")"
        if [ "$_sres" = "pass" ]; then
            break
        fi
        log "STAGE threads INVALID — will redo with new reps (attempt was $_stage_try)"
        _stage_try=$((_stage_try + 1))
        if [ "$_stage_try" -gt 2 ]; then
            log "WARN: threads sentinel failed twice — keeping BEST_T=$BEST_T with warning"
        fi
    done

    # --- stage 2: ctx ---
    _stage_try=1
    while [ "$_stage_try" -le 2 ]; do
        log "STAGE ctx {512,1024,4096} with t=$BEST_T kv=$BEST_K (attempt $_stage_try)"
        for c in 512 1024 4096; do
            _need_total="$(need_for_attempt "$BEST_T" "$c" "$BEST_K")"
            measure_config "$BEST_T" "$c" "$BEST_K" "ctx" "$_need_total"
        done
        _best_line=""
        for c in 512 1024 4096; do
            _m="$(median_eval_for_config "$BEST_T" "$c" "$BEST_K")"
            log "median ctx c=$c → ${_m:-NA} (last ${REPS} rows, low-majflt preferred)"
            if [ -n "$_m" ]; then
                _best_line="${_best_line}${_m} ${c}\n"
            fi
        done
        _pick="$(printf '%b' "$_best_line" | pick_best)"
        if [ -n "$_pick" ]; then
            BEST_C="$_pick"
        fi
        log "BEST ctx → $BEST_C"
        _sres="$(sentinel_check "$BEST_T" "$BEST_C" "$BEST_K" "ctx")"
        if [ "$_sres" = "pass" ]; then
            break
        fi
        log "STAGE ctx INVALID — will redo with new reps (attempt was $_stage_try)"
        _stage_try=$((_stage_try + 1))
        if [ "$_stage_try" -gt 2 ]; then
            log "WARN: ctx sentinel failed twice — keeping BEST_C=$BEST_C with warning"
        fi
    done

    # --- stage 3: kv ---
    _stage_try=1
    while [ "$_stage_try" -le 2 ]; do
        log "STAGE kv {f16,q8_0} with t=$BEST_T c=$BEST_C (attempt $_stage_try)"
        for k in f16 q8_0; do
            _need_total="$(need_for_attempt "$BEST_T" "$BEST_C" "$k")"
            measure_config "$BEST_T" "$BEST_C" "$k" "kv" "$_need_total"
        done
        _best_line=""
        for k in f16 q8_0; do
            _m="$(median_eval_for_config "$BEST_T" "$BEST_C" "$k")"
            log "median kv k=$k → ${_m:-NA} (last ${REPS} rows, low-majflt preferred)"
            if [ -n "$_m" ]; then
                _best_line="${_best_line}${_m} ${k}\n"
            fi
        done
        _pick="$(printf '%b' "$_best_line" | pick_best)"
        if [ -n "$_pick" ]; then
            BEST_K="$_pick"
        fi
        log "BEST kv → $BEST_K"
        _sres="$(sentinel_check "$BEST_T" "$BEST_C" "$BEST_K" "kv")"
        if [ "$_sres" = "pass" ]; then
            break
        fi
        log "STAGE kv INVALID — will redo with new reps (attempt was $_stage_try)"
        _stage_try=$((_stage_try + 1))
        if [ "$_stage_try" -gt 2 ]; then
            log "WARN: kv sentinel failed twice — keeping BEST_K=$BEST_K with warning"
        fi
    done
fi


_final_med="$(median_eval_for_config "$BEST_T" "$BEST_C" "$BEST_K")"
{
    echo "# $PHASE summary"
    echo
    echo "- model: \`$(basename "$MODEL")\`"
    echo "- best: threads=$BEST_T ctx=$BEST_C kv=$BEST_K"
    echo "- median eval_tok_s (low-majflt preferred): ${_final_med:-NA}"
    echo "- protocol: cooldown=${COOLDOWN_S}s cool_temp≤${MAX_COOL_TEMP} majflt_max=${MAJFLT_BASELINE_MAX} sentinel_drift≤${SENTINEL_MAX_DRIFT}"
    echo "- n_gen: $N_GEN prompt: $PROMPT_ID"
    echo "- binary: \`$BINARY\`"
    echo "- finished: $(date -Iseconds 2>/dev/null || date)"
} | tee "$SUMMARY_FILE" >&2

echo "best_t=$BEST_T best_c=$BEST_C best_k=$BEST_K median=${_final_med:-}" >>"$STATE_FILE"
log "=== done $PHASE best t=$BEST_T c=$BEST_C kv=$BEST_K median=${_final_med:-NA} ==="
exit 0
