#!/data/data/com.termux/files/usr/bin/bash
# KEXP quality grid: k x drop, floor PPL <= 2.0955
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/kexp_grid}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
CORPUS="${CORPUS:-$HOME/experiments/results/dropcold/corpus_subset_10k.txt}"
FLOOR="2.0955"
BASELINE_F0="1.5249"

export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$OUTDIR/cells"
MASTER="$OUTDIR/grid.master.log"
CSV="$OUTDIR/grid_ppl.csv"
: > "$MASTER"
echo "cell,k,drop,ppl,delta_vs_f0,verdict,rc,wall_s" > "$CSV"
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
  BIN_SHA256="$got"
fi

log "grid start model=$MODEL floor=$FLOOR bin=$BIN_SHA256"
sha256sum "$BIN" "$MODEL" "$CORPUS" | tee -a "$MASTER"
termux-battery-status 2>/dev/null | tee "$OUTDIR/battery_start.json" || true
termux-wake-lock >/dev/null 2>&1 || true

BASE=(--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -t 4 -c 4096)

run_cell() {
  local id="$1" k="$2" drop="$3"
  local out="$OUTDIR/cells/c${id}_k${k}_d${drop}"
  mkdir -p "$out"
  log "CELL $id k=$k drop=$drop"
  local t0 t1 wall rc ppl verdict
  t0=$(date +%s)
  set +e
  "$BIN" -m "$MODEL" "${BASE[@]}" --n-expert-used "$k" --drop-cold-experts "$drop" \
    --ppl-decode "$CORPUS" --ppl-csv "$out/per_token.csv" \
    >"$out/stdout.txt" 2>"$out/stderr.txt"
  rc=$?
  set -e
  t1=$(date +%s); wall=$((t1-t0))
  ppl=$(python3 - <<PY
import re
from pathlib import Path
t=Path("$out/stdout.txt").read_text(errors="replace")+"\n"+Path("$out/stderr.txt").read_text(errors="replace")
ms=re.findall(r"(?:ppl|perplexity)\s*[=: ]\s*([0-9]+\.[0-9]+)", t, re.I)
# also final JSON
import json
for line in t.splitlines():
    if "ppl" in line and "{" in line:
        try:
            j=json.loads(line[line.find("{"):])
            if "ppl" in j: ms.append(str(j["ppl"]))
        except Exception:
            pass
print(ms[-1] if ms else "")
PY
)
  echo "$ppl" > "$out/ppl.txt"
  verdict="NO_PPL"
  delta=""
  if [ -n "$ppl" ]; then
    verdict=$(python3 -c "p=float('$ppl'); f=float('$FLOOR'); print('VIVA' if p<=f else 'MORTA')")
    delta=$(python3 -c "print(f'{float(\"$ppl\")-float(\"$BASELINE_F0\"):+.4f}')")
  fi
  log "DONE cell=$id k=$k drop=$drop ppl=$ppl delta=$delta verdict=$verdict wall=$wall rc=$rc"
  echo "$id,$k,$drop,$ppl,$delta,$verdict,$rc,$wall" >> "$CSV"
  echo "$verdict" > "$out/verdict.txt"
  # return 0 viva, 1 morta, 2 no ppl
  if [ "$verdict" = "VIVA" ]; then return 0; fi
  if [ "$verdict" = "MORTA" ]; then return 1; fi
  return 2
}

# order from mandate; skip children of dead parents
declare -A viva
# 1 k=8 drop=0.80
if run_cell 1 8 0.80; then viva[1]=1; else viva[1]=0; fi
# 2 k=6 drop=0.65
if run_cell 2 6 0.65; then viva[2]=1; else viva[2]=0; fi
# 3 k=8 drop=1.00
if run_cell 3 8 1.00; then viva[3]=1; else viva[3]=0; fi
# 4 k=6 drop=0.80 only if 1 and 2 viva
if [ "${viva[1]}" = 1 ] && [ "${viva[2]}" = 1 ]; then
  if run_cell 4 6 0.80; then viva[4]=1; else viva[4]=0; fi
else
  log "SKIP cell 4 (parent dead: c1=${viva[1]} c2=${viva[2]})"
  echo "4,6,0.80,,SKIP,parent_dead,," >> "$CSV"
  viva[4]=0
fi
# 5 k=7 drop=0.80 if k=6 sfora (c2 dead) else optional
if [ "${viva[2]}" = 0 ]; then
  if run_cell 5 7 0.80; then viva[5]=1; else viva[5]=0; fi
else
  log "SKIP cell 5 (k=6 held; ripiego not needed)"
  echo "5,7,0.80,,SKIP,not_needed,," >> "$CSV"
  viva[5]=0
fi
# 6 k=6 drop=1.00 only if 4 regge
if [ "${viva[4]}" = 1 ]; then
  if run_cell 6 6 1.00; then viva[6]=1; else viva[6]=0; fi
else
  log "SKIP cell 6 (cell 4 not viva)"
  echo "6,6,1.00,,SKIP,parent_dead,," >> "$CSV"
  viva[6]=0
fi

termux-battery-status 2>/dev/null | tee "$OUTDIR/battery_end.json" || true
log "grid done"
echo "DONE" > "$OUTDIR/STATUS.txt"
cat "$CSV" | tee -a "$MASTER"
