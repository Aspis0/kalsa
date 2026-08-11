#!/data/data/com.termux/files/usr/bin/bash
# Parte 3 adopt-kexp: speed of survivors (STACCATO, batt>=45%)
# Configs: k6/d0.80, k6/d0.65, k8/d0.65 control
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/kexp_grid/speed}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
P1="${P1:-$HOME/experiments/prompts/short.txt}"
P2="${P2:-$HOME/experiments/prompts/f45_1.txt}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$OUTDIR/runs"
MASTER="$OUTDIR/speed.master.log"
CSV="$OUTDIR/speed_cells.csv"
: > "$MASTER"
echo "label,cfg,k,drop,prompt,rep,tok_s,prefill_tps,hit,drop_pct,wall_s,n_gen,rc,batt" > "$CSV"
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

log "speed grid start model=$MODEL bin=$BIN_SHA256"
sha256sum "$BIN" "$MODEL" | tee -a "$MASTER"
termux-battery-status 2>/dev/null | tee "$OUTDIR/battery_start.json" || true
termux-wake-lock >/dev/null 2>&1 || true

plug=$(python3 -c "import json;print(json.load(open('$OUTDIR/battery_start.json')).get('plugged','?'))" 2>/dev/null || echo "?")
pct=$(python3 -c "import json;print(json.load(open('$OUTDIR/battery_start.json')).get('percentage',0))" 2>/dev/null || echo 0)
log "preflight plugged=$plug batt=$pct"
if ! echo "$plug" | grep -qi UNPLUGGED; then
  log "STOP: not UNPLUGGED"; echo "STOP_PLUGGED" > "$OUTDIR/STATUS.txt"; exit 3
fi
if [ "${pct:-0}" -lt 45 ]; then
  log "STOP: battery $pct < 45"; echo "STOP_BATT" > "$OUTDIR/STATUS.txt"; exit 3
fi

cold() {
  if [ -x "$HOME/bin/cold_model.sh" ]; then "$HOME/bin/cold_model.sh" "$MODEL" || true
  elif command -v fadv >/dev/null 2>&1; then fadv --dontneed "$MODEL" 2>/dev/null || true
  fi
}

parse_tok() {
  local t="$1"
  python3 - <<PY
import re, json
from pathlib import Path
text = Path("$t").read_text(encoding="utf-8", errors="replace")
tok_s = None
n_gen = None
prefill = None
hit = None
drop = None
m = re.search(r"generation:\s*(\d+)\s+tokens,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)", text)
if m:
    n_gen = int(m.group(1)); tok_s = float(m.group(2))
for line in text.splitlines():
    if "BMOE_DONE" in line:
        i = line.find("{")
        if i >= 0:
            try:
                j = json.loads(line[i:])
                if j.get("tok_s") is not None:
                    tok_s = float(j["tok_s"])
                if j.get("tokens") is not None:
                    n_gen = int(j["tokens"])
            except Exception:
                pass
m2 = re.search(r"prefill:\s*\d+\s+tokens,\s*[0-9.]+\s*s\s*\(([0-9.]+)\s*tok/s\)", text)
if m2: prefill = float(m2.group(1))
m3 = re.search(r"moe-cache:\s*([0-9.]+)%\s*hit", text)
if m3: hit = float(m3.group(1))
m4 = re.search(r"moe-drop:[^)]*\(([0-9.]+)%\)", text)
if m4: drop = float(m4.group(1))
print(f"{tok_s or ''}|{prefill or ''}|{hit or ''}|{drop or ''}|{n_gen or ''}")
PY
}

run_cell() {
  local label="$1" cfg="$2" k="$3" drop="$4" prompt="$5" ngen="$6" rep="$7"
  local out="$OUTDIR/runs/${label}"
  mkdir -p "$out"
  local batt_s ptext t0 t1 wall rc m tok_s prefill hit drop_pct n_gen
  batt_s=$(python3 -c "import json,subprocess;print(json.loads(subprocess.check_output(['termux-battery-status'])).get('percentage','?'))" 2>/dev/null || echo "?")
  # abort if plugged mid-run
  plug_now=$(python3 -c "import json,subprocess;print(json.loads(subprocess.check_output(['termux-battery-status'])).get('plugged','?'))" 2>/dev/null || echo "?")
  if ! echo "$plug_now" | grep -qi UNPLUGGED; then
    log "STOP mid-run plugged=$plug_now"
    echo "STOP_PLUGGED" > "$OUTDIR/STATUS.txt"
    exit 3
  fi
  log "CELL $label cfg=$cfg k=$k drop=$drop ngen=$ngen batt=$batt_s"
  cold
  ptext=$(cat "$prompt")
  t0=$(date +%s)
  set +e
  "$BIN" -m "$MODEL" --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
    --io-threads 4 --ubatch 512 -t 4 -c 4096 --n-expert-used "$k" --drop-cold-experts "$drop" \
    --temp 0 --chatml --no-think -n "$ngen" -p "$ptext" \
    >"$out/stdout.txt" 2>"$out/stderr.txt"
  rc=$?
  set -e
  t1=$(date +%s); wall=$((t1-t0))
  cat "$out/stdout.txt" "$out/stderr.txt" > "$out/combo.txt"
  m=$(parse_tok "$out/combo.txt")
  IFS='|' read -r tok_s prefill hit drop_pct n_gen <<<"$m"
  log "DONE $label tok_s=$tok_s prefill=$prefill hit=$hit drop=$drop_pct wall=$wall n_gen=$n_gen rc=$rc"
  echo "$label,$cfg,$k,$drop,$(basename "$prompt"),$rep,${tok_s},${prefill},${hit},${drop_pct},${wall},${n_gen},${rc},${batt_s}" >> "$CSV"
}

# ABBA-ish per prompt: cfg order fixed but A/B/C interleaved by prompt
# configs: most aggressive first for early data if interrupted
# c1=k6d080 c2=k6d065 ctrl=k8d065

for prompt_tag in p1 p2; do
  if [ "$prompt_tag" = p1 ]; then PR="$P1"; else PR="$P2"; fi
  # rep1: c1, c2, ctrl
  run_cell "${prompt_tag}_c1_r1" k6d080 6 0.80 "$PR" 200 1
  run_cell "${prompt_tag}_c2_r1" k6d065 6 0.65 "$PR" 200 1
  run_cell "${prompt_tag}_ctrl_r1" k8d065 8 0.65 "$PR" 200 1
  # rep2 reverse-ish: ctrl, c2, c1
  run_cell "${prompt_tag}_ctrl_r2" k8d065 8 0.65 "$PR" 200 2
  run_cell "${prompt_tag}_c2_r2" k6d065 6 0.65 "$PR" 200 2
  run_cell "${prompt_tag}_c1_r2" k6d080 6 0.80 "$PR" 200 2
done

# pick winner by median tok_s
python3 - <<'PY' | tee -a "$MASTER"
import csv, statistics
from pathlib import Path
from collections import defaultdict
p = Path.home() / "experiments/results/kexp_grid/speed/speed_cells.csv"
rows = list(csv.DictReader(p.open(encoding="utf-8")))
by = defaultdict(list)
for r in rows:
    if r.get("tok_s") and r["label"].startswith(("p1_","p2_")):
        try:
            by[r["cfg"]].append(float(r["tok_s"]))
        except Exception:
            pass
med = {c: statistics.median(v) for c,v in by.items() if v}
print("MEDIANS", med)
if not med:
    Path.home().joinpath("experiments/results/kexp_grid/speed/winner.txt").write_text("NONE\n")
    raise SystemExit(0)
# best speed; if within 2% prefer lower ppl (known)
ppl = {"k6d080": 1.965088, "k6d065": 1.852152, "k8d065": 1.5647}
best = max(med, key=lambda c: med[c])
top = med[best]
# candidates within 2%
cands = [c for c,m in med.items() if m >= top * 0.98]
if len(cands) > 1:
    best = min(cands, key=lambda c: ppl.get(c, 99))
    print("TIE within 2% -> prefer better PPL:", cands, "->", best)
print("WINNER", best, "med", med[best])
Path.home().joinpath("experiments/results/kexp_grid/speed/winner.txt").write_text(
    f"{best}\nmed_tok_s={med[best]}\nall={med}\n", encoding="utf-8")
# map cfg to k drop for sostenuto
cfg_map = {"k6d080": (6, 0.80), "k6d065": (6, 0.65), "k8d065": (8, 0.65)}
k,d = cfg_map[best]
Path.home().joinpath("experiments/results/kexp_grid/speed/winner_kd.txt").write_text(f"{k} {d}\n")
PY

WIN_KD=$(cat "$OUTDIR/winner_kd.txt" 2>/dev/null || echo "8 0.65")
WK=$(echo "$WIN_KD" | awk '{print $1}')
WD=$(echo "$WIN_KD" | awk '{print $2}')
WCFG=$(cat "$OUTDIR/winner.txt" 2>/dev/null | head -1)
log "sostenuto winner cfg=$WCFG k=$WK drop=$WD n=512"
run_cell "sos_${WCFG}_n512" "$WCFG" "$WK" "$WD" "$P1" 512 1

termux-battery-status 2>/dev/null | tee "$OUTDIR/battery_end.json" || true
log "speed grid done"
echo "DONE" > "$OUTDIR/STATUS.txt"
cat "$CSV" | tee -a "$MASTER"
cat "$OUTDIR/winner.txt" | tee -a "$MASTER"
