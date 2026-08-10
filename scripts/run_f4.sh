#!/usr/bin/env bash
# run_f4.sh — F4 BigMoeOnEdge streaming 35B on S23 (PLAN F4 + §8.2)
# Cold=fadv via cold_model.sh. Battery floor 40%. LD_LIBRARY_PATH from binary dir.
set -euo pipefail
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export LC_ALL=C

CELL="C"
FIRST_RUN_TYPE="cold"
REPS=3
DO_SENTINEL=1
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
EXPECTED_SIZE="11522702304"
PROMPT_FILE="${PROMPT_FILE:-$HOME/experiments/prompts/short.txt}"
PROMPT_ID="short"
N_GEN=64
THREADS=4
N_CTX=512
KV_TYPE="q8_0"
BINARY="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
RUN_BENCH="${RUN_BENCH:-$HOME/experiments/scripts/run_bench.sh}"
CSV_PATH="${RUNS_CSV:-$HOME/experiments/results/runs.csv}"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-b0c4e5b}"
FILE_GB="11.52"
QUANT="UD-IQ2_M"
COOLDOWN_S="${COOLDOWN_S:-180}"
MAX_START_TEMP="32.0"
MAX_COOL_TEMP="30.0"
BATTERY_FLOOR=40
MAX_COOL_WAIT_S="${MAX_COOL_WAIT_S:-1800}"
RUN_TIMEOUT_S="${RUN_TIMEOUT_S:-2700}"
COLD_METHOD="${COLD_METHOD:-fadv}"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
SKIP_FIRST_COOLDOWN=0
if [ "$COLD_METHOD" = "reboot" ]; then SKIP_FIRST_COOLDOWN=1; fi
TASKSET_CPUS="${TASKSET_CPUS:-}"
LOSSY_NOTE=""
export TMPDIR="${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
mkdir -p "$TMPDIR" 2>/dev/null || true

usage() {
    echo "Uso: run_f4.sh --cell C|C-topapp|C3bis-t{3,4,5,6}|F4.4-io5|F4.4-cache3000|F4.4-cache2500|... [opts]" >&2
    echo "  C / C-topapp: F4.2 baseline (t=4 cache-mb 2000); C-topapp tags F4.3-bis top-app remeasure" >&2
    echo "  C3bis-t{N}: F4.3-bis paired thread sweep -t N (cache-mb 2000 fixed)" >&2
    echo "  C3-t{N}/C3-k{N}: legacy F4.3 cells (INVALID under background cpuset)" >&2
    echo "  C3-t5-pin: -t 5 + taskset (may be clipped by cpuset)" >&2
}

while [ $# -gt 0 ]; do
    case "$1" in
        --cell) CELL="${2:-}"; shift 2 ;;
        --first-run-type) FIRST_RUN_TYPE="${2:-}"; shift 2 ;;
        --reps) REPS="${2:-}"; shift 2 ;;
        --no-sentinel) DO_SENTINEL=0; shift ;;
        --model|-m) MODEL="${2:-}"; shift 2 ;;
        --binary) BINARY="${2:-}"; shift 2 ;;
        --prompt-file|-p) PROMPT_FILE="${2:-}"; shift 2 ;;
        --runtime-commit) RUNTIME_COMMIT="${2:-}"; shift 2 ;;
        --cooldown) COOLDOWN_S="${2:-}"; shift 2 ;;
        --max-cool-temp) MAX_COOL_TEMP="${2:-}"; shift 2 ;;
        --run-timeout) RUN_TIMEOUT_S="${2:-}"; shift 2 ;;
        --cold-method) COLD_METHOD="${2:-}"; shift 2 ;;
        --threads|-t) THREADS="${2:-}"; shift 2 ;;
        --taskset) TASKSET_CPUS="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "arg: $1" >&2; usage; exit 3 ;;
    esac
done

case "$FIRST_RUN_TYPE" in cold|warm) ;; *) echo "ERROR: --first-run-type" >&2; exit 3 ;; esac
case "$COLD_METHOD" in fadv|reboot) ;; *) echo "ERROR: --cold-method" >&2; exit 3 ;; esac
case "$REPS" in ''|*[!0-9]*) echo "ERROR: --reps" >&2; exit 3 ;; esac
if [ "$COOLDOWN_S" -lt 180 ] 2>/dev/null; then COOLDOWN_S=180; fi
if [ "$RUN_TIMEOUT_S" -lt 2700 ] 2>/dev/null; then
    echo "ERROR: --run-timeout $RUN_TIMEOUT_S < 2700" >&2
    exit 3
fi

RUNTIME="bigmoe"
EXTRA_FLAGS=""
PHASE=""
VARIANT_TAG=""
case "$CELL" in
    C)
        PHASE="F4.2"; VARIANT_TAG="C"
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        ;;
    C-topapp)
        # F4.3-bis: same config as C, new phase/tag so rows don't collide with invalidated F4.2
        PHASE="F4.3-bis"; VARIANT_TAG="C-topapp"; THREADS=4
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        ;;
    C2-cache1500)
        PHASE="F4.3"; VARIANT_TAG="C2-cache1500"
        EXTRA_FLAGS="--moe-stream --cache-mb 1500 --dense-weights anon --overlap --io-threads 4"
        ;;
    C2-cache2000)
        PHASE="F4.3"; VARIANT_TAG="C2-cache2000"
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        ;;
    C2-cacheauto)
        PHASE="F4.3"; VARIANT_TAG="C2-cacheauto"
        EXTRA_FLAGS="--moe-stream --cache-mb auto --dense-weights anon --overlap --io-threads 4"
        ;;
    C2-ahwb)
        PHASE="F4.3"; VARIANT_TAG="C2-ahwb"
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights ahwb --overlap --io-threads 4"
        ;;
    C2-no-overlap)
        PHASE="F4.3"; VARIANT_TAG="C2-no-overlap"
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --io-threads 4"
        ;;
    C2-io2)
        PHASE="F4.3"; VARIANT_TAG="C2-io2"
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 2"
        ;;
    C2-io8)
        PHASE="F4.3"; VARIANT_TAG="C2-io8"
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 8"
        ;;
    C2-dio-mainline)
        PHASE="F4.3"; VARIANT_TAG="C2-dio-mainline"; RUNTIME="mainline"
        EXTRA_FLAGS="--load-mode dio"
        BINARY="${BINARY_MAINLINE:-$HOME/src/llama.cpp/build-safe2/bin/llama-cli}"
        RUNTIME_COMMIT="${RUNTIME_COMMIT_MAINLINE:-67d5978}"
        N_GEN=32
        ;;
    # --- F4.3 compute-attack: thread sweep (fixed cache-mb 2000) ---
    C3-t4)
        PHASE="F4.3"; VARIANT_TAG="C3-t4"; THREADS=4
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        ;;
    C3-t5)
        PHASE="F4.3"; VARIANT_TAG="C3-t5"; THREADS=5
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        ;;
    C3-t6)
        PHASE="F4.3"; VARIANT_TAG="C3-t6"; THREADS=6
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        ;;
    C3-t8)
        PHASE="F4.3"; VARIANT_TAG="C3-t8"; THREADS=8
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        ;;
    # --- F4.3-bis paired thread sweep (top-app remeasure) ---
    C3bis-t3)
        PHASE="F4.3-bis"; VARIANT_TAG="C3bis-t3"; THREADS=3
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        ;;
    C3bis-t4)
        PHASE="F4.3-bis"; VARIANT_TAG="C3bis-t4"; THREADS=4
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        ;;
    C3bis-t5)
        PHASE="F4.3-bis"; VARIANT_TAG="C3bis-t5"; THREADS=5
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        ;;
    C3bis-t6)
        PHASE="F4.3-bis"; VARIANT_TAG="C3bis-t6"; THREADS=6
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        ;;
    # --- F4.4 I/O attack (post gate PASS) ---
    F4.4-io5)
        # t=3 + io-threads 5: move one core from compute to I/O (total still 8)
        PHASE="F4.4"; VARIANT_TAG="F4.4-io5"; THREADS=3
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 5"
        ;;
    F4.4-cache3000)
        # more cache to reduce re-reads (hit-rate 56.9% baseline)
        PHASE="F4.4"; VARIANT_TAG="F4.4-cache3000"; THREADS=4
        EXTRA_FLAGS="--moe-stream --cache-mb 3000 --dense-weights anon --overlap --io-threads 4"
        ;;
    F4.4-cache2500)
        # safer RAM margin if 3000 triggers lmkd
        PHASE="F4.4"; VARIANT_TAG="F4.4-cache2500"; THREADS=4
        EXTRA_FLAGS="--moe-stream --cache-mb 2500 --dense-weights anon --overlap --io-threads 4"
        ;;
    C3-t5-pin)
        # -t 5 pinned to big cores: cpu3-6 perf (2.8GHz) + cpu7 prime (3.36GHz)
        PHASE="F4.3"; VARIANT_TAG="C3-t5-pin"; THREADS=5
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4"
        TASKSET_CPUS="${TASKSET_CPUS:-3-7}"
        ;;
    # --- F4.3 compute-attack: n-expert-used LOSSY diagnostic probe ---
    C3-k8)
        PHASE="F4.3"; VARIANT_TAG="C3-k8"
        # THREADS may be overridden via --threads (default best from thread sweep; else 5)
        if [ "$THREADS" = "4" ]; then THREADS=5; fi
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --n-expert-used 8"
        LOSSY_NOTE="LOSSY n-expert-used=8 diagnostic-only not-for-section9"
        ;;
    C3-k6)
        PHASE="F4.3"; VARIANT_TAG="C3-k6"
        if [ "$THREADS" = "4" ]; then THREADS=5; fi
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --n-expert-used 6"
        LOSSY_NOTE="LOSSY n-expert-used=6 diagnostic-only not-for-section9"
        ;;
    C3-k4)
        PHASE="F4.3"; VARIANT_TAG="C3-k4"
        if [ "$THREADS" = "4" ]; then THREADS=5; fi
        EXTRA_FLAGS="--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --n-expert-used 4"
        LOSSY_NOTE="LOSSY n-expert-used=4 diagnostic-only not-for-section9"
        ;;
    *)
        echo "ERROR: unknown --cell $CELL" >&2
        usage
        exit 3
        ;;
esac

_msz="$(stat -c '%s' "$MODEL" 2>/dev/null || stat -f '%z' "$MODEL" 2>/dev/null || echo 0)"
if [ "$_msz" != "$EXPECTED_SIZE" ]; then
    echo "ERROR: model size $_msz != $EXPECTED_SIZE" >&2
    exit 3
fi

if [ ! -x "$BINARY" ] && [ ! -f "$BINARY" ]; then
    for _cand in \
        "$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN" \
        "$HOME/src/BigMoeOnEdge/build-bmoe/bin/bmoe-cli" \
        "$HOME/src/BigMoeOnEdge/build-termux/cli/bmoe-cli" \
        "$HOME/experiments/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN"
    do
        if [ -x "$_cand" ]; then BINARY="$_cand"; break; fi
    done
fi
if [ ! -x "$BINARY" ] && [ ! -f "$BINARY" ]; then
    echo "ERROR: binary missing: $BINARY" >&2
    exit 6
fi
case "$BINARY" in
    */llama.cpp/build/*)
        echo "ERROR: refused old llama.cpp/build/ tree: $BINARY" >&2
        exit 6
        ;;
esac
export LD_LIBRARY_PATH="$(cd "$(dirname "$BINARY")" && pwd):${LD_LIBRARY_PATH:-}"
_bindir="$(cd "$(dirname "$BINARY")" && pwd)"
for _extra in "$_bindir" "$_bindir/.." "$_bindir/../bin" "$_bindir/bin"; do
    if [ -d "$_extra" ]; then
        _extra_abs="$(cd "$_extra" && pwd)"
        case ":$LD_LIBRARY_PATH:" in
            *":$_extra_abs:"*) ;;
            *) export LD_LIBRARY_PATH="${LD_LIBRARY_PATH}:$_extra_abs" ;;
        esac
    fi
done

if [ ! -f "$RUN_BENCH" ]; then
    echo "ERROR: run_bench missing: $RUN_BENCH" >&2
    exit 3
fi
if [ ! -f "$PROMPT_FILE" ]; then
    echo "ERROR: prompt file missing: $PROMPT_FILE" >&2
    exit 3
fi

STATE_DIR="$HOME/experiments/results/f4_state"
mkdir -p "$STATE_DIR" "$HOME/experiments/results/logs"
PHASE_KEY="${PHASE}-${VARIANT_TAG}"
STATE_FILE="$STATE_DIR/${PHASE_KEY}.state"
SUMMARY_FILE="$STATE_DIR/${PHASE_KEY}.summary.md"
LOG_FILE="$STATE_DIR/${PHASE_KEY}.runner.log"
AGG_LOG="$STATE_DIR/F4.runner.log"

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

# Hard gate: Termux must be top-app with >=6 cores covering CPU 0-5.
# Expected: nproc>=6 and affinity mask includes bits 0..5 (0x3f).
# Exit 93 if not (same class as battery gate — no CSV row).
gate_cpuset() {
    # Wait/retry like thermal gate: OEM can demote Termux to /moderate during idle.
    # Exit 93 only after MAX_COOL_WAIT_S without recovery.
    _waited=0
    while true; do
        _np="$(nproc 2>/dev/null || echo 0)"
        _mask=""
        if command -v taskset >/dev/null 2>&1; then
            _mask="$(taskset -p $$ 2>/dev/null | awk '{print $NF}')"
        fi
        _mask="$(printf '%s' "$_mask" | tr 'A-F' 'a-f' | sed 's/^0x//')"
        _cg="$(cat /proc/self/cgroup 2>/dev/null | awk -F: '/cpuset/{print $3; exit}')"
        _bits=0
        if [ -n "$_mask" ]; then
            _bits="$(bash -c 'm="$1"; v=$((16#$m)); c=0; while [ $v -gt 0 ]; do c=$((c+(v&1))); v=$((v>>1)); done; echo $c' bash "$_mask" 2>/dev/null || echo 0)"
        fi
        _ok=1
        if [ -z "$_np" ] || [ "$_np" -lt 6 ] 2>/dev/null; then _ok=0; fi
        case "$_cg" in
            *background*|*system-background*|*moderate*) _ok=0 ;;
        esac
        if [ -n "$_mask" ] && [ "$_bits" -lt 6 ] 2>/dev/null; then _ok=0; fi
        if [ "$_ok" -eq 1 ]; then
            log "cpuset OK nproc=$_np mask=${_mask:-?} bits=${_bits:-?} cgroup=${_cg:-?}"
            return 0
        fi
        log "WAIT/cpuset: nproc=${_np:-?} mask=${_mask:-?} bits=${_bits:-?} cgroup=${_cg:-?} — need top-app >=6 cores (waited ${_waited}s)"
        sleep 30
        _waited=$((_waited + 30))
        if [ "$_waited" -ge "$MAX_COOL_WAIT_S" ]; then
            log "BLOCKED/cpuset: no top-app recovery within ${MAX_COOL_WAIT_S}s (last nproc=${_np:-?} mask=${_mask:-?} cgroup=${_cg:-?})"
            exit 93
        fi
    done
}

gate_ok() {
    check_alive
    gate_cpuset
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
            log "WAIT: battery API empty — sleep 30s (waited ${_waited}s)"
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
        if [ -n "$_lv" ]; then
            _low_batt="$(awk -v l="$_lv" -v f="$BATTERY_FLOOR" 'BEGIN{print (l+0 < f+0)?1:0}')"
            if [ "$_low_batt" = "1" ]; then
                log "CHARGE_NEEDED: battery $_lv% <${BATTERY_FLOOR}% floor — STOP F4"
                echo "CHARGE_NEEDED battery=${_lv}" >>"$STATE_FILE"
                exit 92
            fi
        fi
        _hot_abs="$(awk -v t="$_tc" -v m="$MAX_START_TEMP" 'BEGIN{print (t+0>m+0)?1:0}')"
        _hot_cool="$(awk -v t="$_tc" -v m="$MAX_COOL_TEMP" 'BEGIN{print (t+0>m+0)?1:0}')"
        if [ "$_hot_abs" = "1" ] || [ "$_hot_cool" = "1" ]; then
            log "WAIT: temp $_tc need ≤$MAX_COOL_TEMP lvl=${_lv:-?} — sleep 30s"
            sleep 30
            _waited=$((_waited + 30))
            if [ "$_waited" -ge "$MAX_COOL_WAIT_S" ]; then
                log "BLOCKED: could not cool to ≤$MAX_COOL_TEMP within ${MAX_COOL_WAIT_S}s (last=$_tc)"
                exit 5
            fi
            continue
        fi
        log "gate OK plugged=$_pl temp=$_tc lvl=${_lv:-?} cell=$CELL phase=$PHASE"
        return 0
    done
}

cooldown_idle() {
    log "cooldown idle ${COOLDOWN_S}s"
    sleep "$COOLDOWN_S"
}

count_rows_cell() {
    _rt="${1:-}"
    _base="$(basename "$MODEL")"
    if [ ! -f "$CSV_PATH" ]; then echo 0; return; fi
    awk -F, -v phase="$PHASE" -v model="$_base" -v tag="$VARIANT_TAG" -v rt="$_rt" '
        NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
        $h["phase"]==phase && $h["model"]==model {
            if (index($h["notes"], tag)==0) next
            if (rt!="" && $h["run_type"]!=rt) next
            n++
        }
        END{print n+0}
    ' "$CSV_PATH"
}

median_eval_cell() {
    _rt="$1"
    _nlast="${2:-$REPS}"
    _base="$(basename "$MODEL")"
    if [ ! -f "$CSV_PATH" ]; then echo ""; return; fi
    awk -F, -v phase="$PHASE" -v model="$_base" -v tag="$VARIANT_TAG" -v rt="$_rt" -v nlast="$_nlast" '
        NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
        $h["phase"]==phase && $h["model"]==model && $h["run_type"]==rt {
            if (index($h["notes"], tag)==0) next
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
                log "BLOCKED: cold_model.sh exit $_cold_ec — cold run NOT started"
                exit 3
            fi
            log "cold_model fadv OK (rep=$_rep)"
            _cold_note="cold=fadv"
        else
            log "cold_method=reboot (operator-declared) rep=$_rep"
            _cold_note="cold=reboot"
        fi
    fi

    _flags_args=()
    if [ -n "$EXTRA_FLAGS" ]; then
        _flags_args=(--flags "$EXTRA_FLAGS")
    fi

    _np_now="$(nproc 2>/dev/null || echo ?)"
    _mask_now=""
    if command -v taskset >/dev/null 2>&1; then
        _mask_now="$(taskset -p $$ 2>/dev/null | awk '{print $NF}' | tr 'A-F' 'a-f' | sed 's/^0x//')"
    fi
    _screen_note="screen=on"
    _notes="${PHASE} ${VARIANT_TAG} ${_note_tag} rep=${_rep} rtype=${_rtype} cool${COOLDOWN_S}s T<=${MAX_COOL_TEMP} t=${THREADS} nproc=${_np_now} mask=${_mask_now:-\?} ${_screen_note}"
    if [ -n "$_cold_note" ]; then
        _notes="${_notes} ${_cold_note}"
    fi
    if [ -n "${LOSSY_NOTE:-}" ]; then
        _notes="${_notes} ${LOSSY_NOTE}"
    fi
    if [ -n "${TASKSET_CPUS:-}" ]; then
        _notes="${_notes} taskset=${TASKSET_CPUS}"
    fi

    _classic=()
    if [ "$RUNTIME" = "mainline" ]; then
        _classic=(--classic-perf)
    fi

    set +e
    if [ -n "${TASKSET_CPUS:-}" ]; then
        export TASKSET_CPUS
        log "taskset affinity: $TASKSET_CPUS"
    else
        unset TASKSET_CPUS 2>/dev/null || true
    fi
    bash "$RUN_BENCH" \
        --binary "$BINARY" \
        -m "$MODEL" \
        -p "$PROMPT_FILE" \
        --prompt-id "$PROMPT_ID" \
        --phase "$PHASE" \
        --runtime "$RUNTIME" \
        --runtime-commit "$RUNTIME_COMMIT" \
        --run-type "$_rtype" \
        --threads "$THREADS" \
        --ctx "$N_CTX" \
        --kv-type "$KV_TYPE" \
        --n-gen "$N_GEN" \
        --file-gb "$FILE_GB" \
        --quant "$QUANT" \
        --run-timeout "$RUN_TIMEOUT_S" \
        --notes "$_notes" \
        "${_classic[@]}" \
        "${_flags_args[@]}" >>"$LOG_FILE" 2>&1
    _ec=$?
    set -e

    if [ "$_ec" -eq 3 ] || [ "$_ec" -eq 4 ] || [ "$_ec" -eq 5 ] || [ "$_ec" -eq 6 ] || [ "$_ec" -eq 7 ]; then
        log "BLOCKED: run_bench exit $_ec cell=$CELL rtype=$_rtype"
        exit "$_ec"
    fi
    if [ "$_ec" -eq 8 ]; then
        log "BLOCKED/timeout: run_bench exit 8 (timeout ${RUN_TIMEOUT_S}s) rtype=$_rtype rep=$_rep"
    elif [ "$_ec" -eq 9 ]; then
        log "INVALID/repl: run_bench exit 9 rtype=$_rtype rep=$_rep"
    elif [ "$_ec" -eq 1 ]; then
        log "ANNOTATE: run_bench exit 1 (crash/lmkd?) rtype=$_rtype rep=$_rep"
    elif [ "$_ec" -ne 0 ]; then
        log "WARN: run_bench exit $_ec rtype=$_rtype rep=$_rep"
    else
        log "OK: run_bench exit 0 rtype=$_rtype rep=$_rep"
    fi

    if [ "$RUNTIME" = "bigmoe" ] && [ "$_ec" -eq 0 ]; then
        _last_ttft="$(awk -F, -v phase="$PHASE" -v tag="$VARIANT_TAG" '
            NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
            $h["phase"]==phase && index($h["notes"], tag)>0 { t=$h["ttft_ms"]; rid=$h["run_id"] }
            END{print t " " rid}
        ' "$CSV_PATH")"
        _tt="$(printf '%s' "$_last_ttft" | awk '{print $1}')"
        _rid="$(printf '%s' "$_last_ttft" | awk '{print $2}')"
        if [ -z "$_tt" ]; then
            log "WARN: ttft_ms EMPTY on bigmoe row run_id=$_rid — flag"
            echo "ttft_empty=1 run_id=${_rid}" >>"$STATE_FILE"
        else
            log "ttft_ms OK = $_tt (run_id=$_rid)"
        fi
    fi

    _bat_post="$(read_batt)"
    if [ -z "$(printf '%s' "$_bat_post" | awk '{print $1}')" ]; then
        log "BLOCKED: lost battery/API after run"
        exit 91
    fi
    log "post-run batt: $_bat_post"
}

log "=== start F4 cell=$CELL phase=$PHASE first=$FIRST_RUN_TYPE reps=$REPS model=$(basename "$MODEL") size=$_msz binary=$BINARY flags='${EXTRA_FLAGS}' runtime=$RUNTIME commit=$RUNTIME_COMMIT cooldown=${COOLDOWN_S}s cool≤${MAX_COOL_TEMP} run_timeout=${RUN_TIMEOUT_S}s cold_method=$COLD_METHOD LD=$LD_LIBRARY_PATH ==="
if [ "$FIRST_RUN_TYPE" = "cold" ] && [ "$REPS" -ge 2 ]; then
    log "PAIR cold+warm same session: rep1=cold($COLD_METHOD), reps 2..$REPS=warm"
fi
{
    echo "phase=$PHASE cell=$CELL first=$FIRST_RUN_TYPE reps=$REPS"
    echo "model=$(basename "$MODEL") size=$_msz flags=${EXTRA_FLAGS:-<none>}"
    echo "binary=$BINARY runtime=$RUNTIME commit=$RUNTIME_COMMIT"
    echo "start=$(date -Iseconds 2>/dev/null || date)"
    echo "protocol=cool${COOLDOWN_S}_T${MAX_COOL_TEMP}_floor${BATTERY_FLOOR}_timeout${RUN_TIMEOUT_S}_cold${COLD_METHOD}"
    echo "cold_method=$COLD_METHOD"
} >"$STATE_FILE"

_have="$(count_rows_cell)"
if [ "$_have" -ge $((REPS + DO_SENTINEL)) ]; then
    log "skip: already have $_have rows for cell=$CELL phase=$PHASE"
else
    for _r in $(seq 1 "$REPS"); do
        if [ "$_r" -eq 1 ]; then
            _rt="$FIRST_RUN_TYPE"
        else
            _rt="warm"
        fi
        _have_now="$(count_rows_cell)"
        if [ "$_have_now" -ge "$_r" ]; then
            log "skip rep $_r already have $_have_now rows for $CELL"
            continue
        fi
        log "measure $PHASE $CELL rep $_r/$REPS run_type=$_rt flags='${EXTRA_FLAGS}'"
        run_one "$_rt" "$_r" "measure"
    done

    if [ "$DO_SENTINEL" -eq 1 ]; then
        _have_now="$(count_rows_cell)"
        _need_sent=$((REPS + 1))
        if [ "$_have_now" -ge "$_need_sent" ]; then
            log "skip sentinel: already have $_have_now rows"
        else
            log "sentinel warm for $CELL"
            run_one "warm" "sentinel" "sentinel"
        fi
    fi
fi

_med_cold="$(median_eval_cell cold 10)"
_med_warm="$(median_eval_cell warm 10)"
_nc="$(count_rows_cell cold)"
_nw="$(count_rows_cell warm)"
_nt="$(count_rows_cell)"

{
    echo "# $PHASE $CELL summary"
    echo
    echo "- model: \`$(basename "$MODEL")\` size=$EXPECTED_SIZE"
    echo "- cell: $CELL flags=\`${EXTRA_FLAGS:-}\`"
    echo "- runtime=$RUNTIME threads=$THREADS ctx=$N_CTX n_gen=$N_GEN"
    echo "- rows total=$_nt cold=$_nc warm=$_nw"
    echo "- median eval_tok_s cold: ${_med_cold:-NA}"
    echo "- median eval_tok_s warm: ${_med_warm:-NA}"
    echo "- protocol: cooldown=${COOLDOWN_S}s cool≤${MAX_COOL_TEMP} floor=${BATTERY_FLOOR}%"
    echo "- binary: \`$BINARY\` commit=$RUNTIME_COMMIT"
    echo "- finished: $(date -Iseconds 2>/dev/null || date)"
} | tee "$SUMMARY_FILE" | tee -a "$AGG_LOG" >&2

echo "rows=$_nt med_cold=${_med_cold:-} med_warm=${_med_warm:-}" >>"$STATE_FILE"
log "=== done $PHASE $CELL rows=$_nt med_cold=${_med_cold:-NA} med_warm=${_med_warm:-NA} ==="
exit 0
