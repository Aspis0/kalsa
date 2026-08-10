#!/data/data/com.termux/files/usr/bin/bash
# PASSO 3 — sweep --drop-cold-experts
# DECLARED BEFORE MEASURE (PASSO 0): F ∈ {0.25, 0.50, 1.00}
#   blando=0.25 → thr=F/k=0.03125
#   medio =0.50 → thr=0.0625
#   aggressivo=1.00 → thr=0.125 (max useful; top expert pinned)
# Decision: ΔPPL≤0.15 AND byte/token ≤−10% → CANDIDATO
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTROOT="$HOME/experiments/results/dropcold/sweep"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
CORPUS="$HOME/experiments/results/dropcold/corpus_subset_10k.txt"
PROMPT="$HOME/experiments/prompts/f45_1_esplicativo.txt"
BASELINE_JSON="$HOME/experiments/results/dropcold/g2/g2_compare.json"
export LD_LIBRARY_PATH="$(dirname "$BIN")"
mkdir -p "$OUTROOT"
MASTER="$OUTROOT/sweep.master.log"
STATUS="$OUTROOT/STATUS_SWEEP.txt"
TABLE="$OUTROOT/table.tsv"
: > "$MASTER"
printf '%s\n' "F	thr	ppl	delta_ppl	bytes_mib_tok	bytes_delta_pct	hit_pct	drop_pct	n_scored	rc_ppl	rc_twin	verdict" > "$TABLE"

if [ -f "$HOME/experiments/scripts/lib_campaign_pin.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/experiments/scripts/lib_campaign_pin.sh"
  assert_campaign_pin "$BIN"
fi

THREADS=4; CACHE_MB=2000; IO_THREADS=4; N_CTX=4096; UBATCH=512
BASE="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${UBATCH}"
VALUES="0.25 0.50 1.00"
NGEN_TWIN=200

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }
max_die_mc(){
  local max=0 v t z
  for z in /sys/class/thermal/thermal_zone*; do
    t=$(cat "$z/type" 2>/dev/null || true)
    case "$t" in cpu-*|cpuss-*|*cpu*|*CPU*)
      v=$(cat "$z/temp" 2>/dev/null || echo 0)
      if [ -n "$v" ] && [ "$v" -gt "$max" ] 2>/dev/null; then max=$v; fi
    ;; esac
  done
  echo "$max"
}
prestart(){
  local i die n
  for i in $(seq 1 30); do
    die=$(max_die_mc); n=$(nproc)
    if [ "$die" -le 80000 ] 2>/dev/null && [ "$n" -ge 6 ]; then log "prestart OK die=$die n=$n"; return 0; fi
    if [ "$die" -gt 98000 ] 2>/dev/null; then log "HARD STOP die=$die"; sleep 20; continue; fi
    log "prestart wait die=$die n=$n"; sleep 10
  done
  log "prestart timeout — proceed"
}
cold(){ if [ -x "$HOME/experiments/scripts/cold_model.sh" ]; then "$HOME/experiments/scripts/cold_model.sh" "$MODEL" >>"$MASTER" 2>&1 || true; fi; }

BASE_PPL=$(python3 -c "import json; print(json.load(open('$BASELINE_JSON'))['ppl_decode'])" 2>/dev/null || echo "")
log "SWEEP start DECLARED_VALUES=$VALUES BASE_PPL=$BASE_PPL"
log "bin=$BIN"; sha256sum "$BIN" | tee -a "$MASTER"
log "corpus=$CORPUS"; sha256sum "$CORPUS" | tee -a "$MASTER"
log "prompt_twin=$PROMPT"; sha256sum "$PROMPT" | tee -a "$MASTER"

run_twin() {
  local F="$1" tag="$2"
  local odir="$OUTROOT/$tag"
  mkdir -p "$odir"
  prestart; cold
  set +e
  if [ "$F" = "0" ] || [ "$F" = "0.0" ] || [ "$F" = "0.00" ]; then
    "$BIN" -m "$MODEL" -t $THREADS -c $N_CTX -n $NGEN_TWIN \
      --chatml --no-think --progress --temp 0 \
      $BASE --n-expert-used 8 \
      -p "$(cat "$PROMPT")" \
      >"$odir/twin.stdout" 2>"$odir/twin.stderr"
  else
    "$BIN" -m "$MODEL" -t $THREADS -c $N_CTX -n $NGEN_TWIN \
      --chatml --no-think --progress --temp 0 \
      $BASE --n-expert-used 8 \
      --drop-cold-experts "$F" \
      -p "$(cat "$PROMPT")" \
      >"$odir/twin.stdout" 2>"$odir/twin.stderr"
  fi
  local rc=$?
  set -e
  echo "$rc" > "$odir/twin.rc"
  F="$F" RC="$rc" ODIR="$odir" python3 - <<'PY'
import re, json, os
from pathlib import Path
odir=Path(os.environ["ODIR"])
out=(odir/"twin.stdout").read_text(encoding="utf-8", errors="replace")
err=(odir/"twin.stderr").read_text(encoding="utf-8", errors="replace")
text=out+"\n"+err
def m1(pat, cast=float, default=None):
    m=re.search(pat, text)
    return cast(m.group(1)) if m else default
info={
  "F": float(os.environ["F"]),
  "rc": int(os.environ["RC"]),
  "read_mib": m1(r"moe-stream: read ([0-9.]+) MiB"),
  "mib_per_token": m1(r"\(([0-9.]+) MiB/token\)"),
  "cache_hit_pct": m1(r"moe-cache: ([0-9.]+)% hit"),
  "n_generated": m1(r"generation: ([0-9]+) tokens", int),
  "experts_dropped": m1(r"moe-drop: ([0-9]+)/", int),
  "experts_routed": m1(r"moe-drop: [0-9]+/([0-9]+)", int),
  "drop_pct": m1(r"moe-drop: [0-9]+/[0-9]+ routed experts dropped \(([0-9.]+)%\)"),
  "tok_s": m1(r"\(([0-9.]+) tok/s\)"),
}
(odir/"twin_meta.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
print(json.dumps(info))
PY
}

log "=== baseline twin F=0 ==="
run_twin 0 baseline_f0
BASE_MIB=$(python3 -c "import json; print(json.load(open('$OUTROOT/baseline_f0/twin_meta.json')).get('mib_per_token') or '')")
BASE_HIT=$(python3 -c "import json; print(json.load(open('$OUTROOT/baseline_f0/twin_meta.json')).get('cache_hit_pct') or '')")
log "baseline_twin mib/tok=$BASE_MIB hit=$BASE_HIT"

SKIP_REST=0

for F in $VALUES; do
  if [ "$SKIP_REST" = "1" ]; then
    log "SKIP F=$F (blando already over threshold; ppl ~45min each)"
    printf '%s\n' "$F	$(python3 -c "print($F/8)")	NA	NA	NA	NA	NA	NA	NA	SKIP	SKIP	SKIPPED" >> "$TABLE"
    continue
  fi
  cell="drop${F}"
  odir="$OUTROOT/$cell"
  mkdir -p "$odir"
  log "=== cell $cell F=$F thr=$(python3 -c "print($F/8)") ==="

  prestart; cold
  set +e
  "$BIN" -m "$MODEL" -t $THREADS -c $N_CTX \
    $BASE --n-expert-used 8 \
    --drop-cold-experts "$F" \
    --ppl-decode "$CORPUS" --ppl-csv "$odir/ppl.per_token.csv" \
    >"$odir/ppl.stdout" 2>"$odir/ppl.stderr"
  rc_ppl=$?
  set -e
  log "ppl rc=$rc_ppl"
  grep -E "BMOE_PPL|ppl done|ppl-decode:" "$odir/ppl.stdout" "$odir/ppl.stderr" 2>/dev/null | tee -a "$MASTER" || true

  F="$F" RC_PPL="$rc_ppl" ODIR="$odir" BASE_PPL="$BASE_PPL" python3 - <<'PY'
import math, json, re, os
from pathlib import Path
odir=Path(os.environ["ODIR"])
csvp=odir/"ppl.per_token.csv"
rows=[]
if csvp.exists():
    for line in csvp.read_text(encoding="utf-8").splitlines()[1:]:
        if not line.strip(): continue
        a,b,c=line.split(",")
        rows.append(float(c))
n=len(rows)
s=sum(rows) if rows else float("nan")
ppl=math.exp(-s/n) if n else float("nan")
text=(odir/"ppl.stdout").read_text(encoding="utf-8",errors="replace")+"\n"+(odir/"ppl.stderr").read_text(encoding="utf-8",errors="replace")
m=re.search(r"BMOE_PPL\s*(\{.*\})", text)
bmoe=json.loads(m.group(1)) if m else {}
if bmoe.get("ppl") is not None:
    ppl=float(bmoe["ppl"]); n=int(bmoe.get("n_scored", n)); s=float(bmoe.get("sum_logprob", s))
base_s=os.environ.get("BASE_PPL") or ""
base=float(base_s) if base_s else None
delta=(ppl-base) if base is not None and n else None
meta={"F":float(os.environ["F"]),"thr":float(os.environ["F"])/8.0,"rc":int(os.environ["RC_PPL"]),"n_scored":n,"sum_logprob":s,"ppl":ppl,"baseline_ppl":base,"delta_ppl":delta,"bmoe":bmoe}
(odir/"ppl_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
print(json.dumps(meta, indent=2))
if delta is not None and delta > 0.15:
    (odir/"OVER_PPL").write_text(str(delta), encoding="utf-8")
PY

  log "twin generate F=$F"
  run_twin "$F" "$cell"

  F="$F" ODIR="$odir" BASE_MIB="$BASE_MIB" TABLE="$TABLE" python3 - <<'PY'
import json, os
from pathlib import Path
odir=Path(os.environ["ODIR"])
ppl=json.loads((odir/"ppl_meta.json").read_text(encoding="utf-8"))
twin=json.loads((odir/"twin_meta.json").read_text(encoding="utf-8"))
base_mib_s=os.environ.get("BASE_MIB") or ""
base_mib=float(base_mib_s) if base_mib_s not in ("", "None") else None
mib=twin.get("mib_per_token")
bytes_delta_pct = None
if base_mib and mib:
    bytes_delta_pct = 100.0 * (mib - base_mib) / base_mib
delta=ppl.get("delta_ppl")
if delta is not None and delta <= 0.15:
    if bytes_delta_pct is not None and bytes_delta_pct <= -10.0:
        verdict="CANDIDATO"
    else:
        verdict="ARCHIVED_QUALITY_OK_NO_BYTE_GAIN"
else:
    verdict="ARCHIVED_PPL"
row={
  "F": ppl["F"], "thr": ppl["thr"], "ppl": ppl.get("ppl"), "delta_ppl": delta,
  "mib_per_token": mib, "bytes_delta_pct": bytes_delta_pct,
  "cache_hit_pct": twin.get("cache_hit_pct"), "drop_pct": twin.get("drop_pct"),
  "n_scored": ppl.get("n_scored"), "rc_ppl": ppl.get("rc"), "rc_twin": twin.get("rc"),
  "verdict": verdict,
}
(odir/"cell_summary.json").write_text(json.dumps(row, indent=2), encoding="utf-8")
print(json.dumps(row, indent=2))
def fmt(v):
    return "NA" if v is None else v
with open(os.environ["TABLE"],"a",encoding="utf-8") as f:
    f.write(f"{fmt(row['F'])}\t{fmt(row['thr'])}\t{fmt(row['ppl'])}\t{fmt(row['delta_ppl'])}\t{fmt(row['mib_per_token'])}\t{fmt(row['bytes_delta_pct'])}\t{fmt(row['cache_hit_pct'])}\t{fmt(row['drop_pct'])}\t{fmt(row['n_scored'])}\t{fmt(row['rc_ppl'])}\t{fmt(row['rc_twin'])}\t{fmt(row['verdict'])}\n")
if delta is not None and delta > 0.15:
    (odir/"OVER_PPL").write_text(str(delta), encoding="utf-8")
PY
  log "cell $cell done"
  if [ -f "$odir/OVER_PPL" ]; then
    log "F=$F ΔPPL over 0.15 — SKIP rest (each ppl ~45min)"
    SKIP_REST=1
  fi
done

log "SWEEP complete"
cp "$TABLE" "$OUTROOT/table_final.tsv"
echo "DONE $(ts)" | tee "$STATUS"
cat "$TABLE" | tee -a "$MASTER"
