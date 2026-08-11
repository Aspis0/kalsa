#!/data/data/com.termux/files/usr/bin/bash
# FASE 0 reap-multilingua: smoke community REAP GGUF on CAMPAIGN binary.
# Validates convert+runtime+format (NOT our REAP calibration quality).
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/reap/f0}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-28B-REAP20-A3B-Q2_K.gguf}"
P1="${P1:-$HOME/experiments/prompts/short.txt}"
EN="${EN:-$HOME/experiments/corpus/multi5/en_slice.txt}"
IT="${IT:-$HOME/experiments/corpus/multi5/it_slice.txt}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$OUTDIR"
MASTER="$OUTDIR/f0.master.log"
: > "$MASTER"
ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

if [ -f "$HOME/experiments/scripts/lib_campaign_pin.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/experiments/scripts/lib_campaign_pin.sh"
  assert_campaign_pin "$BIN"
else
  exp=$(awk 'NF{print $1; exit}' "$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256")
  got=$(sha256sum "$BIN" | awk '{print $1}')
  [ "$got" = "$exp" ] || { echo "PIN FAIL"; exit 6; }
fi

log "F0 start model=$MODEL"
[ -f "$MODEL" ] || { log "MISSING model"; echo "FAIL_MODEL" > "$OUTDIR/STATUS.txt"; exit 2; }
ls -la "$MODEL" | tee -a "$MASTER"
sha256sum "$MODEL" | tee "$OUTDIR/model.sha256" | tee -a "$MASTER"

# --- smoke gen (k=8 no drop — format probe) ---
log "SMOKE gen n=32"
set +e
"$BIN" -m "$MODEL" --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
  --io-threads 4 --ubatch 512 -t 4 -c 2048 --n-expert-used 8 \
  --temp 0 --chatml --no-think -n 32 -p "$(cat "$P1")" \
  >"$OUTDIR/smoke.stdout" 2>"$OUTDIR/smoke.stderr"
rc_smoke=$?
set -e
log "smoke rc=$rc_smoke"
# extract n_expert / expert_count from logs
grep -E 'n_expert|expert_count|expert_used|moe-stream|load time|generation:|BMOE_DONE|error|Error|fail' \
  "$OUTDIR/smoke.stderr" "$OUTDIR/smoke.stdout" 2>/dev/null | head -80 | tee "$OUTDIR/smoke_extract.txt" | tee -a "$MASTER"

n_expert=$(grep -oE 'n_expert[^=]*=[[:space:]]*[0-9]+' "$OUTDIR/smoke.stderr" 2>/dev/null | head -1 | grep -oE '[0-9]+$' || true)
n_expert_used=$(grep -oE 'n_expert_used[^=]*=[[:space:]]*[0-9]+' "$OUTDIR/smoke.stderr" 2>/dev/null | head -1 | grep -oE '[0-9]+$' || true)
log "parsed n_expert=$n_expert n_expert_used=$n_expert_used"
echo "n_expert=$n_expert" > "$OUTDIR/hparams.txt"
echo "n_expert_used=$n_expert_used" >> "$OUTDIR/hparams.txt"

if [ "$rc_smoke" -ne 0 ]; then
  log "SMOKE FAIL"
  echo "FAIL_SMOKE" > "$OUTDIR/STATUS.txt"
  exit 3
fi

# --- bpb EN + IT slices (pipeline metric, NOT REAP quality judgment) ---
run_bpb() {
  local tag="$1" corpus="$2"
  local d="$OUTDIR/bpb_$tag"
  mkdir -p "$d"
  [ -f "$corpus" ] || { log "MISSING corpus $corpus"; return 2; }
  log "BPB $tag corpus=$corpus bytes=$(wc -c < "$corpus")"
  set +e
  "$BIN" -m "$MODEL" --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
    --io-threads 4 --ubatch 512 -t 4 -c 4096 --n-expert-used 8 \
    --ppl-decode "$corpus" --ppl-csv "$d/per_token.csv" \
    >"$d/stdout.txt" 2>"$d/stderr.txt"
  local rc=$?
  set -e
  log "bpb $tag rc=$rc"
  tail -30 "$d/stderr.txt" | tee -a "$MASTER"
  # parse ppl/bpb if present
  python3 - <<PY
import re, json
from pathlib import Path
text = Path("$d/stderr.txt").read_text(encoding="utf-8", errors="replace")
text += "\n" + Path("$d/stdout.txt").read_text(encoding="utf-8", errors="replace")
ppl = None
for pat in [r'"ppl"\s*:\s*([0-9.]+)', r'ppl\s*[:=]\s*([0-9.]+)', r'perplexity\s*[:=]\s*([0-9.]+)']:
    m = re.search(pat, text, re.I)
    if m:
        ppl = float(m.group(1)); break
out = {"tag": "$tag", "rc": $rc, "ppl": ppl}
Path("$d/summary.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
print(out)
PY
  return $rc
}

rc_en=0; rc_it=0
if [ -f "$EN" ]; then run_bpb en "$EN" || rc_en=$?; else log "skip EN (no slice)"; fi
if [ -f "$IT" ]; then run_bpb it "$IT" || rc_it=$?; else log "skip IT (no slice)"; fi

if [ "$rc_smoke" -eq 0 ] && [ "${rc_en:-0}" -eq 0 ] && [ "${rc_it:-0}" -eq 0 ]; then
  log "F0 PASS (pipeline)"
  echo "PASS" > "$OUTDIR/STATUS.txt"
else
  log "F0 PARTIAL/FAIL smoke=$rc_smoke en=$rc_en it=$rc_it"
  echo "FAIL" > "$OUTDIR/STATUS.txt"
  exit 4
fi
cat "$OUTDIR/STATUS.txt" | tee -a "$MASTER"
