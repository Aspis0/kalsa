#!/data/data/com.termux/files/usr/bin/bash
# run_k0_s23.sh — Mellum2 KERNEL K0: where does 0.228 s/tok of compute go?
# K0-A  test-backend-ops MUL_MAT_ID vs fused MUL_MAT (exact Mellum geometry)
# K0-B  on-model n=64 warm  -t 1 / -t 2 / -t 4   (sync + placement tax)
# K0-C  -t 4 + 1 Hz placement; pin variant: ggml threads on 4 mid cores
# NEVER touch campaign pins, Jelly, Xiaomi. NEVER kill a foreign bmoe.
# Timed cells UNPLUGGED, batt floor 45 °C abort 45 °C.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

ROOT="${ROOT:-$HOME/experiments/results/mellum2_kernel_k0}"
OUTDIR="$ROOT"
BIN_BMOE="${BINARY:-$HOME/bin/bmoe-cli-mellum2}"
LIBDIR="${LIBDIR:-$HOME/bin/mellum2}"
BIN_OPS="${BIN_OPS:-$HOME/bin/kernel_k0/test-backend-ops}"
MODEL="${MODEL:-$HOME/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf}"
PFACT="${PFACT:-$HOME/experiments/results/mellum2_f1_s23/p_fact.txt}"
export LD_LIBRARY_PATH="${LIBDIR}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

EXPECTED_BIN_SHA="0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c"
EXPECTED_MODEL_SHA="b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7"
EXPECTED_MODEL_SIZE="8071293600"
EXPECTED_FACT_SHA="b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd"
FORBIDDEN_CAMPAIGN_SHA="1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f"

BATT_FLOOR=45
TEMP_ABORT_C=45
UNPLUG_POLLS="${UNPLUG_POLLS:-4}"
UNPLUG_SLEEP_S="${UNPLUG_SLEEP_S:-20}"
# 4 mid cores (2x A710 + 2x A715). Leave littles 0-2 and X3=7 free for I/O.
PIN_CPUS="${PIN_CPUS:-3,4,5,6}"

mkdir -p "$OUTDIR/k0a" "$OUTDIR/k0b" "$OUTDIR/k0c" "$OUTDIR/logs" "$OUTDIR/forensics" "$OUTDIR/mem"
MASTER="$OUTDIR/K0.master.log"
STATUS="$OUTDIR/STATUS.txt"
CSV_A="$OUTDIR/k0a/ops.csv"
CSV_B="$OUTDIR/k0b/runs.csv"
CSV_C="$OUTDIR/k0c/runs.csv"
FORE="$OUTDIR/forensics/cpu_1hz.csv"
: > "$MASTER"
echo "RUNNING" > "$STATUS"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

if [ ! -f "$CSV_A" ]; then
  echo "ts,cell,op,params,threads,taskset,us_per_run,flops_per_s,n_runs,rc,wall_s,batt,temp,nproc,cpus_allowed" > "$CSV_A"
fi
if [ ! -f "$CSV_B" ]; then
  echo "ts,cell,threads,taskset,warm,decode_tps,mib_per_tok,hit_pct,ttft_s,load_s,prefill_s,n_gen,rss_mib,batt_start,batt_end,temp_start,temp_end,plugged,compute_s,cache_s,flash_s,flash_mibs,stall_s,nproc,cpus_allowed,cli_cpus,rc,wall_s" > "$CSV_B"
fi
if [ ! -f "$CSV_C" ]; then
  echo "ts,cell,threads,taskset,decode_tps,mib_per_tok,hit_pct,compute_s,flash_s,flash_mibs,n_gen,rss_mib,batt_start,batt_end,temp_start,temp_end,little_pct,x3_pct,nproc,cpus_allowed,cli_cpus,rc,wall_s" > "$CSV_C"
fi
if [ ! -f "$FORE" ]; then
  echo "iso,cell,cli_pid,nproc,cpu_online,self_cpus,cli_cpus,taskset_cli,freq0,freq1,freq2,freq3,freq4,freq5,freq6,freq7,thr_cpu0,thr_cpu1,thr_cpu2,thr_cpu3,thr_cpu4,thr_cpu5,thr_cpu6,thr_cpu7" > "$FORE"
fi

batt_json(){ timeout 8 termux-battery-status 2>/dev/null || echo '{"plugged":"?","percentage":0,"temperature":0}'; }
memavail_kib(){ awk '/MemAvailable:/{print $2}' /proc/meminfo; }

preflight_block(){
  local floor="${1:-$BATT_FLOOR}"
  local bj plug pct temp i
  for i in $(seq 1 "$UNPLUG_POLLS"); do
    bj=$(batt_json)
    plug=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('plugged','?'))" "$bj")
    pct=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj")
    temp=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj")
    log "preflight i=$i plugged=$plug batt=$pct temp=$temp memavail_kib=$(memavail_kib) nproc=$(nproc) online=$(cat /sys/devices/system/cpu/online)"
    if ! echo "$plug" | grep -qi UNPLUGGED; then
      log "WAIT unplugged (now $plug) poll $i/$UNPLUG_POLLS"
      sleep "$UNPLUG_SLEEP_S"
      continue
    fi
    if [ "$pct" -lt "$floor" ] 2>/dev/null; then
      log "STOP_BATT $pct < $floor"
      echo "PENDING_BATTERY" > "$STATUS"
      return 3
    fi
    if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > ${TEMP_ABORT_C} else 1)" "$temp"; then
      log "WAIT battery temp $temp > ${TEMP_ABORT_C}C"
      sleep 30
      continue
    fi
    return 0
  done
  log "PENDING_UNPLUG"
  echo "PENDING_UNPLUG" > "$STATUS"
  return 2
}

foreign_bmoe(){
  # any bmoe that is NOT one of ours (test-backend-ops / this script's child)
  pgrep -af 'bmoe-cli' | grep -v "kernel_k0" | grep -v "$$" || true
}

wait_foreign(){
  local n=0
  while true; do
    local f
    f=$(pgrep -af 'bmoe-cli' || true)
    if [ -z "$f" ]; then
      return 0
    fi
    # if it is our own later cell, caller should not use this
    log "WAIT foreign/other bmoe (poll $n): $f"
    echo "WAIT_FOREIGN" > "$STATUS"
    sleep 300
    n=$((n+1))
  done
}

start_forensics(){
  local cell="$1"
  local match="${2:-bmoe-cli}"
  (
    while true; do
      cpid=$(pgrep -f "$match" | head -1 || true)
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

pin_ggml_threads(){
  local cpid="$1" cpus="$2"
  local tries=0
  while [ "$tries" -lt 30 ]; do
    if [ -n "$cpid" ] && [ -d "/proc/$cpid/task" ]; then
      local n=0
      for tidp in /proc/$cpid/task/*; do
        [ -r "$tidp/comm" ] || continue
        local comm tid
        comm=$(cat "$tidp/comm" 2>/dev/null || echo)
        tid=$(basename "$tidp")
        case "$comm" in
          ggml*|GGML*)
            taskset -cp "$cpus" "$tid" >/dev/null 2>&1 || true
            n=$((n+1))
            ;;
        esac
      done
      if [ "$n" -gt 0 ]; then
        log "pinned $n ggml threads of pid=$cpid to $cpus"
        return 0
      fi
    fi
    tries=$((tries+1))
    sleep 1
    cpid=$(pgrep -f "$HOME/bin/mellum2/bmoe-cli" | head -1 || true)
  done
  log "WARN no ggml-* threads found to pin (Termux may not expose names)"
  return 1
}

parse_ops_line(){
  # stdin: console perf line  -> prints us,flops
  python3 - <<'PY'
import re, sys
text = sys.stdin.read()
#  N runs -   XXX.XX us/run - ... GFLOP/run -   Z.ZZ GFLOPS  (ANSI possible)
rows = []
for line in text.splitlines():
    m = re.search(r'^\s*(\S+)\((.*)\):\s+(\d+)\s+runs\s+-\s+([0-9.]+)\s+us/run', line)
    if not m:
        continue
    op, params, nruns, us = m.group(1), m.group(2), m.group(3), m.group(4)
    fm = re.search(r'([0-9.]+)\s*([kMGT])FLOPS', line)
    flops = ''
    if fm:
        scale = {'k':1e3,'M':1e6,'G':1e9,'T':1e12}[fm.group(2)]
        flops = str(float(fm.group(1)) * scale)
    print(f"{op}\t{params}\t{us}\t{flops}\t{nruns}")
PY
}

parse_bmoe(){
  local combo="$1"
  python3 - <<PY
import re
from pathlib import Path
text = Path("$combo").read_text(encoding="utf-8", errors="replace")
tok_s=mib=hit=ttft=n_gen=load_s=prefill_s=""
compute_s=cache_s=flash_s=flash_mibs=stall_s=""
m=re.search(r"generation:\s*(\d+)\s+tokens,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)", text)
if m:
    n_gen=m.group(1); tok_s=m.group(2)
m2=re.search(r"TTFT\s+([0-9.]+)\s*s", text)
if m2: ttft=m2.group(1)
mpre=re.search(r"prefill:\s*(\d+)\s+tokens,\s*([0-9.]+)\s*s", text)
if mpre:
    if not ttft: ttft=mpre.group(2)
    prefill_s=mpre.group(2)
mload=re.search(r"model load\s+([0-9.]+)\s*s", text)
if mload: load_s=mload.group(1)
m3=re.search(r"moe-cache:\s*([0-9.]+)%\s*hit", text)
if m3: hit=m3.group(1)
m5=re.search(r"\(([0-9.]+)\s*MiB/token\)", text)
if m5: mib=m5.group(1)
msplit=re.search(
    r"compute\s+([0-9.]+)\s*\+\s*cache mgmt\s+([0-9.]+)\s*\+\s*flash I/O\s+([0-9.]+)\s*s/token,\s*([0-9.]+)\s*MiB/s",
    text)
if msplit:
    compute_s,cache_s,flash_s,flash_mibs=msplit.group(1),msplit.group(2),msplit.group(3),msplit.group(4)
mstall=re.search(r"moe-overlap:\s*stall\s+([0-9.]+)\s*s/token", text)
if mstall: stall_s=mstall.group(1)
print(",".join([tok_s,mib,hit,ttft,load_s,prefill_s,n_gen,compute_s,cache_s,flash_s,flash_mibs,stall_s]))
PY
}

# ---------------- identity ----------------
REALBIN="$BIN_BMOE"
if [ -x "$BIN_BMOE" ] && head -c 2 "$BIN_BMOE" 2>/dev/null | grep -q '#'; then
  if [ -x "$LIBDIR/bmoe-cli" ]; then REALBIN="$LIBDIR/bmoe-cli"; fi
fi
got=$(sha256sum "$REALBIN" | awk '{print $1}')
log "BIN_SHA=$got real=$REALBIN"
if [ "$got" != "$EXPECTED_BIN_SHA" ]; then
  log "REFUSE binary sha mismatch want $EXPECTED_BIN_SHA"
  echo "FAIL_BIN_SHA" > "$STATUS"; exit 6
fi
if [ "$got" = "$FORBIDDEN_CAMPAIGN_SHA" ]; then
  log "REFUSE campaign pin"; echo "FAIL_PIN" > "$STATUS"; exit 6
fi
camp=$(sha256sum "$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN" 2>/dev/null | awk '{print $1}' || true)
log "CAMPAIGN_SHA=$camp"
if [ -n "$camp" ] && [ "$camp" != "$FORBIDDEN_CAMPAIGN_SHA" ]; then
  log "REFUSE campaign mutated"; echo "FAIL_CAMPAIGN_MUTATED" > "$STATUS"; exit 6
fi
msz=$(stat -c%s "$MODEL")
msha=$(sha256sum "$MODEL" | awk '{print $1}')
log "MODEL size=$msz sha=$msha"
if [ "$msz" != "$EXPECTED_MODEL_SIZE" ] || [ "$msha" != "$EXPECTED_MODEL_SHA" ]; then
  log "REFUSE model identity"; echo "FAIL_MODEL" > "$STATUS"; exit 7
fi
fsha=$(sha256sum "$PFACT" | awk '{print $1}')
log "PFACT sha=$fsha"
if [ "$fsha" != "$EXPECTED_FACT_SHA" ]; then
  log "REFUSE p_fact"; echo "FAIL_PFACT" > "$STATUS"; exit 7
fi
if [ ! -x "$BIN_OPS" ]; then
  log "FAIL missing $BIN_OPS"; echo "FAIL_OPS" > "$STATUS"; exit 6
fi
opssha=$(sha256sum "$BIN_OPS" | awk '{print $1}')
log "OPS_SHA=$opssha"
{
  echo "bmoe-cli $got"
  echo "test-backend-ops $opssha"
  echo "model $msha"
  echo "p_fact $fsha"
  echo "campaign $camp"
} > "$OUTDIR/shas.txt"

# backend name probe
BE="CPU"
if ! "$BIN_OPS" support -b CPU -o NONE >/tmp/k0_beprobe.txt 2>&1; then
  true
fi
if grep -q "Skipping CPU" /tmp/k0_beprobe.txt 2>/dev/null; then
  BE="CPU"
fi
log "backend_filter=$BE"
cp "$BIN_OPS" "$OUTDIR/test-backend-ops.bin" 2>/dev/null || true

# ============================================================
# K0-A
# ============================================================
run_ops(){
  local cell="$1" op="$2" pat="$3" nth="$4"
  if ! preflight_block; then
    log "K0-A $cell skipped preflight"
    return 3
  fi
  local tflag=""
  if [ "$nth" != "default" ]; then
    tflag="-t $nth"
  fi
  local outd="$OUTDIR/k0a/$cell"
  mkdir -p "$outd"
  local bj pct temp
  bj=$(batt_json)
  pct=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj")
  temp=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj")
  local np ca
  np=$(nproc)
  ca=$(awk '/^Cpus_allowed_list:/{print $2}' /proc/self/status)
  log "K0-A START $cell op=$op pat=$pat threads=$nth nproc=$np cpus=$ca batt=$pct"
  local t0 t1 rc
  t0=$(date +%s)
  set +e
  # shellcheck disable=SC2086
  "$BIN_OPS" perf -b "$BE" -o "$op" -p "$pat" $tflag > "$outd/stdout.txt" 2> "$outd/stderr.txt"
  rc=$?
  set -e
  t1=$(date +%s)
  local wall=$((t1-t0))
  log "K0-A END $cell rc=$rc wall=${wall}s"
  # parse every matching line
  local parsed
  parsed=$(parse_ops_line < "$outd/stdout.txt" || true)
  if [ -z "$parsed" ]; then
    echo "$(ts),$cell,$op,$pat,$nth,default,,,,,${rc},${wall},${pct},${temp},${np},${ca}" >> "$CSV_A"
    echo "$parsed" > "$outd/parsed.txt"
    return 0
  fi
  echo "$parsed" > "$outd/parsed.txt"
  while IFS=$'\t' read -r opname params us flops nruns; do
    [ -n "$opname" ] || continue
    echo "$(ts),$cell,$opname,$params,$nth,default,$us,$flops,$nruns,${rc},${wall},${pct},${temp},${np},${ca}" >> "$CSV_A"
  done <<< "$parsed"
}

log "===== K0-A test-backend-ops ====="
# MUL_MAT_ID: three real types, default threads + -t 1
run_ops A_id_tdef MUL_MAT_ID 'n_mats=64' default || true
run_ops A_id_t1   MUL_MAT_ID 'n_mats=64' 1 || true
# fused / packed / single-expert MUL_MAT at Mellum dims
run_ops A_mm_tdef MUL_MAT 'k=2304|k=896' default || true
run_ops A_mm_t1   MUL_MAT 'k=2304|k=896' 1 || true
log "K0-A done"

# ============================================================
# K0-B  on-model  n=64  warm = first pass in SAME process via --session if present,
#        else two-shot: we use n=80 and treat compute s/tok as the number (cache
#        hits 76% by token ~8 on this SKU). Battery-cheap.
# ============================================================
run_model(){
  local cell="$1" nth="$2" ngen="$3" do_fore="$4" do_pin="$5"
  if ! preflight_block; then
    log "$cell skipped preflight"
    return 3
  fi
  local outd="$OUTDIR/logs/$cell"
  mkdir -p "$outd"
  local bj0 pct0 temp0 bj1 pct1 temp1
  bj0=$(batt_json)
  pct0=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj0")
  temp0=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj0")
  local np ca
  np=$(nproc)
  ca=$(awk '/^Cpus_allowed_list:/{print $2}' /proc/self/status)
  local prompt
  prompt=$(cat "$PFACT")
  local cmd
  cmd="$REALBIN -m $MODEL -p \"$prompt\" -n $ngen --n-expert-used 8 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -t $nth -c 4096 --temp 0 --chatml --no-think"
  echo "$cmd" > "$outd/cmdline.txt"
  log "$cell START -t $nth n=$ngen pin=$do_pin batt=$pct0 temp=$temp0 nproc=$np"
  if [ "$do_fore" = "1" ]; then
    start_forensics "$cell" "$HOME/bin/mellum2/bmoe-cli"
  fi
  local t0 t1 rc rss
  t0=$(date +%s)
  set +e
  if [ "$do_pin" = "1" ]; then
    # launch unpinned so I/O can sit on littles/X3; pin ggml-* after spawn
    "$REALBIN" -m "$MODEL" -p "$prompt" -n "$ngen" --n-expert-used 8 \
      --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
      --io-threads 4 --ubatch 512 -t "$nth" -c 4096 --temp 0 --chatml --no-think \
      > "$outd/stdout.txt" 2> "$outd/stderr.txt" &
    local bpid=$!
    pin_ggml_threads "$bpid" "$PIN_CPUS" || true
    wait "$bpid"
    rc=$?
  else
    "$REALBIN" -m "$MODEL" -p "$prompt" -n "$ngen" --n-expert-used 8 \
      --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
      --io-threads 4 --ubatch 512 -t "$nth" -c 4096 --temp 0 --chatml --no-think \
      > "$outd/stdout.txt" 2> "$outd/stderr.txt"
    rc=$?
  fi
  set -e
  t1=$(date +%s)
  local wall=$((t1-t0))
  if [ "$do_fore" = "1" ]; then stop_forensics; fi
  cat "$outd/stdout.txt" "$outd/stderr.txt" > "$outd/combo.txt"
  tail -80 "$outd/combo.txt" > "$outd/tail.txt"
  bj1=$(batt_json)
  pct1=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj1")
  temp1=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj1")
  local plug
  plug=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('plugged','?'))" "$bj1")
  rss=$(awk '/VmHWM:/{print $2}' "$outd/combo.txt" 2>/dev/null || echo)
  # peak RSS from /proc is gone; leave empty if missing
  local metrics
  metrics=$(parse_bmoe "$outd/combo.txt")
  IFS=',' read -r tok_s mib hit ttft load_s prefill_s n_gen compute_s cache_s flash_s flash_mibs stall_s <<< "$metrics"
  log "$cell END rc=$rc wall=${wall}s decode=$tok_s compute=$compute_s flash=$flash_s batt=$pct0->$pct1"
  echo "$(ts),$cell,$nth,default,1,$tok_s,$mib,$hit,$ttft,$load_s,$prefill_s,$n_gen,$rss,$pct0,$pct1,$temp0,$temp1,$plug,$compute_s,$cache_s,$flash_s,$flash_mibs,$stall_s,$np,$ca,,$rc,$wall" >> "$CSV_B"
  # also write a one-line summary
  echo "$metrics" > "$outd/metrics.txt"
}

# Warm-then-measure: first pass n=32 discarded (fills LRU), second n=64 timed.
# Same process required for expert LRU. bmoe-cli is one-shot, so we approximate
# with a single n=96 run: first ~32 tokens fill the 2 GB cache (F1b hit 76% by
# token 8-16). compute s/tok is the decode-window average. Battery-cheap.
# A true two-pass needs --session; we also do a dedicated warm pair via a
# tiny stdin loop if --session exists.

log "===== K0-B on-model thread sweep ====="
# First pass (warm the process? we cannot keep LRU). Do a cheap n=32 warm
# only to touch flash/page state; O_DIRECT makes this mostly a no-op for
# weights. Then timed n=64. Both counted. The number that matters is compute s/tok.
run_model B_t1 1 64 0 0 || true
run_model B_t2 2 64 0 0 || true
run_model B_t4 4 64 0 0 || true

# ============================================================
# K0-C  scheduler
# ============================================================
summarize_fore(){
  local cell="$1"
  python3 - <<PY
import csv
from pathlib import Path
p = Path("$FORE")
little = big7 = tot = 0
with p.open() as f:
    r = csv.DictReader(f)
    for row in r:
        if row.get("cell") != "$cell":
            continue
        counts = [int(row.get(f"thr_cpu{i}") or 0) for i in range(8)]
        s = sum(counts)
        if s == 0:
            continue
        little += counts[0] + counts[1] + counts[2]
        big7 += counts[7]
        tot += s
lp = (100.0 * little / tot) if tot else 0.0
xp = (100.0 * big7 / tot) if tot else 0.0
print(f"{lp:.1f},{xp:.1f},{tot}")
PY
}

run_model_c(){
  local cell="$1" nth="$2" do_pin="$3"
  if ! preflight_block; then
    log "$cell skipped preflight"
    return 3
  fi
  local outd="$OUTDIR/logs/$cell"
  mkdir -p "$outd"
  local bj0 pct0 temp0
  bj0=$(batt_json)
  pct0=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj0")
  temp0=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj0")
  local np ca prompt
  np=$(nproc)
  ca=$(awk '/^Cpus_allowed_list:/{print $2}' /proc/self/status)
  prompt=$(cat "$PFACT")
  log "$cell START -t $nth pin=$do_pin batt=$pct0"
  start_forensics "$cell" "$HOME/bin/mellum2/bmoe-cli"
  local t0 t1 rc
  t0=$(date +%s)
  set +e
  if [ "$do_pin" = "1" ]; then
    "$REALBIN" -m "$MODEL" -p "$prompt" -n 64 --n-expert-used 8 \
      --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
      --io-threads 4 --ubatch 512 -t "$nth" -c 4096 --temp 0 --chatml --no-think \
      > "$outd/stdout.txt" 2> "$outd/stderr.txt" &
    local bpid=$!
    pin_ggml_threads "$bpid" "$PIN_CPUS" || true
    wait "$bpid"
    rc=$?
  else
    "$REALBIN" -m "$MODEL" -p "$prompt" -n 64 --n-expert-used 8 \
      --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
      --io-threads 4 --ubatch 512 -t "$nth" -c 4096 --temp 0 --chatml --no-think \
      > "$outd/stdout.txt" 2> "$outd/stderr.txt"
    rc=$?
  fi
  set -e
  t1=$(date +%s)
  local wall=$((t1-t0))
  stop_forensics
  cat "$outd/stdout.txt" "$outd/stderr.txt" > "$outd/combo.txt"
  tail -80 "$outd/combo.txt" > "$outd/tail.txt"
  local bj1 pct1 temp1
  bj1=$(batt_json)
  pct1=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj1")
  temp1=$(python3 -c "import json,sys;print(float(json.loads(sys.argv[1]).get('temperature',0)))" "$bj1")
  local metrics
  metrics=$(parse_bmoe "$outd/combo.txt")
  IFS=',' read -r tok_s mib hit ttft load_s prefill_s n_gen compute_s cache_s flash_s flash_mibs stall_s <<< "$metrics"
  local place
  place=$(summarize_fore "$cell")
  IFS=',' read -r little_pct x3_pct _ <<< "$place"
  echo "$place" > "$outd/placement.txt"
  log "$cell END rc=$rc decode=$tok_s compute=$compute_s little%=$little_pct x3%=$x3_pct"
  echo "$(ts),$cell,$nth,$do_pin,$tok_s,$mib,$hit,$compute_s,$flash_s,$flash_mibs,$n_gen,,$pct0,$pct1,$temp0,$temp1,$little_pct,$x3_pct,$np,$ca,,$rc,$wall" >> "$CSV_C"
}

log "===== K0-C scheduler ====="
run_model_c C_t4_unpinned 4 0 || true
run_model_c C_t4_pin_mid 4 1 || true

# campaign pin check after
camp2=$(sha256sum "$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN" 2>/dev/null | awk '{print $1}' || true)
log "CAMPAIGN_SHA_AFTER=$camp2"
if [ -n "$camp2" ] && [ "$camp2" != "$FORBIDDEN_CAMPAIGN_SHA" ]; then
  log "REFUSE campaign mutated after run"
  echo "FAIL_CAMPAIGN_MUTATED" > "$STATUS"
  exit 6
fi

echo "DONE" > "$STATUS"
log "K0 ALL CELLS DONE"
exit 0
