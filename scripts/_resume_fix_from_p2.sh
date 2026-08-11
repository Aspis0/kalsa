#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export HOME=/data/data/com.termux/files/home
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
export TMPDIR=$PREFIX/tmp
export LC_ALL=C
OUTDIR=$HOME/experiments/results/calaqwen_s23/fix
MASTER=$OUTDIR/FIX.master.log
log(){ echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] $*" | tee -a "$MASTER"; }
python3 - <<'PY'
import json
from pathlib import Path
out=Path.home()/"experiments/results/calaqwen_s23/fix/smoke"
def dones(p):
    text=p.read_text(encoding="utf-8",errors="replace")
    d=[]
    for line in text.splitlines():
        if "BMOE_DONE" not in line: continue
        i=line.find("{")
        if i<0: continue
        try: d.append(json.loads(line[i:]))
        except: pass
    return d
b=dones(out/"broken.combo.txt")
f=dones(out/"fixed.combo.txt")
(out/"broken_dones.json").write_text(json.dumps(b),encoding="utf-8")
(out/"fixed_dones.json").write_text(json.dumps(f),encoding="utf-8")
by={int(d.get("id") or 0):d for d in f}
t1,t2=by.get(1,{}),by.get(2,{})
n1past=t1.get("n_past"); n2past=t2.get("n_past"); n2p=t2.get("n_prompt")
try:
    n2c=max(int(t2.get("n_past") or 0)-int(t2.get("n_prompt") or 0)-int(t2.get("tokens") or 0),0)
except Exception:
    n2c=-1
if t2.get("n_common") is not None: n2c=int(t2["n_common"])
verdict="PASS" if len(f)>=2 and (n1past==71 or n2c==71 or (n1past and n2past and int(n2past)>int(n1past))) else "FAIL"
summary={"bug":"JSONL missing cmd/generate/id/think/close; parser heredoc ate stdin so fixed looked like 0 dones","broken_dones":len(b),"fixed_dones":len(f),"t1_n_past":n1past,"t2_n_past":n2past,"t2_n_prompt":n2p,"t2_n_common":n2c,"verdict":verdict}
(out/"smoke_summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
(out/"STATUS_SMOKE.txt").write_text(f"DONE {verdict} broken_dones={len(b)} fixed_dones={len(f)} t1_n_past={n1past} t2_n_common={n2c}\n",encoding="utf-8")
print(json.dumps(summary,indent=2))
if verdict!="PASS" and verdict!="PASS_SOFT":
    raise SystemExit(2)
PY
log "PASSO1 reparsed $(cat $OUTDIR/smoke/STATUS_SMOKE.txt)"
# Build continuation script from main: everything before PASSO1 + skip + from PASSO2
python3 - <<'PY'
from pathlib import Path
src=Path.home()/"experiments/scripts/run_calaqwen_fix_session.sh"
text=src.read_text(encoding="utf-8").replace("\r\n","\n")
j=text.find("=== PASSO 1")
start2=text.find('log "=== PASSO 2')
if start2<0:
    start2=text.find("=== PASSO 2")
body=text[:j]+'log "PASSO1 already PASS ? continue from PASSO2"\n'+text[start2:]
Path("/tmp/run_calaqwen_fix_cont.sh").write_text(body,encoding="utf-8")
print("cont bytes", len(body))
PY
chmod +x /tmp/run_calaqwen_fix_cont.sh
echo RUNNING > $OUTDIR/STATUS.txt
nohup bash /tmp/run_calaqwen_fix_cont.sh >>$OUTDIR/nohup.out 2>&1 &
echo $! > $OUTDIR/fix.pid
sleep 2
echo PID=$(cat $OUTDIR/fix.pid)
ps -p $(cat $OUTDIR/fix.pid) >/dev/null && echo ALIVE || echo DEAD
tail -12 $OUTDIR/FIX.master.log
