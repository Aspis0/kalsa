#!/data/data/com.termux/files/usr/bin/bash
# shortlist-velocita.md — C: k=5 PPL (charge OK) + speed (unplugged, survivors only)
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/shortlist_k5}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
CORPUS="${CORPUS:-$HOME/experiments/results/dropcold/corpus_subset_10k.txt}"
P1="${P1:-$HOME/experiments/prompts/short.txt}"
P2="${P2:-$HOME/experiments/prompts/f45_1.txt}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
mkdir -p "$OUTDIR"/{ppl,speed,trace}
MASTER="$OUTDIR/SHORTLIST.master.log"
STATUS="$OUTDIR/STATUS.txt"
SPEED_CSV="$OUTDIR/speed/speed_cells.csv"
: > "$MASTER"
echo "RUNNING" > "$STATUS"
echo "label,cfg,k,drop,prompt,rep,tok_s,prefill_tps,n_gen,hit,drop_pct,wall_s,rc,batt" > "$SPEED_CSV"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

if [ -f "$HOME/experiments/scripts/lib_campaign_pin.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/experiments/scripts/lib_campaign_pin.sh"
  assert_campaign_pin "$BIN"
else
  exp=$(awk 'NF{print $1; exit}' "$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256")
  got=$(sha256sum "$BIN" | awk '{print $1}')
  [ "$got" = "$exp" ] || { log "PIN FAIL"; echo "FAIL_PIN" > "$STATUS"; exit 6; }
  BIN_SHA256="$got"
fi

FLOOR_PPL=2.0955
REF_F0=1.5249
REF_K6D065=1.852
log "shortlist k5 start bin=$BIN_SHA256"
log "corpus=$(sha256sum "$CORPUS" | awk '{print $1}') size=$(wc -c < "$CORPUS")"
# do NOT sha256 full KEXP (13GB blocks minutes) — size + cached sha
MODEL_SIZE=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
MODEL_SHA="ac44e20c…"
if [ -f "$HOME/experiments/results/kexp_baseline/kexp.sha256" ]; then
  MODEL_SHA=$(awk 'NF{print $1; exit}' "$HOME/experiments/results/kexp_baseline/kexp.sha256")
fi
log "model_size=$MODEL_SIZE model_sha_cached=$MODEL_SHA"
# thr effective: drop/k — declare per cell
log "thr_k6d065=$(python3 -c 'print(0.65/6)') thr_k5d065=$(python3 -c 'print(0.65/5)') thr_k5d000=0"

cold(){
  if [ -x "$HOME/bin/cold_model.sh" ]; then "$HOME/bin/cold_model.sh" "$MODEL" || true
  elif command -v fadv >/dev/null 2>&1; then fadv --dontneed "$MODEL" 2>/dev/null || true
  fi
}

run_ppl(){
  local tag="$1" k="$2" drop="$3" extra=("${@:4}")
  local d="$OUTDIR/ppl/$tag"
  mkdir -p "$d"
  log "PPL $tag k=$k drop=$drop thr_eff=$(python3 -c "print($drop/$k if $k else 0)")"
  cold
  set +e
  "$BIN" -m "$MODEL" -t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
    --io-threads 4 --ubatch 512 --n-expert-used "$k" --drop-cold-experts "$drop" \
    --ppl-decode "$CORPUS" --ppl-csv "$d/per_token.csv" \
    "${extra[@]}" \
    >"$d/stdout.txt" 2>"$d/stderr.txt"
  local rc=$?
  set -e
  log "ppl $tag rc=$rc"
  # parse ppl
  python3 - <<PY
import re, json
from pathlib import Path
d=Path("$d")
text=(d/"stderr.txt").read_text(encoding="utf-8",errors="replace")+"\n"+(d/"stdout.txt").read_text(encoding="utf-8",errors="replace")
ppl=None
for pat in [r"ppl done \(decode\):[^\n]*ppl=([0-9.]+)", r'"ppl"\s*:\s*([0-9.]+)', r"ppl=([0-9.]+)"]:
    m=re.search(pat, text)
    if m: ppl=float(m.group(1)); break
n_scored=None
m=re.search(r"n_scored=(\d+)", text)
if m: n_scored=int(m.group(1))
alive = ppl is not None and ppl <= $FLOOR_PPL
summary={"tag":"$tag","k":$k,"drop":$drop,"ppl":ppl,"n_scored":n_scored,"rc":$rc,
         "alive":alive,"floor":$FLOOR_PPL,"d_vs_f0":(ppl-$REF_F0) if ppl else None,
         "d_vs_k6d065":(ppl-$REF_K6D065) if ppl else None,
         "thr_eff": $drop/$k}
(d/"summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
print(json.dumps(summary,indent=2))
(d/"ALIVE.txt" if alive else d/"MORTA.txt").write_text("ppl=%s\n"%ppl,encoding="utf-8")
PY
  return $rc
}

# ============== PPL (charge OK) ==============
log "=== PPL phase ==="
# k5d065 with route-trace
run_ppl k5d065 5 0.65 --route-trace "$OUTDIR/trace/k5d065.route.trace"
# k5d000
run_ppl k5d000 5 0.0

# which alive?
VIVE=$(python3 - <<'PY'
import json
from pathlib import Path
root=Path.home()/"experiments/results/shortlist_k5/ppl"
alive=[]
for tag in ["k5d065","k5d000"]:
    p=root/tag/"summary.json"
    if p.exists():
        s=json.loads(p.read_text())
        if s.get("alive"): alive.append(tag)
print(" ".join(alive))
PY
)
log "VIVE=$VIVE"
if [ -z "${VIVE// }" ]; then
  log "no survivors — shortlist closes, default k6d065"
  echo "DONE_NO_VIVE" > "$STATUS"
  exit 0
fi

# ============== SPEED (must unplug) ==============
log "=== SPEED phase survivors: $VIVE ==="
termux-wake-lock >/dev/null 2>&1 || true

# wait unplugged + batt>=45
for i in $(seq 1 120); do
  bj=$(timeout 5 termux-battery-status 2>/dev/null || echo '{}')
  plug=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('plugged','?'))" "$bj" 2>/dev/null || echo "?")
  pct=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj" 2>/dev/null || echo 0)
  log "speed preflight i=$i plugged=$plug batt=$pct"
  if echo "$plug" | grep -qi UNPLUGGED && [ "$pct" -ge 45 ] 2>/dev/null; then break; fi
  if [ "$i" -eq 120 ]; then log "TIMEOUT wait unplug"; echo "FAIL_PLUGGED" > "$STATUS"; exit 3; fi
  sleep 30
done

parse_tok(){
  python3 - <<'PY'
import re, json
from pathlib import Path
text=Path("$1").read_text(encoding="utf-8",errors="replace")
tok_s=n_gen=prefill=hit=drop=None
m=re.search(r"generation:\s*(\d+)\s+tokens,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)", text)
if m: n_gen=int(m.group(1)); tok_s=float(m.group(2))
for line in text.splitlines():
    if "BMOE_DONE" in line:
        i=line.find("{")
        if i>=0:
            try:
                j=json.loads(line[i:])
                if j.get("tok_s") is not None: tok_s=float(j["tok_s"])
                if j.get("tokens") is not None: n_gen=int(j["tokens"])
            except: pass
m2=re.search(r"prefill:\s*\d+\s+tokens,\s*[0-9.]+\s*s\s*\(([0-9.]+)\s*tok/s\)", text)
if m2: prefill=float(m2.group(1))
m3=re.search(r"moe-cache:\s*([0-9.]+)%\s*hit", text)
if m3: hit=float(m3.group(1))
m4=re.search(r"moe-drop:[^)]*\(([0-9.]+)%\)", text)
if m4: drop=float(m4.group(1))
print(f"{tok_s or ''}|{prefill or ''}|{n_gen or ''}|{hit or ''}|{drop or ''}")
PY
}

run_speed_cell(){
  local label="$1" cfg="$2" k="$3" drop="$4" prompt="$5" rep="$6"
  local out="$OUTDIR/speed/runs/$label"
  mkdir -p "$out"
  local batt_s plug t0 t1 wall rc
  batt_s=$(python3 -c "import json,subprocess;print(json.loads(subprocess.check_output(['termux-battery-status'])).get('percentage','?'))" 2>/dev/null || echo "?")
  plug=$(python3 -c "import json,subprocess;print(json.loads(subprocess.check_output(['termux-battery-status'])).get('plugged','?'))" 2>/dev/null || echo "?")
  if ! echo "$plug" | grep -qi UNPLUGGED; then
    log "STOP mid-run plugged=$plug"; echo "STOP_PLUGGED" > "$STATUS"; exit 3
  fi
  log "SPEED $label k=$k drop=$drop batt=$batt_s"
  cold
  ptext=$(cat "$prompt")
  t0=$(date +%s)
  set +e
  "$BIN" -m "$MODEL" --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
    --io-threads 4 --ubatch 512 -t 4 -c 4096 --n-expert-used "$k" --drop-cold-experts "$drop" \
    --temp 0 --chatml --no-think -n 200 -p "$ptext" \
    >"$out/stdout.txt" 2>"$out/stderr.txt"
  rc=$?
  set -e
  t1=$(date +%s); wall=$((t1-t0))
  cat "$out/stdout.txt" "$out/stderr.txt" > "$out/combo.txt"
  local m tok_s prefill n_gen hit drop_pct
  m=$(COMBO="$out/combo.txt" python3 - <<'PY'
import re, json, os
from pathlib import Path
text=Path(os.environ["COMBO"]).read_text(encoding="utf-8",errors="replace")
tok_s=n_gen=prefill=hit=drop=None
m=re.search(r"generation:\s*(\d+)\s+tokens,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)", text)
if m: n_gen=int(m.group(1)); tok_s=float(m.group(2))
for line in text.splitlines():
    if "BMOE_DONE" in line:
        i=line.find("{")
        if i>=0:
            try:
                j=json.loads(line[i:])
                if j.get("tok_s") is not None: tok_s=float(j["tok_s"])
                if j.get("tokens") is not None: n_gen=int(j["tokens"])
            except: pass
m2=re.search(r"prefill:\s*\d+\s+tokens,\s*[0-9.]+\s*s\s*\(([0-9.]+)\s*tok/s\)", text)
if m2: prefill=float(m2.group(1))
m3=re.search(r"moe-cache:\s*([0-9.]+)%\s*hit", text)
if m3: hit=float(m3.group(1))
m4=re.search(r"moe-drop:[^)]*\(([0-9.]+)%\)", text)
if m4: drop=float(m4.group(1))
print(f"{tok_s or ''}|{prefill or ''}|{n_gen or ''}|{hit or ''}|{drop or ''}")
PY
)
  IFS='|' read -r tok_s prefill n_gen hit drop_pct <<<"$m"
  log "DONE $label tok_s=$tok_s n_gen=$n_gen wall=$wall rc=$rc"
  echo "$label,$cfg,$k,$drop,$(basename "$prompt"),$rep,${tok_s},${prefill},${n_gen},${hit},${drop_pct},${wall},${rc},${batt_s}" >> "$SPEED_CSV"
}

# Interleaved: for each of 3 blocks: ctrl k6d065, then each vive
# Use short + f45? Mandate: cells with control interleaved — use short for speed grid simplicity
# 3 reps: sequence ctrl→k5... repeated
# If only k5d065 vive: ctrl,k5,ctrl,k5,ctrl,k5 (6 cells)
# If both vive: for each rep: ctrl, k5d065, k5d000

for rep in 1 2 3; do
  run_speed_cell "ctrl_k6d065_r${rep}" k6d065 6 0.65 "$P1" "$rep"
  for tag in $VIVE; do
    if [ "$tag" = "k5d065" ]; then
      run_speed_cell "k5d065_r${rep}" k5d065 5 0.65 "$P1" "$rep"
    elif [ "$tag" = "k5d000" ]; then
      run_speed_cell "k5d000_r${rep}" k5d000 5 0.0 "$P1" "$rep"
    fi
  done
done

# also f45 one interleaved pair for robustness? Mandate says 3 rep per cell — done on short.
# ratios
python3 - <<'PY' | tee -a "$MASTER" | tee "$OUTDIR/speed/verdict.txt"
import csv, statistics, math, json
from pathlib import Path
from collections import defaultdict
p=Path.home()/"experiments/results/shortlist_k5/speed/speed_cells.csv"
rows=list(csv.DictReader(p.open(encoding="utf-8")))
by_cfg=defaultdict(list)
for r in rows:
    if r.get("tok_s"):
        try: by_cfg[r["cfg"]].append(float(r["tok_s"]))
        except: pass
ctrl=sorted(by_cfg.get("k6d065",[]))
print("CTRL tok_s", ctrl, "med", statistics.median(ctrl) if ctrl else None)
# paired ratios: for each rep, k5/ctrl
by_rep=defaultdict(dict)
for r in rows:
    if not r.get("tok_s"): continue
    by_rep[r["rep"]][r["cfg"]]=float(r["tok_s"])
verdicts={}
for cfg in sorted(c for c in by_cfg if c!="k6d065"):
    ratios=[]
    for rep,d in by_rep.items():
        if "k6d065" in d and cfg in d and d["k6d065"]>0:
            ratios.append(d[cfg]/d["k6d065"])
    if not ratios:
        verdicts[cfg]={"error":"no_pairs"}; continue
    med=statistics.median(ratios)
    mean=statistics.mean(ratios)
    if len(ratios)>1:
        sem=statistics.stdev(ratios)/math.sqrt(len(ratios))
        sem_pct=100*sem/mean if mean else 999
    else:
        sem=0; sem_pct=0
    # ppl
    ppl_path=Path.home()/f"experiments/results/shortlist_k5/ppl/{cfg}/summary.json"
    ppl=json.loads(ppl_path.read_text())["ppl"] if ppl_path.exists() else None
    ppl_ctrl=1.852
    gate_speed = med >= 1.05
    dominate = med >= 1.02 and ppl is not None and ppl <= ppl_ctrl - 0.01
    band = 1.02 <= med < 1.05
    if sem_pct > 2:
        note="SEM>2% — REPEAT_BLOCK"
    elif dominate:
        note="DOMINATES"
    elif med >= 1.05:
        note="SPEED_GATE_PASS"
    elif band:
        note="BAND_1.02_1.05_DOSSIER"
    elif med >= 0.98:
        # within 2% prefer better PPL
        note="WITHIN_2PCT_PPL_DECIDES"
    else:
        note="NO_GAIN"
    verdicts[cfg]={"ratios":ratios,"median_ratio":med,"sem_pct":sem_pct,"ppl":ppl,
                   "gate_speed_1.05":gate_speed,"dominate":dominate,"note":note,
                   "tok_s":by_cfg[cfg],"ctrl":ctrl}
    print(cfg, "ratios", ratios, "med", med, "sem%", sem_pct, "ppl", ppl, note)
import json
Path.home().joinpath("experiments/results/shortlist_k5/speed/verdict.json").write_text(
    json.dumps(verdicts,indent=2),encoding="utf-8")
if any(v.get("sem_pct",0)>2 for v in verdicts.values()):
    Path.home().joinpath("experiments/results/shortlist_k5/STATUS.txt").write_text("DONE_SEM_HIGH\n")
else:
    Path.home().joinpath("experiments/results/shortlist_k5/STATUS.txt").write_text("DONE\n")
PY

# sha trace
if [ -f "$OUTDIR/trace/k5d065.route.trace" ]; then
  sha256sum "$OUTDIR/trace/k5d065.route.trace" | tee "$OUTDIR/trace/k5d065.route.trace.sha256" | tee -a "$MASTER"
fi
log "shortlist done"
cat "$SPEED_CSV" | tee -a "$MASTER"
termux-wake-unlock >/dev/null 2>&1 || true
exit 0
