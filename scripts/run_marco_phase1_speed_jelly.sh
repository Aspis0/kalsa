#!/data/data/com.termux/files/usr/bin/bash
# Marco Phase 1 SPEED on Jelly Star: ABBA A0 vs A2, ranking only.
# A0: k=8 drop OFF | A2: k=6 drop 0.65
# -t 2 (G99), io-threads 4 (PROTOCOL), n=200, 2 prompts x ABBA, cold, unplugged.
# Binary = Jelly pin (~/bin/run-bmoe), NOT S23 CAMPAIGN.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C
unset LD_LIBRARY_PATH

OUTDIR="${OUTDIR:-$HOME/experiments/results/marco_phase1/speed_jelly}"
mkdir -p "$OUTDIR/logs" "$OUTDIR/prompts" "$TMPDIR"
MASTER="$OUTDIR/SPEED.master.log"
STATUS="$OUTDIR/STATUS.txt"
CSV="$OUTDIR/runs_speed.csv"
SUMM="$OUTDIR/speed_summary.json"
VERDICT="$OUTDIR/SPEED_VERDICT.md"
BIN="${BINARY:-$HOME/bin/run-bmoe}"
MODEL="${MODEL:-$HOME/experiments/models/Marco-Mini-Instruct.i1-Q4_K_M.gguf}"
THREADS="${THREADS:-2}"
N_CTX="${N_CTX:-4096}"
N_GEN="${N_GEN:-200}"
IO_THREADS="${IO_THREADS:-4}"
CACHE_MB="${CACHE_MB:-2000}"
UBATCH="${UBATCH:-512}"
BATT_MIN="${BATT_MIN:-45}"
BATT_STOP="${BATT_STOP:-30}"

P1="$OUTDIR/prompts/p_fact.txt"
P2="$OUTDIR/prompts/p_creative.txt"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

batt_json() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 4 termux-battery-status 2>/dev/null || echo '{}'
  else
    echo '{}'
  fi
}
batt_plugged_sys() {
  local online=0 v
  for p in /sys/class/power_supply/*/online; do
    [ -f "$p" ] || continue
    v=$(cat "$p" 2>/dev/null || echo 0)
    [ "$v" = "1" ] && online=1
  done
  if [ "$online" = "1" ]; then echo PLUGGED; else echo UNPLUGGED; fi
}
batt_pct_sys() {
  for p in /sys/class/power_supply/battery/capacity /sys/class/power_supply/*/capacity; do
    if [ -f "$p" ]; then cat "$p" 2>/dev/null; return; fi
  done
  echo -1
}
batt_plugged() {
  local j p
  j=$(batt_json)
  p=$(echo "$j" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin); print(d.get("plugged","UNKNOWN"))
except Exception:
 print("UNKNOWN")' 2>/dev/null || echo UNKNOWN)
  if [ "$p" = "UNKNOWN" ] || [ -z "$p" ]; then batt_plugged_sys; else echo "$p"; fi
}
batt_pct() {
  local j p
  j=$(batt_json)
  p=$(echo "$j" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin); print(int(d.get("percentage") or d.get("level") or -1))
except Exception:
 print(-1)' 2>/dev/null || echo -1)
  if [ "$p" = "-1" ]; then batt_pct_sys; else echo "$p"; fi
}

require_unplugged() {
  local p pct
  p=$(batt_plugged)
  pct=$(batt_pct)
  log "battery plugged=$p pct=$pct"
  case "$p" in
    UNPLUGGED|false|0|none|NONE) ;;
    *)
      log "FAIL: must be UNPLUGGED (got plugged=$p)"
      echo "FAIL plugged=$p" > "$STATUS"
      exit 4
      ;;
  esac
  if [ "$pct" -ge 0 ] 2>/dev/null && [ "$pct" -lt "$BATT_MIN" ]; then
    log "FAIL: battery $pct < BATT_MIN $BATT_MIN"
    echo "FAIL batt_low=$pct" > "$STATUS"
    exit 5
  fi
}

cold_model() {
  local m="$1"
  if [ -x "$HOME/bin/cold_model.sh" ]; then
    "$HOME/bin/cold_model.sh" "$m" >>"$MASTER" 2>&1 || log "WARN cold_model failed"
  elif [ -x "$HOME/bin/fadv" ]; then
    "$HOME/bin/fadv" "$m" >>"$MASTER" 2>&1 || true
  else
    sync || true
    sleep 2
  fi
}

parse_metrics() {
  local logf="$1"
  python3 - "$logf" <<'PY'
import re,sys,json
text=open(sys.argv[1],encoding='utf-8',errors='replace').read()
out={}
m=re.search(r'generation:\s*(\d+)\s*tokens?,\s*([0-9.]+)\s*s/token\s*\(([0-9.]+)\s*tok/s\)', text)
if m:
    out['n_gen']=int(m.group(1)); out['s_per_tok']=float(m.group(2)); out['tok_s']=float(m.group(3))
m=re.search(r'moe-stream:\s*read\s*([0-9.]+)\s*MiB\s*\(([0-9.]+)\s*MiB/token\)', text)
if m:
    out['read_mib']=float(m.group(1)); out['mib_per_tok']=float(m.group(2))
m=re.search(r'moe-cache:\s*([0-9.]+)%\s*hit,\s*resident\s*([0-9.]+)\s*MiB', text)
if m:
    out['hit_pct']=float(m.group(1)); out['cache_res_mib']=float(m.group(2))
m=re.search(r'prefill:\s*(\d+)\s*tokens?,\s*([0-9.]+)\s*s\s*\(([0-9.]+)\s*tok/s\)', text)
if m:
    out['prefill_tok']=int(m.group(1)); out['prefill_s']=float(m.group(2)); out['prefill_tok_s']=float(m.group(3))
m=re.search(r'TTFT\s*([0-9.]+)\s*s', text)
if m: out['ttft_s']=float(m.group(1))
print(json.dumps(out))
PY
}

run_one() {
  local cell="$1" k="$2" drop="$3" prompt_file="$4" pid="$5" order="$6"
  local run_id="${cell}_${pid}_o${order}"
  local outf="$OUTDIR/logs/${run_id}.log"
  local prompt
  prompt=$(cat "$prompt_file")

  require_unplugged
  local pct; pct=$(batt_pct)
  if [ "$pct" -ge 0 ] 2>/dev/null && [ "$pct" -lt "$BATT_STOP" ]; then
    log "STOP battery floor $pct < $BATT_STOP"
    echo "STOP batt_floor" > "$STATUS"
    exit 7
  fi

  log "RUN $run_id k=$k drop=$drop n=$N_GEN"
  cold_model "$MODEL"

  local drop_args=()
  if [ -n "$drop" ] && [ "$drop" != "0" ] && [ "$drop" != "off" ] && [ "$drop" != "OFF" ]; then
    drop_args=(--drop-cold-experts "$drop")
  fi

  set +e
  "$BIN" -m "$MODEL" \
    -t "$THREADS" -c "$N_CTX" -n "$N_GEN" \
    -p "$prompt" --temp 0 \
    --moe-stream --cache-mb "$CACHE_MB" --dense-weights anon --overlap \
    --io-threads "$IO_THREADS" --ubatch "$UBATCH" \
    --n-expert-used "$k" \
    "${drop_args[@]}" \
    >"$outf" 2>&1
  local rc=$?
  set -e
  log "RUN $run_id rc=$rc"

  local metrics tok_s mib hit
  metrics=$(parse_metrics "$outf" || echo '{}')
  tok_s=$(echo "$metrics" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tok_s",""))')
  mib=$(echo "$metrics" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("mib_per_tok",""))')
  hit=$(echo "$metrics" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("hit_pct",""))')

  echo "$(ts),$run_id,$cell,$k,$drop,$pid,$order,$rc,$tok_s,$mib,$hit,$pct,$metrics" >> "$CSV"
  log "METRICS $run_id tok/s=$tok_s MiB/tok=$mib hit%=$hit batt=$pct"
  sleep 5
}

# --- main ---
: > "$MASTER"
echo "ts,run_id,cell,k,drop,prompt_id,order,rc,tok_s,mib_per_tok,hit_pct,batt_pct,metrics_json" > "$CSV"
echo "RUNNING" > "$STATUS"
termux-wake-lock 2>/dev/null || true

log "Phase1 SPEED Jelly A0 vs A2"
log "bin=$BIN"
[ -x "$BIN" ] || [ -f "$BIN" ] || { log "FAIL binary missing $BIN"; echo "FAIL bin" > "$STATUS"; exit 2; }
if [ -x "$HOME/bin/bmoe-cli.JELLY" ]; then
  sha256sum "$HOME/bin/bmoe-cli.JELLY" | tee -a "$MASTER"
fi
[ -f "$MODEL" ] || { log "FAIL missing $MODEL"; echo "FAIL model" > "$STATUS"; exit 2; }
msz=$(stat -c%s "$MODEL")
log "model bytes=$msz"
if [ "$msz" != "10505424704" ]; then
  log "FAIL unexpected Marco size $msz"
  echo "FAIL model_size" > "$STATUS"
  exit 2
fi

cat > "$P1" <<'EOF'
You are a helpful technical assistant. Answer clearly, in plain English, with one short paragraph and then two bullet points.

User: Explain what a Mixture-of-Experts language model is, and why activating only a few experts per token can reduce compute while still needing a large on-disk weight file on a phone. Mention routing and flash streaming.
Assistant:
EOF
cat > "$P2" <<'EOF'
You are a creative writer. Write in vivid English.

Task: In about 150 words, tell a short story about a courier robot delivering a sealed package across a rainy neon city at night. Include one obstacle and one small act of kindness. End with a single-sentence moral.
EOF
log "prompt_fact_sha=$(sha256sum "$P1" | awk '{print $1}')"
log "prompt_creative_sha=$(sha256sum "$P2" | awk '{print $1}')"

require_unplugged
log "ABBA: 2 prompts x (A0 A2 A2 A0), n=$N_GEN, -t $THREADS, io=$IO_THREADS"
log "A0 k=8 drop=OFF | A2 k=6 drop=0.65"

for pi in fact creative; do
  case $pi in
    fact) PF="$P1" ;;
    creative) PF="$P2" ;;
  esac
  run_one A0 8 OFF   "$PF" "$pi" 1
  run_one A2 6 0.65  "$PF" "$pi" 2
  run_one A2 6 0.65  "$PF" "$pi" 3
  run_one A0 8 OFF   "$PF" "$pi" 4
done

python3 - "$CSV" "$SUMM" "$VERDICT" <<'PY'
import csv, json, statistics, sys
from collections import defaultdict
path, outp, verdictp = sys.argv[1], sys.argv[2], sys.argv[3]
rows = []
with open(path, newline='', encoding='utf-8') as f:
    for row in csv.DictReader(f):
        try:
            if row.get('tok_s'):
                row['tok_s_f'] = float(row['tok_s'])
            if row.get('mib_per_tok'):
                row['mib_f'] = float(row['mib_per_tok'])
            if row.get('hit_pct'):
                row['hit_f'] = float(row['hit_pct'])
            rows.append(row)
        except Exception:
            pass

def med(cell, key):
    vals = [r[key] for r in rows if r.get('cell') == cell and key in r]
    return statistics.median(vals) if vals else None

a0_t, a2_t = med('A0', 'tok_s_f'), med('A2', 'tok_s_f')
a0_m, a2_m = med('A0', 'mib_f'), med('A2', 'mib_f')
a0_h, a2_h = med('A0', 'hit_f'), med('A2', 'hit_f')
ratio = (a2_t / a0_t) if a0_t and a2_t else None
mib_delta = ((a2_m - a0_m) / a0_m) if a0_m and a2_m else None
hit_delta = (a2_h - a0_h) if a0_h is not None and a2_h is not None else None
gate_tps = bool(ratio is not None and ratio >= 1.15)
gate_mib = bool(mib_delta is not None and mib_delta <= -0.20)
gate = gate_tps or gate_mib
out = {
    'n_rows': len(rows),
    'A0': {'median_tok_s': a0_t, 'median_mib_tok': a0_m, 'median_hit_pct': a0_h},
    'A2': {'median_tok_s': a2_t, 'median_mib_tok': a2_m, 'median_hit_pct': a2_h},
    'ratio_A2_over_A0': ratio,
    'mib_rel_delta': mib_delta,
    'hit_delta_pt': hit_delta,
    'gate_decode_1_15x': gate_tps,
    'gate_mib_minus20': gate_mib,
    'SPEED_GATE': 'PASS' if gate else 'FAIL',
}
open(outp, 'w', encoding='utf-8').write(json.dumps(out, indent=2) + '\n')
lines = [
    '# Marco Phase1 SPEED — Jelly Star (ranking only)',
    '',
    f"- A0 median tok/s: {a0_t}",
    f"- A2 median tok/s: {a2_t}",
    f"- ratio A2/A0: {ratio}  (gate >= 1.15x → {gate_tps})",
    f"- A0 median MiB/tok: {a0_m}",
    f"- A2 median MiB/tok: {a2_m}",
    f"- MiB rel delta: {mib_delta}  (gate <= -20% → {gate_mib})",
    f"- hit% A0={a0_h} A2={a2_h} dPt={hit_delta}",
    f"- **SPEED_GATE: {'PASS' if gate else 'FAIL'}**",
    '',
    'Absolute tok/s not product-citeable. Jelly = relative ranking.',
]
open(verdictp, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
print(json.dumps(out, indent=2))
PY

echo "DONE" > "$STATUS"
log "SPEED DONE summary=$SUMM"
termux-wake-unlock 2>/dev/null || true
