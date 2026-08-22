#!/data/data/com.termux/files/usr/bin/bash
# run_f1c_s23.sh — Mellum2 F1c: runtime k/drop grid on the F1b binary.
# Cells (2 cold reps each): k=6, k=4, k=2, then best-k + --drop-cold-experts 0.65.
# NEVER touch ~/bin/bmoe-cli or bmoe-cli.CAMPAIGN. NEVER touch Jelly/Xiaomi.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

ROOT="${ROOT:-$HOME/experiments/results/mellum2_f1_s23}"
OUTDIR="${OUTDIR:-$ROOT/f1c}"
BIN="${BINARY:-$HOME/bin/bmoe-cli-mellum}"
LIBDIR="${LIBDIR:-$HOME/bin/mellum}"
MODEL="${MODEL:-$HOME/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf}"
export LD_LIBRARY_PATH="${LIBDIR}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

EXPECTED_BIN_SHA="69a35f5ef85e286a1d05069872a3ae75b9a8c66d4098695936a5baf4b4d61b8a"
EXPECTED_MODEL_SHA="b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7"
EXPECTED_MODEL_SIZE="8071293600"
EXPECTED_FACT_SHA="b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd"
FORBIDDEN_CAMPAIGN_SHA="1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f"

MEMAVAIL_ABORT_KIB=307200
MEMAVAIL_STREAK_NEED=12
BATT_FLOOR=45
TEMP_ABORT_C=45
UNPLUG_POLLS="${UNPLUG_POLLS:-4}"
UNPLUG_SLEEP_S="${UNPLUG_SLEEP_S:-20}"
DROP_F="0.65"

mkdir -p "$OUTDIR/logs" "$OUTDIR/prompts" "$OUTDIR/mem"
CSV="$OUTDIR/runs_regime.csv"
MASTER="$OUTDIR/F1c.master.log"
STATUS="$OUTDIR/STATUS.txt"
: > "$MASTER"
if [ ! -f "$CSV" ]; then
  echo "ts,cell,k,drop,prompt_id,rep,decode_tps,mib_per_tok,hit_pct,ttft_s,load_s,prefill_s,n_gen,rss_mib,batt_start,batt_end,temp_start,temp_end,temp_max,cold,plugged,memavail_start_kib,rc,wall_s,compute_s,cache_s,flash_s,flash_mibs,stall_s" > "$CSV"
fi
echo "RUNNING" > "$STATUS"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

if [ ! -x "$BIN" ]; then
  log "FAIL missing binary $BIN"
  echo "FAIL_BIN" > "$STATUS"
  exit 6
fi
REALBIN="$BIN"
if head -c 2 "$BIN" 2>/dev/null | grep -q '#'; then
  if [ -x "$LIBDIR/bmoe-cli" ]; then
    REALBIN="$LIBDIR/bmoe-cli"
  fi
fi
got=$(sha256sum "$REALBIN" | awk '{print $1}')
log "BIN_SHA=$got path=$BIN real=$REALBIN"
if [ "$got" != "$EXPECTED_BIN_SHA" ]; then
  log "REFUSE: binary sha mismatch want $EXPECTED_BIN_SHA"
  echo "FAIL_BIN_SHA" > "$STATUS"
  exit 6
fi
if [ "$got" = "$FORBIDDEN_CAMPAIGN_SHA" ]; then
  log "REFUSE: labeled binary hashes as CAMPAIGN pin"
  echo "FAIL_PIN_COLLISION" > "$STATUS"
  exit 6
fi
echo "$got  bmoe-cli-mellum" > "$OUTDIR/bin.sha256"

msize=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
log "MODEL path=$MODEL size=$msize"
if [ "$msize" != "$EXPECTED_MODEL_SIZE" ]; then
  log "MODEL size unexpected: $msize want $EXPECTED_MODEL_SIZE"
  echo "FAIL_MODEL_SIZE" > "$STATUS"
  exit 7
fi
if [ -f "$ROOT/model.sha256" ]; then
  msha=$(awk 'NF{print $1; exit}' "$ROOT/model.sha256")
else
  log "computing MODEL sha256 (slow)..."
  msha=$(sha256sum "$MODEL" | awk '{print $1}')
  echo "$msha  Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf" > "$ROOT/model.sha256"
fi
log "MODEL_SHA=$msha (from $ROOT/model.sha256 if present — size already matched)"
if [ "$msha" != "$EXPECTED_MODEL_SHA" ]; then
  log "MODEL sha mismatch want $EXPECTED_MODEL_SHA"
  echo "FAIL_MODEL_SHA" > "$STATUS"
  exit 8
fi

P_FACT="$OUTDIR/prompts/p_fact.txt"
if [ ! -f "$P_FACT" ]; then
  if [ -f "$ROOT/p_fact.txt" ]; then
    cp "$ROOT/p_fact.txt" "$P_FACT"
  elif [ -f "$ROOT/f1b/prompts/p_fact.txt" ]; then
    cp "$ROOT/f1b/prompts/p_fact.txt" "$P_FACT"
  else
    log "prompts missing $P_FACT"
    echo "FAIL_PROMPTS" > "$STATUS"
    exit 9
  fi
fi
fact_sha=$(sha256sum "$P_FACT" | awk '{print $1}')
log "prompt_fact_sha=$fact_sha"
if [ "$fact_sha" != "$EXPECTED_FACT_SHA" ]; then
  log "fact prompt sha mismatch"
  echo "FAIL_PROMPT_SHA" > "$STATUS"
  exit 9
fi

cold(){
  local m="${1:-$MODEL}"
  if [ -x "$HOME/bin/cold_model.sh" ]; then
    "$HOME/bin/cold_model.sh" "$m" || true
  elif [ -x "$HOME/bin/fadv" ]; then
    "$HOME/bin/fadv" --dontneed "$m" 2>/dev/null || true
  else
    log "WARN no cold_model.sh/fadv — posix_fadvise skipped"
  fi
}

batt_json(){ timeout 5 termux-battery-status 2>/dev/null || echo '{}'; }
memavail_kib(){ awk '/^MemAvailable:/{print $2}' /proc/meminfo; }
memfree_kib(){ awk '/^MemFree:/{print $2}' /proc/meminfo; }

kill_our_cli(){
  pkill -f "$HOME/bin/mellum/bmoe-cli" 2>/dev/null || true
  pkill -f "bmoe-cli-mellum" 2>/dev/null || true
}

start_mem_sampler(){
  local csv="$1"
  echo "iso,memfree_kib,memavail_kib,cli_rss_kib" > "$csv"
  rm -f "$OUTDIR/ABORT_RAM.txt"
  (
    bad=0
    while true; do
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
      rss=""
      cpid=$(pgrep -f "$HOME/bin/mellum/bmoe-cli" | head -1 || true)
      if [ -z "${cpid:-}" ]; then
        cpid=$(pgrep -f "bmoe-cli-mellum" | head -1 || true)
      fi
      if [ -n "${cpid:-}" ] && [ -r "/proc/$cpid/status" ]; then
        rss=$(awk '/^VmRSS:/{print $2}' "/proc/$cpid/status")
      fi
      echo "$(ts),${mf},${ma},${rss}" >> "$csv"
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
  for i in $(seq 1 "$UNPLUG_POLLS"); do
    bj=$(batt_json)
    plug=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('plugged','?'))" "$bj")
    pct=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj")
    temp=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj")
    ma=$(memavail_kib)
    log "preflight i=$i plugged=$plug batt=$pct temp=$temp memavail_kib=$ma floor=$floor nproc=$(nproc)"
    if ! echo "$plug" | grep -qi UNPLUGGED; then
      log "WAIT unplugged (now $plug) poll $i/$UNPLUG_POLLS"
      sleep "$UNPLUG_SLEEP_S"
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
  log "PENDING_UNPLUG still plugged after ${UNPLUG_POLLS} polls"
  echo "PENDING_UNPLUG" > "$STATUS"
  return 2
}

parse_metrics(){
  local combo="$1"
  python3 - <<PY
import re, json
from pathlib import Path
text = Path("$combo").read_text(encoding="utf-8", errors="replace")
tok_s=mib=hit=ttft=n_gen=load_s=prefill_s=""
compute_s=cache_s=flash_s=flash_mibs=stall_s=""
m=re.search(r"generation:\s*(\d+)\s+tokens,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)", text)
if m:
    n_gen=m.group(1); tok_s=m.group(2)
m2=re.search(r"TTFT\s+([0-9.]+)\s*s", text)
if m2:
    ttft=m2.group(1)
mpre=re.search(r"prefill:\s*(\d+)\s+tokens,\s*([0-9.]+)\s*s\s*\(([0-9.]+)\s*tok/s\)", text)
if mpre:
    if not ttft:
        ttft=mpre.group(2)
    prefill_s=mpre.group(2)
mload=re.search(r"model load\s+([0-9.]+)\s*s", text)
if mload:
    load_s=mload.group(1)
m3=re.search(r"moe-cache:\s*([0-9.]+)%\s*hit", text)
if m3:
    hit=m3.group(1)
m5=re.search(r"\(([0-9.]+)\s*MiB/token\)", text)
if m5:
    mib=m5.group(1)
msplit=re.search(
    r"compute\s+([0-9.]+)\s*\+\s*cache mgmt\s+([0-9.]+)\s*\+\s*flash I/O\s+([0-9.]+)\s*s/token,\s*([0-9.]+)\s*MiB/s",
    text,
)
if msplit:
    compute_s=msplit.group(1); cache_s=msplit.group(2); flash_s=msplit.group(3); flash_mibs=msplit.group(4)
mstall=re.search(r"moe-overlap:\s*stall\s+([0-9.]+)\s*s/token", text)
if mstall:
    stall_s=mstall.group(1)
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
print("|".join([tok_s, mib, hit, ttft, load_s, prefill_s, n_gen, compute_s, cache_s, flash_s, flash_mibs, stall_s]))
PY
}

max_rss_mib(){
  local csv="$1"
  python3 - <<PY
from pathlib import Path
mx = 0
p = Path("$csv")
if p.exists():
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines()[1:]:
        parts = line.split(",")
        if len(parts) >= 4 and parts[3].strip().isdigit():
            mx = max(mx, int(parts[3]))
print(f"{mx/1024.0:.1f}" if mx else "")
PY
}

extract_gen(){
  local combo="$1" dest="$2"
  python3 - <<PY
from pathlib import Path
text = Path("$combo").read_text(encoding="utf-8", errors="replace")
idx = text.rfind("Assistant:")
body = text[idx+len("Assistant:"):] if idx >= 0 else text
cut_needles = ["llama_perf", "generation:", "BMOE_DONE", "moe-cache:", "system_info:", "print_info:"]
cut = len(body)
for n in cut_needles:
    i = body.find(n)
    if i >= 0:
        cut = min(cut, i)
Path("$dest").write_text(body[:cut].strip() + "\n", encoding="utf-8")
PY
}

BASE_FLAGS=(--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -t 4 -c 4096 --temp 0 --chatml --no-think)

run_one(){
  local cell="$1" k="$2" drop="$3" prompt_id="$4" rep="$5" prompt_file="$6"
  local label="${cell}_${prompt_id}_r${rep}"
  local out="$OUTDIR/logs/$label"
  mkdir -p "$out"

  local bj plug pct_s temp_s ma_s
  bj=$(batt_json)
  plug=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('plugged','?'))" "$bj")
  pct_s=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj")
  temp_s=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj")
  ma_s=$(memavail_kib)
  log "RUN $label k=$k drop=$drop batt=$pct_s plugged=$plug temp=$temp_s memavail_kib=$ma_s nproc=$(nproc)"
  if ! echo "$plug" | grep -qi UNPLUGGED; then
    log "STOP $label plugged=$plug"
    echo "PENDING_UNPLUG" > "$STATUS"
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

  cold "$MODEL"
  local ptext
  ptext=$(cat "$prompt_file")

  local -a cmd
  cmd=("$BIN" -m "$MODEL" -p "$ptext" -n 200 --n-expert-used "$k" "${BASE_FLAGS[@]}")
  if [ "$drop" != "OFF" ] && [ -n "$drop" ]; then
    cmd+=(--drop-cold-experts "$drop")
  fi
  printf '%s\n' "${cmd[@]}" > "$out/cmdline.txt"

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

  local metrics decode_tps mib_per_tok hit_pct ttft_s load_s prefill_s n_gen rss
  local compute_s cache_s flash_s flash_mibs stall_s
  metrics=$(parse_metrics "$out/combo.txt")
  IFS='|' read -r decode_tps mib_per_tok hit_pct ttft_s load_s prefill_s n_gen compute_s cache_s flash_s flash_mibs stall_s <<<"$metrics"
  rss=$(max_rss_mib "$OUTDIR/mem/${label}.csv")
  extract_gen "$out/combo.txt" "$out/gen.txt"

  local row
  row="$(ts),${cell},${k},${drop},${prompt_id},${rep},${decode_tps},${mib_per_tok},${hit_pct},${ttft_s},${load_s},${prefill_s},${n_gen},${rss},${pct_s},${pct_e},${temp_s},${temp_e},${temp_max},1,${plug},${ma_s},${rc},${wall},${compute_s},${cache_s},${flash_s},${flash_mibs},${stall_s}"
  echo "$row" >> "$CSV"
  log "DONE $label rc=$rc wall=${wall}s decode_tps=$decode_tps mib=$mib_per_tok hit=$hit_pct ttft=$ttft_s load=$load_s prefill=$prefill_s n_gen=$n_gen rss_mib=$rss compute=$compute_s flash=$flash_s flash_mibs=$flash_mibs stall=$stall_s batt=${pct_s}->${pct_e} temp=${temp_s}->${temp_e} memavail=$ma_s"
  tail -100 "$out/combo.txt" > "$out/tail.txt" || true
  if [ "$rc" -ne 0 ]; then
    log "WARN $label cli rc=$rc (metrics may be empty)"
  fi
  return 0
}

pick_best_k(){
  python3 - <<'PY'
import csv
from pathlib import Path
import os
p = Path(os.environ["CSV"])
rows = list(csv.DictReader(p.open(encoding="utf-8")))
by_k = {}
for r in rows:
    if r.get("drop") not in ("OFF", "off", ""):
        continue
    try:
        k = int(r["k"])
        t = float(r["decode_tps"])
    except (KeyError, ValueError):
        continue
    by_k.setdefault(k, []).append(t)
if not by_k:
    raise SystemExit("NONE")
# mean of the two reps; for n=2 this equals the house median-of-two
best_k, best_t = None, -1.0
for k, vals in sorted(by_k.items()):
    mean = sum(vals) / len(vals)
    print(f"k={k} n={len(vals)} mean={mean:.3f} vals={vals}", flush=True)
    if mean > best_t:
        best_k, best_t = k, mean
print(f"BEST_K={best_k} mean={best_t:.3f}", flush=True)
Path(os.environ["OUTDIR"], "best_k.txt").write_text(str(best_k) + "\n", encoding="utf-8")
print(best_k)
PY
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

log "=== MELLUM2 F1c S23 START ==="
log "BIN=$BIN LIBDIR=$LIBDIR nproc=$(nproc)"

export CSV OUTDIR

# Cell order is mandatory: k=6, k=4, k=2, then best-k + drop 0.65.
for k in 6 4 2; do
  for rep in 1 2; do
    preflight_block "$BATT_FLOOR" || { log "stopped before k=${k} r${rep} status=$(cat $STATUS)"; cat "$CSV" | tee -a "$MASTER"; exit 0; }
    run_one "MELLUM2_Q4_k${k}" "$k" OFF fact "$rep" "$P_FACT" || { log "aborted k=${k} r${rep} status=$(cat $STATUS)"; cat "$CSV" | tee -a "$MASTER"; exit 0; }
  done
done

log "=== picking best k from k=6/4/2 ==="
BEST_K=$(pick_best_k | tail -1)
log "BEST_K=$BEST_K (by mean decode tok/s). Drop is I/O-only; never skips matmul."
if [ -z "${BEST_K:-}" ] || [ "$BEST_K" = "NONE" ]; then
  log "no complete k cell — skip drop"
  echo "PARTIAL_NO_BEST_K" > "$STATUS"
  cat "$CSV" | tee -a "$MASTER"
  exit 0
fi

for rep in 1 2; do
  preflight_block "$BATT_FLOOR" || { log "stopped before drop r${rep} status=$(cat $STATUS)"; cat "$CSV" | tee -a "$MASTER"; exit 0; }
  run_one "MELLUM2_Q4_k${BEST_K}d065" "$BEST_K" "$DROP_F" fact "$rep" "$P_FACT" || { log "aborted drop r${rep} status=$(cat $STATUS)"; cat "$CSV" | tee -a "$MASTER"; exit 0; }
done

echo "DONE" > "$STATUS"
log "=== MELLUM2 F1c S23 COMPLETE ==="
cat "$CSV" | tee -a "$MASTER"
