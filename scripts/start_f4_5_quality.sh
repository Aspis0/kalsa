#!/usr/bin/env bash
# F4.5 — QUALITÀ (priorità assoluta). Una passata per prompt, no cooldown/sentinel.
# Non è un protocollo di misura tempi: si legge il testo. --temp 0 (harness).
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
LOGDIR="$EXP/results/logs"
OUTDIR="$EXP/results/f4.5"
PHASE="F4.5-quality"
FLAGS='--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --drop-cold-experts 0.50 --chatml --no-think'
THREADS=4
N_GEN=200
N_CTX=512
RUNTIME_COMMIT="${RUNTIME_COMMIT:-b0c4e5b}"
RUN_TIMEOUT_S="${RUN_TIMEOUT_S:-2700}"

mkdir -p "$OUTDIR" "$LOGDIR" "$EXP/prompts"
export TMPDIR="${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
mkdir -p "$TMPDIR" 2>/dev/null || true

# LD: binary dir + sibling bin/ (RUNPATH already has bin, belt-and-suspenders)
_ld_dir="$(cd "$(dirname "$BIN")" && pwd -P 2>/dev/null || dirname "$BIN")"
export LD_LIBRARY_PATH="${_ld_dir}:${_ld_dir}/../bin:${LD_LIBRARY_PATH:-}"

MASTER="$OUTDIR/F4.5-quality.runner.log"
exec > >(tee -a "$MASTER") 2>&1

log() { echo "[$(date -Iseconds 2>/dev/null || date)] $*"; }

# Harness hard-fails at T>32. F4.5 does not need thermal protocol for *comparability*,
# but we still must pass the harness gate: wait until cool enough.
cool_wait() {
    local max_wait="${1:-900}"
    local target="32.0"
    local waited=0
    while [ "$waited" -lt "$max_wait" ]; do
        local t=""
        if command -v termux-battery-status >/dev/null 2>&1; then
            # Prefer python JSON parse; sed fallback without broken backrefs
            t="$(termux-battery-status 2>/dev/null | python3 -c 'import sys,json,re
s=sys.stdin.read()
try:
 d=json.loads(s); v=d.get("temperature");
 print(f"{float(v):.1f}" if v is not None else "")
except Exception:
 m=re.search(r"\"temperature\"\s*:\s*([0-9.]+)", s)
 print(m.group(1) if m else "")
' 2>/dev/null || true)"
        fi
        if [ -z "$t" ]; then
            log "cool_wait: temp unreadable, sleep 30"; sleep 30; waited=$((waited+30)); continue
        fi
        local too_hot
        too_hot="$(awk -v x="$t" -v y="$target" 'BEGIN{ print (x+0 > y+0) ? 1 : 0 }')"
        if [ "$too_hot" = "0" ]; then
            log "cool_wait: T=${t}C <= ${target} (waited ${waited}s)"; return 0
        fi
        log "cool_wait: T=${t}C > ${target}, sleep 30 (waited ${waited}s/${max_wait}s)"
        sleep 30
        waited=$((waited+30))
    done
    log "cool_wait: TIMEOUT after ${max_wait}s"; return 1
}


preflight() {
    local n
    n="$(nproc 2>/dev/null || echo 0)"
    local cg
    cg="$(cat /proc/self/cgroup 2>/dev/null | grep cpuset || true)"
    log "preflight nproc=$n cgroup=$cg"
    if [ "${n:-0}" -lt 6 ]; then
        log "FATAL: nproc=$n < 6 (Termux non in top-app / background). NON misurare."
        return 2
    fi
    if ! echo "$cg" | grep -q 'top-app'; then
        log "WARN: cpuset non top-app ($cg) — proseguo solo se nproc>=6"
    fi
    if [ ! -x "$BIN" ]; then
        log "FATAL: binary missing $BIN"; return 2
    fi
    if [ ! -f "$MODEL" ]; then
        log "FATAL: model missing $MODEL"; return 2
    fi
    local sz
    sz="$(stat -c%s "$MODEL" 2>/dev/null || wc -c < "$MODEL")"
    if [ "$sz" != "$EXPECTED_SIZE" ]; then
        log "FATAL: model size $sz != $EXPECTED_SIZE"; return 2
    fi
    # battery snapshot (info only; quality is battery-independent)
    if command -v termux-battery-status >/dev/null 2>&1; then
        log "battery: $(termux-battery-status 2>/dev/null | tr '\n' ' ')"
    fi
    # power saver via dumpsys if readable
    if dumpsys power 2>/dev/null | grep -qiE 'mLowPowerModeEnabled=true|Low power mode: true'; then
        log "power_saver=ON"
    else
        log "power_saver=OFF_or_unknown"
    fi
    return 0
}

run_one() {
    local prompt_id="$1"
    local prompt_file="$2"
    local notes="$3"
    local quant="UD-IQ2_M"
    local file_gb="11.52"
    local runtime="bigmoe"
    local model_path="$MODEL"
    local binary="$BIN"
    local flags="$FLAGS"
    local threads="$THREADS"
    local n_gen="$N_GEN"
    local rcommit="$RUNTIME_COMMIT"

    if [ ! -f "$prompt_file" ]; then
        log "FATAL: prompt missing $prompt_file"; return 2
    fi

    preflight || return $?
    cool_wait 1200 || return 5

    log "=== RUN prompt_id=$prompt_id file=$prompt_file n_gen=$n_gen ==="
    # run_bench writes CSV + log; capture rc
    set +e
    "$RUN_BENCH" \
        --model "$model_path" \
        --prompt-file "$prompt_file" \
        --prompt-id "$prompt_id" \
        --phase "$PHASE" \
        --quant "$quant" \
        --file-gb "$file_gb" \
        --runtime "$runtime" \
        --runtime-commit "$rcommit" \
        --flags "$flags" \
        --threads "$threads" \
        --ctx "$N_CTX" \
        --kv-type q8_0 \
        --n-gen "$n_gen" \
        --run-type warm \
        --binary "$binary" \
        --csv "$CSV" \
        --notes "$notes" \
        --run-timeout "$RUN_TIMEOUT_S"
    local rc=$?
    set -e
    log "=== END prompt_id=$prompt_id rc=$rc ==="
    return 0
}

run_4b_ref() {
    local prompt_id="f45_1_esplicativo_4bref"
    local prompt_file="$EXP/prompts/f45_1_esplicativo.txt"
    local model4="$HOME/models/Qwen3.5-4B-Q4_K_M.gguf"
    local bin4="${BINARY_4B:-$HOME/src/llama.cpp/build-safe2/bin/llama-cli}"
    local exp_sz="2740937888"

    preflight || return $?
    if [ ! -f "$model4" ]; then
        log "SKIP 4B: model missing $model4"; return 0
    fi
    local sz
    sz="$(stat -c%s "$model4" 2>/dev/null || wc -c < "$model4")"
    if [ "$sz" != "$exp_sz" ]; then
        log "SKIP 4B: size $sz != $exp_sz"; return 0
    fi
    if [ ! -e "$bin4" ]; then
        log "SKIP 4B: binary missing $bin4"; return 0
    fi

    # battery check: skip if critically low to preserve F4.7 headroom
    local pct=""
    if command -v termux-battery-status >/dev/null 2>&1; then
        pct="$(termux-battery-status 2>/dev/null | sed -n 's/.*"percentage"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1)"
    fi
    if [ -n "$pct" ] && [ "$pct" -lt 18 ] 2>/dev/null; then
        log "SKIP 4B: battery_pct=$pct < 18 (preserve headroom for F4.7 if quality ok)"
        return 0
    fi

    cool_wait 1200 || { log "SKIP 4B: cannot cool"; return 0; }
    log "=== RUN 4B reference prompt_id=$prompt_id ==="
    # chatml/no-think may not exist on mainline; use plain --temp 0 via harness
    set +e
    "$RUN_BENCH" \
        --model "$model4" \
        --prompt-file "$prompt_file" \
        --prompt-id "$prompt_id" \
        --phase "$PHASE" \
        --quant "Q4_K_M" \
        --file-gb "2.74" \
        --runtime mainline \
        --runtime-commit "${RUNTIME_COMMIT_MAINLINE:-67d5978}" \
        --flags "" \
        --threads 4 \
        --ctx 1024 \
        --kv-type f16 \
        --n-gen 200 \
        --run-type warm \
        --binary "$bin4" \
        --csv "$CSV" \
        --notes "F4.5 quality 4B reference vs UD-IQ2_M; same IT esplicativo prompt" \
        --run-timeout "$RUN_TIMEOUT_S"
    local rc=$?
    set -e
    log "=== END 4B rc=$rc ==="
}

# --- main ---
termux-wake-lock 2>/dev/null || true
log "F4.5 quality start BIN=$BIN MODEL=$(basename "$MODEL") FLAGS=$FLAGS"
preflight || exit 2

# ONLY=comma list of prompt ids to run (default: all). Example: ONLY=f45_2_scrittura,f45_3_istruzioni
ONLY="${ONLY:-}"
PROMPTS=(
    "f45_1_esplicativo:$EXP/prompts/f45_1_esplicativo.txt:F4.5 quality IT esplicativo; chatml+no-think; n=200; gate config"
    "f45_2_scrittura:$EXP/prompts/f45_2_scrittura.txt:F4.5 quality IT scrittura breve; chatml+no-think; n=200; gate config"
    "f45_3_istruzioni:$EXP/prompts/f45_3_istruzioni.txt:F4.5 quality IT istruzioni letterali; chatml+no-think; n=200; gate config"
    "f45_4_codice:$EXP/prompts/f45_4_codice.txt:F4.5 quality code Python; chatml+no-think; n=200; gate config"
    "f45_5_ragionamento:$EXP/prompts/f45_5_ragionamento.txt:F4.5 quality IT ragionamento breve; chatml+no-think; n=200; gate config"
)

for entry in "${PROMPTS[@]}"; do
    pid="${entry%%:*}"
    rest="${entry#*:}"
    pfile="${rest%%:*}"
    notes="${rest#*:}"
    if [ -n "$ONLY" ]; then
        case ",$ONLY," in
            *",$pid,"*) ;;
            *) log "SKIP $pid (ONLY=$ONLY)"; continue ;;
        esac
    fi
    run_one "$pid" "$pfile" "$notes" || log "WARN run_one failed for $pid (continuing)"
done

# optional 4B reference if battery allows
DO_4B="${DO_4B:-1}"
if [ -n "$ONLY" ] && [ "$DO_4B" != "1" ]; then
    log "SKIP 4B (DO_4B=$DO_4B)"
else
    if [ -z "$ONLY" ] || [ "$DO_4B" = "1" ]; then
        run_4b_ref || log "WARN 4B ref failed/skipped"
    fi
fi

log "F4.5 quality DONE"
# extract generations into OUTDIR for easy reading
for f in "$LOGDIR"/Qwen*-F4.5* "$LOGDIR"/Qwen3.6-35B-A3B-UD-IQ2_M-*.log "$LOGDIR"/Qwen3.5-4B-Q4_K_M-*.log; do
    [ -f "$f" ] || continue
done
# copy latest logs that match phase by grepping
python3 - <<'PY' 2>/dev/null || true
import os, glob, re
logdir = os.path.expanduser("~/experiments/results/logs")
outdir = os.path.expanduser("~/experiments/results/f4.5")
os.makedirs(outdir, exist_ok=True)
for path in sorted(glob.glob(logdir + "/*.log")):
    try:
        txt = open(path, "r", encoding="utf-8", errors="replace").read()
    except Exception:
        continue
    if "phase=F4.5-quality" not in txt and "F4.5-quality" not in txt:
        # harness writes phase= in header
        if "phase=F4.5" not in txt:
            continue
    base = os.path.basename(path)
    open(os.path.join(outdir, base), "w", encoding="utf-8").write(txt)
    # try extract generation text between prompt echo and generation: line
    print("copied", base)
PY

log "artifacts in $OUTDIR"
exit 0
