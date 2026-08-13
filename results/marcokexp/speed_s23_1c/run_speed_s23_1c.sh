#!/data/data/com.termux/files/usr/bin/bash
# run_speed_s23_1c.sh — MarcoKEXP-1c vs Marco-Q4KM A2 ABBA on S23
# REGIME test: MiB/tok + hit%. Campaign config. MemAvailable guard (NOT MemFree).
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/marcokexp_speed_s23_1c}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MARCO="${MARCO_MODEL:-$HOME/experiments/models/Marco-Mini-Instruct.i1-Q4_K_M.gguf}"
ONEC="${ONEC_MODEL:-$HOME/models/Marco-Mini-Instruct-KEXP.gguf}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

EXPECTED_BIN_PREFIX="1ca51420"
EXPECTED_MARCO_SHA="a001d324b6edc6a797009fbe6eb94a52a9f32453ee8d06465409875f3e3a6dbc"
EXPECTED_MARCO_SIZE="10505424704"
EXPECTED_1C_SHA="2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777"
EXPECTED_1C_SIZE="6385238848"
EXPECTED_FACT_SHA="b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd"
EXPECTED_CREATIVE_SHA="761db0d07cbc312acb35fb8c64894be83f38a3a7f0ba14e2100ef6a44a29c871"

MEMAVAIL_ABORT_KIB=307200
MEMAVAIL_STREAK_NEED=12   # 12 x 5s = 60s
BATT_FLOOR=45
TEMP_ABORT_C=45

mkdir -p "$OUTDIR/logs" "$OUTDIR/prompts" "$OUTDIR/mem"
CSV="$OUTDIR/runs_speed.csv"
MASTER="$OUTDIR/SPEED.master.log"
STATUS="$OUTDIR/STATUS.txt"
: > "$MASTER"
echo "ts,cell,k,drop,prompt_id,order_idx,decode_tps,mib_per_tok,hit_pct,ttft_s,load_s,n_gen,batt_start,batt_end,temp_max,cold,plugged,memavail_start_kib" > "$CSV"
echo "RUNNING" > "$STATUS"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

got=$(sha256sum "$BIN" | awk '{print $1}')
log "BIN_SHA=$got path=$BIN"
case "$got" in
  ${EXPECTED_BIN_PREFIX}*) log "PIN OK" ;;
  *) log "PIN FAIL expected ${EXPECTED_BIN_PREFIX}* got $got"; echo "FAIL_PIN" > "$STATUS"; exit 6 ;;
esac
echo "$got  bmoe-cli.CAMPAIGN" > "$OUTDIR/bin.sha256"

marco_size=$(stat -c%s "$MARCO" 2>/dev/null || echo 0)
log "MARCO path=$MARCO size=$marco_size"
if [ "$marco_size" != "$EXPECTED_MARCO_SIZE" ]; then
  log "MARCO size unexpected: $marco_size want $EXPECTED_MARCO_SIZE"
  echo "FAIL_MARCO_SIZE" > "$STATUS"; exit 7
fi
if [ -f "$OUTDIR/marco.sha256" ]; then
  msha=$(awk 'NF{print $1; exit}' "$OUTDIR/marco.sha256")
else
  log "computing MARCO sha256..."
  msha=$(sha256sum "$MARCO" | awk '{print $1}')
  echo "$msha  Marco-Mini-Instruct.i1-Q4_K_M.gguf" > "$OUTDIR/marco.sha256"
fi
log "MARCO_SHA=$msha"
if [ "$msha" != "$EXPECTED_MARCO_SHA" ]; then
  log "MARCO sha mismatch"; echo "FAIL_MARCO_SHA" > "$STATUS"; exit 8
fi

onec_size=$(stat -c%s "$ONEC" 2>/dev/null || echo 0)
log "ONEC path=$ONEC size=$onec_size"
if [ "$onec_size" != "$EXPECTED_1C_SIZE" ]; then
  log "ONEC size unexpected: $onec_size want $EXPECTED_1C_SIZE"
  echo "FAIL_1C_SIZE" > "$STATUS"; exit 7
fi
if [ -f "$OUTDIR/kexp1c.sha256" ]; then
  osha=$(awk 'NF{print $1; exit}' "$OUTDIR/kexp1c.sha256")
else
  log "computing ONEC sha256..."
  osha=$(sha256sum "$ONEC" | awk '{print $1}')
  echo "$osha  Marco-Mini-Instruct-KEXP.gguf" > "$OUTDIR/kexp1c.sha256"
fi
log "ONEC_SHA=$osha"
if [ "$osha" != "$EXPECTED_1C_SHA" ]; then
  log "ONEC sha mismatch"; echo "FAIL_1C_SHA" > "$STATUS"; exit 8
fi

P_FACT="$OUTDIR/prompts/p_fact.txt"
P_CREATIVE="$OUTDIR/prompts/p_creative.txt"
# Prompts must be pre-pushed (byte-identical to phase-1). Do not rewrite them here.
if [ ! -f "$P_FACT" ] || [ ! -f "$P_CREATIVE" ]; then
  log "prompts missing"; echo "FAIL_PROMPTS" > "$STATUS"; exit 9
fi
fact_sha=$(sha256sum "$P_FACT" | awk '{print $1}')
crea_sha=$(sha256sum "$P_CREATIVE" | awk '{print $1}')
log "prompt_fact_sha=$fact_sha"
log "prompt_creative_sha=$crea_sha"
if [ "$fact_sha" != "$EXPECTED_FACT_SHA" ]; then
  log "fact prompt sha mismatch"; echo "FAIL_PROMPT_SHA" > "$STATUS"; exit 9
fi
if [ "$crea_sha" != "$EXPECTED_CREATIVE_SHA" ]; then
  log "creative prompt sha mismatch"; echo "FAIL_PROMPT_SHA" > "$STATUS"; exit 9
fi

cold(){
  local m="${1:-$MARCO}"
  if [ -x "$HOME/bin/cold_model.sh" ]; then
    "$HOME/bin/cold_model.sh" "$m" || true
  elif [ -x "$HOME/bin/fadv" ]; then
    "$HOME/bin/fadv" --dontneed "$m" 2>/dev/null || true
  fi
}

batt_json(){ timeout 5 termux-battery-status 2>/dev/null || echo '{}'; }

memavail_kib(){ awk '/^MemAvailable:/{print $2}' /proc/meminfo; }

kill_our_cli(){
  pkill -f "bmoe-cli.CAMPAIGN" 2>/dev/null || true
}

# 60s MemAvailable window (12 x 5s). MemFree logged only; page-cache mmap is not OOM.
start_mem_sampler(){
  local csv="$1"
  echo "iso,memfree_kib,memavail_kib" > "$csv"
  rm -f "$OUTDIR/ABORT_RAM.txt"
  (
    bad=0
    while true; do
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
      echo "$(ts),${mf},${ma}" >> "$csv"
      if [ -n "${ma}" ] && [ "${ma}" -lt "${MEMAVAIL_ABORT_KIB}" ]; then
        bad=$((bad + 1))
        echo "LOW MemAvailable=${ma} KiB consec=${bad}/${MEMAVAIL_STREAK_NEED}" >> "$csv"
        if [ "${bad}" -ge "${MEMAVAIL_STREAK_NEED}" ]; then
          echo "ABORT MemAvailable=${ma} KiB < 300 MiB sustained 60s" | tee -a "$csv"
          echo "ABORT_RAM ma=${ma}" > "$OUTDIR/ABORT_RAM.txt"
          kill_our_cli
          exit 0
        fi
      else
        bad=0
      fi
      sleep 5
    done
  ) >/dev/null 2>&1 &
  echo $! > "$OUTDIR/mem_sampler.pid"
}

stop_mem_sampler(){
  if [ -f "$OUTDIR/mem_sampler.pid" ]; then
    local pid
    pid="$(cat "$OUTDIR/mem_sampler.pid")"
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    rm -f "$OUTDIR/mem_sampler.pid"
  fi
}

preflight_block(){
  local floor="${1:-$BATT_FLOOR}"
  local bj plug pct temp i ma
  for i in $(seq 1 720); do
    bj=$(batt_json)
    plug=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('plugged','?'))" "$bj")
    pct=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj")
    temp=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj")
    ma=$(memavail_kib)
    log "preflight i=$i plugged=$plug batt=$pct temp=$temp memavail_kib=$ma floor=$floor"
    if ! echo "$plug" | grep -qi UNPLUGGED; then
      log "WAIT unplugged (now $plug) — measurements require UNPLUGGED"
      sleep 20
      continue
    fi
    if [ "$pct" -lt "$floor" ] 2>/dev/null; then
      log "STOP batt $pct < $floor needs charge"
      echo "STOP_BATT" > "$STATUS"
      return 3
    fi
    if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > ${TEMP_ABORT_C} else 1)" "$temp"; then
      log "WAIT battery temp $temp > ${TEMP_ABORT_C}C"
      sleep 30
      continue
    fi
    return 0
  done
  log "STOP preflight timeout still not ready"
  echo "STOP_PLUGGED" > "$STATUS"
  return 2
}

BASE_FLAGS=(--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -t 4 -c 4096 --temp 0 --chatml --no-think)

run_one(){
  local cell="$1" k="$2" drop="$3" prompt_id="$4" order_idx="$5" prompt_file="$6" model_path="$7"
  local label="${cell}_${prompt_id}_o${order_idx}"
  local out="$OUTDIR/logs/$label"
  mkdir -p "$out"

  local bj plug pct_s temp_s ma_s
  bj=$(batt_json)
  plug=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('plugged','?'))" "$bj")
  pct_s=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj")
  temp_s=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj")
  ma_s=$(memavail_kib)
  log "RUN $label batt=$pct_s plugged=$plug temp=$temp_s memavail_kib=$ma_s"
  if ! echo "$plug" | grep -qi UNPLUGGED; then
    log "STOP $label plugged=$plug"
    echo "STOP_PLUGGED" > "$STATUS"
    return 2
  fi
  if [ "$pct_s" -lt "$BATT_FLOOR" ] 2>/dev/null; then
    log "STOP $label batt=$pct_s needs charge"
    echo "STOP_BATT" > "$STATUS"
    return 3
  fi
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > ${TEMP_ABORT_C} else 1)" "$temp_s"; then
    log "WAIT thermal before $label temp=$temp_s"
    sleep 45
    bj=$(batt_json)
    temp_s=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj")
    plug=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('plugged','?'))" "$bj")
    pct_s=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj")
    ma_s=$(memavail_kib)
    if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > ${TEMP_ABORT_C} else 1)" "$temp_s"; then
      log "STOP thermal $label temp=$temp_s"
      echo "STOP_THERMAL" > "$STATUS"
      return 4
    fi
  fi

  cold "$model_path"
  local cold_flag=1

  local ptext
  ptext=$(cat "$prompt_file")

  local -a cmd
  cmd=("$BIN" -m "$model_path" -p "$ptext" -n 200 --n-expert-used "$k")
  if [ -n "$drop" ] && [ "$drop" != "OFF" ] && [ "$drop" != "none" ]; then
    cmd+=(--drop-cold-experts "$drop")
  fi
  cmd+=("${BASE_FLAGS[@]}")

  start_mem_sampler "$OUTDIR/mem/${label}.csv"
  local t0 t1 wall rc
  t0=$(date +%s)
  set +e
  "${cmd[@]}" >"$out/stdout.txt" 2>"$out/stderr.txt"
  rc=$?
  set -e
  t1=$(date +%s); wall=$((t1-t0))
  stop_mem_sampler
  cat "$out/stdout.txt" "$out/stderr.txt" > "$out/combo.txt" 2>/dev/null || true

  if [ -f "$OUTDIR/ABORT_RAM.txt" ]; then
    log "STOP $label $(cat "$OUTDIR/ABORT_RAM.txt")"
    echo "STOP_RAM" > "$STATUS"
    return 5
  fi

  local bj2 pct_e temp_e temp_max
  bj2=$(batt_json)
  pct_e=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj2")
  temp_e=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj2")
  temp_max=$(python3 -c "print(max(float('$temp_s'), float('$temp_e')))")

  local metrics
  metrics=$(python3 - <<PY
import re, json
from pathlib import Path
text = Path("$out/combo.txt").read_text(encoding="utf-8", errors="replace")
tok_s=mib=hit=ttft=n_gen=load_s=""
m=re.search(r"generation:\s*(\d+)\s+tokens,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)", text)
if m:
    n_gen=m.group(1); tok_s=m.group(2)
m2=re.search(r"TTFT\s+([0-9.]+)\s*s", text)
if m2:
    ttft=m2.group(1)
if not ttft:
    m2b=re.search(r"prefill:\s*(\d+)\s+tokens,\s*([0-9.]+)\s*s\s*\(([0-9.]+)\s*tok/s\)", text)
    if m2b:
        ttft=m2b.group(2)
if not ttft:
    m2c=re.search(r"prompt eval time\s*=\s*([0-9.]+)\s*ms", text, re.I)
    if m2c:
        ttft=str(float(m2c.group(1))/1000.0)
mload=re.search(r"model load\s+([0-9.]+)\s*s", text)
if mload:
    load_s=mload.group(1)
m3=re.search(r"moe-cache:\s*([0-9.]+)%\s*hit", text)
if m3:
    hit=m3.group(1)
m5=re.search(r"\(([0-9.]+)\s*MiB/token\)", text)
if m5:
    mib=m5.group(1)
for line in text.splitlines():
    if "BMOE_DONE" in line:
        i=line.find("{")
        if i>=0:
            try:
                j=json.loads(line[i:])
                if j.get("tok_s") is not None: tok_s=str(j["tok_s"])
                if j.get("tokens") is not None: n_gen=str(j["tokens"])
                if j.get("ttft") is not None: ttft=str(j["ttft"])
                if j.get("mib_per_tok") is not None: mib=str(j["mib_per_tok"])
                if j.get("hit_pct") is not None: hit=str(j["hit_pct"])
                if j.get("load_s") is not None: load_s=str(j["load_s"])
            except Exception:
                pass
print("|".join([tok_s, mib, hit, ttft, load_s, n_gen]))
PY
)
  IFS='|' read -r decode_tps mib_per_tok hit_pct ttft_s load_s n_gen <<<"$metrics"
  local drop_csv="$drop"
  if [ -z "$drop" ] || [ "$drop" = "OFF" ] || [ "$drop" = "none" ]; then drop_csv="OFF"; fi

  local row
  row="$(ts),${cell},${k},${drop_csv},${prompt_id},${order_idx},${decode_tps},${mib_per_tok},${hit_pct},${ttft_s},${load_s},${n_gen},${pct_s},${pct_e},${temp_max},${cold_flag},${plug},${ma_s}"
  echo "$row" >> "$CSV"
  log "DONE $label rc=$rc wall=${wall}s decode_tps=$decode_tps mib=$mib_per_tok hit=$hit_pct ttft=$ttft_s load=$load_s n_gen=$n_gen batt=${pct_s}->${pct_e} temp_max=$temp_max memavail=$ma_s"
  tail -100 "$out/combo.txt" > "$out/tail.txt" || true
  printf '%s\n' "${cmd[@]}" > "$out/cmdline.txt"
  if [ "$rc" -ne 0 ]; then
    log "WARN $label cli rc=$rc (metrics may be empty)"
  fi
  return 0
}

termux-wake-lock >/dev/null 2>&1 || true
SCREEN_PREV=$(settings get system screen_off_timeout 2>/dev/null || echo "")
settings put system screen_off_timeout 7200000 2>/dev/null || true
restore(){
  stop_mem_sampler
  if [ -n "${SCREEN_PREV:-}" ] && [ "$SCREEN_PREV" != "null" ]; then
    settings put system screen_off_timeout "$SCREEN_PREV" 2>/dev/null || true
  fi
  termux-wake-unlock >/dev/null 2>&1 || true
}
trap 'restore; log "trap cleanup"' EXIT

log "=== MARCOKEXP-1c SPEED START ==="
preflight_block "$BATT_FLOOR" || exit $?

run_abba(){
  local pid="$1" pfile="$2"
  log "=== ABBA prompt=$pid ==="
  preflight_block "$BATT_FLOOR" || return $?
  run_one ARM_MARCO 6 0.65 "$pid" 1 "$pfile" "$MARCO" || return $?
  run_one ARM_1C    6 0.65 "$pid" 2 "$pfile" "$ONEC"  || return $?
  run_one ARM_1C    6 0.65 "$pid" 3 "$pfile" "$ONEC"  || return $?
  run_one ARM_MARCO 6 0.65 "$pid" 4 "$pfile" "$MARCO" || return $?
}

run_abba fact "$P_FACT" || { log "aborted fact status=$(cat $STATUS)"; exit 1; }
run_abba creative "$P_CREATIVE" || { log "aborted creative status=$(cat $STATUS)"; exit 1; }

echo "DONE" > "$STATUS"
log "=== MARCOKEXP-1c SPEED COMPLETE ==="
cat "$CSV" | tee -a "$MASTER"
