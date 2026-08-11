#!/data/data/com.termux/files/usr/bin/bash
# run_calaqwen_s23.sh — mandate calaqwen-sessione-s23.md
# Default A: KEXP + k=6 + drop 0.65, CAMPAIGN pin, staccato.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/calaqwen_s23}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
P_SHORT="${P_SHORT:-$HOME/experiments/prompts/short.txt}"
P_F45="${P_F45:-$HOME/experiments/prompts/f45_1.txt}"
# 5-turn prompts (F5.1 t1..t5 if present)
P_TDIR="${P_TDIR:-$HOME/experiments/prompts}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

mkdir -p "$OUTDIR"/{b1,b2,b3,flight,idle}
MASTER="$OUTDIR/CALAQWEN.master.log"
CELLS="$OUTDIR/cells.csv"
FLIGHT="$OUTDIR/flight/flight_1s.csv"
STATUS="$OUTDIR/STATUS.txt"
: > "$MASTER"
echo "block,label,rc,wall_s,tok_s,prefill_tps,n_gen,n_prompt,n_past,hit,drop_pct,mib_tok,die_med,die_p90,die_max,batt_s,batt_e,note" > "$CELLS"
echo "ts_epoch,iso,batt_pct,current_uA,voltage_mV,temp_c,plugged,die_c,memfree_kb,phase" > "$FLIGHT"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }
echo "RUNNING" > "$STATUS"

# --- libs ---
# shellcheck disable=SC1090
if [ -f "$HOME/experiments/scripts/lib_campaign_pin.sh" ]; then
  source "$HOME/experiments/scripts/lib_campaign_pin.sh"
  assert_campaign_pin "$BIN"
else
  exp=$(awk 'NF{print $1; exit}' "$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256")
  got=$(sha256sum "$BIN" | awk '{print $1}')
  [ "$got" = "$exp" ] || { log "PIN FAIL"; echo "FAIL_PIN" > "$STATUS"; exit 6; }
  BIN_SHA256="$got"
fi
# shellcheck disable=SC1090
source "$HOME/experiments/scripts/lib_guardrails.sh"
log "bin=$BIN_SHA256 model=$(sha256sum "$MODEL" | awk '{print $1}')"
log "guardrails_sha=$(sha256sum "$HOME/experiments/scripts/lib_guardrails.sh" | awk '{print $1}')"
sha256sum "$P_SHORT" "$P_F45" 2>/dev/null | tee -a "$MASTER" || true

# screen long for overnight
SCREEN_PREV=$(settings get system screen_off_timeout 2>/dev/null || echo "")
settings put system screen_off_timeout 7200000 2>/dev/null || true
termux-wake-lock >/dev/null 2>&1 || true
restore_screen(){
  if [ -n "${SCREEN_PREV:-}" ] && [ "$SCREEN_PREV" != "null" ]; then
    settings put system screen_off_timeout "$SCREEN_PREV" 2>/dev/null || true
  else
    settings put system screen_off_timeout 1800000 2>/dev/null || true
  fi
  termux-wake-unlock >/dev/null 2>&1 || true
}
trap 'restore_screen; log "trap cleanup"' EXIT

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

batt_json(){ timeout 5 termux-battery-status 2>/dev/null || echo '{}'; }
batt_probe(){
  python3 - <<'PY'
import json,subprocess,sys
try:
  d=json.loads(subprocess.check_output(["termux-battery-status"],timeout=5))
except Exception as e:
  print(f"FAIL {e}"); sys.exit(1)
need=["percentage","plugged","current","voltage","temperature"]
missing=[k for k in need if k not in d]
if missing:
  print("FAIL missing",missing); sys.exit(2)
print("OK",d.get("plugged"),d.get("percentage"),d.get("current"),d.get("voltage"))
PY
}

cold(){
  if [ -x "$HOME/bin/cold_model.sh" ]; then "$HOME/bin/cold_model.sh" "$MODEL" || true
  elif command -v fadv >/dev/null 2>&1; then fadv --dontneed "$MODEL" 2>/dev/null || true
  fi
}

preflight(){
  local floor="${1:-50}" need_unplugged="${2:-1}"
  local die nproc_n bj plug pct
  for i in $(seq 1 60); do
    bj=$(batt_json)
    plug=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('plugged','?'))" "$bj" 2>/dev/null || echo "?")
    pct=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj" 2>/dev/null || echo 0)
    die=$(max_die_mc); nproc_n=$(nproc)
    log "preflight i=$i plugged=$plug batt=$pct die=$(mc_to_c "$die") nproc=$nproc_n"
    if [ "$need_unplugged" = "1" ] && ! echo "$plug" | grep -qi UNPLUGGED; then
      log "WAIT unplugged"; sleep 15; continue
    fi
    if [ "$pct" -lt "$floor" ] 2>/dev/null; then
      log "WAIT batt $pct < $floor"; sleep 30; continue
    fi
    if [ "$nproc_n" -lt 6 ] 2>/dev/null; then
      termux-wake-lock >/dev/null 2>&1 || true
      /system/bin/am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1 || true
      sleep 10; continue
    fi
    if [ "$die" -gt 80000 ] 2>/dev/null; then
      log "WAIT die cool"; sleep 15; continue
    fi
    return 0
  done
  log "preflight FAIL"
  return 1
}

# flight sampler 1s + guardrail 0.5s on bmoe pid
run_with_flight(){
  local label="$1"; shift
  local out="$OUTDIR/$label"
  mkdir -p "$out"
  local batt_s plug die_s
  batt_s=$(python3 -c "import json,subprocess;print(json.loads(subprocess.check_output(['termux-battery-status'])).get('percentage','?'))" 2>/dev/null || echo "?")
  log "CELL $label batt=$batt_s"
  cold
  local t0 t1 wall rc
  t0=$(date +%s)
  set +e
  "$@" >"$out/stdout.txt" 2>"$out/stderr.txt" &
  local BPID=$!
  echo $BPID > "$out/pid"
  set -e
  # dual sampler: flight 1s + guardrail 0.5s
  (
    guardrails_reset 2>/dev/null || true
    while kill -0 "$BPID" 2>/dev/null; do
      now=$(date +%s)
      iso=$(date '+%Y-%m-%dT%H:%M:%S%z')
      bj=$(batt_json)
      eval "$(python3 -c "
import json,sys
try:
 d=json.loads(sys.argv[1])
 print('pct=%s'%d.get('percentage',-1))
 print('cur=%s'%d.get('current',0))
 print('volt=%s'%d.get('voltage',0))
 print('temp=%s'%d.get('temperature',-1))
 print('plug=%s'%d.get('plugged','?'))
except Exception:
 print('pct=-1'); print('cur=0'); print('volt=0'); print('temp=-1'); print('plug=?')
" "$bj" 2>/dev/null)"
      die_mc=$(max_die_mc); die_c=$(mc_to_c "$die_mc")
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      # flight 1s rows only every other 0.5 tick via counter
      echo "${now},${iso},${pct},${cur},${volt},${temp},${plug},${die_c},${mf},${label}" >> "$FLIGHT"
      guardrail_tick "$die_mc" "$mf"
      case "$GR_ACTION" in
        PAUSE_THERMAL)
          log "PAUSE_THERMAL $label $GR_LAST_DETAIL"
          kill "$BPID" 2>/dev/null || true
          echo "PAUSE_THERMAL" > "$out/guardrail.txt"
          ;;
        ABORT_MEM)
          log "ABORT_MEM $label $GR_LAST_DETAIL"
          kill "$BPID" 2>/dev/null || true
          echo "ABORT_MEM" > "$out/guardrail.txt"
          ;;
        HARD_DIE)
          log "HARD_DIE $label"
          kill "$BPID" 2>/dev/null || true
          echo "HARD_DIE" > "$out/guardrail.txt"
          ;;
      esac
      sleep 0.5
    done
  ) &
  local SPID=$!
  set +e
  wait $BPID; rc=$?
  set -e
  kill $SPID 2>/dev/null || true; wait $SPID 2>/dev/null || true
  t1=$(date +%s); wall=$((t1-t0))
  cat "$out/stdout.txt" "$out/stderr.txt" > "$out/combo.txt" 2>/dev/null || true
  # parse metrics
  python3 - <<PY
import re, json, csv, statistics
from pathlib import Path
out = Path("$out")
text = (out/"combo.txt").read_text(encoding="utf-8", errors="replace")
tok_s = prefill = hit = drop = mib = None
n_gen = n_prompt = n_past = None
m = re.search(r"generation:\s*(\d+)\s+tokens,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)", text)
if m:
    n_gen = int(m.group(1)); tok_s = float(m.group(2))
m2 = re.search(r"prefill:\s*(\d+)\s+tokens,\s*[0-9.]+\s*s\s*\(([0-9.]+)\s*tok/s\)", text)
if m2:
    n_prompt = int(m2.group(1)); prefill = float(m2.group(2))
for line in text.splitlines():
    if "BMOE_DONE" in line:
        i = line.find("{")
        if i>=0:
            try:
                j=json.loads(line[i:])
                if j.get("tok_s") is not None: tok_s=float(j["tok_s"])
                if j.get("tokens") is not None: n_gen=int(j["tokens"])
                if j.get("n_prompt") is not None: n_prompt=int(j["n_prompt"])
                if j.get("n_past") is not None: n_past=int(j["n_past"])
            except Exception:
                pass
m3 = re.search(r"moe-cache:\s*([0-9.]+)%\s*hit", text)
if m3: hit=float(m3.group(1))
m4 = re.search(r"moe-drop:[^)]*\(([0-9.]+)%\)", text)
if m4: drop=float(m4.group(1))
m5 = re.search(r"\(([0-9.]+)\s*MiB/token\)", text)
if m5: mib=float(m5.group(1))
# die stats from flight for this label
dies=[]
fl=Path("$FLIGHT")
if fl.exists():
    for row in fl.read_text(encoding="utf-8", errors="replace").splitlines()[1:]:
        p=row.split(",")
        if len(p)>=10 and p[-1]=="$label":
            try: dies.append(float(p[7]))
            except: pass
def pct(a,q):
    if not a: return ""
    a=sorted(a); i=int(q*(len(a)-1)); return f"{a[i]:.1f}"
die_med=pct(dies,0.5); die_p90=pct(dies,0.9); die_max=f"{max(dies):.1f}" if dies else ""
batt_e="?"
try:
    import subprocess
    batt_e=str(json.loads(subprocess.check_output(["termux-battery-status"],timeout=5)).get("percentage","?"))
except Exception:
    pass
note=""
if (out/"guardrail.txt").exists():
    note=(out/"guardrail.txt").read_text().strip()
line=f"{'$3' if False else ''}"
# block passed via env
block=Path("$out").parts[-2] if False else open("$out/../.block","w")
PY
  # simpler parse in bash+python one shot
  local metrics
  metrics=$(python3 - <<PY
import re, json, subprocess
from pathlib import Path
text = Path("$out/combo.txt").read_text(encoding="utf-8", errors="replace")
tok_s=prefill=hit=drop=mib=""
n_gen=n_prompt=n_past=""
m=re.search(r"generation:\s*(\d+)\s+tokens,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)", text)
if m: n_gen,m.group(1); n_gen=m.group(1); tok_s=m.group(2)
m2=re.search(r"prefill:\s*(\d+)\s+tokens,\s*[0-9.]+\s*s\s*\(([0-9.]+)\s*tok/s\)", text)
if m2: n_prompt=m2.group(1); prefill=m2.group(2)
for line in text.splitlines():
    if "BMOE_DONE" in line:
        i=line.find("{")
        if i>=0:
            try:
                j=json.loads(line[i:])
                if j.get("tok_s") is not None: tok_s=str(j["tok_s"])
                if j.get("tokens") is not None: n_gen=str(j["tokens"])
                if j.get("n_prompt") is not None: n_prompt=str(j["n_prompt"])
                if j.get("n_past") is not None: n_past=str(j["n_past"])
            except Exception: pass
m3=re.search(r"moe-cache:\s*([0-9.]+)%\s*hit", text)
if m3: hit=m3.group(1)
m4=re.search(r"moe-drop:[^)]*\(([0-9.]+)%\)", text)
if m4: drop=m4.group(1)
m5=re.search(r"\(([0-9.]+)\s*MiB/token\)", text)
if m5: mib=m5.group(1)
dies=[]
for row in Path("$FLIGHT").read_text(encoding="utf-8",errors="replace").splitlines()[1:]:
    p=row.split(",")
    if len(p)>=10 and p[-1]=="$label":
        try: dies.append(float(p[7]))
        except: pass
def q(a,f):
    if not a: return ""
    a=sorted(a); return f"{a[int(f*(len(a)-1))]:.1f}"
die_med=q(dies,0.5); die_p90=q(dies,0.9); die_max=f"{max(dies):.1f}" if dies else ""
try:
    be=str(json.loads(subprocess.check_output(["termux-battery-status"],timeout=5)).get("percentage","?"))
except Exception:
    be="?"
note=""
gp=Path("$out/guardrail.txt")
if gp.exists(): note=gp.read_text().strip().replace(","," ")
print("|".join([str(x) for x in [tok_s,prefill,n_gen,n_prompt,n_past,hit,drop,mib,die_med,die_p90,die_max,be,note]]))
PY
)
  IFS='|' read -r tok_s prefill n_gen n_prompt n_past hit drop mib die_med die_p90 die_max batt_e note <<<"$metrics"
  local block_tag="${BLOCK_TAG:-x}"
  echo "${block_tag},${label},${rc},${wall},${tok_s},${prefill},${n_gen},${n_prompt},${n_past},${hit},${drop},${mib},${die_med},${die_p90},${die_max},${batt_s},${batt_e},${note}" >> "$CELLS"
  log "DONE $label tok_s=$tok_s n_gen=$n_gen wall=$wall rc=$rc die_max=$die_max note=$note"
  echo "$rc"
}

FLAGS=(--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512
  --n-expert-used 6 --drop-cold-experts 0.65 --temp 0 --chatml --no-think -t 4 -c 4096)

# ============== PREFLIGHT GLOBAL ==============
log "=== CALAQWEN START ==="
if ! batt_probe | tee -a "$MASTER" | grep -q '^OK'; then
  log "battery probe FAIL — energy may be NON MISURABILE"
fi
preflight 50 1 || { echo "FAIL_PREFLIGHT" > "$STATUS"; exit 3; }

# idle baseline 30s
log "idle baseline 30s"
for i in $(seq 1 30); do
  now=$(date +%s); iso=$(date '+%Y-%m-%dT%H:%M:%S%z')
  bj=$(batt_json)
  eval "$(python3 -c "
import json,sys
try:
 d=json.loads(sys.argv[1])
 print('pct=%s'%d.get('percentage',-1)); print('cur=%s'%d.get('current',0)); print('volt=%s'%d.get('voltage',0)); print('temp=%s'%d.get('temperature',-1)); print('plug=%s'%d.get('plugged','?'))
except Exception:
 print('pct=-1');print('cur=0');print('volt=0');print('temp=-1');print('plug=?')
" "$bj")"
  die_c=$(mc_to_c "$(max_die_mc)"); mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
  echo "${now},${iso},${pct},${cur},${volt},${temp},${plug},${die_c},${mf},idle_pre" >> "$FLIGHT"
  sleep 1
done

# ============== BLOCCO 1 ==============
BLOCK_TAG=b1
log "=== BLOCCO 1 scheda ==="
# B1.1 sostenuto short n=512 x2 (EOS early expected)
for rep in 1 2; do
  preflight 45 1 || true
  ptext=$(cat "$P_SHORT")
  run_with_flight "b1/sos_short_r${rep}" "$BIN" -m "$MODEL" -p "$ptext" -n 512 "${FLAGS[@]}"
done
# B1.1b long thermal: degenerate continue list
preflight 40 1 || true
plong="Continue this numbered list forever without stopping. 1. alpha 2. beta 3. gamma"
run_with_flight "b1/sos_long_thermal" "$BIN" -m "$MODEL" -p "$plong" -n 512 "${FLAGS[@]}"

# B1.2 conv 5 turns KV
log "=== B1 conv5 KV ==="
preflight 40 1 || true
CONV_OUT="$OUTDIR/b1/conv5"
mkdir -p "$CONV_OUT"
# build session input
python3 - <<PY
from pathlib import Path
home=Path.home()
pdir=home/"experiments/prompts"
turns=[]
for i in range(1,6):
    for name in [f"f5_1_t{i}.txt", f"f51_t{i}.txt"]:
        f=pdir/name
        if f.exists():
            turns.append(f.read_text(encoding="utf-8", errors="replace").strip())
            break
    else:
        turns.append(f"Turn {i}: Briefly explain MoE expert streaming on flash in one short paragraph.")
# session protocol: JSON lines clear_kv only t1
out=Path("$CONV_OUT/session_in.jsonl")
lines=[]
for i,t in enumerate(turns):
    obj={"prompt": t, "n_predict": 256, "clear_kv": i==0}
    import json
    lines.append(json.dumps(obj))
out.write_text("\n".join(lines)+"\n", encoding="utf-8")
print("turns", len(turns))
PY
cold
# session mode
set +e
"$BIN" -m "$MODEL" --session "${FLAGS[@]}" \
  < "$CONV_OUT/session_in.jsonl" > "$CONV_OUT/stdout.txt" 2> "$CONV_OUT/stderr.txt" &
BPID=$!
(
  while kill -0 $BPID 2>/dev/null; do
    now=$(date +%s); iso=$(date '+%Y-%m-%dT%H:%M:%S%z')
    bj=$(batt_json)
    eval "$(python3 -c "import json,sys
try:
 d=json.loads(sys.argv[1])
 print('pct=%s'%d.get('percentage',-1)); print('cur=%s'%d.get('current',0)); print('volt=%s'%d.get('voltage',0)); print('temp=%s'%d.get('temperature',-1)); print('plug=%s'%d.get('plugged','?'))
except: print('pct=-1');print('cur=0');print('volt=0');print('temp=-1');print('plug=?')" "$bj")"
    die_c=$(mc_to_c "$(max_die_mc)"); mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
    echo "${now},${iso},${pct},${cur},${volt},${temp},${plug},${die_c},${mf},b1_conv5" >> "$FLIGHT"
    sleep 1
  done
) &
SPID=$!
wait $BPID; crc=$?
kill $SPID 2>/dev/null || true
set -e
cat "$CONV_OUT/stdout.txt" "$CONV_OUT/stderr.txt" > "$CONV_OUT/combo.txt"
log "conv5 rc=$crc"
# extract per-turn from BMOE_DONE
python3 - <<'PY' | tee -a "$MASTER"
import re,json
from pathlib import Path
text=Path.home().joinpath("experiments/results/calaqwen_s23/b1/conv5/combo.txt").read_text(encoding="utf-8",errors="replace")
dones=[]
for line in text.splitlines():
    if "BMOE_DONE" in line:
        i=line.find("{")
        if i>=0:
            try: dones.append(json.loads(line[i:]))
            except: pass
print("CONV5_DONES", len(dones))
for i,d in enumerate(dones,1):
    print(f"T{i} n_prompt={d.get('n_prompt')} n_past={d.get('n_past')} tok_s={d.get('tok_s')} tokens={d.get('tokens')}")
Path.home().joinpath("experiments/results/calaqwen_s23/b1/conv5/turns.json").write_text(json.dumps(dones,indent=2),encoding="utf-8")
PY

# B1.3 load cold x2
for rep in 1 2; do
  preflight 35 1 || true
  cold
  ptext=$(cat "$P_SHORT")
  run_with_flight "b1/load_r${rep}" "$BIN" -m "$MODEL" -p "$ptext" -n 16 "${FLAGS[@]}"
done

# idle post 30s
log "idle post 30s"
for i in $(seq 1 30); do
  now=$(date +%s); iso=$(date '+%Y-%m-%dT%H:%M:%S%z')
  bj=$(batt_json)
  eval "$(python3 -c "import json,sys
try:
 d=json.loads(sys.argv[1])
 print('pct=%s'%d.get('percentage',-1)); print('cur=%s'%d.get('current',0)); print('volt=%s'%d.get('voltage',0)); print('temp=%s'%d.get('temperature',-1)); print('plug=%s'%d.get('plugged','?'))
except: print('pct=-1');print('cur=0');print('volt=0');print('temp=-1');print('plug=?')" "$bj")"
  die_c=$(mc_to_c "$(max_die_mc)"); mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
  echo "${now},${iso},${pct},${cur},${volt},${temp},${plug},${die_c},${mf},idle_post" >> "$FLIGHT"
  sleep 1
done

# energy compute (methodology D)
python3 - <<'PY' | tee -a "$MASTER" | tee "$OUTDIR/b1/energy.txt"
import csv, statistics
from pathlib import Path
from collections import defaultdict
rows=[]
for line in Path.home().joinpath("experiments/results/calaqwen_s23/flight/flight_1s.csv").read_text(encoding="utf-8",errors="replace").splitlines()[1:]:
    p=line.split(",")
    if len(p)<10: continue
    try:
        rows.append(dict(ts=float(p[0]), pct=float(p[2]), cur=float(p[3]), volt=float(p[4]), phase=p[9], die=float(p[7])))
    except: pass
# discard pct==-1
rows=[r for r in rows if r["pct"]!=-1]
idle=[r for r in rows if r["phase"].startswith("idle")]
# current in uA (termux), voltage mV
I_idle = statistics.median([r["cur"] for r in idle]) if idle else 0
# energy per phase window that is b1 sos
phases=defaultdict(list)
for r in rows:
    phases[r["phase"]].append(r)
def energy_j(ph_rows, I_idle):
    if len(ph_rows)<2: return None, 0
    ph_rows=sorted(ph_rows, key=lambda x:x["ts"])
    E=0.0
    for a,b in zip(ph_rows, ph_rows[1:]):
        dt=b["ts"]-a["ts"]
        if dt<=0 or dt>5: continue
        # I in A: uA/1e6; V in V: mV/1000
        I=(a["cur"]-I_idle)/1e6
        V=a["volt"]/1000.0
        if I<0: I=0  # discharge only contribution
        E += I*V*dt
    return E, len(ph_rows)
print(f"I_idle_uA={I_idle}")
# n_gen from cells
import re
cells=Path.home().joinpath("experiments/results/calaqwen_s23/cells.csv").read_text(encoding="utf-8",errors="replace").splitlines()
# map label -> n_gen
ngen={}
for line in cells[1:]:
    p=line.split(",")
    if len(p)>6 and p[0]=="b1":
        try: ngen[p[1]]=int(float(p[6])) if p[6] else 0
        except: ngen[p[1]]=0
jtoks=[]
for lab, ph in [("sos_short_r1","b1/sos_short_r1"),("sos_short_r2","b1/sos_short_r2"),("sos_long_thermal","b1/sos_long_thermal")]:
    # flight phase is label without path in our writer — we used label as path b1/sos...
    key=lab if any(r["phase"]==lab for r in rows) else f"b1/{lab}" if any(r["phase"]==f"b1/{lab}" for r in rows) else None
    # our flight uses full label like b1/sos_short_r1
    cand=[k for k in {r["phase"] for r in rows} if lab in k or k.endswith(lab)]
    if not cand:
        print(f"{lab}: NO_FLIGHT")
        continue
    E,n=energy_j([r for r in rows if r["phase"]==cand[0]], I_idle)
    ng=ngen.get(f"b1/{lab}", ngen.get(lab,0))
    if E is None or ng<=0:
        print(f"{lab}: NON_MISURABILE E={E} n_gen={ng}")
    else:
        jt=E/ng
        jtoks.append(jt)
        print(f"{lab}: E_J={E:.3f} n_gen={ng} J_per_tok={jt:.4f}")
if jtoks:
    print(f"J_per_tok median={statistics.median(jtoks):.4f} range={min(jtoks):.4f}-{max(jtoks):.4f}")
else:
    print("J_per_tok: NON MISURABILE")
PY

batt_now=$(python3 -c "import json,subprocess;print(int(json.loads(subprocess.check_output(['termux-battery-status'])).get('percentage',0)))" 2>/dev/null || echo 0)
log "post-B1 batt=$batt_now"
B2_REPS=2
if [ "$batt_now" -lt 45 ] 2>/dev/null; then
  log "batt <45 → BLOCCO 2 at 1 rep"
  B2_REPS=1
fi

# ============== BLOCCO 2 N1 v2 ==============
BLOCK_TAG=b2
log "=== BLOCCO 2 N1 v2 reps=$B2_REPS ==="
# control one-shot decode t1
preflight 35 1 || true
ptext=$(cat "$P_SHORT")
run_with_flight "b2/ctrl_decode1" "$BIN" -m "$MODEL" -p "$ptext" -n 64 "${FLAGS[@]}"

# session k sweep
for k in 0 8 32 64 128 256; do
  for rep in $(seq 1 "$B2_REPS"); do
    preflight 30 1 || true
    cold
    # two-turn session: t1 short template, t2 = 'x '*k
    python3 - <<PY
import json
from pathlib import Path
k=$k
t2=("x "*k).rstrip() if k>0 else ""
# turn1 minimal
t1="Hi."
# session: clear_kv t1 only; t2 is the k-probe
lines=[
  json.dumps({"prompt": t1, "n_predict": 8, "clear_kv": True}),
  json.dumps({"prompt": t2 if t2 else " ", "n_predict": 8, "clear_kv": False}),
]
Path("$OUTDIR/b2/sess_k${k}_r${rep}.jsonl").write_text("\n".join(lines)+"\n", encoding="utf-8")
print("k",k,"t2_chars",len(t2))
PY
    out="$OUTDIR/b2/sess_k${k}_r${rep}"
    mkdir -p "$out"
    set +e
    "$BIN" -m "$MODEL" --session "${FLAGS[@]}" \
      < "$OUTDIR/b2/sess_k${k}_r${rep}.jsonl" > "$out/stdout.txt" 2> "$out/stderr.txt"
    rc=$?
    set -e
    cat "$out/stdout.txt" "$out/stderr.txt" > "$out/combo.txt"
    python3 - <<PY
import re,json
from pathlib import Path
text=Path("$out/combo.txt").read_text(encoding="utf-8",errors="replace")
dones=[]
for line in text.splitlines():
    if "BMOE_DONE" in line:
        i=line.find("{")
        if i>=0:
            try: dones.append(json.loads(line[i:]))
            except: pass
# t2 is last
d=dones[-1] if dones else {}
n_prompt=d.get("n_prompt")
# expected 14+k ±1 for t2
k=$k
exp=14+k
ok = n_prompt is not None and abs(int(n_prompt)-exp)<=1
status="OK" if ok else "SCARTATA"
# prefill time if present
prefill_s=d.get("prefill_s") or d.get("prompt_s")
# try parse from text
import re as _re
m=_re.search(r"prefill:\s*\d+\s+tokens,\s*([0-9.]+)\s*s", text)
if m: prefill_s=float(m.group(1))
# mib
mib=None
m2=_re.search(r"\(([0-9.]+)\s*MiB/token\)", text)
if m2: mib=float(m2.group(1))
row={"k":k,"rep":$rep,"n_prompt":n_prompt,"expected":exp,"status":status,"prefill_s":prefill_s,"mib_tok":mib,"rc":$rc,"n_dones":len(dones)}
Path("$out/meta.json").write_text(json.dumps(row,indent=2),encoding="utf-8")
print("N1", row)
# append cells
with open(Path.home()/"experiments/results/calaqwen_s23/cells.csv","a",encoding="utf-8") as f:
    f.write(f"b2,sess_k{k}_r{$rep},{$rc},,{''},{''},{d.get('tokens','')},{n_prompt},{d.get('n_past','')},,,,{''},{''},{''},,,{status} exp={exp}\n")
PY
    log "N1 k=$k rep=$rep done"
  done
done

# one-shot control ~128 tokens
preflight 30 1 || true
# build ~128 token-ish prompt by repeating
python3 - <<'PY'
from pathlib import Path
base=Path.home().joinpath("experiments/prompts/short.txt").read_text(encoding="utf-8",errors="replace")
# pad
pad=(" word"*200)
Path.home().joinpath("experiments/results/calaqwen_s23/b2/oneshot_prompt.txt").write_text(base+"\n"+pad,encoding="utf-8")
PY
p128=$(cat "$OUTDIR/b2/oneshot_prompt.txt")
run_with_flight "b2/oneshot_p128" "$BIN" -m "$MODEL" -p "$p128" -n 32 "${FLAGS[@]}"

# fit N1
python3 - <<'PY' | tee -a "$MASTER" | tee "$OUTDIR/b2/n1_fit.txt"
import json, statistics
from pathlib import Path
import math
rows=[]
root=Path.home()/"experiments/results/calaqwen_s23/b2"
for meta in root.glob("sess_k*_r*/meta.json"):
    d=json.loads(meta.read_text(encoding="utf-8"))
    if d.get("status")!="OK": continue
    if d.get("prefill_s") is None or d.get("n_prompt") is None: continue
    rows.append((float(d["n_prompt"]), float(d["prefill_s"]), d["k"]))
print("N1_OK_ROWS", len(rows), rows)
if len(rows)<3:
    print("FIT: INSUFFICIENT_DATA")
else:
    # linear least squares t = F + m*n
    n=len(rows)
    sx=sum(x for x,_,__ in rows); sy=sum(y for _,y,__ in rows)
    sxx=sum(x*x for x,_,__ in rows); sxy=sum(x*y for x,y,__ in rows)
    den=n*sxx-sx*sx
    m=(n*sxy-sx*sy)/den if den else float("nan")
    F=(sy-m*sx)/n if n else float("nan")
    # R^2
    yhat=[F+m*x for x,_,__ in rows]
    ybar=sy/n
    ss_tot=sum((y-ybar)**2 for _,y,__ in rows)
    ss_res=sum((y-yh)**2 for (_,y,__),yh in zip(rows,yhat))
    r2=1-ss_res/ss_tot if ss_tot else float("nan")
    print(f"FIT F={F:.4f}s m={m:.6f}s/tok R2={r2:.4f}")
    # t_decode1 from cells
    # crude: from ctrl_decode1 tok_s
    print("NOTE compare m <= 0.3 * t_decode1 (t_decode1 from ctrl cell wall/n_gen)")
Path.home().joinpath("experiments/results/calaqwen_s23/b2/fit.json").write_text(
    json.dumps({"rows":rows,"F":F if len(rows)>=3 else None,"m":m if len(rows)>=3 else None,"R2":r2 if len(rows)>=3 else None},indent=2),
    encoding="utf-8")
PY

# ============== BLOCCO 3 cache bracket ==============
BLOCK_TAG=b3
log "=== BLOCCO 3 cache bracket ==="
# interleaved: 2000→1500→2000→1750→2000→2300 ; 2 rep where possible
# store as list of (cache_mb, rep_tag)
seq=(2000 1500 2000 1750 2000 2300)
declare -A repc
for cmb in "${seq[@]}"; do
  repc[$cmb]=$((${repc[$cmb]:-0}+1))
  r=${repc[$cmb]}
  preflight 30 1 || true
  # special: if batt low skip 2300 retries already handled
  ptext=$(cat "$P_F45")
  # override cache-mb in flags
  local_flags=(--moe-stream --cache-mb "$cmb" --dense-weights anon --overlap --io-threads 4 --ubatch 512
    --n-expert-used 6 --drop-cold-experts 0.65 --temp 0 --chatml --no-think -t 4 -c 4096)
  lab="b3/C${cmb}_r${r}"
  rc=$(run_with_flight "$lab" "$BIN" -m "$MODEL" -p "$ptext" -n 200 "${local_flags[@]}") || rc=$?
  # cite rule n_gen>=100
  n_gen=$(python3 -c "import csv; 
rows=list(csv.DictReader(open('$CELLS')));
print(next((r['n_gen'] for r in reversed(rows) if r['label']=='$lab'),''))" 2>/dev/null || echo "")
  if [ -n "$n_gen" ] && [ "$n_gen" -lt 100 ] 2>/dev/null; then
    log "NO_DATA $lab n_gen=$n_gen"
  fi
  # control 2000 abort retry once after cool
  if [ "$cmb" = "2000" ] && [ "${rc:-0}" -ne 0 ]; then
    log "C2000 abort rc=$rc — cool and 1 retry"
    sleep 20
    preflight 30 1 || true
    run_with_flight "b3/C2000_retry" "$BIN" -m "$MODEL" -p "$ptext" -n 200 "${local_flags[@]}" || true
  fi
done

# final idle energy note already in b1
log "=== CALAQWEN ALL BLOCKS DONE ==="
echo "DONE" > "$STATUS"
cat "$CELLS" | tee -a "$MASTER"
restore_screen
log "screen restored"
exit 0
