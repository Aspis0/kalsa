#!/data/data/com.termux/files/usr/bin/bash
# G2/G3/G4 gates for mmap_prefetch loader fix.
set -euo pipefail
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
export TMPDIR=$PREFIX/tmp
export LC_ALL=C

OUT=~/experiments/results/loader-fix
BINDIR=~/src/BigMoeOnEdge/build-bmoe
export LD_LIBRARY_PATH=$BINDIR/bin:$BINDIR/cli:${LD_LIBRARY_PATH:-}
MODEL=~/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf
COLD=~/bin/cold_model.sh
PROMPTS=~/experiments/prompts
REFDIR=~/experiments/results/f5.5/b
NEW=$BINDIR/cli/bmoe-cli.NEW
PRE=$BINDIR/cli/bmoe-cli.G3_PREFAULT
THREADS=4
CACHE_MB=2000
IO_THREADS=4
N_CTX=4096
UBATCH=512
BASE="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${UBATCH}"
DIE_STOP_MC=98000
DIE_START_MC=80000

mkdir -p "$OUT/g2" "$OUT/g3" "$OUT/g4"
MASTER=$OUT/gates.master.log
: > "$MASTER"
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
mc_to_c(){ awk -v m="$1" 'BEGIN{ if (m>1000) printf "%.1f", m/1000; else printf "%.1f", m }'; }

wait_cool(){
  local target="${1:-70}" maxw="${2:-600}" t0 now die
  t0=$(date +%s)
  while :; do
    die=$(max_die_mc)
    if [ "$die" -le $((target*1000)) ] 2>/dev/null; then log "cool OK die=$(mc_to_c $die)C"; return 0; fi
    now=$(date +%s)
    if [ $((now-t0)) -ge $maxw ]; then log "cool timeout die=$(mc_to_c $die)C"; return 0; fi
    if [ "$die" -gt "$DIE_STOP_MC" ] 2>/dev/null; then log "HARD_STOP die=$(mc_to_c $die)C"; exit 99; fi
    sleep 10
  done
}

wait_prestart(){
  local maxw=600 t0 now die n
  t0=$(date +%s)
  while :; do
    n=$(nproc)
    die=$(max_die_mc)
    if [ "$n" -lt 6 ]; then log "FATAL nproc=$n"; exit 2; fi
    if [ "$die" -le "$DIE_START_MC" ] 2>/dev/null; then log "prestart OK die=$(mc_to_c $die)C nproc=$n"; return 0; fi
    now=$(date +%s)
    if [ $((now-t0)) -ge $maxw ]; then log "prestart timeout die=$(mc_to_c $die)C — proceed"; return 0; fi
    log "wait prestart die=$(mc_to_c $die)C"
    sleep 10
  done
}

kill_bmoe(){
  local pid cmd
  for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cmd" in *"/bmoe-cli"*|*/bmoe-cli.NEW*|*/bmoe-cli.G3*)
      kill "$pid" 2>/dev/null || true; sleep 1; kill -9 "$pid" 2>/dev/null || true
    ;; esac
  done
  sleep 1
}

extract_gen(){
  local slog=$1 genf=$2
  if grep -q '=== answer ===' "$slog" 2>/dev/null; then
    sed -n '/=== answer ===/,/=== perf ===/{/=== answer ===/d;/=== perf ===/d;p}' "$slog" > "$genf"
  else
    python3 - "$slog" "$genf" <<'PY'
import sys,json
src,dst=sys.argv[1],sys.argv[2]
parts=[]
with open(src,encoding='utf-8',errors='replace') as f:
    for line in f:
        if 'BMOE_PROGRESS' not in line: continue
        i=line.find('{')
        if i<0: continue
        try: o=json.loads(line[i:])
        except Exception: continue
        t=o.get('delta_text') or ''
        if t: parts.append(t)
open(dst,'w',encoding='utf-8').write(''.join(parts))
PY
  fi
}

run_g3_one(){
  local label=$1 bin=$2
  local slog=$OUT/g3/${label}.stdout
  local serr=$OUT/g3/${label}.stderr
  local samp=$OUT/g3/${label}.io.csv
  local sum=$OUT/g3/${label}.summary.txt
  log "==== G3 $label bin=$bin ===="
  wait_prestart
  kill_bmoe
  "$COLD" "$MODEL" >>"$MASTER" 2>&1 || log "WARN cold"
  echo "ts_ms,read_bytes,rchar,vmrss_kb,vmhwm_kb,phase" > "$samp"

  set +e
  # shellcheck disable=SC2086
  "$bin" -m "$MODEL" -t $THREADS -c $N_CTX -n 8 --chatml --no-think --temp 0 --progress \
    $BASE --n-expert-used 8 \
    -p "Say hello in one short sentence." \
    >"$slog" 2>"$serr" &
  local bpid=$!
  set -e

  local start_ms load_line load_s=0
  start_ms=$(python3 -c 'import time;print(int(time.time()*1000))')
  while kill -0 $bpid 2>/dev/null; do
    now_ms=$(python3 -c 'import time;print(int(time.time()*1000))')
    rb=0; rc=0; rss=0; hwm=0
    if [ -r "/proc/$bpid/io" ]; then
      rb=$(awk '/^read_bytes:/{print $2}' "/proc/$bpid/io")
      rc=$(awk '/^rchar:/{print $2}' "/proc/$bpid/io")
    fi
    if [ -r "/proc/$bpid/status" ]; then
      rss=$(awk '/^VmRSS:/{print $2}' "/proc/$bpid/status")
      hwm=$(awk '/^VmHWM:/{print $2}' "/proc/$bpid/status")
    fi
    phase=run
    if ! grep -q 'model load' "$slog" 2>/dev/null; then phase=load; fi
    echo "${now_ms},${rb},${rc},${rss},${hwm},${phase}" >> "$samp"
    die=$(max_die_mc)
    if [ "$die" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
      log "HARD_STOP mid G3 $label die=$(mc_to_c $die)C"
      kill -9 $bpid 2>/dev/null || true
      exit 99
    fi
    sleep 0.2
  done
  wait $bpid || true
  load_line=$(grep -oE 'model load [0-9.]+ s' "$slog" 2>/dev/null | head -1 || true)
  load_s=$(echo "$load_line" | awk '{print $3}')
  load_s=${load_s:-0}

  python3 - "$samp" "$sum" "$load_s" "$start_ms" "$label" <<'PY'
import sys,csv
samp,sumf,load_s,start_ms,label=sys.argv[1],sys.argv[2],float(sys.argv[3] or 0),int(sys.argv[4]),sys.argv[5]
rows=[]
with open(samp) as f:
    r=csv.DictReader(f)
    for row in r:
        rows.append(row)
if not rows:
    open(sumf,'w').write('NO_SAMPLES\n'); raise SystemExit
load_rows=[x for x in rows if x.get('phase')=='load']
if load_rows:
    sel=load_rows[-1]
    how='last_phase_load'
else:
    target=start_ms + int(load_s*1000)
    sel=min(rows, key=lambda x: abs(int(x['ts_ms'])-target))
    how='nearest_load_seconds'
peak_rb=max(int(x['read_bytes'] or 0) for x in rows)
peak_hwm=max(int(x['vmhwm_kb'] or 0) for x in rows)
rb=int(sel['read_bytes'] or 0)
rchar=int(sel['rchar'] or 0)
hwm=int(sel['vmhwm_kb'] or 0)
GiB=1024**3
out=[]
out.append(f'label={label}')
out.append(f'select={how}')
out.append(f'load_seconds={load_s}')
out.append(f'read_bytes_at_load={rb}')
out.append(f'read_bytes_at_load_GiB={rb/GiB:.4f}')
out.append(f'rchar_at_load={rchar}')
out.append(f'rchar_at_load_GiB={rchar/GiB:.4f}')
out.append(f'VmHWM_at_load_MiB={hwm/1024:.1f}')
out.append(f'peak_read_bytes_GiB={peak_rb/GiB:.4f}')
out.append(f'peak_VmHWM_MiB={peak_hwm/1024:.1f}')
out.append(f'n_samples={len(rows)}')
text='\n'.join(out)+'\n'
open(sumf,'w').write(text)
print(text)
PY
  log "G3 $label done load_s=$load_s"
  kill_bmoe
  wait_cool 70 400
}

log "=== GATES START ==="
log "NEW=$(sha256sum $NEW)"
log "PRE=$(sha256sum $PRE)"
log "nproc=$(nproc) die=$(mc_to_c $(max_die_mc))C"

run_g3_one PREFAULT "$PRE"
run_g3_one NEW "$NEW"

log "=== G2 START ==="
PROMPTS_LIST=(short f45_1_esplicativo f45_2_scrittura f45_3_istruzioni f45_4_codice f45_5_ragionamento long_conversational_it d1_long)
NGENS=(200 200 200 200 200 200 256 256)
G2_PASS=0
G2_FAIL=0
: > "$OUT/g2/compare.txt"
: > "$OUT/g4/status.txt"
for i in "${!PROMPTS_LIST[@]}"; do
  pn=${PROMPTS_LIST[$i]}
  ngen=${NGENS[$i]}
  cell=${pn}-k8
  pfile=$PROMPTS/${pn}.txt
  slog=$OUT/g2/${cell}.stdout
  serr=$OUT/g2/${cell}.stderr
  genf=$OUT/g2/${cell}.gen.txt
  log "==== G2 $cell n=$ngen ===="
  wait_prestart
  kill_bmoe
  "$COLD" "$MODEL" >>"$MASTER" 2>&1 || log "WARN cold"
  set +e
  # shellcheck disable=SC2086
  "$NEW" -m "$MODEL" -t $THREADS -c $N_CTX -n $ngen \
    --chatml --no-think --progress --temp 0 \
    $BASE --n-expert-used 8 \
    -p "$(cat "$pfile")" \
    >"$slog" 2>"$serr"
  rc=$?
  set -e
  extract_gen "$slog" "$genf"
  new_sha=$(sha256sum "$genf" | awk '{print $1}')
  ref=$REFDIR/${cell}.gen.txt
  if [ ! -f "$ref" ]; then
    log "G2 MISS ref $ref"
    echo "$cell MISS_REF new=$new_sha" | tee -a "$OUT/g2/compare.txt"
    G2_FAIL=$((G2_FAIL+1))
  else
    ref_sha=$(sha256sum "$ref" | awk '{print $1}')
    if [ "$new_sha" = "$ref_sha" ]; then
      log "G2 PASS $cell"
      echo "$cell PASS $new_sha" | tee -a "$OUT/g2/compare.txt"
      G2_PASS=$((G2_PASS+1))
    else
      log "G2 FAIL $cell new=$new_sha ref=$ref_sha"
      echo "$cell FAIL new=$new_sha ref=$ref_sha" | tee -a "$OUT/g2/compare.txt"
      python3 - "$genf" "$ref" <<'PY' | tee -a "$OUT/g2/compare.txt" || true
import sys
a=open(sys.argv[1],encoding='utf-8',errors='replace').read()
b=open(sys.argv[2],encoding='utf-8',errors='replace').read()
print(f'  new_len={len(a)} ref_len={len(b)}')
for i,(ca,cb) in enumerate(zip(a,b)):
    if ca!=cb:
        print(f'  first_diff_at={i} new={a[max(0,i-20):i+20]!r} ref={b[max(0,i-20):i+20]!r}')
        break
else:
    if len(a)!=len(b):
        print(f'  prefix_match len_diff new-ref={len(a)-len(b)}')
PY
      G2_FAIL=$((G2_FAIL+1))
    fi
  fi
  if [ $rc -ne 0 ]; then
    log "G4 FAIL rc=$rc on $cell"
    echo "G4_FAIL rc=$rc $cell" >> "$OUT/g4/status.txt"
  else
    echo "G4_OK $cell rc=0" >> "$OUT/g4/status.txt"
  fi
  grep -E 'model load|generation:|prefill:' "$slog" | head -5 | tee -a "$MASTER" || true
  kill_bmoe
  wait_cool 70 400
done

echo "G2_PASS=$G2_PASS G2_FAIL=$G2_FAIL" | tee "$OUT/g2/summary.txt" | tee -a "$MASTER"
log "=== GATES DONE G2_PASS=$G2_PASS G2_FAIL=$G2_FAIL ==="
{
  echo "=== G3 PREFAULT ==="
  cat "$OUT/g3/PREFAULT.summary.txt" 2>/dev/null || echo missing
  echo "=== G3 NEW ==="
  cat "$OUT/g3/NEW.summary.txt" 2>/dev/null || echo missing
  echo "=== G2 ==="
  cat "$OUT/g2/compare.txt" 2>/dev/null || echo missing
  cat "$OUT/g2/summary.txt" 2>/dev/null || echo missing
  echo "=== G4 ==="
  cat "$OUT/g4/status.txt" 2>/dev/null || echo missing
} | tee "$OUT/FINAL_SUMMARY.txt"
