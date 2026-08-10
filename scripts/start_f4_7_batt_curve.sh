#!/usr/bin/env bash
# F4.7 — curva batteria-prestazioni. Config FISSA del gate. Phase F4.7-batt-curve.
# NON confrontare con gate. Annota power saver. Stop ~8-10%.
set -euo pipefail
export LC_ALL=C

HOME="${HOME:-/data/data/com.termux/files/home}"
EXP="$HOME/experiments"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"

# --- campaign binary pin (fix-bloccanti-audit §C) ---
_PIN_LIB=""
for _d in \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" \
  "$HOME/experiments/scripts" \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." 2>/dev/null && pwd)/scripts" \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." 2>/dev/null && pwd)/scripts"
do
  [ -n "$_d" ] && [ -f "$_d/lib_campaign_pin.sh" ] && _PIN_LIB="$_d/lib_campaign_pin.sh" && break
done
if [ -n "$_PIN_LIB" ]; then
  # shellcheck disable=SC1090
  source "$_PIN_LIB"
  assert_campaign_pin "$BIN"
else
  _sha_file="${CAMPAIGN_SHA_FILE:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256}"
  _exp=$(awk 'NF{print $1; exit}' "$_sha_file" 2>/dev/null || true)
  _got=$(sha256sum "$BIN" 2>/dev/null | awk '{print $1}')
  BIN_SHA256="$_got"
  if [ "${ALLOW_UNPINNED:-0}" != "1" ]; then
    case "$BIN" in *.CAMPAIGN) ;; *)
      echo "ERRORE pin campagna: usare bmoe-cli.CAMPAIGN (got $BIN). ALLOW_UNPINNED=1 per override." >&2
      exit 6
    ;; esac
    if [ -z "$_exp" ] || [ "$_got" != "$_exp" ]; then
      echo "ERRORE pin campagna: sha mismatch got=$_got expected=$_exp ($_sha_file)" >&2
      exit 6
    fi
  fi
fi
export BIN_SHA256="${BIN_SHA256:-}"
# --- end pin ---

MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
EXPECTED_SIZE="11522702304"
RUN_BENCH="${RUN_BENCH:-$EXP/scripts/run_bench.sh}"
CSV="${RUNS_CSV:-$EXP/results/runs.csv}"
OUTDIR="$EXP/results/f4.7"
PROMPT_FILE="${PROMPT_FILE:-$EXP/prompts/short.txt}"
PHASE="F4.7-batt-curve"
FLAGS='--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --drop-cold-experts 0.50'
THREADS=4
N_GEN=64
N_CTX=512
RUNTIME_COMMIT="${RUNTIME_COMMIT:-b0c4e5b}"
RUN_TIMEOUT_S="${RUN_TIMEOUT_S:-2700}"
COOLDOWN_S="${COOLDOWN_S:-180}"
MAX_START_TEMP="${MAX_START_TEMP:-32.0}"
STOP_PCT="${STOP_PCT:-9}"
TARGETS=(40 35 30 25 20 15 10)

mkdir -p "$OUTDIR" "$EXP/results/logs"
export TMPDIR="${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
mkdir -p "$TMPDIR" 2>/dev/null || true

_ld_dir="$(cd "$(dirname "$BIN")" && pwd -P 2>/dev/null || dirname "$BIN")"
export LD_LIBRARY_PATH="${_ld_dir}:${_ld_dir}/../bin:${LD_LIBRARY_PATH:-}"

MASTER="$OUTDIR/F4.7-batt-curve.runner.log"
exec > >(tee -a "$MASTER") 2>&1
SUMMARY="$OUTDIR/curve_summary.csv"
if [ ! -f "$SUMMARY" ]; then
    echo "ts,target_pct,battery_pct,temp_c,eval_tok_s,nproc,affinity_mask,power_saver,run_id,notes" > "$SUMMARY"
fi

log() { echo "[$(date -Iseconds 2>/dev/null || date)] $*"; }

read_batt_json() {
    termux-battery-status 2>/dev/null || true
}

batt_fields() {
    # stdout: pct temp plugged
    read_batt_json | python3 -c 'import sys,json
s=sys.stdin.read()
try:
 d=json.loads(s)
 print(int(d.get("percentage", d.get("level", -1))), float(d.get("temperature", -1)), d.get("plugged",""))
except Exception:
 print(-1, -1, "")
' 2>/dev/null
}

power_saver_state() {
    # ON/OFF/UNKNOWN — dumpsys (Termux settings often denied)
    local out
    out="$(dumpsys power 2>/dev/null || true)"
    if printf '%s' "$out" | grep -qiE 'Battery Saver is currently:[[:space:]]*ON|mLowPowerModeEnabled=true|isPowerSaveMode=true'; then
        echo "ON"; return
    fi
    if printf '%s' "$out" | grep -qiE 'Battery Saver is currently:[[:space:]]*OFF|mLowPowerModeEnabled=false|isPowerSaveMode=false'; then
        echo "OFF"; return
    fi
    local lp
    lp="$(settings get global low_power 2>/dev/null || true)"
    case "$lp" in
        1) echo "ON" ;;
        0) echo "OFF" ;;
        *) echo "UNKNOWN" ;;
    esac
}

preflight_cores() {
    local n
    n="$(nproc 2>/dev/null || echo 0)"
    local cg
    cg="$(cat /proc/self/cgroup 2>/dev/null | grep cpuset || true)"
    log "preflight nproc=$n cgroup=$cg"
    if [ "${n:-0}" -lt 6 ]; then
        log "FATAL: nproc=$n < 6 — NON misurare (Termux background)"
        return 2
    fi
    if [ ! -x "$BIN" ] && [ ! -e "$BIN" ]; then
        log "FATAL: binary missing $BIN"; return 2
    fi
    local sz
    sz="$(stat -c%s "$MODEL" 2>/dev/null || wc -c < "$MODEL")"
    if [ "$sz" != "$EXPECTED_SIZE" ]; then
        log "FATAL: model size $sz != $EXPECTED_SIZE"; return 2
    fi
    return 0
}

cool_before_run() {
    local max_wait="${1:-900}"
    local waited=0
    while [ "$waited" -lt "$max_wait" ]; do
        # shellcheck disable=SC2046
        set -- $(batt_fields)
        local pct="${1:--1}" temp="${2:--1}" plugged="${3:-}"
        if [ "$plugged" != "UNPLUGGED" ] && [ -n "$plugged" ]; then
            log "FATAL: plugged=$plugged — misure invalide in carica"; return 4
        fi
        local ok
        ok="$(awk -v t="$temp" -v m="$MAX_START_TEMP" 'BEGIN{
            if (t+0 < 0) {print 0; exit}
            print (t+0 <= m+0) ? 1 : 0
        }')"
        if [ "$ok" = "1" ]; then
            log "cool ok T=${temp}C pct=${pct} waited=${waited}s"
            return 0
        fi
        log "cool wait T=${temp}C > ${MAX_START_TEMP} pct=${pct} (waited ${waited}s/${max_wait}s) — thermal gate may skip if cannot cool"
        sleep 30
        waited=$((waited+30))
    done
    log "WARN: cool timeout; attempting run anyway (harness may reject if T>32)"
    return 0
}

wait_for_target() {
    # wait until battery_pct <= target (discharging). If already below, proceed.
    local target="$1"
    local max_wait="${2:-7200}"
    local waited=0
    while [ "$waited" -lt "$max_wait" ]; do
        # shellcheck disable=SC2046
        set -- $(batt_fields)
        local pct="${1:--1}" temp="${2:--1}" plugged="${3:-}"
        if [ "$pct" -lt 0 ] 2>/dev/null; then
            log "batt unreadable, sleep 30"; sleep 30; waited=$((waited+30)); continue
        fi
        if [ "$pct" -le "$target" ]; then
            log "target $target reached: pct=$pct T=$temp"
            return 0
        fi
        log "waiting discharge: pct=$pct > target=$target T=$temp (waited ${waited}s)"
        # light wake work is already on (screen); just sleep
        sleep 60
        waited=$((waited+60))
    done
    log "WARN: target $target not reached in ${max_wait}s"
    return 1
}

run_point() {
    local target="$1"
    preflight_cores || return $?
    # shellcheck disable=SC2046
    set -- $(batt_fields)
    local pct="${1:--1}" temp="${2:--1}" plugged="${3:-}"
    if [ "$pct" -ge 0 ] 2>/dev/null && [ "$pct" -le "$STOP_PCT" ]; then
        log "STOP: battery_pct=$pct <= stop $STOP_PCT"
        return 9
    fi
    local ps
    ps="$(power_saver_state)"
    log "point target=$target actual_pct=$pct T=$temp power_saver=$ps nproc=$(nproc)"

    cool_before_run 600 || true

    # re-read after cool
    set -- $(batt_fields)
    pct="${1:--1}"; temp="${2:--1}"; plugged="${3:-}"
    ps="$(power_saver_state)"
    local notes="F4.7-batt-curve target=${target} power_saver=${ps} screen=on fixed-gate-config; DO_NOT_COMPARE_TO_GATE"

    log "=== RUN target=$target pct=$pct T=$temp saver=$ps ==="
    set +e
    "$RUN_BENCH" \
        --model "$MODEL" \
        --prompt-file "$PROMPT_FILE" \
        --prompt-id short \
        --phase "$PHASE" \
        --quant UD-IQ2_M \
        --file-gb 11.52 \
        --runtime bigmoe \
        --runtime-commit "$RUNTIME_COMMIT" \
        --flags "$FLAGS" \
        --threads "$THREADS" \
        --ctx "$N_CTX" \
        --kv-type q8_0 \
        --n-gen "$N_GEN" \
        --run-type warm \
        --binary "$BIN" \
        --csv "$CSV" \
        --notes "$notes" \
        --run-timeout "$RUN_TIMEOUT_S"
    local rc=$?
    set -e
    log "=== END target=$target rc=$rc ==="

    # append summary from last CSV row with this phase
    local last
    last="$(grep ",${PHASE}," "$CSV" 2>/dev/null | tail -n1 || true)"
    local run_id eval_s nproc mask battp
    run_id="$(printf '%s' "$last" | cut -d, -f1)"
    eval_s="$(printf '%s' "$last" | cut -d, -f17)"
    # battery_pct is col 26 in new schema; nproc 28 affinity 29
    battp="$(printf '%s' "$last" | cut -d, -f26)"
    nproc="$(printf '%s' "$last" | cut -d, -f28)"
    mask="$(printf '%s' "$last" | cut -d, -f29)"
    set -- $(batt_fields)
    local pct2="${1:--1}" temp2="${2:--1}"
    ps="$(power_saver_state)"
    echo "$(date -Iseconds 2>/dev/null || date),$target,${battp:-$pct2},$temp2,$eval_s,$nproc,$mask,$ps,$run_id,rc=$rc" >> "$SUMMARY"
    log "summary target=$target eval=$eval_s batt=${battp:-$pct2} nproc=$nproc mask=$mask saver=$ps rc=$rc"

    if [ "$rc" -eq 5 ]; then
        log "thermal reject — will retry after more cool on next loop"
    fi
    return 0
}

# --- main ---
termux-wake-lock 2>/dev/null || true
log "F4.7 batt-curve start BIN=$BIN FLAGS=$FLAGS STOP_PCT=$STOP_PCT"
preflight_cores || exit 2
log "battery now: $(batt_fields) power_saver=$(power_saver_state)"

# Dense sampling: one point every ~3-5% actual drop. Labels use actual pct as target tag.
# Already have point near 32 from prior partial run; continue downward.
LAST_SAMPLED_PCT=999
# If curve_summary has rows, seed LAST from last battery_pct
if [ -f "$SUMMARY" ]; then
    _ls="$(tail -n1 "$SUMMARY" | cut -d, -f3)"
    case "$_ls" in
        ''|battery_pct|*[!0-9]*) ;;
        *) LAST_SAMPLED_PCT="$_ls" ;;
    esac
fi
log "LAST_SAMPLED_PCT=$LAST_SAMPLED_PCT"

while true; do
    set -- $(batt_fields)
    pct="${1:--1}"; temp="${2:--1}"; plugged="${3:-}"
    if [ "$pct" -lt 0 ] 2>/dev/null; then
        log "batt unreadable; sleep 30"; sleep 30; continue
    fi
    if [ "$pct" -le "$STOP_PCT" ]; then
        log "STOP: pct=$pct <= $STOP_PCT"; break
    fi
    # need drop of at least 3 points from last sample (first sample always if LAST=999)
    drop=$((LAST_SAMPLED_PCT - pct))
    if [ "$LAST_SAMPLED_PCT" -lt 900 ] && [ "$drop" -lt 4 ]; then
        log "wait drop: pct=$pct last=$LAST_SAMPLED_PCT drop=$drop T=$temp — light drain 45s"
        # light multi-core burn to help discharge without long idle; 45s then recheck
        # keep screen on path; stop if heating hard
        too_hot="$(awk -v t="$temp" 'BEGIN{print (t+0>36)?1:0}')"
        if [ "$too_hot" = "0" ]; then
            # brief CPU burn (4 procs, 45s)
            for _i in 1 2 3 4 5 6; do
                ( dd if=/dev/zero of=/dev/null bs=1M count=5000 2>/dev/null & )
            done
            # also touch flash a bit (not during measure)
            ( dd if=/dev/zero of="$TMPDIR/drain.bin" bs=1M count=64 conv=fsync 2>/dev/null; rm -f "$TMPDIR/drain.bin" ) &
            sleep 60
            killall dd 2>/dev/null || true
        else
            sleep 60
        fi
        continue
    fi

    # map to nearest planned target label for readability
    tag="$pct"
    for target in "${TARGETS[@]}"; do
        d=$((pct - target)); [ "$d" -lt 0 ] && d=$((-d))
        if [ "$d" -le 2 ]; then tag="$target"; break; fi
    done

    run_point "$tag" || {
        rc=$?
        if [ "$rc" -eq 9 ] || [ "$rc" -eq 2 ] || [ "$rc" -eq 4 ]; then
            log "abort rc=$rc"; break
        fi
    }

    set -- $(batt_fields)
    pct="${1:--1}"
    LAST_SAMPLED_PCT="$pct"
    if [ "$pct" -ge 0 ] 2>/dev/null && [ "$pct" -le "$STOP_PCT" ]; then
        log "STOP after run: pct=$pct"; break
    fi
    log "cooldown ${COOLDOWN_S}s between points (last_sampled=$LAST_SAMPLED_PCT)"
    sleep "$COOLDOWN_S"
done

log "F4.7 batt-curve DONE"
log "summary file: $SUMMARY"
cat "$SUMMARY" || true
exit 0
