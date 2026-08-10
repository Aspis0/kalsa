#!/usr/bin/env bash
# Gate: --ppl-decode must reproduce the campaign PPL baseline (2.779) on a corpus
# subset BEFORE any drop-cold / runtime-lever sweep.
#
# PREPARED notte-9 (BINARIO B). Do NOT run on the phone tonight — cable + battery
# budget land tomorrow. Host smoke of scorer coherence is separate (short text,
# --ppl-file vs --ppl-decode agreement within ~1e-4).
#
# Success criteria (declared now):
#   1. Binary is the campaign pin (bmoe-cli.CAMPAIGN) unless ALLOW_UNPINNED=1.
#   2. --ppl-decode on CORPUS_SUBSET with campaign config (k=8, cache 2000,
#      dense-weights anon, no drop-cold) yields ppl within TOL of TARGET_PPL.
#   3. Per-token CSV is written (pos,token_id,logprob) for audit.
#
# Env overrides:
#   BINARY, MODEL, CORPUS_SUBSET, OUTDIR, TARGET_PPL, TOL, THREADS, CACHE_MB,
#   N_CTX, UBATCH, N_EXPERT_USED, ALLOW_UNPINNED
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:${PATH:-}"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/notte9/ppl_decode_gate}"
# Subset of mixed_it: default to the full corpus if no subset file is staged.
# Prefer a short ~2–5k-token slice for the first gate pass (faster, still decisive).
CORPUS_SUBSET="${CORPUS_SUBSET:-$HOME/experiments/quality/corpus_it/mixed_it.txt}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"

TARGET_PPL="${TARGET_PPL:-2.779}"
TOL="${TOL:-0.05}"   # absolute |ppl - target|; tighten once device noise is known
THREADS="${THREADS:-4}"
CACHE_MB="${CACHE_MB:-2000}"
IO_THREADS="${IO_THREADS:-4}"
N_CTX="${N_CTX:-4096}"
UBATCH="${UBATCH:-512}"
N_EXPERT_USED="${N_EXPERT_USED:-8}"

# --- campaign binary pin (same pattern as f55a_ppl_baseline.sh) ---
_PIN_LIB=""
for _d in \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" \
  "$HOME/experiments/scripts" \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd)/scripts"
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

export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$OUTDIR"
MASTER="$OUTDIR/ppl_decode_gate.master.log"
STDOUT="$OUTDIR/ppl_decode_gate.stdout"
STDERR="$OUTDIR/ppl_decode_gate.stderr"
CSV="$OUTDIR/ppl_decode_gate.per_token.csv"
JSON="$OUTDIR/ppl_decode_gate.json"
STATUS="$OUTDIR/STATUS_PPL_DECODE.txt"

BASE="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${UBATCH}"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

: > "$MASTER"
log "ppl-decode gate start (NOTTE-9 prep; run on device with cable)"
log "bin=$BIN"
sha256sum "$BIN" 2>/dev/null | tee -a "$MASTER" || true
log "corpus=$CORPUS_SUBSET"
sha256sum "$CORPUS_SUBSET" 2>/dev/null | tee -a "$MASTER" || true
log "model=$MODEL"
log "target_ppl=$TARGET_PPL tol=$TOL k=$N_EXPERT_USED cache_mb=$CACHE_MB n_ctx=$N_CTX"

if [ ! -f "$CORPUS_SUBSET" ]; then
  log "FAIL: corpus missing: $CORPUS_SUBSET"
  echo "FAIL corpus_missing" > "$STATUS"
  exit 2
fi
if [ ! -x "$BIN" ] && [ ! -f "$BIN" ]; then
  log "FAIL: binary missing: $BIN"
  echo "FAIL bin_missing" > "$STATUS"
  exit 2
fi
if [ ! -f "$MODEL" ]; then
  log "FAIL: model missing: $MODEL"
  echo "FAIL model_missing" > "$STATUS"
  exit 2
fi

# Optional cold: drop page cache so the first decode is not a free hit.
if [ -x "$HOME/bin/cold_model.sh" ]; then
  "$HOME/bin/cold_model.sh" "$MODEL" >>"$MASTER" 2>&1 || true
elif [ -x "$(dirname "${BASH_SOURCE[0]:-$0}")/cold_model.sh" ]; then
  "$(dirname "${BASH_SOURCE[0]:-$0}")/cold_model.sh" "$MODEL" >>"$MASTER" 2>&1 || true
fi

# RAW text: no chatml, no think. Same config as F5.5-A baseline, scorer = --ppl-decode.
set +e
"$BIN" -m "$MODEL" -t "$THREADS" -c "$N_CTX" \
  $BASE --n-expert-used "$N_EXPERT_USED" \
  --ppl-decode "$CORPUS_SUBSET" --ppl-csv "$CSV" \
  >"$STDOUT" 2>"$STDERR"
rc=$?
set -e

log "ppl-decode rc=$rc"
tail -30 "$STDERR" | tee -a "$MASTER" || true
cat "$STDOUT" | tee -a "$MASTER" || true

# Parse BMOE_PPL JSON line (last one wins).
ppl_line=$(grep -E '^BMOE_PPL ' "$STDOUT" | tail -1 || true)
if [ -z "$ppl_line" ]; then
  log "FAIL: no BMOE_PPL line on stdout"
  echo "FAIL no_bmoe_ppl rc=$rc" > "$STATUS"
  exit 3
fi

# Extract ppl= with a tiny python (host + termux both have it under known paths).
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in \
    /c/Users/gualt/AppData/Local/Programs/Python/Python312/python \
    python3 python
  do
    command -v "$c" >/dev/null 2>&1 && PY="$c" && break
    [ -x "$c" ] && PY="$c" && break
  done
fi
if [ -z "$PY" ]; then
  log "FAIL: no python to parse BMOE_PPL"
  echo "FAIL no_python" > "$STATUS"
  exit 4
fi

# shellcheck disable=SC2016
eval "$("$PY" - "$ppl_line" "$TARGET_PPL" "$TOL" <<'PY'
import json, re, sys
line = sys.argv[1]
# strip leading "BMOE_PPL "
raw = line.split(" ", 1)[1].strip()
obj = json.loads(raw)
ppl = float(obj["ppl"])
target = float(sys.argv[2])
tol = float(sys.argv[3])
delta = abs(ppl - target)
ok = delta <= tol
print(f"PPL={ppl}")
print(f"DELTA={delta}")
print(f"N_SCORED={int(obj.get('n_scored', 0))}")
print(f"SUM_LP={float(obj.get('sum_logprob', 0.0))}")
print(f"MODE={obj.get('mode', '')}")
print(f"GATE_OK={'1' if ok else '0'}")
PY
)"

log "ppl=$PPL delta=$DELTA n_scored=$N_SCORED mode=$MODE target=$TARGET_PPL tol=$TOL"

# Persist a small JSON summary for the report assembler.
cat > "$JSON" <<EOF
{
  "mode": "ppl-decode",
  "ppl": $PPL,
  "target_ppl": $TARGET_PPL,
  "tol": $TOL,
  "delta": $DELTA,
  "n_scored": $N_SCORED,
  "sum_logprob": $SUM_LP,
  "gate_ok": $GATE_OK,
  "rc": $rc,
  "bin": "$BIN",
  "bin_sha256": "${BIN_SHA256:-}",
  "corpus": "$CORPUS_SUBSET",
  "model": "$MODEL",
  "n_expert_used": $N_EXPERT_USED,
  "cache_mb": $CACHE_MB,
  "n_ctx": $N_CTX,
  "ubatch": $UBATCH
}
EOF

if [ "$rc" -ne 0 ]; then
  echo "FAIL rc=$rc ppl=$PPL" > "$STATUS"
  log "FAIL: binary rc=$rc"
  exit "$rc"
fi

if [ "$GATE_OK" != "1" ]; then
  echo "FAIL ppl=$PPL target=$TARGET_PPL delta=$DELTA tol=$TOL" > "$STATUS"
  log "FAIL: |ppl-target|=$DELTA > tol=$TOL (ppl=$PPL target=$TARGET_PPL)"
  exit 5
fi

echo "PASS ppl=$PPL delta=$DELTA n_scored=$N_SCORED" > "$STATUS"
log "PASS ppl-decode gate (ppl=$PPL within $TOL of $TARGET_PPL)"
exit 0
