#!/usr/bin/env bash
# =============================================================================
# run_f3.sh — F3 "Il muro": mmap naive 35B on S23 (pure measurement)
#
# PLAN F3 + §8.2 (2026-08-05):
#   model: Qwen3.6-35B-A3B-UD-IQ2_M.gguf (hard size 11522702304 B)
#   n_gen=32, ctx=512, kv=q8_0, threads=4 (best F2.2c), mainline mmap
#   variants: default (phase F3) | --numa distribute (F3-numa) | --no-warmup (F3-nowarmup)
#   3 reps per variant: cold first (via cold_model.sh fadvise DONTNEED) then warm
#   cooldown ≥180 s between reps; T≤30.0 sentinel; abs start T≤32
#   battery floor 40% → CHARGE_NEEDED exit 92 (no wait for charger)
#   majflt >50k = high-pressure regime (expected for ALL F3 runs; still recorded)
#   lmkd/OOM = valid data (run_bench FAIL row + notes), not harness failure
#   cold=fadv (default, cold_model.sh) or cold=reboot (only if operator sets COLD_METHOD)
#   MemAvailable start MB recorded in notes as memavail_start_mb=N (covariate)
#
# Binary: $HOME/src/llama.cpp/build-safe/bin/llama-cli only (pin 67d5978).
# NEVER old build/. No network. No broad pkill. SSH-only control (no adb dependency).
#
# Uso (on phone; reboot NOT required — cold via ~/bin/cold_model.sh):
#   bash scripts/run_f3.sh --variant default --first-run-type cold
#   bash scripts/run_f3.sh --variant numa --first-run-type cold
#   bash scripts/run_f3.sh --variant nowarmup --first-run-type cold --reps 1
#   bash scripts/run_f3.sh --variant default --first-run-type warm --reps 2
# =============================================================================

set -euo pipefail
export LC_ALL=C

VARIANT="default"
FIRST_RUN_TYPE="cold"
REPS=3
DO_SENTINEL=1
MODEL="${MODEL:-$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf}"
EXPECTED_SIZE="11522702304"
PROMPT_FILE="${PROMPT_FILE:-$HOME/experiments/prompts/short.txt}"
PROMPT_ID="short"
N_GEN=32
THREADS=4
N_CTX=512
KV_TYPE="q8_0"
BINARY="${BINARY:-$HOME/src/llama.cpp/build-safe/bin/llama-cli}"
RUN_BENCH="${RUN_BENCH:-$HOME/experiments/scripts/run_bench.sh}"
CSV_PATH="${RUNS_CSV:-$HOME/experiments/results/runs.csv}"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-67d5978}"
FILE_GB="11.52"
QUANT="UD-IQ2_M"
COOLDOWN_S="${COOLDOWN_S:-180}"
MAX_START_TEMP="32.0"
MAX_COOL_TEMP="30.0"
MAJFLT_BASELINE_MAX="${MAJFLT_BASELINE_MAX:-50000}"
BATTERY_FLOOR=40
MAX_COOL_WAIT_S="${MAX_COOL_WAIT_S:-1800}"
# Run-level wall timeout per llama invocation (floor 2700 s = 45 min).
# 35B naive load alone can take 10–30+ min under thrash — never kill mid-load.
RUN_TIMEOUT_S="${RUN_TIMEOUT_S:-2700}"
# Cold method: fadv (default, via cold_model.sh) or reboot (operator-declared only).
# Never ambiguous in CSV notes: always cold=fadv or cold=reboot.
COLD_METHOD="${COLD_METHOD:-fadv}"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
# With fadv cold, first-rep cooldown is still required (thermal protocol).
# Only reboot-cold may skip the first idle wait (phone just finished boot cool-down).
SKIP_FIRST_COOLDOWN=0
if [ "$COLD_METHOD" = "reboot" ]; then
    SKIP_FIRST_COOLDOWN=1
fi

# LD_LIBRARY_PATH set after --binary is parsed (build-safe or build-safe2).
export TMPDIR="${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
mkdir -p "$TMPDIR" 2>/dev/null || true

usage() {
    cat <<'EOF' >&2
Uso: run_f3.sh --variant default|numa|nowarmup [opts]
  --first-run-type cold|warm   (default cold; cold via cold_model.sh unless COLD_METHOD=reboot)
  --reps N                     (default 3; first is first-run-type, rest warm)
  --no-sentinel                skip optional sentinel warm rep
  --model PATH
  --binary PATH                (must be build-safe llama-cli)
  --cooldown SEC               (default 180; floor 180)
  --max-cool-temp C            (default 30.0; ceiling 30.0)
  --majflt-max N               (default 50000; covariate only in F3)
  --run-timeout SEC            (default 2700; floor 2700 = 45 min per run)
  --cold-method fadv|reboot    (default fadv; reboot only when human rebooted)

Cold+warm pairing (§8.2 promoted B/B2):
  --first-run-type cold --reps 3  → rep1 cold + rep2 warm + rep3 warm SAME session
  cold via ~/bin/cold_model.sh (fadvise DONTNEED + mincore verify); exit non-zero aborts
  before run_bench so a failed cold never enters CSV. Notes always carry cold=fadv|reboot.
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --variant) VARIANT="${2:-}"; shift 2 ;;
        --first-run-type) FIRST_RUN_TYPE="${2:-}"; shift 2 ;;
        --reps) REPS="${2:-}"; shift 2 ;;
        --no-sentinel) DO_SENTINEL=0; shift ;;
        --model|-m) MODEL="${2:-}"; shift 2 ;;
        --binary) BINARY="${2:-}"; shift 2 ;;
        --prompt-file|-p) PROMPT_FILE="${2:-}"; shift 2 ;;
        --cooldown) COOLDOWN_S="${2:-}"; shift 2 ;;
        --max-cool-temp) MAX_COOL_TEMP="${2:-}"; shift 2 ;;
        --majflt-max) MAJFLT_BASELINE_MAX="${2:-}"; shift 2 ;;
        --run-timeout) RUN_TIMEOUT_S="${2:-}"; shift 2 ;;
        --cold-method) COLD_METHOD="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "arg: $1" >&2; usage; exit 3 ;;
    esac
done

case "$VARIANT" in
    default|numa|nowarmup) ;;
    *)
        echo "ERROR: --variant must be default|numa|nowarmup (got: $VARIANT)" >&2
        exit 3
        ;;
esac
case "$FIRST_RUN_TYPE" in
    cold|warm) ;;
    *)
        echo "ERROR: --first-run-type must be cold|warm (got: $FIRST_RUN_TYPE)" >&2
        exit 3
        ;;
esac
case "$COLD_METHOD" in
    fadv|reboot) ;;
    *)
        echo "ERROR: --cold-method must be fadv|reboot (got: $COLD_METHOD)" >&2
        exit 3
        ;;
esac
# Recompute first-cooldown skip after CLI may have changed COLD_METHOD
SKIP_FIRST_COOLDOWN=0
if [ "$COLD_METHOD" = "reboot" ]; then
    SKIP_FIRST_COOLDOWN=1
fi
case "$REPS" in
    ''|*[!0-9]*)
        echo "ERROR: --reps must be positive int (got: $REPS)" >&2
        exit 3
        ;;
esac
if [ "$REPS" -lt 1 ]; then
    echo "ERROR: --reps must be >=1" >&2
    exit 3
fi

# Phase tag + EXTRA flags for run_bench --flags (CSV flags column)
case "$VARIANT" in
    default)
        PHASE="F3"
        EXTRA_FLAGS=""
        VARIANT_TAG="mmap_default"
        ;;
    numa)
        PHASE="F3-numa"
        # TYPE required by pinned help: distribute|isolate|numactl
        # distribute → NUMA init path applies MADV_RANDOM on model mapping (PLAN B2)
        EXTRA_FLAGS="--numa distribute"
        VARIANT_TAG="numa_distribute"
        ;;
    nowarmup)
        PHASE="F3-nowarmup"
        EXTRA_FLAGS="--no-warmup"
        VARIANT_TAG="no_warmup"
        ;;
esac

if [ -z "$MODEL" ] || [ ! -f "$MODEL" ]; then
    echo "ERROR: model missing: $MODEL" >&2
    exit 3
fi

# Hard size gate (never download)
_msz="$(stat -c '%s' "$MODEL" 2>/dev/null || stat -f '%z' "$MODEL" 2>/dev/null || echo 0)"
if [ "$_msz" != "$EXPECTED_SIZE" ]; then
    echo "ERROR: F3 model size $_msz != $EXPECTED_SIZE (Qwen3.6-35B-A3B-UD-IQ2_M). Fix file; scripts never download." >&2
    exit 3
fi

# Safety floors/ceilings — reject, never silent clamp
_cd_lo="$(awk -v c="$COOLDOWN_S" 'BEGIN{print (c+0 < 180)?1:0}')"
if [ "$_cd_lo" = "1" ]; then
    echo "ERROR: --cooldown $COOLDOWN_S < 180 (PLAN §8.2; no bypass)" >&2
    exit 3
fi
_ct_hi="$(awk -v t="$MAX_COOL_TEMP" 'BEGIN{print (t+0 > 30.0)?1:0}')"
if [ "$_ct_hi" = "1" ]; then
    echo "ERROR: --max-cool-temp $MAX_COOL_TEMP > 30.0 (PLAN §8.2; no bypass)" >&2
    exit 3
fi
_ct_bad="$(awk -v t="$MAX_COOL_TEMP" 'BEGIN{print (t+0 <= 0)?1:0}')"
if [ "$_ct_bad" = "1" ]; then
    echo "ERROR: --max-cool-temp invalid: $MAX_COOL_TEMP" >&2
    exit 3
fi

# Run-timeout floor 2700 s (45 min). Reject below floor — never silent clamp.
case "$RUN_TIMEOUT_S" in
    ''|*[!0-9]*)
        echo "ERROR: --run-timeout must be positive int (got: $RUN_TIMEOUT_S)" >&2
        exit 3
        ;;
esac
if [ "$RUN_TIMEOUT_S" -lt 2700 ]; then
    echo "ERROR: --run-timeout $RUN_TIMEOUT_S < 2700 (floor 45 min; 35B naive load can take 10–30+ min)" >&2
    exit 3
fi

if [ ! -x "$BINARY" ] && [ ! -f "$BINARY" ]; then
    echo "ERROR: binary missing: $BINARY" >&2
    exit 6
fi
case "$BINARY" in
    */build/bin/*)
        echo "ERROR: refused old build/ tree: $BINARY (use build-safe or build-safe2)" >&2
        exit 6
        ;;
esac
case "$BINARY" in
    */build-safe/*|*/build-safe2/*) ;;
    *)
        echo "ERROR: binary must be under build-safe/ or build-safe2/: $BINARY" >&2
        exit 6
        ;;
esac
# Shared libs live next to llama-cli (build-safe or build-safe2).
export LD_LIBRARY_PATH="$(cd "$(dirname "$BINARY")" && pwd):${LD_LIBRARY_PATH:-}"
if [ ! -f "$RUN_BENCH" ]; then
    echo "ERROR: run_bench missing: $RUN_BENCH" >&2
    exit 3
fi
if [ ! -f "$PROMPT_FILE" ]; then
    echo "ERROR: prompt file missing: $PROMPT_FILE" >&2
    exit 3
fi

STATE_DIR="$HOME/experiments/results/f3_state"
mkdir -p "$STATE_DIR" "$HOME/experiments/results/logs"
STATE_FILE="$STATE_DIR/${PHASE}.state"
SUMMARY_FILE="$STATE_DIR/${PHASE}.summary.md"
LOG_FILE="$STATE_DIR/${PHASE}.runner.log"
# also keep aggregate F3.runner.log for start_f3
AGG_LOG="$STATE_DIR/F3.runner.log"

# Graceful drop of nowarmup if pinned binary lacks --no-warmup (do not error).
# --numa is hard-required for the numa variant (already validated by start_f3).
# Skip the --help probe when RUN_BENCH is a test stub (offline harness tests).
if [ "$VARIANT" = "nowarmup" ] && [ -x "$BINARY" ] && [ "${F3_SKIP_BINARY_HELP:-0}" != "1" ]; then
    if command -v timeout >/dev/null 2>&1; then
        _help_now="$(timeout 8 "$BINARY" --help 2>&1 || true)"
    else
        _help_now="$("$BINARY" --help 2>&1 || true)"
    fi
    if [ -n "$_help_now" ] && ! printf '%s' "$_help_now" | grep -q -- '--no-warmup'; then
        _drop_msg="NOTE: pinned binary lacks --no-warmup — dropping F3-nowarmup variant gracefully (not an error)"
        echo "$_drop_msg" | tee -a "$LOG_FILE" >>"$AGG_LOG" >&2
        echo "nowarmup_dropped=1 reason=flag_unsupported binary=$BINARY" | tee -a "$LOG_FILE" >>"$AGG_LOG"
        echo "dropped=nowarmup" >"$STATE_FILE"
        exit 0
    fi
    # Empty help (fake binary / probe failed) → leave decision to start_f3 / operator;
    # do not false-drop on empty output.
fi

log() {
    _line="$(printf '%s %s' "$(date -Iseconds 2>/dev/null || date)" "$*")"
    printf '%s\n' "$_line" | tee -a "$LOG_FILE" >>"$AGG_LOG" >&2
}

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

# Pre-rep gate: UNPLUGGED, battery ≥40% (stop immediately if floor), temp ≤ cool sentinel.
# F3: battery floor is hard STOP (CHARGE_NEEDED), not wait-for-charger.
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
        # §8.2 + F3: floor → CHARGE_NEEDED stop (no charger wait)
        if [ -n "$_lv" ]; then
            _low_batt="$(awk -v l="$_lv" -v f="$BATTERY_FLOOR" 'BEGIN{print (l+0 < f+0)?1:0}')"
            if [ "$_low_batt" = "1" ]; then
                log "CHARGE_NEEDED: battery $_lv% <${BATTERY_FLOOR}% floor — STOP F3 (partial results stand)"
                echo "CHARGE_NEEDED battery=${_lv}" >>"$STATE_FILE"
                exit 92
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
        log "gate OK plugged=$_pl temp=$_tc lvl=${_lv:-?} cool≤$MAX_COOL_TEMP variant=$VARIANT phase=$PHASE"
        return 0
    done
}

cooldown_idle() {
    log "cooldown idle ${COOLDOWN_S}s"
    sleep "$COOLDOWN_S"
}

count_rows_phase() {
    _rt="${1:-}" # optional run_type filter
    _base="$(basename "$MODEL")"
    if [ ! -f "$CSV_PATH" ]; then echo 0; return; fi
    if [ -n "$_rt" ]; then
        awk -F, -v phase="$PHASE" -v model="$_base" -v rt="$_rt" '
            NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
            $h["phase"]==phase && $h["model"]==model && $h["run_type"]==rt {n++}
            END{print n+0}
        ' "$CSV_PATH"
    else
        awk -F, -v phase="$PHASE" -v model="$_base" '
            NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
            $h["phase"]==phase && $h["model"]==model {n++}
            END{print n+0}
        ' "$CSV_PATH"
    fi
}

# Median eval_tok_s for phase+run_type over last N rows (empty eval ignored)
median_eval() {
    _rt="$1"
    _nlast="${2:-$REPS}"
    _base="$(basename "$MODEL")"
    if [ ! -f "$CSV_PATH" ]; then echo ""; return; fi
    awk -F, -v phase="$PHASE" -v model="$_base" -v rt="$_rt" -v nlast="$_nlast" '
        NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
        $h["phase"]==phase && $h["model"]==model && $h["run_type"]==rt {
            v=$h["eval_tok_s"]
            if (v!="" && v+0==v) { n_all++; a[n_all]=v+0 }
        }
        function med(arr, n,    i,j,x) {
            if (n==0) return ""
            for(i=1;i<=n;i++) for(j=i+1;j<=n;j++) if(arr[j]<arr[i]){x=arr[i];arr[i]=arr[j];arr[j]=x}
            if (n%2) return sprintf("%.2f", arr[int(n/2)+1])
            return sprintf("%.2f", (arr[n/2]+arr[n/2+1])/2)
        }
        END {
            if (n_all==0) { print ""; exit }
            start = n_all - nlast + 1
            if (start < 1) start = 1
            nb=0
            for (i=start;i<=n_all;i++) { nb++; b[nb]=a[i] }
            print med(b, nb)
        }
    ' "$CSV_PATH"
}

run_one() {
    _rtype="$1"
    _rep="$2"
    _note_tag="$3"
    if [ "$SKIP_FIRST_COOLDOWN" -eq 1 ] && [ "$_rep" = "1" ] && [ "$_rtype" = "cold" ]; then
        log "skip cooldown before first cold rep (cold_method=$COLD_METHOD)"
    else
        cooldown_idle
    fi
    gate_ok

    # Cold path: fadvise DONTNEED via cold_model.sh BEFORE run_bench.
    # Non-zero exit => abort without CSV row (never report warm as cold).
    _cold_note=""
    if [ "$_rtype" = "cold" ]; then
        if [ "$COLD_METHOD" = "fadv" ]; then
            if [ ! -x "$COLD_MODEL_SH" ]; then
                log "BLOCKED: cold_model.sh missing/not executable: $COLD_MODEL_SH"
                exit 3
            fi
            log "cold_model fadv start: $COLD_MODEL_SH $MODEL"
            set +e
            "$COLD_MODEL_SH" "$MODEL" >>"$LOG_FILE" 2>&1
            _cold_ec=$?
            set -e
            if [ "$_cold_ec" -ne 0 ]; then
                log "BLOCKED: cold_model.sh exit $_cold_ec — cold run NOT started, no CSV row (rtype=cold rep=$_rep)"
                exit 3
            fi
            log "cold_model fadv OK (rep=$_rep)"
            _cold_note="cold=fadv"
        else
            # Operator declared a real reboot; do not call fadv.
            log "cold_method=reboot (operator-declared; no cold_model.sh call) rep=$_rep"
            _cold_note="cold=reboot"
        fi
    fi

    _flags_args=()
    if [ -n "$EXTRA_FLAGS" ]; then
        _flags_args=(--flags "$EXTRA_FLAGS")
    fi

    _notes="${PHASE} ${VARIANT_TAG} ${_note_tag} rep=${_rep} rtype=${_rtype} cool${COOLDOWN_S}s T<=${MAX_COOL_TEMP} majflt_gate=${MAJFLT_BASELINE_MAX}"
    if [ -n "$_cold_note" ]; then
        _notes="${_notes} ${_cold_note}"
    fi

    set +e
    # F3: --classic-perf drops --simple-io so llama_perf fills ttft_ms;
    # --run-timeout protects against mid-load kill (floor 2700 s).
    # memavail_start_mb is appended by run_bench from /proc/meminfo at start.
    bash "$RUN_BENCH" \
        --binary "$BINARY" \
        -m "$MODEL" \
        -p "$PROMPT_FILE" \
        --prompt-id "$PROMPT_ID" \
        --phase "$PHASE" \
        --runtime mainline \
        --runtime-commit "$RUNTIME_COMMIT" \
        --run-type "$_rtype" \
        --threads "$THREADS" \
        --ctx "$N_CTX" \
        --kv-type "$KV_TYPE" \
        --n-gen "$N_GEN" \
        --file-gb "$FILE_GB" \
        --quant "$QUANT" \
        --classic-perf \
        --run-timeout "$RUN_TIMEOUT_S" \
        --notes "$_notes" \
        "${_flags_args[@]}" >>"$LOG_FILE" 2>&1
    _ec=$?
    set -e

    # Propagate hard safety exits (no CSV row)
    if [ "$_ec" -eq 3 ] || [ "$_ec" -eq 4 ] || [ "$_ec" -eq 5 ] || [ "$_ec" -eq 6 ] || [ "$_ec" -eq 7 ]; then
        log "BLOCKED: run_bench exit $_ec (config/safety/binary) variant=$VARIANT rtype=$_rtype"
        exit "$_ec"
    fi
    # exit 8 = harness run-timeout — NOT valid F3 data (distinct from lmkd/OOM)
    if [ "$_ec" -eq 8 ]; then
        log "BLOCKED/timeout: run_bench exit 8 (harness run-timeout ${RUN_TIMEOUT_S}s) — NOT valid F3 data rtype=$_rtype rep=$_rep"
        # Continue remaining reps only if operator wants; treat as annotated miss, do not abort campaign.
        # (A killed mid-load run is not a scientific row; CSV may still have BLOCKED/timeout notes.)
    # exit 9 = REPL hang after generation — NOT valid data
    elif [ "$_ec" -eq 9 ]; then
        log "INVALID/repl: run_bench exit 9 (hung in interactive mode) — NOT valid F3 data rtype=$_rtype rep=$_rep"
    # exit 1 = llama fail (lmkd/OOM/crash) — VALID F3 data if CSV row written
    elif [ "$_ec" -eq 1 ]; then
        log "ANNOTATE: run_bench exit 1 (likely lmkd/OOM/crash) — valid F3 data if row present rtype=$_rtype rep=$_rep"
    elif [ "$_ec" -ne 0 ]; then
        log "WARN: run_bench exit $_ec rtype=$_rtype rep=$_rep"
    else
        log "OK: run_bench exit 0 rtype=$_rtype rep=$_rep"
    fi

    _bat_post="$(read_batt)"
    if [ -z "$(printf '%s' "$_bat_post" | awk '{print $1}')" ]; then
        log "BLOCKED: lost battery/API after run — possible reboot/instability"
        exit 91
    fi
    log "post-run batt: $_bat_post"
}

log "=== start F3 phase=$PHASE variant=$VARIANT first=$FIRST_RUN_TYPE reps=$REPS model=$(basename "$MODEL") size=$_msz binary=$BINARY flags='${EXTRA_FLAGS}' cooldown=${COOLDOWN_S}s cool≤${MAX_COOL_TEMP} run_timeout=${RUN_TIMEOUT_S}s classic_perf=1 cold_method=$COLD_METHOD ==="
# Explicit cold+warm same-boot pairing for promoted rows B/B2 (§8.2)
if [ "$FIRST_RUN_TYPE" = "cold" ] && [ "$REPS" -ge 2 ]; then
    log "PAIR cold+warm same session: rep1=cold($COLD_METHOD), reps 2..$REPS=warm (no reboot between; phase=$PHASE variant=$VARIANT)"
elif [ "$FIRST_RUN_TYPE" = "cold" ]; then
    log "PAIR cold only (reps=1 cold_method=$COLD_METHOD): single cold rep this invocation; warm must be same session if added later"
fi
{
    echo "phase=$PHASE variant=$VARIANT first=$FIRST_RUN_TYPE reps=$REPS"
    echo "model=$(basename "$MODEL") size=$_msz flags=${EXTRA_FLAGS:-<none>}"
    echo "start=$(date -Iseconds 2>/dev/null || date)"
    echo "protocol=cool${COOLDOWN_S}_T${MAX_COOL_TEMP}_maj${MAJFLT_BASELINE_MAX}_floor${BATTERY_FLOOR}_timeout${RUN_TIMEOUT_S}_classic_perf_cold${COLD_METHOD}"
    echo "cold_method=$COLD_METHOD"
    if [ "$FIRST_RUN_TYPE" = "cold" ] && [ "$REPS" -ge 2 ]; then
        echo "pair=cold+warm_same_session"
    fi
} >"$STATE_FILE"

# Resume: if phase already has enough measure rows, skip (not counting sentinel notes)
_have="$(count_rows_phase)"
# target measure rows = REPS (sentinel extra)
if [ "$_have" -ge "$REPS" ] && [ "$DO_SENTINEL" -eq 0 ]; then
    log "skip: already have $_have>=$REPS rows for phase=$PHASE"
elif [ "$_have" -ge $((REPS + DO_SENTINEL)) ]; then
    log "skip: already have $_have rows for phase=$PHASE (reps+sentinel)"
else
    for _r in $(seq 1 "$REPS"); do
        if [ "$_r" -eq 1 ]; then
            _rt="$FIRST_RUN_TYPE"
        else
            _rt="warm"
        fi
        # skip if this ordinal already exists? simple: count and only run missing
        _have_now="$(count_rows_phase)"
        if [ "$_have_now" -ge "$_r" ]; then
            log "skip rep $_r already have $_have_now rows for $PHASE"
            continue
        fi
        log "measure $PHASE rep $_r/$REPS run_type=$_rt flags='${EXTRA_FLAGS}'"
        run_one "$_rt" "$_r" "measure"
    done

    # Optional sentinel warm (same boot) if budget allows
    if [ "$DO_SENTINEL" -eq 1 ]; then
        _have_now="$(count_rows_phase)"
        _need_sent=$((REPS + 1))
        if [ "$_have_now" -ge "$_need_sent" ]; then
            log "skip sentinel: already have $_have_now rows"
        else
            log "sentinel warm for $PHASE (optional; battery gate may CHARGE_NEEDED)"
            run_one "warm" "sentinel" "sentinel"
        fi
    fi
fi

_med_cold="$(median_eval cold 10)"
_med_warm="$(median_eval warm 10)"
_nc="$(count_rows_phase cold)"
_nw="$(count_rows_phase warm)"
_nt="$(count_rows_phase)"

{
    echo "# $PHASE summary"
    echo
    echo "- model: \`$(basename "$MODEL")\` size=$EXPECTED_SIZE"
    echo "- variant: $VARIANT flags=\`${EXTRA_FLAGS:-}\`"
    echo "- threads=$THREADS ctx=$N_CTX kv=$KV_TYPE n_gen=$N_GEN"
    echo "- rows total=$_nt cold=$_nc warm=$_nw"
    echo "- median eval_tok_s cold: ${_med_cold:-NA}"
    echo "- median eval_tok_s warm: ${_med_warm:-NA}"
    echo "- protocol: cooldown=${COOLDOWN_S}s cool≤${MAX_COOL_TEMP} majflt_gate=${MAJFLT_BASELINE_MAX} floor=${BATTERY_FLOOR}%"
    echo "- binary: \`$BINARY\` commit=$RUNTIME_COMMIT"
    echo "- finished: $(date -Iseconds 2>/dev/null || date)"
    echo
    echo "F3 is pure measurement — any recorded naive numbers (incl. OOM/lmkd) are PASS."
} | tee "$SUMMARY_FILE" | tee -a "$AGG_LOG" >&2

echo "rows=$_nt med_cold=${_med_cold:-} med_warm=${_med_warm:-}" >>"$STATE_FILE"
log "=== done $PHASE rows=$_nt med_cold=${_med_cold:-NA} med_warm=${_med_warm:-NA} ==="
exit 0
