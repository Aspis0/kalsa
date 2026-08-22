#!/data/data/com.termux/files/usr/bin/bash
# run_f1d_s23.sh — Mellum2 F1d: kill or confirm the 4.5 t/s compute ceiling.
# Cells (UNPLUGGED, floor 45%, cold fadvise):
#   A  dense Qwen3.5-2B Q4  -t 4     x2   (no --moe-stream; dense has no recipe)
#   B  mellum k=8 campaign-flag rebuild + 1 Hz forensics x2
#   C  mellum k=8 -t 6 pinned to big cores (taskset 3-7) x2
# NEVER touch ~/bin/bmoe-cli, bmoe-cli.CAMPAIGN, or the F1b ~/bin/bmoe-cli-mellum pin.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

ROOT="${ROOT:-$HOME/experiments/results/mellum2_f1_s23}"
OUTDIR="${OUTDIR:-$ROOT/f1d}"
BIN="${BINARY:-$HOME/bin/bmoe-cli-mellum2}"
LIBDIR="${LIBDIR:-$HOME/bin/mellum2}"
MODEL_MELLUM="${MODEL_MELLUM:-$HOME/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf}"
MODEL_DENSE="${MODEL_DENSE:-$HOME/models/Qwen3.5-2B-Q4_K_M.gguf}"
export LD_LIBRARY_PATH="${LIBDIR}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

EXPECTED_MELLUM_SHA="b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7"
EXPECTED_MELLUM_SIZE="8071293600"
EXPECTED_DENSE_SHA="aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223"
EXPECTED_DENSE_SIZE="1280835840"
EXPECTED_FACT_SHA="b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd"
FORBIDDEN_CAMPAIGN_SHA="1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f"
FORBIDDEN_F1B_SHA="69a35f5ef85e286a1d05069872a3ae75b9a8c66d4098695936a5baf4b4d61b8a"

MEMAVAIL_ABORT_KIB=307200
MEMAVAIL_STREAK_NEED=12
BATT_FLOOR=45
TEMP_ABORT_C=45
UNPLUG_POLLS="${UNPLUG_POLLS:-4}"
UNPLUG_SLEEP_S="${UNPLUG_SLEEP_S:-20}"
# Snapdragon 8 Gen 2: 0-2 A510 little, 3-4 A710, 5-6 A715, 7 X3.
# 3-7 = five performance cores. -t 6 needs one extra; cell C uses -t 5 on 3-7
# unless BIG_CPUS is overridden. A second C variant can set THREADS=6 BIG_CPUS=2-7.
BIG_CPUS="${BIG_CPUS:-3-7}"
C_THREADS="${C_THREADS:-5}"

mkdir -p "$OUTDIR/logs" "$OUTDIR/prompts" "$OUTDIR/mem" "$OUTDIR/forensics"
CSV="$OUTDIR/runs_regime.csv"
FORE="$OUTDIR/forensics/cpu_1hz.csv"
MASTER="$OUTDIR/F1d.master.log"
STATUS="$OUTDIR/STATUS.txt"
: > "$MASTER"
if [ ! -f "$CSV" ]; then
  echo "ts,cell,k,threads,taskset,prompt_id,rep,decode_tps,mib_per_tok,hit_pct,ttft_s,load_s,prefill_s,n_gen,rss_mib,batt_start,batt_end,temp_start,temp_end,temp_max,cold,plugged,memavail_start_kib,rc,wall_s,compute_s,cache_s,flash_s,flash_mibs,stall_s,nproc_start,cpu_online_start,cli_cpus" > "$CSV"
fi
if [ ! -f "$FORE" ]; then
  echo "iso,cell,cli_pid,nproc,cpu_online,self_cpus,cli_cpus,taskset_cli,freq0,freq1,freq2,freq3,freq4,freq5,freq6,freq7,thr_cpu0,thr_cpu1,thr_cpu2,thr_cpu3,thr_cpu4,thr_cpu5,thr_cpu6,thr_cpu7" > "$FORE"
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
if [ "$got" = "$FORBIDDEN_CAMPAIGN_SHA" ]; then
  log "REFUSE: labeled binary hashes as CAMPAIGN pin"
  echo "FAIL_PIN_COLLISION" > "$STATUS"
  exit 6
fi
if [ "$got" = "$FORBIDDEN_F1B_SHA" ]; then
  log "REFUSE: this is the F1b i8mm binary, not the campaign-flag rebuild"
  echo "FAIL_F1B_PIN" > "$STATUS"
  exit 6
fi
{
  echo "$got  bmoe-cli-mellum2"
  echo "real=$REALBIN"
  echo "wrapper=$BIN"
  sha256sum "$LIBDIR"/lib*.so 2>/dev/null || true
} > "$OUTDIR/bin.sha256"

check_model(){
  local path="$1" want_sha="$2" want_size="$3" tag="$4"
  local sz sha
  sz=$(stat -c%s "$path" 2>/dev/null || echo 0)
  log "MODEL_$tag path=$path size=$sz"
  if [ "$sz" != "$want_size" ]; then
    log "FAIL $tag size $sz want $want_size"
    echo "FAIL_MODEL_SIZE_$tag" > "$STATUS"
    return 7
  fi
  sha=$(sha256sum "$path" | awk '{print $1}')
  log "MODEL_${tag}_SHA=$sha"
  echo "$sha  $(basename "$path")" >> "$OUTDIR/bin.sha256"
  if [ "$sha" != "$want_sha" ]; then
    log "FAIL $tag sha mismatch want $want_sha"
    echo "FAIL_MODEL_SHA_$tag" > "$STATUS"
    return 8
  fi
  return 0
}
check_model "$MODEL_MELLUM" "$EXPECTED_MELLUM_SHA" "$EXPECTED_MELLUM_SIZE" MELLUM || exit $?
check_model "$MODEL_DENSE" "$EXPECTED_DENSE_SHA" "$EXPECTED_DENSE_SIZE" DENSE || exit $?

P_FACT="$OUTDIR/prompts/p_fact.txt"
if [ ! -f "$P_FACT" ]; then
  if [ -f "$ROOT/p_fact.txt" ]; then
    cp "$ROOT/p_fact.txt" "$P_FACT"
  elif [ -f "$ROOT/f1b/prompts/p_fact.txt" ]; then
    cp "$ROOT/f1b/prompts/p_fact.txt" "$P_FACT"
  else
    log "prompts missing"
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

# Snapshot of topology + nproc mystery (nproc=6 vs online=0-7 in F1b/F1c).
{
  echo "=== topology $(ts) ==="
  echo "nproc=$(nproc 2>/dev/null || echo '?')"
  echo "nproc_all=$(nproc --all 2>/dev/null || echo '?')"
  echo "getconf=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo '?')"
  echo "online=$(cat /sys/devices/system/cpu/online 2>/dev/null || echo '?')"
  echo "present=$(cat /sys/devices/system/cpu/present 2>/dev/null || echo '?')"
  echo "possible=$(cat /sys/devices/system/cpu/possible 2>/dev/null || echo '?')"
  echo "--- /proc/self/status ---"
  grep -E 'Cpus_allowed|Cpus_allowed_list' /proc/self/status || true
  echo "--- taskset self ---"
  taskset -p $$ 2>/dev/null || true
  echo "--- per-cpu ---"
  for i in 0 1 2 3 4 5 6 7; do
    d="/sys/devices/system/cpu/cpu$i"
    echo -n "cpu$i online=$(cat $d/online 2>/dev/null || echo '?')"
    echo -n " cap=$(cat $d/cpu_capacity 2>/dev/null || echo '?')"
    echo -n " max=$(cat $d/cpufreq/scaling_max_freq 2>/dev/null || echo '?')"
    echo -n " min=$(cat $d/cpufreq/scaling_min_freq 2>/dev/null || echo '?')"
    echo -n " cur=$(cat $d/cpufreq/scaling_cur_freq 2>/dev/null || echo '?')"
    echo -n " gov=$(cat $d/cpufreq/scaling_governor 2>/dev/null || echo '?')"
    echo " pkg=$(cat $d/topology/physical_package_id 2>/dev/null || echo '?')"
  done
  echo "--- cpuset ---"
  cat /dev/cpuset/cpus 2>/dev/null || true
  cat /dev/cpuset/foreground/cpus 2>/dev/null || true
  cat /dev/cpuset/background/cpus 2>/dev/null || true
  cat /proc/self/cpuset 2>/dev/null || true
  echo "--- wakelock ---"
  command -v termux-wake-lock || true
} > "$OUTDIR/forensics/topology.txt"
log "topology written nproc=$(nproc) online=$(cat /sys/devices/system/cpu/online)"

cold(){
  local m="${1:-$MODEL_MELLUM}"
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
  pkill -f "$HOME/bin/mellum2/bmoe-cli" 2>/dev/null || true
  pkill -f "bmoe-cli-mellum2" 2>/dev/null || true
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
      cpid=$(pgrep -f "$HOME/bin/mellum2/bmoe-cli" | head -1 || true)
      if [ -z "${cpid:-}" ]; then
        cpid=$(pgrep -f "bmoe-cli-mellum2" | head -1 || true)
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

# 1 Hz CPU / cpuset / freq / thread-placement sampler for the timed window.
start_forensics(){
  local cell="$1"
  (
    while true; do
      cpid=$(pgrep -f "$HOME/bin/mellum2/bmoe-cli" | head -1 || true)
      online=$(cat /sys/devices/system/cpu/online 2>/dev/null || echo '?')
      np=$(nproc 2>/dev/null || echo '?')
      selfc=$(awk '/^Cpus_allowed_list:/{print $2}' /proc/self/status)
      clic=''; tscli=''
      t0=0;t1=0;t2=0;t3=0;t4=0;t5=0;t6=0;t7=0
      if [ -n "${cpid:-}" ] && [ -r "/proc/$cpid/status" ]; then
        clic=$(awk '/^Cpus_allowed_list:/{print $2}' "/proc/$cpid/status")
        tscli=$(taskset -p "$cpid" 2>/dev/null | awk '{print $NF}')
        for tid in /proc/$cpid/task/*; do
          [ -r "$tid/stat" ] || continue
          cpu=$(awk '{print $39}' "$tid/stat" 2>/dev/null || echo "")
          case "$cpu" in
            0) t0=$((t0+1));; 1) t1=$((t1+1));; 2) t2=$((t2+1));; 3) t3=$((t3+1));;
            4) t4=$((t4+1));; 5) t5=$((t5+1));; 6) t6=$((t6+1));; 7) t7=$((t7+1));;
          esac
        done
      fi
      f0=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo)
      f1=$(cat /sys/devices/system/cpu/cpu1/cpufreq/scaling_cur_freq 2>/dev/null || echo)
      f2=$(cat /sys/devices/system/cpu/cpu2/cpufreq/scaling_cur_freq 2>/dev/null || echo)
      f3=$(cat /sys/devices/system/cpu/cpu3/cpufreq/scaling_cur_freq 2>/dev/null || echo)
      f4=$(cat /sys/devices/system/cpu/cpu4/cpufreq/scaling_cur_freq 2>/dev/null || echo)
      f5=$(cat /sys/devices/system/cpu/cpu5/cpufreq/scaling_cur_freq 2>/dev/null || echo)
      f6=$(cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_cur_freq 2>/dev/null || echo)
      f7=$(cat /sys/devices/system/cpu/cpu7/cpufreq/scaling_cur_freq 2>/dev/null || echo)
      echo "$(ts),${cell},${cpid:-},${np},${online},${selfc},${clic},${tscli},${f0},${f1},${f2},${f3},${f4},${f5},${f6},${f7},${t0},${t1},${t2},${t3},${t4},${t5},${t6},${t7}" >> "$FORE"
      sleep 1
    done
  ) >/dev/null 2>&1 &
  echo $! > "$OUTDIR/fore_sampler.pid"
}

stop_forensics(){
  if [ -f "$OUTDIR/fore_sampler.pid" ]; then
    local pid
    pid="$(cat "$OUTDIR/fore_sampler.pid")"
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    rm -f "$OUTDIR/fore_sampler.pid"
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
    log "preflight i=$i plugged=$plug batt=$pct temp=$temp memavail_kib=$ma floor=$floor nproc=$(nproc) online=$(cat /sys/devices/system/cpu/online)"
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

run_one(){
  local label="$1" cell="$2" model="$3" k="$4" threads="$5" pin="$6" prompt_id="$7" rep="$8" prompt_file="$9"
  local out="$OUTDIR/logs/${label}_r${rep}"
  mkdir -p "$out"
  local bj plug pct_s temp_s ma_s
  bj=$(batt_json)
  plug=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('plugged','?'))" "$bj")
  pct_s=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj")
  temp_s=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj")
  ma_s=$(memavail_kib)
  local np_s online_s
  np_s=$(nproc)
  online_s=$(cat /sys/devices/system/cpu/online)

  if ! echo "$plug" | grep -qi UNPLUGGED; then
    log "STOP $label plugged=$plug — refuse timed cell"
    echo "STOP_PLUGGED" > "$STATUS"
    return 2
  fi
  if [ "$pct_s" -lt "$BATT_FLOOR" ] 2>/dev/null; then
    log "STOP $label batt=$pct_s < $BATT_FLOOR"
    echo "STOP_BATT" > "$STATUS"
    return 3
  fi
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > ${TEMP_ABORT_C} else 1)" "$temp_s"; then
    log "STOP thermal $label temp=$temp_s"
    echo "STOP_THERMAL" > "$STATUS"
    return 4
  fi

  cold "$model"
  local ptext
  ptext=$(cat "$prompt_file")

  local -a cmd
  cmd=("$BIN" -m "$model" -p "$ptext" -n 200 -t "$threads" -c 4096 --temp 0 --chatml --no-think)
  if [ "$cell" != "A_DENSE2B" ]; then
    cmd+=(--n-expert-used "$k" --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512)
  fi
  local runner=()
  if [ -n "$pin" ] && [ "$pin" != "none" ]; then
    runner=(taskset -c "$pin")
  fi
  printf '%s\n' "${runner[@]}" "${cmd[@]}" > "$out/cmdline.txt"
  {
    echo "cell=$cell k=$k threads=$threads pin=$pin nproc=$np_s online=$online_s"
    echo "self_cpus=$(awk '/^Cpus_allowed_list:/{print $2}' /proc/self/status)"
    taskset -p $$ 2>/dev/null || true
  } > "$out/forensics_start.txt"

  log "RUN $label cell=$cell k=$k t=$threads pin=$pin batt=$pct_s plugged=$plug temp=$temp_s memavail_kib=$ma_s nproc=$np_s online=$online_s"
  start_mem_sampler "$OUTDIR/mem/${label}_r${rep}.csv"
  start_forensics "$label"
  local t0 t1 wall rc
  t0=$(date +%s)
  set +e
  "${runner[@]}" "${cmd[@]}" >"$out/stdout.txt" 2>"$out/stderr.txt"
  rc=$?
  set -e
  t1=$(date +%s); wall=$((t1-t0))
  stop_forensics
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
  rss=$(max_rss_mib "$OUTDIR/mem/${label}_r${rep}.csv")
  extract_gen "$out/combo.txt" "$out/gen.txt"

  local cli_cpus=""
  cli_cpus=$(python3 - <<PY
from pathlib import Path
cpus=set()
p=Path("$FORE")
if p.exists():
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines()[1:]:
        parts=line.split(",")
        if len(parts)>6 and parts[1]=="$label" and parts[6].strip():
            cpus.add(parts[6].strip())
print("|".join(sorted(cpus)))
PY
)

  local row
  row="$(ts),${cell},${k},${threads},${pin},${prompt_id},${rep},${decode_tps},${mib_per_tok},${hit_pct},${ttft_s},${load_s},${prefill_s},${n_gen},${rss},${pct_s},${pct_e},${temp_s},${temp_e},${temp_max},1,${plug},${ma_s},${rc},${wall},${compute_s},${cache_s},${flash_s},${flash_mibs},${stall_s},${np_s},${online_s},${cli_cpus}"
  echo "$row" >> "$CSV"
  log "DONE $label rc=$rc wall=${wall}s decode_tps=$decode_tps mib=$mib_per_tok hit=$hit_pct ttft=$ttft_s load=$load_s prefill=$prefill_s n_gen=$n_gen rss_mib=$rss compute=$compute_s flash=$flash_s flash_mibs=$flash_mibs stall=$stall_s batt=${pct_s}->${pct_e} temp=${temp_s}->${temp_e} nproc=$np_s online=$online_s cli_cpus=$cli_cpus"
  tail -120 "$out/combo.txt" > "$out/tail.txt" || true
  if [ "$rc" -ne 0 ]; then
    log "WARN $label cli rc=$rc (metrics may be empty)"
  fi
  return 0
}

# Refuse to start if F1c (or any other bmoe) is still on the phone.
if pgrep -f "run_f1c_s23.sh" >/dev/null 2>&1 || pgrep -f "$HOME/bin/mellum/bmoe-cli" >/dev/null 2>&1; then
  log "REFUSE: F1c / F1b binary still running — wait, do not kill"
  echo "WAIT_F1C" > "$STATUS"
  exit 20
fi

termux-wake-lock >/dev/null 2>&1 || true
SCREEN_PREV=$(settings get system screen_off_timeout 2>/dev/null || echo "")
settings put system screen_off_timeout 7200000 2>/dev/null || true
restore(){
  stop_forensics
  stop_mem_sampler
  if [ -n "${SCREEN_PREV:-}" ] && [ "$SCREEN_PREV" != "null" ]; then
    settings put system screen_off_timeout "$SCREEN_PREV" 2>/dev/null || true
  fi
  termux-wake-unlock >/dev/null 2>&1 || true
}
trap 'restore; log "trap cleanup"' EXIT

log "=== MELLUM2 F1d S23 START ==="
log "BIN=$BIN LIBDIR=$LIBDIR nproc=$(nproc) online=$(cat /sys/devices/system/cpu/online)"
log "wakelock acquired; screen_off_timeout=7200000 (was ${SCREEN_PREV:-?})"
log "BIG_CPUS=$BIG_CPUS C_THREADS=$C_THREADS"

# Cell A — dense 2B calibration (same binary, no --moe-stream).
for rep in 1 2; do
  preflight_block "$BATT_FLOOR" || { log "stopped before A r${rep} status=$(cat $STATUS)"; cat "$CSV" | tee -a "$MASTER"; exit 0; }
  run_one "DENSE2B_t4" "A_DENSE2B" "$MODEL_DENSE" 0 4 none fact "$rep" "$P_FACT" || { log "aborted A r${rep} status=$(cat $STATUS)"; cat "$CSV" | tee -a "$MASTER"; exit 0; }
done

# Cell B — mellum k=8, campaign flags, 1 Hz forensics (same as F1b config).
for rep in 1 2; do
  preflight_block "$BATT_FLOOR" || { log "stopped before B r${rep} status=$(cat $STATUS)"; cat "$CSV" | tee -a "$MASTER"; exit 0; }
  run_one "MELLUM2_Q4_k8" "B_MELLUM_K8" "$MODEL_MELLUM" 8 4 none fact "$rep" "$P_FACT" || { log "aborted B r${rep} status=$(cat $STATUS)"; cat "$CSV" | tee -a "$MASTER"; exit 0; }
done

# Cell C — more / better-placed compute. Pin to performance cluster.
for rep in 1 2; do
  preflight_block "$BATT_FLOOR" || { log "stopped before C r${rep} status=$(cat $STATUS)"; cat "$CSV" | tee -a "$MASTER"; exit 0; }
  run_one "MELLUM2_Q4_k8_t${C_THREADS}pin" "C_MELLUM_PIN" "$MODEL_MELLUM" 8 "$C_THREADS" "$BIG_CPUS" fact "$rep" "$P_FACT" || { log "aborted C r${rep} status=$(cat $STATUS)"; cat "$CSV" | tee -a "$MASTER"; exit 0; }
done

echo "DONE" > "$STATUS"
log "=== MELLUM2 F1d S23 COMPLETE ==="
cat "$CSV" | tee -a "$MASTER"
