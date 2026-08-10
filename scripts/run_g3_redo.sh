#!/data/data/com.termux/files/usr/bin/bash
# G3 redo — confini affidabili + sampler locale ~200ms (mandato fix-bloccanti-audit §B)
# Fix v2: sampler Python (no thermal nel hot path), stderr via FIFO con wait del reader.
set -euo pipefail
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
export TMPDIR=$PREFIX/tmp
export LC_ALL=C
export HOME=/data/data/com.termux/files/home

OUT=$HOME/experiments/results/g3-redo
BINDIR=$HOME/src/BigMoeOnEdge/build-bmoe
export LD_LIBRARY_PATH=$BINDIR/bin:$BINDIR/cli:${LD_LIBRARY_PATH:-}
MODEL=${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}
COLD=$HOME/bin/cold_model.sh
CTRL=$BINDIR/cli/bmoe-cli.PREFAULT
NEW=$BINDIR/cli/bmoe-cli.CAMPAIGN
PROMPT_SHA_EXPECT=197480d977685dc8bacec8c3eeaf81ab395ee33ccaf5737a4913149920c2f619
PROMPT_TEXT="Say hello in one short sentence."
SHORT_FILE=$HOME/experiments/prompts/short.txt
THREADS=4
CACHE_MB=2000
IO_THREADS=4
N_CTX=4096
UBATCH=512
BASE="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${UBATCH}"
DIE_STOP_MC=98000
DIE_START_MC=80000
# Riga esistente in ENTRAMBI i binari a fine load (prima del prefill/decode)
BOUNDARY_RE='bmoe: expert streaming ON'

mkdir -p "$OUT/b0" "$OUT/b1" "$OUT/runs" "$OUT/raw" "$TMPDIR"
MASTER=$OUT/g3-redo.master.log
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
  local maxw=900 t0 now die n
  t0=$(date +%s)
  while :; do
    n=$(nproc)
    die=$(max_die_mc)
    if [ "$n" -lt 6 ]; then log "FATAL nproc=$n"; exit 2; fi
    if [ "$die" -le "$DIE_START_MC" ] 2>/dev/null; then log "prestart OK die=$(mc_to_c $die)C nproc=$n"; return 0; fi
    now=$(date +%s)
    if [ $((now-t0)) -ge $maxw ]; then log "prestart timeout die=$(mc_to_c $die)C — proceed cautiously"; return 0; fi
    log "wait prestart die=$(mc_to_c $die)C"
    sleep 15
  done
}
kill_bmoe(){
  local pid cmd
  for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cmd" in *"/bmoe-cli"*)
      kill "$pid" 2>/dev/null || true; sleep 1; kill -9 "$pid" 2>/dev/null || true
    ;; esac
  done
  sleep 1
}

# Run one measured load: Python orchestrates sampler + timestamped stderr via FIFO.
# Args: label bin slog serr samp sum phase(B0|B2) [rep]
run_measured(){
  local label=$1 bin=$2 slog=$3 serr=$4 samp=$5 sum=$6 phase=$7 rep=${8:-0}
  log "==== $phase $label rep=$rep bin=$bin ===="
  wait_prestart
  kill_bmoe
  "$COLD" "$MODEL" >>"$MASTER" 2>&1 || log "WARN cold"

  local fifo=$TMPDIR/g3err.$$.fifo
  rm -f "$fifo"
  mkfifo "$fifo"

  # stderr timestamp reader (line-buffered)
  python3 - "$fifo" "$serr" <<'PY' &
import sys, time
fifo, outp = sys.argv[1], sys.argv[2]
with open(outp, 'w', encoding='utf-8', errors='replace') as out, open(fifo, 'r', encoding='utf-8', errors='replace') as inp:
    for line in inp:
        out.write(f"{time.time():.3f} {line}")
        out.flush()
PY
  local rpid=$!

  set +e
  # shellcheck disable=SC2086
  "$bin" -m "$MODEL" -t $THREADS -c $N_CTX -n 8 --chatml --no-think --temp 0 --progress \
    $BASE --n-expert-used 8 \
    -p "$PROMPT_TEXT" \
    >"$slog" 2>"$fifo" &
  local bpid=$!
  set -e

  # Python sampler ~200ms, NO thermal in hot path; hard-stop check every ~2s
  python3 - "$bpid" "$samp" "$DIE_STOP_MC" <<'PY' &
import sys, time, os
pid = int(sys.argv[1]); samp = sys.argv[2]; die_stop = int(sys.argv[3])
io_path = f"/proc/{pid}/io"
st_path = f"/proc/{pid}/status"
def alive():
    try:
        os.kill(pid, 0); return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
def read_io():
    rb=rc=0
    try:
        with open(io_path) as f:
            for line in f:
                if line.startswith('read_bytes:'): rb=int(line.split()[1])
                elif line.startswith('rchar:'): rc=int(line.split()[1])
    except Exception:
        pass
    return rb, rc
def read_hwm():
    rss=hwm=0
    try:
        with open(st_path) as f:
            for line in f:
                if line.startswith('VmRSS:'): rss=int(line.split()[1])
                elif line.startswith('VmHWM:'): hwm=int(line.split()[1])
    except Exception:
        pass
    return rss, hwm
def max_die_mc():
    mx=0
    try:
        import glob
        for z in glob.glob('/sys/class/thermal/thermal_zone*'):
            try:
                t=open(z+'/type').read().strip().lower()
            except Exception:
                continue
            if 'cpu' not in t: continue
            try:
                v=int(open(z+'/temp').read().strip())
            except Exception:
                continue
            if v>mx: mx=v
    except Exception:
        pass
    return mx

with open(samp,'w') as out:
    out.write('ts,read_bytes,rchar,vmrss_kb,vmhwm_kb\n')
    out.flush()
    n=0
    while alive():
        now=time.time()
        rb,rc=read_io()
        rss,hwm=read_hwm()
        out.write(f'{now:.3f},{rb},{rc},{rss},{hwm}\n')
        out.flush()
        n+=1
        if n % 10 == 0:  # ~2s
            die=max_die_mc()
            if die > die_stop:
                try: os.kill(pid, 9)
                except Exception: pass
                break
        time.sleep(0.2)
PY
  local spid=$!

  t0=$(date +%s.%3N)
  wait $bpid || true
  t1=$(date +%s.%3N)
  # drain stderr reader (bin closed fifo write end)
  wait $rpid 2>/dev/null || true
  wait $spid 2>/dev/null || true
  rm -f "$fifo"

  python3 - "$samp" "$serr" "$sum" "$label" "$rep" "$t0" "$t1" "$bin" "$BOUNDARY_RE" "$phase" <<'PY'
import sys,csv,re,os,subprocess
samp,serr,sumf,label,rep,t0,t1,binpath,bre,phase=sys.argv[1:11]
rows=list(csv.DictReader(open(samp)))
bound_ts=None; bound_line=None
# primary boundary
pat=re.compile(re.escape(bre) if not bre.startswith('bmoe') else bre)
# allow plain substring
with open(serr,encoding='utf-8',errors='replace') as f:
    for line in f:
        if bre in line:
            parts=line.split(' ',1)
            try: bound_ts=float(parts[0])
            except Exception: bound_ts=None
            bound_line=line.rstrip('\n')
            break
# secondary fallback: last "set_abort_callback: call" (end of context setup, just before bmoe lines)
sec_ts=None; sec_line=None
with open(serr,encoding='utf-8',errors='replace') as f:
    for line in f:
        if 'set_abort_callback: call' in line:
            parts=line.split(' ',1)
            try: sec_ts=float(parts[0])
            except Exception: sec_ts=None
            sec_line=line.rstrip('\n')
# tertiary: dense-weights dropped
tert_ts=None; tert_line=None
with open(serr,encoding='utf-8',errors='replace') as f:
    for line in f:
        if 'dropped' in line and 'mmap pages' in line:
            parts=line.split(' ',1)
            try: tert_ts=float(parts[0])
            except Exception: tert_ts=None
            tert_line=line.rstrip('\n')
            break

use_ts = bound_ts if bound_ts is not None else (tert_ts if tert_ts is not None else sec_ts)
use_line = bound_line if bound_line is not None else (tert_line if tert_line is not None else sec_line)
use_src = 'primary' if bound_ts is not None else ('tertiary_dropped' if tert_ts is not None else ('secondary_abortcb' if sec_ts is not None else 'NONE'))

def nearest(rows,t):
    if t is None or not rows: return None
    return min(rows, key=lambda x: abs(float(x['ts'])-t))
sel=nearest(rows, use_ts)
GiB=1024**3
rb=rc=hwm=0
if sel:
    rb=int(sel['read_bytes'] or 0); rc=int(sel['rchar'] or 0); hwm=int(sel['vmhwm_kb'] or 0)
peak_rb=max((int(x['read_bytes'] or 0) for x in rows), default=0)
peak_hwm=max((int(x['vmhwm_kb'] or 0) for x in rows), default=0)
wall=float(t1)-float(t0)
sha=subprocess.check_output(['sha256sum', binpath], text=True).split()[0]

# interval stats
ivs=[]
if len(rows)>=2:
    ts=[float(x['ts']) for x in rows]
    ivs=sorted(ts[i+1]-ts[i] for i in range(len(ts)-1))
def pct(p):
    if not ivs: return None
    k=(len(ivs)-1)*p/100.0
    f=int(k); c=min(f+1,len(ivs)-1)
    return ivs[f] if f==c else ivs[f]*(c-k)+ivs[c]*(k-f)
med=ivs[len(ivs)//2] if ivs else None

# rate before/after boundary to verify plateau
rate_b=rate_a=None
if use_ts is not None and len(rows)>=2:
    before=[x for x in rows if float(x['ts'])<=use_ts]
    after=[x for x in rows if float(x['ts'])>use_ts]
    def rate(xs):
        if len(xs)<2: return 0.0
        dt=float(xs[-1]['ts'])-float(xs[0]['ts'])
        if dt<=0: return 0.0
        return (int(xs[-1]['read_bytes'] or 0)-int(xs[0]['read_bytes'] or 0))/dt
    rate_b=rate(before); rate_a=rate(after)

out=[]
out.append(f'label={label}')
out.append(f'rep={rep}')
out.append(f'phase={phase}')
out.append(f'bin={binpath}')
out.append(f'bin_sha256={sha}')
out.append(f'boundary_src={use_src}')
out.append(f'boundary_line={use_line}')
out.append(f'boundary_ts={use_ts}')
out.append(f'primary_line={bound_line}')
out.append(f'secondary_line={sec_line}')
out.append(f'tertiary_line={tert_line}')
out.append(f'read_bytes_at_load={rb}')
out.append(f'read_bytes_at_load_GiB={rb/GiB:.4f}')
out.append(f'rchar_at_load={rc}')
out.append(f'rchar_at_load_GiB={rc/GiB:.4f}')
out.append(f'VmHWM_at_load_MiB={hwm/1024:.1f}')
out.append(f'peak_read_bytes={peak_rb}')
out.append(f'peak_read_bytes_GiB={peak_rb/GiB:.4f}')
out.append(f'peak_VmHWM_MiB={peak_hwm/1024:.1f}')
out.append(f'wall_s={wall:.3f}')
out.append(f'n_samples={len(rows)}')
out.append(f'interval_median_s={med}')
out.append(f'interval_p95_s={pct(95)}')
out.append(f'interval_min_s={ivs[0] if ivs else None}')
out.append(f'interval_max_s={ivs[-1] if ivs else None}')
out.append(f'read_bytes_rate_before={rate_b}')
out.append(f'read_bytes_rate_after={rate_a}')
if rows:
    out.append(f'first_ts={rows[0]["ts"]} first_rb={rows[0]["read_bytes"]}')
    out.append(f'last_ts={rows[-1]["ts"]} last_rb={rows[-1]["read_bytes"]}')
text='\n'.join(out)+'\n'
open(sumf,'w').write(text)
print(text)

if phase=='B2':
    raw=os.path.join(os.path.dirname(os.path.dirname(sumf)), 'raw', 'runs.csv')
    os.makedirs(os.path.dirname(raw), exist_ok=True)
    hdr='label,rep,bin_sha256,read_bytes_at_load,rchar_at_load,VmHWM_kb,wall_s,n_samples,boundary_ts,boundary_src\n'
    if not os.path.exists(raw):
        open(raw,'w').write(hdr)
    open(raw,'a').write(f'{label},{rep},{sha},{rb},{rc},{hwm},{wall:.3f},{len(rows)},{use_ts},{use_src}\n')
PY
  log "$phase $label r$rep done"
  kill_bmoe
  wait_cool 70 500
}

log "=== G3-REDO START v2 ==="
log "CTRL=$(sha256sum $CTRL)"
log "NEW=$(sha256sum $NEW)"
if [ -f "$SHORT_FILE" ]; then
  got=$(sha256sum "$SHORT_FILE" | awk '{print $1}')
  log "short.txt sha=$got expect=$PROMPT_SHA_EXPECT"
fi
log "boundary_re=$BOUNDARY_RE"
log "nproc=$(nproc) die=$(mc_to_c $(max_die_mc))C"

# B0
run_measured B0_CTRL "$CTRL" "$OUT/b0/B0_CTRL.stdout" "$OUT/b0/B0_CTRL.stderr.ts" \
  "$OUT/b0/B0_CTRL.io.csv" "$OUT/b0/B0_CTRL.summary.txt" B0 0
run_measured B0_NEW "$NEW" "$OUT/b0/B0_NEW.stdout" "$OUT/b0/B0_NEW.stderr.ts" \
  "$OUT/b0/B0_NEW.io.csv" "$OUT/b0/B0_NEW.summary.txt" B0 0

# B1 gate from B0 intervals
python3 - "$OUT" <<'PY'
import sys,csv,glob
root=sys.argv[1]
all_iv=[]
hist_edges=[0.1,0.2,0.3,0.4,0.5,0.6,0.8,1.0,2.0,5.0]
hist={e:0 for e in hist_edges}; hist[99]=0
for p in sorted(glob.glob(root+'/b0/*.io.csv')):
    rows=list(csv.DictReader(open(p)))
    ts=[float(r['ts']) for r in rows]
    iv=[ts[i+1]-ts[i] for i in range(len(ts)-1)]
    all_iv.extend(iv)
    print(p, 'n', len(iv), 'med', sorted(iv)[len(iv)//2] if iv else None)
for v in all_iv:
    placed=False
    for edge in hist_edges:
        if v<=edge:
            hist[edge]+=1; placed=True; break
    if not placed: hist[99]+=1
ivs=sorted(all_iv)
def pct(p):
    if not ivs: return None
    k=(len(ivs)-1)*p/100.0
    f=int(k); c=min(f+1,len(ivs)-1)
    return ivs[f] if f==c else ivs[f]*(c-k)+ivs[c]*(k-f)
med=ivs[len(ivs)//2] if ivs else 9e9
p95=pct(95) if ivs else 9e9
# also dump boundary verification from B0 summaries
bound_info=[]
for p in sorted(glob.glob(root+'/b0/*.summary.txt')):
    bound_info.append(open(p).read())
open(root+'/b1/histogram.txt','w').write(
    f'n={len(ivs)}\nmedian_s={med}\np95_s={p95}\nmin_s={ivs[0] if ivs else None}\nmax_s={ivs[-1] if ivs else None}\nhist_le={hist}\n\n' + '\n---\n'.join(bound_info)
)
print('G-B median', med, 'p95', p95, 'hist', hist)
ok = (med is not None and med<=0.4 and p95 is not None and p95<=0.6)
open(root+'/b1/STATUS.txt','w').write('PASS\n' if ok else 'FAIL\n')
print('G-B', 'PASS' if ok else 'FAIL')
if not ok:
    sys.exit(11)
# require boundary found in both B0
for p in sorted(glob.glob(root+'/b0/*.summary.txt')):
    txt=open(p).read()
    if 'boundary_src=NONE' in txt:
        print('B0 boundary missing in', p)
        open(root+'/b1/STATUS.txt','w').write('FAIL_BOUNDARY\n')
        sys.exit(12)
    # verify rate drop
    # soft check only
sys.exit(0)
PY
GB_RC=$?
if [ "$GB_RC" -ne 0 ]; then
  log "G-B FAIL rc=$GB_RC — abort before B2"
  exit $GB_RC
fi
log "G-B PASS — proceeding to B2"

# B2: 2 reps per arm
for rep in 1 2; do
  run_measured CTRL "$CTRL" "$OUT/runs/CTRL_r${rep}.stdout" "$OUT/runs/CTRL_r${rep}.stderr.ts" \
    "$OUT/runs/CTRL_r${rep}.io.csv" "$OUT/runs/CTRL_r${rep}.summary.txt" B2 $rep
  run_measured NEW "$NEW" "$OUT/runs/NEW_r${rep}.stdout" "$OUT/runs/NEW_r${rep}.stderr.ts" \
    "$OUT/runs/NEW_r${rep}.io.csv" "$OUT/runs/NEW_r${rep}.summary.txt" B2 $rep
done

python3 - "$OUT" <<'PY'
import sys,glob
root=sys.argv[1]
def parse(p):
    d={}
    for line in open(p):
        if '=' in line:
            k,v=line.strip().split('=',1); d[k]=v
    return d
arms={'CTRL':[], 'NEW':[]}
for p in sorted(glob.glob(root+'/runs/*.summary.txt')):
    d=parse(p)
    arms[d['label']].append(float(d['read_bytes_at_load']))
need=[]
for arm,vals in arms.items():
    if len(vals)>=2:
        a,b=vals[0],vals[1]
        base=max(a,b) if max(a,b)>0 else 1
        rel=abs(a-b)/base
        print(arm, vals, 'rel', rel)
        if rel>0.15:
            need.append(arm)
open(root+'/raw/need_third.txt','w').write('\n'.join(need)+'\n')
print('need_third', need)
PY

NEED=$(cat "$OUT/raw/need_third.txt" 2>/dev/null || true)
for arm in $NEED; do
  if [ "$arm" = "CTRL" ]; then
    run_measured CTRL "$CTRL" "$OUT/runs/CTRL_r3.stdout" "$OUT/runs/CTRL_r3.stderr.ts" \
      "$OUT/runs/CTRL_r3.io.csv" "$OUT/runs/CTRL_r3.summary.txt" B2 3
  fi
  if [ "$arm" = "NEW" ]; then
    run_measured NEW "$NEW" "$OUT/runs/NEW_r3.stdout" "$OUT/runs/NEW_r3.stderr.ts" \
      "$OUT/runs/NEW_r3.io.csv" "$OUT/runs/NEW_r3.summary.txt" B2 3
  fi
done

python3 - "$OUT" <<'PY'
import sys,glob
from statistics import median
root=sys.argv[1]
def parse(p):
    d={}
    for line in open(p):
        if '=' in line:
            k,v=line.strip().split('=',1); d[k]=v
    return d
rows=[]
for p in sorted(glob.glob(root+'/runs/*.summary.txt')):
    rows.append(parse(p))
def med2(arm,key):
    xs=[]
    for r in rows:
        if r.get('label')!=arm: continue
        if key in r:
            try: xs.append(float(r[key]))
            except Exception: pass
    return median(xs) if xs else None
ctrl_rb=med2('CTRL','read_bytes_at_load')
new_rb=med2('NEW','read_bytes_at_load')
ctrl_rc=med2('CTRL','rchar_at_load')
new_rc=med2('NEW','rchar_at_load')
ctrl_hw=med2('CTRL','VmHWM_at_load_MiB')
new_hw=med2('NEW','VmHWM_at_load_MiB')
ctrl_wall=med2('CTRL','wall_s')
new_wall=med2('NEW','wall_s')
GiB=1024**3
red=None
if ctrl_rb and new_rb and ctrl_rb>0:
    red=(ctrl_rb-new_rb)/ctrl_rb
verdict='UNKNOWN'
if red is not None:
    if new_rb < ctrl_rb and red >= 0.40:
        verdict='G3_CONFERMATO'
    elif red >= 0.15:
        verdict='G3_PARZIALE'
    else:
        verdict='G3_ARTEFATTO_O_NULLO'
note=''
if new_rc is not None and abs(new_rc - 1.6*GiB)/(1.6*GiB) < 0.25:
    note='rchar_new_~1.6GiB_like_F4.8_historical'
lines=[]
lines.append(f'ctrl_read_bytes_median={ctrl_rb}')
lines.append(f'new_read_bytes_median={new_rb}')
lines.append(f'reduction={red}')
lines.append(f'ctrl_rchar_median={ctrl_rc}')
lines.append(f'new_rchar_median={new_rc}')
lines.append(f'ctrl_VmHWM_MiB_median={ctrl_hw}')
lines.append(f'new_VmHWM_MiB_median={new_hw}')
lines.append(f'ctrl_wall_s_median={ctrl_wall}')
lines.append(f'new_wall_s_median={new_wall}')
lines.append(f'verdict={verdict}')
lines.append(f'note={note}')
lines.append('--- per run ---')
for r in rows:
    lines.append(f"{r['label']}_r{r['rep']} rb={r.get('read_bytes_at_load')} ({r.get('read_bytes_at_load_GiB')} GiB) rchar={r.get('rchar_at_load')} hwm={r.get('VmHWM_at_load_MiB')} wall={r.get('wall_s')} src={r.get('boundary_src')} iv_med={r.get('interval_median_s')}")
text='\n'.join(lines)+'\n'
open(root+'/VERDICT.txt','w').write(text)
print(text)
PY

log "=== G3-REDO DONE ==="
cat "$OUT/VERDICT.txt" | tee -a "$MASTER"
exit 0
