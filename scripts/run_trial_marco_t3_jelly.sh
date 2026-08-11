#!/data/data/com.termux/files/usr/bin/bash
# T3 trial-marco on Jelly Star: ABBA A=KEXP vs B=Marco, 2 prompts x ABBA, n=200
# then sustained Marco n=512. Unplugged hard-gate, batt>=45%, -t 2 (G99).
# Binary: Jelly pin via ~/bin/run-bmoe (NOT S23 CAMPAIGN pin).
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C
# CRITICAL on this Termux: do not inject $PREFIX/lib (breaks libunwindstack)
unset LD_LIBRARY_PATH

OUTDIR="${OUTDIR:-$HOME/experiments/results/trial_marco/t3}"
mkdir -p "$OUTDIR" "$TMPDIR"
MASTER="$OUTDIR/T3.master.log"
STATUS="$OUTDIR/STATUS.txt"
CSV="$OUTDIR/t3_runs.csv"
BIN="${BINARY:-$HOME/bin/run-bmoe}"
MODEL_A="${MODEL_A:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
MODEL_B="${MODEL_B:-$HOME/experiments/models/Marco-Mini-Instruct.i1-Q4_K_M.gguf}"
THREADS="${THREADS:-2}"
N_CTX="${N_CTX:-4096}"
N_GEN="${N_GEN:-200}"
N_SUSTAIN="${N_SUSTAIN:-512}"
IO_THREADS="${IO_THREADS:-2}"
CACHE_MB="${CACHE_MB:-2000}"
UBATCH="${UBATCH:-512}"
BATT_MIN="${BATT_MIN:-45}"
BATT_STOP="${BATT_STOP:-30}"
DROP_A="${DROP_A:-0.65}"   # KEXP campaign drop
N_EXPERT_A="${N_EXPERT_A:-6}"  # campaign default k=6 (k6d065)
N_EXPERT_B="${N_EXPERT_B:-0}"  # 0 = model default for Marco
# Marco: drop OFF

P1="${P1:-$HOME/experiments/prompts/t3_p1.txt}"
P2="${P2:-$HOME/experiments/prompts/t3_p2.txt}"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

# termux-battery-status can hang forever on some devices — always timeout.
batt_json() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 4 termux-battery-status 2>/dev/null || echo '{}'
  else
    # fallback: background + kill
    local tmpf
    tmpf=$(mktemp)
    termux-battery-status >"$tmpf" 2>/dev/null &
    local bp=$!
    local i=0
    while [ $i -lt 40 ] && kill -0 $bp 2>/dev/null; do
      sleep 0.1
      i=$((i+1))
    done
    if kill -0 $bp 2>/dev/null; then kill $bp 2>/dev/null; wait $bp 2>/dev/null; echo '{}'; rm -f "$tmpf"; return; fi
    wait $bp 2>/dev/null || true
    cat "$tmpf" 2>/dev/null || echo '{}'
    rm -f "$tmpf"
  fi
}
# sysfs fallbacks (no hang)
batt_plugged_sys() {
  local online=0
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
  if [ "$p" = "UNKNOWN" ] || [ -z "$p" ]; then
    batt_plugged_sys
  else
    echo "$p"
  fi
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
batt_temp() {
  local j
  j=$(batt_json)
  echo "$j" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin); print(float(d.get("temperature") or -1))
except Exception:
 print(-1)' 2>/dev/null || echo -1
}

require_unplugged() {
  local p pct
  p=$(batt_plugged)
  pct=$(batt_pct)
  log "battery plugged=$p pct=$pct temp=$(batt_temp)"
  case "$p" in
    UNPLUGGED|false|0|none|NONE) ;;
    *)
      log "FAIL: must be UNPLUGGED for T3 (got plugged=$p)"
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
    "$HOME/bin/cold_model.sh" "$m" >>"$MASTER" 2>&1 || log "WARN cold_model failed for $m"
  elif [ -x "$HOME/bin/fadv" ]; then
    "$HOME/bin/fadv" "$m" >>"$MASTER" 2>&1 || true
  else
    log "WARN no fadv/cold_model — best-effort cold (sleep + sync)"
    sync || true
    sleep 2
  fi
}

# Parse metrics from bmoe-cli stdout/stderr blob
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
m=re.search(r'model load\s*([0-9.]+)\s*s', text)
if m: out['load_s']=float(m.group(1))
m=re.search(r'TTFT\s*([0-9.]+)\s*s', text)
if m: out['ttft_s']=float(m.group(1))
print(json.dumps(out))
PY
}

run_one() {
  local tag="$1" model="$2" drop="$3" prompt_file="$4" ngen="$5" rep="$6" cell="$7" kexp_used="${8:-0}"
  local run_id="${tag}_${cell}_r${rep}_n${ngen}"
  local outf="$OUTDIR/${run_id}.log"
  local prompt
  prompt=$(cat "$prompt_file")

  require_unplugged
  local pct; pct=$(batt_pct)
  if [ "$pct" -ge 0 ] 2>/dev/null && [ "$pct" -lt "$BATT_STOP" ]; then
    log "STOP battery floor $pct < $BATT_STOP"
    echo "STOP batt_floor" > "$STATUS"
    exit 7
  fi

  log "RUN $run_id model=$(basename "$model") drop=$drop k=$kexp_used n=$ngen"
  cold_model "$model"

  local drop_args=()
  if [ -n "$drop" ] && [ "$drop" != "0" ] && [ "$drop" != "off" ] && [ "$drop" != "OFF" ]; then
    drop_args=(--drop-cold-experts "$drop")
  fi
  local k_args=()
  if [ -n "$kexp_used" ] && [ "$kexp_used" != "0" ]; then
    k_args=(--n-expert-used "$kexp_used")
  fi

  set +e
  # shellcheck disable=SC2086
  "$BIN" -m "$model" \
    -t "$THREADS" -c "$N_CTX" -n "$ngen" \
    -p "$prompt" --temp 0 \
    --moe-stream --cache-mb "$CACHE_MB" --dense-weights anon --overlap \
    --io-threads "$IO_THREADS" --ubatch "$UBATCH" \
    "${k_args[@]}" \
    "${drop_args[@]}" \
    >"$outf" 2>&1
  local rc=$?
  set -e
  log "RUN $run_id rc=$rc"

  local metrics
  metrics=$(parse_metrics "$outf" || echo '{}')
  local tok_s mib hit
  tok_s=$(echo "$metrics" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tok_s",""))')
  mib=$(echo "$metrics" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("mib_per_tok",""))')
  hit=$(echo "$metrics" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("hit_pct",""))')

  echo "$(ts),$run_id,$tag,$cell,$rep,$ngen,$(basename "$model"),$drop,$kexp_used,$rc,$tok_s,$mib,$hit,$pct,$(batt_temp),$metrics" >> "$CSV"
  log "METRICS $run_id tok/s=$tok_s MiB/tok=$mib hit%=$hit k=$kexp_used batt=$pct"
  # small cool-down between runs
  sleep 5
}

# --- main ---
: > "$MASTER"
echo "ts,run_id,tag,cell,rep,n,model,drop,n_expert_used,rc,tok_s,mib_per_tok,hit_pct,batt_pct,batt_temp_c,metrics_json" > "$CSV"
echo "RUNNING" > "$STATUS"
termux-wake-lock 2>/dev/null || true

log "T3 start Jelly trial-marco (KEXP = k${N_EXPERT_A}d${DROP_A} campaign default)"
log "bin=$BIN"
if [ -x "$BIN" ] || [ -f "$BIN" ]; then
  # resolve real binary for sha
  real_bin="$HOME/src/BigMoeOnEdge/build-jelly/cli/bmoe-cli"
  if [ -f "$real_bin" ]; then sha256sum "$real_bin" | tee -a "$MASTER"; fi
else
  log "FAIL binary missing $BIN"; echo "FAIL bin" > "$STATUS"; exit 2
fi
[ -f "$MODEL_A" ] || { log "FAIL missing $MODEL_A"; exit 2; }
[ -f "$MODEL_B" ] || { log "FAIL missing $MODEL_B"; exit 2; }
# Size check only at start (full sha of 23GB can take 10+ min and delays ABBA).
log "model_a bytes=$(stat -c%s "$MODEL_A") name=$(basename "$MODEL_A")"
log "model_b bytes=$(stat -c%s "$MODEL_B") name=$(basename "$MODEL_B")"
# Expected sizes from PC download/push verification
if [ "$(stat -c%s "$MODEL_A")" != "13416430592" ]; then log "WARN unexpected KEXP size"; fi
if [ "$(stat -c%s "$MODEL_B")" != "10505424704" ]; then log "WARN unexpected Marco size"; fi

# prompts
mkdir -p "$(dirname "$P1")"
if [ ! -f "$P1" ]; then
  cat > "$P1" <<'EOF'
You are a helpful technical assistant. Answer clearly, in plain English, with one short paragraph and then two bullet points.

User: On a modern smartphone with 8GB of RAM and UFS flash storage, why can a dense 4B language model run smoothly while a 35B mixture-of-experts model with only about 3B active parameters still needs careful expert streaming from flash? Mention memory footprint, page faults, and thermal limits in your answer.
EOF
fi
if [ ! -f "$P2" ]; then
  cat > "$P2" <<'EOF'
Sei un assistente tecnico. Rispondi in italiano, chiaro e concreto, max 150 parole.

Domanda: cos'è un modello Mixture-of-Experts e perché su uno smartphone con 8 GB di RAM uno streaming degli esperti da flash può essere necessario anche se i parametri attivi per token sono pochi?
EOF
fi

require_unplugged
log "ABBA plan: 2 prompts x (A B B A), n=$N_GEN, threads=$THREADS"
log "A=KEXP k=$N_EXPERT_A drop=$DROP_A (k6d065) | B=Marco drop=OFF k=default"

for pi in 1 2; do
  case $pi in
    1) PF="$P1"; CELL=p1 ;;
    2) PF="$P2"; CELL=p2 ;;
  esac
  # ABBA: A B B A  — A always campaign k6d065
  run_one A "$MODEL_A" "$DROP_A" "$PF" "$N_GEN" 1 "${CELL}a1" "$N_EXPERT_A"
  run_one B "$MODEL_B" "OFF"      "$PF" "$N_GEN" 1 "${CELL}b1" "$N_EXPERT_B"
  run_one B "$MODEL_B" "OFF"      "$PF" "$N_GEN" 2 "${CELL}b2" "$N_EXPERT_B"
  run_one A "$MODEL_A" "$DROP_A" "$PF" "$N_GEN" 2 "${CELL}a2" "$N_EXPERT_A"
done

log "SUSTAINED Marco n=$N_SUSTAIN"
run_one B "$MODEL_B" "OFF" "$P1" "$N_SUSTAIN" 1 "sust" "$N_EXPERT_B"

# summary ratios
python3 - "$CSV" "$OUTDIR/t3_summary.json" <<'PY'
import csv,json,statistics,sys
from collections import defaultdict
path,outp=sys.argv[1],sys.argv[2]
rows=[]
with open(path,newline='',encoding='utf-8') as f:
    r=csv.DictReader(f)
    for row in r:
        try:
            if row.get('tok_s'):
                row['tok_s_f']=float(row['tok_s'])
                rows.append(row)
        except Exception:
            pass
by=defaultdict(list)
for row in rows:
    if row['n']=='200' or row.get('n')=='200':
        by[row['tag']].append(row['tok_s_f'])
# also filter by n field
by=defaultdict(list)
for row in rows:
    if str(row.get('n'))=='200':
        by[row['tag']].append(row['tok_s_f'])
summ={}
for tag,vals in by.items():
    summ[tag]={
        'n': len(vals),
        'median_tok_s': statistics.median(vals) if vals else None,
        'mean_tok_s': statistics.mean(vals) if vals else None,
        'vals': vals,
    }
a=summ.get('A',{}).get('median_tok_s')
b=summ.get('B',{}).get('median_tok_s')
ratio=(b/a) if a and b else None
gate = (ratio is not None and ratio >= 1.3)
out={
    'by_tag_n200': summ,
    'ratio_marco_over_kexp_median': ratio,
    'gate_1_3x': gate,
    'all_rows': len(rows),
}
open(outp,'w',encoding='utf-8').write(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
PY

echo "DONE" > "$STATUS"
log "T3 DONE summary=$OUTDIR/t3_summary.json"
termux-wake-unlock 2>/dev/null || true
