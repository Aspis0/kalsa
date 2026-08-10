#!/usr/bin/env bash
# Fase B — gate qualità KEXP (device, IN CARICA ok)
# PPL(KEXP,F=0) vs 2.0955; PPL(KEXP,drop 0.65) vs 2.19992
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:${PATH:-}"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/requant1c/phase_b}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
CORPUS="${CORPUS_SUBSET:-$HOME/experiments/results/dropcold/corpus_subset_10k.txt}"
# fallbacks
if [ ! -f "$CORPUS" ]; then
  for c in \
    "$HOME/experiments/quality/corpus_it/mixed_it.txt" \
    "$HOME/experiments/results/dropcold/corpus_subset_part1_approx10k.txt"
  do
    [ -f "$c" ] && CORPUS="$c" && break
  done
fi

THREADS="${THREADS:-4}"
CACHE_MB="${CACHE_MB:-2000}"
IO_THREADS="${IO_THREADS:-4}"
N_CTX="${N_CTX:-4096}"
UBATCH="${UBATCH:-512}"
N_EXPERT_USED="${N_EXPERT_USED:-8}"
DROP_F="${DROP_F:-0.65}"

# pin
if [ -f "$HOME/experiments/scripts/lib_campaign_pin.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/experiments/scripts/lib_campaign_pin.sh"
  assert_campaign_pin "$BIN"
else
  exp=$(awk 'NF{print $1; exit}' "$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256")
  got=$(sha256sum "$BIN" | awk '{print $1}')
  [ "$got" = "$exp" ] || { echo "PIN FAIL $got != $exp"; exit 6; }
  BIN_SHA256="$got"
fi
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$OUTDIR"
MASTER="$OUTDIR/phase_b.master.log"
ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

: > "$MASTER"
log "phase B start model=$MODEL corpus=$CORPUS bin_sha=$BIN_SHA256 drop=$DROP_F"
sha256sum "$BIN" | tee -a "$MASTER"
sha256sum "$MODEL" | tee -a "$MASTER"
sha256sum "$CORPUS" | tee -a "$MASTER"
# battery / plug note
termux-battery-status 2>/dev/null | tee "$OUTDIR/battery_start.json" || true

BASE=(--moe-stream --cache-mb "$CACHE_MB" --dense-weights anon --overlap --io-threads "$IO_THREADS" --ubatch "$UBATCH" -t "$THREADS" -c "$N_CTX" --n-expert-used "$N_EXPERT_USED")

run_ppl() {
  local label="$1"; shift
  local out="$OUTDIR/$label"
  mkdir -p "$out"
  log "RUN $label $*"
  set +e
  "$BIN" -m "$MODEL" "${BASE[@]}" "$@" \
    --ppl-decode "$CORPUS" --ppl-csv "$out/per_token.csv" \
    >"$out/stdout.txt" 2>"$out/stderr.txt"
  local rc=$?
  set -e
  log "DONE $label rc=$rc"
  # extract ppl
  local ppl
  ppl=$(grep -Eoi 'ppl[=: ]+[0-9.]+|perplexity[=: ]+[0-9.]+' "$out/stdout.txt" "$out/stderr.txt" 2>/dev/null | tail -1 | grep -Eo '[0-9]+\.[0-9]+' | tail -1 || true)
  if [ -z "$ppl" ]; then
    ppl=$(python -c "print('skip')" 2>/dev/null || true)
    # device python
    ppl=$(python - <<PY 2>/dev/null || true
import re,pathlib
t=pathlib.Path("$out/stdout.txt").read_text(errors="replace")+"\n"+pathlib.Path("$out/stderr.txt").read_text(errors="replace")
ms=re.findall(r"(?:ppl|perplexity)\s*[=: ]\s*([0-9]+\.[0-9]+)", t, re.I)
print(ms[-1] if ms else "")
PY
)
  fi
  echo "label=$label ppl=$ppl rc=$rc" | tee -a "$OUTDIR/summary.txt" | tee -a "$MASTER"
  echo "$ppl" > "$out/ppl.txt"
}

# F=0
run_ppl "ppl_F0"
# drop 0.65
run_ppl "ppl_drop065" --drop-cold-experts "$DROP_F"

# Smoke KV two turns n_past=71
log "KV smoke start"
KVDIR="$OUTDIR/kv_smoke"
mkdir -p "$KVDIR"
# two-turn session: generate enough to reach n_past around 71
set +e
"$BIN" -m "$MODEL" "${BASE[@]}" --drop-cold-experts "$DROP_F" \
  -n 32 -p "Say hello in one short sentence." \
  >"$KVDIR/turn1.stdout" 2>"$KVDIR/turn1.stderr"
rc1=$?
"$BIN" -m "$MODEL" "${BASE[@]}" --drop-cold-experts "$DROP_F" \
  -n 32 -p "Continue: the previous greeting was fine. Reply with two words only." \
  >"$KVDIR/turn2.stdout" 2>"$KVDIR/turn2.stderr"
rc2=$?
set -e
log "KV smoke rc1=$rc1 rc2=$rc2"
# n_past search
grep -E 'n_past|past' "$KVDIR"/turn*.stderr "$KVDIR"/turn*.stdout 2>/dev/null | head -20 | tee -a "$MASTER" || true
termux-battery-status 2>/dev/null | tee "$OUTDIR/battery_end.json" || true
log "phase B done"
