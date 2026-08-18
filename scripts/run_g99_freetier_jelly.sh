#!/data/data/com.termux/files/usr/bin/bash
# G99 free-tier fail-fast on Jelly Star.
# B1 Qwen3.5-2B Q4_K_M plain | B2 LFM2.5-8B-A1B Q4_K_M mmap | k=3 | k=2
# UNPLUGGED, -t 2, n=200, temp 0, cold fadvise, 2 runs/cell.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$HOME/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C
unset LD_LIBRARY_PATH

OUTDIR="${OUTDIR:-$HOME/experiments/results/g99_freetier}"
mkdir -p "$OUTDIR/logs" "$TMPDIR"
MASTER="$OUTDIR/G99.master.log"
STATUS="$OUTDIR/STATUS.txt"
CSV="$OUTDIR/runs.csv"
BIN="${BINARY:-$HOME/bin/run-bmoe}"
MODEL_QWEN="${MODEL_QWEN:-$HOME/models/Qwen3.5-2B-Q4_K_M.gguf}"
MODEL_LFM="${MODEL_LFM:-$HOME/models/LFM2.5-8B-A1B-Q4_K_M.gguf}"
THREADS="${THREADS:-2}"
N_CTX="${N_CTX:-1024}"
N_GEN="${N_GEN:-200}"
BATT_MIN="${BATT_MIN:-35}"
TEMP_MAX="${TEMP_MAX:-45}"
PROMPT_FILE="$OUTDIR/prompt.txt"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

batt_json() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 4 termux-battery-status 2>/dev/null || echo '{}'
  else
    echo '{}'
  fi
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
    local online=0 v
    for pth in /sys/class/power_supply/*/online; do
      [ -f "$pth" ] || continue
      v=$(cat "$pth" 2>/dev/null || echo 0)
      [ "$v" = "1" ] && online=1
    done
    if [ "$online" = "1" ]; then echo PLUGGED; else echo UNPLUGGED; fi
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
  echo "$p"
}
batt_temp() {
  local j t
  j=$(batt_json)
  t=$(echo "$j" | python3 -c 'import sys,json
try:
 d=json.load(sys.stdin); print(float(d.get("temperature") or -1))
except Exception:
 print(-1)' 2>/dev/null || echo -1)
  echo "$t"
}

require_unplugged() {
  local p pct temp
  p=$(batt_plugged)
  pct=$(batt_pct)
  temp=$(batt_temp)
  log "battery plugged=$p pct=$pct temp=$temp"
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
  python3 - "$temp" "$TEMP_MAX" <<'PY' || true
import sys
try:
    t=float(sys.argv[1]); mx=float(sys.argv[2])
except Exception:
    sys.exit(0)
if t>0 and t>mx:
    sys.exit(6)
sys.exit(0)
PY
  if [ $? -eq 6 ]; then
    log "FAIL: temp $temp > TEMP_MAX $TEMP_MAX"
    echo "FAIL temp=$temp" > "$STATUS"
    exit 6
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

parse_toks() {
  python3 - "$1" <<'PY'
import re,sys
text=open(sys.argv[1],encoding='utf-8',errors='replace').read()
# bmoe / llama.cpp decode lines
pats=[
    r'generation:\s*\d+\s*tokens?,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)',
    r'eval time\s*=\s*[0-9.]+ ms\s*/\s*\d+\s*tokens?\s*\(\s*[0-9.]+\s*ms per token,\s*([0-9.]+)\s*tokens per second\)',
    r'tok/s[:\s]+([0-9.]+)',
]
for p in pats:
    ms=re.findall(p, text)
    if ms:
        print(ms[-1]); sys.exit(0)
print('')
PY
}

mem_snap() {
  local tag="$1"
  {
    echo "=== MEM $tag $(ts) ==="
    free -h || true
    echo "--- proc ---"
    # rss of recent bmoe if still around
    ps -o pid,rss,vsz,args -A 2>/dev/null | grep -E 'bmoe|llama' | grep -v grep || true
    echo "--- dmesg OOM (last 20 matching) ---"
    dmesg 2>/dev/null | grep -i -E 'oom|kill|lowmemory' | tail -n 20 || echo 'dmesg unavailable'
  } >> "$OUTDIR/mem.log"
}

run_one() {
  local cell="$1" model="$2" extra="$3" run="$4"
  local outf="$OUTDIR/logs/${cell}_r${run}.log"
  local pct temp tok extra_arr
  require_unplugged
  pct=$(batt_pct)
  temp=$(batt_temp)
  log "RUN cell=$cell run=$run batt=$pct temp=$temp extra=[$extra]"
  cold_model "$model"
  mem_snap "pre_${cell}_r${run}"
  # shellcheck disable=SC2206
  extra_arr=($extra)
  local prompt
  prompt=$(cat "$PROMPT_FILE")
  set +e
  "$BIN" -m "$model" \
    -t "$THREADS" -c "$N_CTX" -n "$N_GEN" \
    -p "$prompt" --temp 0 --ubatch 256 \
    "${extra_arr[@]}" \
    >"$outf" 2>&1
  local rc=$?
  set -e
  mem_snap "post_${cell}_r${run}"
  tok=$(parse_toks "$outf" || echo '')
  log "RUN cell=$cell run=$run rc=$rc tok/s=$tok"
  echo "$(ts),$cell,$run,$tok,$pct,$temp,$rc" >> "$CSV"
  sleep 8
}

# --- main ---
: > "$MASTER"
echo "ts,cell,run,tok_s,batt,temp,rc" > "$CSV"
echo "RUNNING" > "$STATUS"
termux-wake-lock 2>/dev/null || true

cat > "$PROMPT_FILE" <<'EOF'
You are a helpful technical assistant. Answer clearly, in plain English, with one short paragraph and then two bullet points.

User: Explain what a Mixture-of-Experts language model is, and why activating only a few experts per token can reduce compute while still needing a large on-disk weight file on a phone. Mention routing and flash streaming.
Assistant:
EOF

log "G99 free-tier fail-fast"
log "bin=$BIN"
sha256sum "$HOME/bin/bmoe-cli" | tee -a "$MASTER"
log "qwen=$MODEL_QWEN"
log "lfm=$MODEL_LFM"
[ -x "$BIN" ] || [ -f "$BIN" ] || { log "FAIL binary missing"; echo "FAIL bin" > "$STATUS"; exit 2; }
[ -f "$MODEL_QWEN" ] || { log "FAIL missing qwen"; echo "FAIL qwen" > "$STATUS"; exit 2; }
[ -f "$MODEL_LFM" ] || { log "FAIL missing lfm"; echo "FAIL lfm" > "$STATUS"; exit 2; }
log "qwen_bytes=$(stat -c%s "$MODEL_QWEN")"
log "lfm_bytes=$(stat -c%s "$MODEL_LFM")"
log "qwen_sha=$(sha256sum "$MODEL_QWEN" | awk '{print $1}')"
log "lfm_sha=$(sha256sum "$MODEL_LFM" | awk '{print $1}')"
log "ctx=$N_CTX n=$N_GEN t=$THREADS"
require_unplugged

# B1 dense reference — no moe flags
run_one B1 "$MODEL_QWEN" "" 1
run_one B1 "$MODEL_QWEN" "" 2

# B2 LFM2.5 headline — plain mmap, no --moe-stream
run_one B2 "$MODEL_LFM" "" 1
run_one B2 "$MODEL_LFM" "" 2

# Phase 3 k lever (speed only). Default K0=4.
run_one K3 "$MODEL_LFM" "--n-expert-used 3" 1
run_one K3 "$MODEL_LFM" "--n-expert-used 3" 2
run_one K2 "$MODEL_LFM" "--n-expert-used 2" 1
run_one K2 "$MODEL_LFM" "--n-expert-used 2" 2

log "DONE"
echo "DONE" > "$STATUS"
termux-wake-unlock 2>/dev/null || true
