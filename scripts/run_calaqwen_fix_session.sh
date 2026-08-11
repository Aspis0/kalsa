#!/data/data/com.termux/files/usr/bin/bash
# Mandate calaqwen-fix-session.md — fix --session + recover conv5 + N1 v2 + energy sign.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/calaqwen_s23/fix}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
P_SHORT="${P_SHORT:-$HOME/experiments/prompts/short.txt}"
P_TDIR="${P_TDIR:-$HOME/experiments/prompts}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

mkdir -p "$OUTDIR"/{smoke,conv5,n1,energy}
MASTER="$OUTDIR/FIX.master.log"
STATUS="$OUTDIR/STATUS.txt"
: > "$MASTER"
echo "RUNNING" > "$STATUS"

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*" | tee -a "$MASTER"; }

# pin
if [ -f "$HOME/experiments/scripts/lib_campaign_pin.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/experiments/scripts/lib_campaign_pin.sh"
  assert_campaign_pin "$BIN"
else
  exp=$(awk 'NF{print $1; exit}' "$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256")
  got=$(sha256sum "$BIN" | awk '{print $1}')
  [ "$got" = "$exp" ] || { log "PIN FAIL"; echo "FAIL_PIN" > "$STATUS"; exit 6; }
  BIN_SHA256="$got"
fi
# shellcheck disable=SC1090
source "$HOME/experiments/scripts/lib_guardrails.sh" 2>/dev/null || true

FLAGS=(--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512
  --n-expert-used 6 --drop-cold-experts 0.65 --temp 0 --chatml --no-think -t 4 -c 4096)

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

cold(){
  if [ -x "$HOME/bin/cold_model.sh" ]; then "$HOME/bin/cold_model.sh" "$MODEL" || true
  elif command -v fadv >/dev/null 2>&1; then fadv --dontneed "$MODEL" 2>/dev/null || true
  fi
}

preflight(){
  local floor="${1:-50}" need_unplugged="${2:-1}"
  for i in $(seq 1 40); do
    bj=$(batt_json)
    plug=$(python3 -c "import json,sys;print(json.loads(sys.argv[1]).get('plugged','?'))" "$bj" 2>/dev/null || echo "?")
    pct=$(python3 -c "import json,sys;print(int(json.loads(sys.argv[1]).get('percentage',0)))" "$bj" 2>/dev/null || echo 0)
    die=$(max_die_mc); n=$(nproc)
    log "preflight i=$i plugged=$plug batt=$pct die=$(mc_to_c "$die") nproc=$n"
    if [ "$need_unplugged" = "1" ] && ! echo "$plug" | grep -qi UNPLUGGED; then sleep 15; continue; fi
    if [ "$pct" -lt "$floor" ] 2>/dev/null; then sleep 20; continue; fi
    if [ "$n" -lt 6 ] 2>/dev/null; then
      termux-wake-lock >/dev/null 2>&1 || true
      /system/bin/am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1 || true
      sleep 10; continue
    fi
    if [ "$die" -gt 80000 ] 2>/dev/null; then sleep 15; continue; fi
    return 0
  done
  return 1
}

parse_dones(){
  # arg1: path to combo text; stdout: JSON array of BMOE_DONE objects
  # Use env (not argv+stdin) so heredoc can provide the program.
  COMBO_PATH="$1" python3 <<'PY'
import json, os
from pathlib import Path
text = Path(os.environ["COMBO_PATH"]).read_text(encoding="utf-8", errors="replace")
dones=[]
for line in text.splitlines():
    if "BMOE_DONE" not in line: continue
    i=line.find("{")
    if i<0: continue
    try: dones.append(json.loads(line[i:]))
    except Exception: pass
print(json.dumps(dones))
PY
}

# ============== PASSO 1: reproduce bug then fixed smoke ==============
log "=== PASSO 1 diagnosis smoke ==="
log "BUG_LINE: broken JSONL lacked cmd=generate,id,think=false and trailing {cmd:close}; known-good uses those fields (run_kv_session_kexp.sh / adopt_dropcold conv5_in.jsonl)"

# 1a broken format (2 turns) — expect 0 dones
BROKEN="$OUTDIR/smoke/broken_in.jsonl"
cat > "$BROKEN" <<'JSONL'
{"prompt": "Spiega in tre frasi cos e la memoria KV in un transformer. Rispondi in italiano, max 80 parole.", "n_predict": 32, "clear_kv": true}
{"prompt": "Spiega in tre frasi cos e la memoria KV in un transformer. Rispondi in italiano, max 80 parole.", "n_predict": 32, "clear_kv": false}
JSONL
cold
set +e
"$BIN" -m "$MODEL" "${FLAGS[@]}" --session < "$BROKEN" \
  > "$OUTDIR/smoke/broken.stdout" 2> "$OUTDIR/smoke/broken.stderr"
brc=$?
set -e
cat "$OUTDIR/smoke/broken.stdout" "$OUTDIR/smoke/broken.stderr" > "$OUTDIR/smoke/broken.combo.txt"
bdones=$(parse_dones "$OUTDIR/smoke/broken.combo.txt")
blog="broken rc=$brc dones=$(python3 -c "import json,sys;print(len(json.loads(sys.argv[1])))" "$bdones")"
log "$blog"
printf '%s\n' "$bdones" > "$OUTDIR/smoke/broken_dones.json"

# 1b fixed format (gold 2-turn)
FIXED="$OUTDIR/smoke/fixed_in.jsonl"
cat > "$FIXED" <<'JSONL'
{"cmd": "generate", "prompt": "Spiega in tre frasi cos e la memoria KV in un transformer. Rispondi in italiano, max 80 parole.", "id": 1, "n_predict": 32, "clear_kv": true, "think": false}
{"cmd": "generate", "prompt": "Spiega in tre frasi cos e la memoria KV in un transformer. Rispondi in italiano, max 80 parole.", "id": 2, "n_predict": 32, "clear_kv": false, "think": false}
{"cmd": "close"}
JSONL
cold
set +e
"$BIN" -m "$MODEL" "${FLAGS[@]}" --session < "$FIXED" \
  > "$OUTDIR/smoke/fixed.stdout" 2> "$OUTDIR/smoke/fixed.stderr"
frc=$?
set -e
cat "$OUTDIR/smoke/fixed.stdout" "$OUTDIR/smoke/fixed.stderr" > "$OUTDIR/smoke/fixed.combo.txt"
fdones=$(parse_dones "$OUTDIR/smoke/fixed.combo.txt")
printf '%s\n' "$fdones" > "$OUTDIR/smoke/fixed_dones.json"
python3 - <<PY | tee -a "$MASTER" | tee "$OUTDIR/smoke/smoke_summary.json"
import json
from pathlib import Path
out=Path("$OUTDIR/smoke")
broken=json.loads((out/"broken_dones.json").read_text())
fixed=json.loads((out/"fixed_dones.json").read_text())
by={int(d.get("id") or 0):d for d in fixed}
t1,t2=by.get(1,{}),by.get(2,{})
n1past=t1.get("n_past"); n2past=t2.get("n_past"); n2p=t2.get("n_prompt")
# n_common approx
def nc(o):
    if o.get("n_common") is not None: return int(o["n_common"])
    try: return max(int(o.get("n_past") or 0)-int(o.get("n_prompt") or 0)-int(o.get("tokens") or 0),0)
    except: return -1
n2c=nc(t2)
verdict="FAIL"
if len(fixed)>=2 and (n2c==71 or (n1past==71 and n2past and int(n2past)>int(n1past or 0))):
    verdict="PASS"
elif len(fixed)>=2:
    verdict="PASS_SOFT"
summary={
  "bug":"JSONL missing cmd=generate,id,think=false and trailing cmd=close",
  "broken_dones":len(broken),"fixed_dones":len(fixed),
  "t1_n_past":n1past,"t2_n_past":n2past,"t2_n_prompt":n2p,"t2_n_common":n2c,
  "verdict":verdict,"broken_rc":$brc,"fixed_rc":$frc
}
print(json.dumps(summary,indent=2))
(out/"STATUS_SMOKE.txt").write_text(f"DONE {verdict} broken_dones={len(broken)} fixed_dones={len(fixed)} t2_n_common={n2c}\n")
if verdict=="FAIL":
    raise SystemExit(2)
PY
log "PASSO1 smoke $(cat $OUTDIR/smoke/STATUS_SMOKE.txt)"

# ============== PASSO 2 conv5 (staccato >=50) ==============
log "=== PASSO 2 conv5 ==="
preflight 50 1 || { log "preflight FAIL conv5"; echo "FAIL_PREFLIGHT_CONV5" > "$STATUS"; exit 3; }
termux-wake-lock >/dev/null 2>&1 || true
# build JSONL from f5_1_t* or adopt gold prompts
python3 - <<'PY'
import json
from pathlib import Path
pdir=Path.home()/"experiments/prompts"
out=Path.home()/"experiments/results/calaqwen_s23/fix/conv5/conv5_in.jsonl"
out.parent.mkdir(parents=True, exist_ok=True)
# prefer adopt gold text if present on device
gold=Path.home()/"experiments/results/adopt_dropcold/conv5/conv5_in.jsonl"
if gold.exists():
    # rewrite with same prompts but ensure format
    lines=[]
    for line in gold.read_text(encoding="utf-8",errors="replace").splitlines():
        if not line.strip(): continue
        o=json.loads(line)
        if o.get("cmd")=="close":
            lines.append(o); continue
        lines.append({
            "cmd":"generate",
            "prompt":o["prompt"],
            "id":int(o.get("id") or len(lines)+1),
            "n_predict":int(o.get("n_predict") or 256),
            "clear_kv":bool(o.get("clear_kv", False)),
            "think":False,
        })
    if not any(x.get("cmd")=="close" for x in lines):
        lines.append({"cmd":"close"})
    out.write_text("\n".join(json.dumps(x,ensure_ascii=False) for x in lines)+"\n",encoding="utf-8")
    print("using adopt gold", len(lines))
else:
    turns=[]
    for i in range(1,6):
        f=pdir/f"f5_1_t{i}.txt"
        if f.exists():
            turns.append(f.read_text(encoding="utf-8",errors="replace").strip())
        else:
            turns.append(f"Turn {i}: briefly explain MoE streaming in Italian, max 80 words.")
    lines=[]
    for i,t in enumerate(turns,1):
        lines.append({"cmd":"generate","prompt":t,"id":i,"n_predict":256,"clear_kv":(i==1),"think":False})
    lines.append({"cmd":"close"})
    out.write_text("\n".join(json.dumps(x,ensure_ascii=False) for x in lines)+"\n",encoding="utf-8")
    print("using f5 prompts", len(turns))
PY
sha256sum "$OUTDIR/conv5/conv5_in.jsonl" | tee -a "$MASTER"
cold
set +e
"$BIN" -m "$MODEL" "${FLAGS[@]}" --session \
  < "$OUTDIR/conv5/conv5_in.jsonl" \
  > "$OUTDIR/conv5/stdout.txt" 2> "$OUTDIR/conv5/stderr.txt"
crc=$?
set -e
cat "$OUTDIR/conv5/stdout.txt" "$OUTDIR/conv5/stderr.txt" > "$OUTDIR/conv5/combo.txt"
python3 - <<'PY' | tee -a "$MASTER" | tee "$OUTDIR/conv5/turns_table.txt"
import json, re
from pathlib import Path
out=Path.home()/"experiments/results/calaqwen_s23/fix/conv5"
text=(out/"combo.txt").read_text(encoding="utf-8",errors="replace")
dones=[]
for line in text.splitlines():
    if "BMOE_DONE" not in line: continue
    i=line.find("{")
    if i<0: continue
    try: dones.append(json.loads(line[i:]))
    except: pass
# also parse prefill times from text in order
prefs=re.findall(r"prefill:\s*(\d+)\s+tokens,\s*([0-9.]+)\s*s\s*\(([0-9.]+)\s*tok/s\)", text)
rows=[]
for idx,d in enumerate(dones):
    prefill_s=None; prefill_tps=None; n_prompt_txt=None
    if idx < len(prefs):
        n_prompt_txt, prefill_s, prefill_tps = int(prefs[idx][0]), float(prefs[idx][1]), float(prefs[idx][2])
    rows.append({
        "turn": d.get("id") or (idx+1),
        "n_prompt": d.get("n_prompt") or n_prompt_txt,
        "n_past": d.get("n_past"),
        "tokens": d.get("tokens"),
        "tok_s": d.get("tok_s"),
        "prefill_s": prefill_s,
        "prefill_tps": prefill_tps,
    })
(out/"turns.json").write_text(json.dumps(rows,indent=2),encoding="utf-8")
print("CONV5_TURNS", len(rows))
print("turn\tn_prompt\tn_past\tprefill_s\ttok_s\ttokens")
for r in rows:
    print(f"{r['turn']}\t{r['n_prompt']}\t{r['n_past']}\t{r['prefill_s']}\t{r['tok_s']}\t{r['tokens']}")
if len(rows)<5:
    raise SystemExit(4)
PY
log "conv5 rc=$crc turns ok"

# ============== PASSO 3 N1 v2 ==============
log "=== PASSO 3 N1 v2 ==="
preflight 40 1 || { log "preflight FAIL n1"; echo "FAIL_PREFLIGHT_N1" > "$STATUS"; exit 3; }
# t_decode1 control
cold
ptext=$(cat "$P_SHORT")
set +e
"$BIN" -m "$MODEL" -p "$ptext" -n 64 "${FLAGS[@]}" \
  > "$OUTDIR/n1/ctrl_decode1.stdout" 2> "$OUTDIR/n1/ctrl_decode1.stderr"
set -e
cat "$OUTDIR/n1/ctrl_decode1.stdout" "$OUTDIR/n1/ctrl_decode1.stderr" > "$OUTDIR/n1/ctrl_decode1.combo.txt"
python3 - <<'PY'
import re,json
from pathlib import Path
t=Path.home().joinpath("experiments/results/calaqwen_s23/fix/n1/ctrl_decode1.combo.txt").read_text(encoding="utf-8",errors="replace")
tok=None; ngen=None
m=re.search(r"generation:\s*(\d+)\s+tokens,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)", t)
if m: ngen=int(m.group(1)); tok=float(m.group(2))
for line in t.splitlines():
    if "BMOE_DONE" in line:
        i=line.find("{")
        if i>=0:
            try:
                j=json.loads(line[i:])
                if j.get("tok_s") is not None: tok=float(j["tok_s"])
                if j.get("tokens") is not None: ngen=int(j["tokens"])
            except: pass
t1 = (1.0/tok) if tok else None
Path.home().joinpath("experiments/results/calaqwen_s23/fix/n1/ctrl_decode1.json").write_text(
    json.dumps({"tok_s":tok,"n_gen":ngen,"t_decode1_s":t1},indent=2),encoding="utf-8")
print("ctrl", tok, ngen, t1)
PY

# k sweep
for k in 0 8 32 64 128 256; do
  for rep in 1 2; do
    preflight 30 1 || true
    cold
    python3 - <<PY
import json
from pathlib import Path
k=$k; rep=$rep
t2=("x "*k).rstrip() if k>0 else " "
# t1 minimal chat turn
t1="Hi."
lines=[
  {"cmd":"generate","prompt":t1,"id":1,"n_predict":8,"clear_kv":True,"think":False},
  {"cmd":"generate","prompt":t2,"id":2,"n_predict":8,"clear_kv":False,"think":False},
  {"cmd":"close"},
]
p=Path.home()/f"experiments/results/calaqwen_s23/fix/n1/sess_k{k}_r{rep}.jsonl"
p.write_text("\n".join(json.dumps(x) for x in lines)+"\n",encoding="utf-8")
print("wrote", p, "t2_len", len(t2))
PY
    outd="$OUTDIR/n1/sess_k${k}_r${rep}"
    mkdir -p "$outd"
    set +e
    "$BIN" -m "$MODEL" "${FLAGS[@]}" --session \
      < "$OUTDIR/n1/sess_k${k}_r${rep}.jsonl" \
      > "$outd/stdout.txt" 2> "$outd/stderr.txt"
    rc=$?
    set -e
    cat "$outd/stdout.txt" "$outd/stderr.txt" > "$outd/combo.txt"
    python3 - <<PY
import json, re
from pathlib import Path
k=$k; rep=$rep; rc=$rc
outd=Path.home()/f"experiments/results/calaqwen_s23/fix/n1/sess_k{k}_r{rep}"
text=(outd/"combo.txt").read_text(encoding="utf-8",errors="replace")
dones=[]
for line in text.splitlines():
    if "BMOE_DONE" not in line: continue
    i=line.find("{")
    if i<0: continue
    try: dones.append(json.loads(line[i:]))
    except: pass
# prefer id==2
by={int(d.get("id") or 0):d for d in dones}
d=by.get(2) or (dones[-1] if dones else {})
n_prompt=d.get("n_prompt")
# prefill for last generate from text
prefs=re.findall(r"prefill:\s*(\d+)\s+tokens,\s*([0-9.]+)\s*s\s*\(([0-9.]+)\s*tok/s\)", text)
prefill_s=float(prefs[-1][1]) if prefs else None
mib=None
m=re.search(r"\(([0-9.]+)\s*MiB/token\)", text)
if m: mib=float(m.group(1))
exp=14+k
ok = n_prompt is not None and abs(int(n_prompt)-exp)<=1
status="OK" if ok else "SCARTATA"
row={"k":k,"rep":rep,"n_prompt":n_prompt,"expected":exp,"status":status,
     "prefill_s":prefill_s,"mib_tok":mib,"rc":rc,"n_dones":len(dones),"t2":d}
(outd/"meta.json").write_text(json.dumps(row,indent=2),encoding="utf-8")
print("N1", row["status"], "k",k,"n_prompt",n_prompt,"exp",exp,"prefill_s",prefill_s,"dones",len(dones))
PY
    log "N1 k=$k rep=$rep done"
  done
done

# oneshot ~128
cold
python3 - <<'PY'
from pathlib import Path
base=Path.home().joinpath("experiments/prompts/short.txt").read_text(encoding="utf-8",errors="replace")
Path.home().joinpath("experiments/results/calaqwen_s23/fix/n1/oneshot_prompt.txt").write_text(base+"\n"+(" word"*200),encoding="utf-8")
PY
p128=$(cat "$OUTDIR/n1/oneshot_prompt.txt")
set +e
"$BIN" -m "$MODEL" -p "$p128" -n 32 "${FLAGS[@]}" \
  > "$OUTDIR/n1/oneshot.stdout" 2> "$OUTDIR/n1/oneshot.stderr"
set -e
cat "$OUTDIR/n1/oneshot.stdout" "$OUTDIR/n1/oneshot.stderr" > "$OUTDIR/n1/oneshot.combo.txt"

# fit
python3 - <<'PY' | tee -a "$MASTER" | tee "$OUTDIR/n1/n1_fit.txt"
import json, math
from pathlib import Path
root=Path.home()/"experiments/results/calaqwen_s23/fix/n1"
rows=[]
for meta in sorted(root.glob("sess_k*_r*/meta.json")):
    d=json.loads(meta.read_text(encoding="utf-8"))
    if d.get("status")!="OK": continue
    if d.get("prefill_s") is None or d.get("n_prompt") is None: continue
    rows.append((float(d["n_prompt"]), float(d["prefill_s"]), int(d["k"]), int(d["rep"])))
print("N1_OK_ROWS", len(rows))
for r in rows:
    print("row", r)
ctrl=json.loads((root/"ctrl_decode1.json").read_text())
t1=ctrl.get("t_decode1_s")
print("t_decode1_s", t1, "tok_s", ctrl.get("tok_s"))
fit={"rows":[{"n_prompt":a,"prefill_s":b,"k":k,"rep":r} for a,b,k,r in rows],
     "t_decode1_s":t1,"tok_s":ctrl.get("tok_s")}
if len(rows)<3:
    fit.update({"F":None,"m":None,"R2":None,"verdict":"INSUFFICIENT_DATA"})
    print("FIT: INSUFFICIENT_DATA")
else:
    n=len(rows)
    sx=sum(x for x,_,_,__ in rows); sy=sum(y for _,y,_,__ in rows)
    sxx=sum(x*x for x,_,_,__ in rows); sxy=sum(x*y for x,y,_,__ in rows)
    den=n*sxx-sx*sx
    m=(n*sxy-sx*sy)/den if den else float("nan")
    F=(sy-m*sx)/n
    yhat=[F+m*x for x,_,_,__ in rows]
    ybar=sy/n
    ss_tot=sum((y-ybar)**2 for _,y,_,__ in rows) or 1.0
    ss_res=sum((y-yh)**2 for (_,y,_,__),yh in zip(rows,yhat))
    r2=1-ss_res/ss_tot
    # rough SE for m
    s_yx=math.sqrt(ss_res/max(n-2,1))
    se_m=s_yx/math.sqrt(sxx-sx*sx/n) if (sxx-sx*sx/n)>0 else float("nan")
    # 95% IC approx
    ic_lo, ic_hi = m-1.96*se_m, m+1.96*se_m
    thr = 0.3*t1 if t1 else None
    ammortizza = (thr is not None and m <= thr)
    # F(0) large stable: F >> m* typical
    verdict="OPEN_MTP" if (F>0.5 and ammortizza) else "EPITAPH_OR_MIXED"
    if thr is not None and m > thr:
        verdict="EPITAPH_SPEC"
    elif F>0.5 and ammortizza:
        verdict="OPEN_MTP_SPEC"
    else:
        verdict="INCONCLUSIVE"
    fit.update({"F":F,"m":m,"R2":r2,"se_m":se_m,"m_ic95":[ic_lo,ic_hi],"threshold_0.3_t1":thr,
                "ammortizza":ammortizza,"verdict":verdict})
    print(f"FIT F={F:.4f}s m={m:.6f}s/tok R2={r2:.4f} se_m={se_m:.6f} IC95=[{ic_lo:.6f},{ic_hi:.6f}]")
    print(f"threshold 0.3*t1={thr} ammortizza={ammortizza} verdict={verdict}")
(root/"fit.json").write_text(json.dumps(fit,indent=2),encoding="utf-8")
# table
print("k\tn_prompt\tprefill_s\tmib_tok\tstatus")
for meta in sorted(root.glob("sess_k*_r*/meta.json")):
    d=json.loads(meta.read_text(encoding="utf-8"))
    print(f"{d['k']}\t{d.get('n_prompt')}\t{d.get('prefill_s')}\t{d.get('mib_tok')}\t{d['status']}")
PY

# ============== PASSO 4 energy sign ==============
log "=== PASSO 4 energy sign ==="
# 30s idle unplugged + 30s if plugged else note
python3 - <<'PY' | tee -a "$MASTER" | tee "$OUTDIR/energy/sign_validation.txt"
import json, subprocess, time, statistics
from pathlib import Path

def sample(n=30, tag=""):
    rows=[]
    for i in range(n):
        try:
            d=json.loads(subprocess.check_output(["termux-battery-status"], timeout=5))
        except Exception as e:
            d={"error":str(e)}
        rows.append({
            "i":i,
            "plugged":d.get("plugged"),
            "pct":d.get("percentage"),
            "current":d.get("current"),
            "voltage":d.get("voltage"),
            "temp":d.get("temperature"),
            "tag":tag,
        })
        time.sleep(1)
    return rows

out=Path.home()/"experiments/results/calaqwen_s23/fix/energy"
out.mkdir(parents=True, exist_ok=True)
# first sample whatever state now
r1=sample(30, "state_now")
(out/"idle_state_now.json").write_text(json.dumps(r1,indent=2),encoding="utf-8")
curs=[x["current"] for x in r1 if x.get("current") is not None]
plug=r1[0].get("plugged") if r1 else "?"
med=statistics.median(curs) if curs else None
print(f"STATE_NOW plugged={plug} current_median_uA={med} n={len(curs)}")
print(f"sign_now={'NEG_discharge' if (med is not None and med<0) else 'POS_charge_or_zero' if med is not None else 'NA'}")

# If currently unplugged, we have staccato idle. For charge sample, ask device if already plugged mid-way:
# try second 30s only if plugged changes; else write NEED_BOTH_STATES
r2=[]
if plug and "UNPLUGGED" not in str(plug).upper():
    r2=sample(30, "plugged")
    (out/"idle_plugged.json").write_text(json.dumps(r2,indent=2),encoding="utf-8")
else:
    # wait up to 3 min for user/auto plug? overnight: just record unplugged and use abs convention
    print("NOTE: only UNPLUGGED idle captured this run; charge sample optional")
    (out/"idle_unplugged.json").write_text(json.dumps(r1,indent=2),encoding="utf-8")

# Recompute scheda J/token with |I - I_idle| discharge-only convention
# Load prior flight if present
flight=Path.home()/"experiments/results/calaqwen_s23/flight/flight_1s.csv"
cells=Path.home()/"experiments/results/calaqwen_s23/cells.csv"
if flight.exists() and cells.exists():
    import csv
    rows=[]
    for line in flight.read_text(encoding="utf-8",errors="replace").splitlines()[1:]:
        p=line.split(",")
        if len(p)<10: continue
        try:
            rows.append(dict(ts=float(p[0]),pct=float(p[2]),cur=float(p[3]),volt=float(p[4]),phase=p[9]))
        except: pass
    idle=[r for r in rows if r["phase"].startswith("idle")]
    I_idle=statistics.median([r["cur"] for r in idle]) if idle else (med or 0)
    # convention A: I_dis = max(0, I_idle - I) if both negative discharge more negative means more draw
    # termux: current <0 means discharging; more negative = higher draw
    def I_draw_uA(cur, I_idle):
        # draw magnitude relative to idle: if cur more negative than idle, positive draw
        return max(0.0, (I_idle - cur))  # both typically negative: idle=-0.4A, load=-0.7A -> draw=0.3A
    ngen={}
    for row in csv.DictReader(cells.open(encoding="utf-8")):
        if row.get("block")=="b1" and row.get("n_gen"):
            try: ngen[row["label"]]=int(float(row["n_gen"]))
            except: pass
    print(f"RECALC I_idle_uA={I_idle}")
    jtoks=[]
    for lab in ["b1/sos_short_r1","b1/sos_short_r2","b1/sos_long_thermal"]:
        ph=[r for r in rows if r["phase"]==lab or r["phase"].endswith(lab.split("/")[-1])]
        # phase labels were like b1/sos_short_r1
        ph=[r for r in rows if lab in r["phase"] or r["phase"]==lab]
        if len(ph)<2:
            print(lab, "NO_FLIGHT"); continue
        ph=sorted(ph,key=lambda x:x["ts"])
        E=0.0
        for a,b in zip(ph,ph[1:]):
            dt=b["ts"]-a["ts"]
            if dt<=0 or dt>5: continue
            I=I_draw_uA(a["cur"], I_idle)/1e6
            V=a["volt"]/1000.0
            E+=I*V*dt
        ng=ngen.get(lab,0)
        if ng<=0: print(lab,"NO_NGEN"); continue
        jt=E/ng
        jtoks.append(jt)
        print(f"{lab}: E_J={E:.3f} n_gen={ng} J_per_tok={jt:.4f}")
    if jtoks:
        import statistics as st
        print(f"J_per_tok_recalc median={st.median(jtoks):.4f} range={min(jtoks):.4f}-{max(jtoks):.4f}")
        old=0.4547
        med=st.median(jtoks)
        delta=abs(med-old)/old*100
        print(f"vs_scheda_old={old} delta_pct={delta:.1f} {'CORRECT_SHEET' if delta>15 else 'KEEP_SHEET'}")
else:
    print("no prior flight/cells for recalc")
PY

log "=== ALL FIX STEPS DONE ==="
echo "DONE" > "$STATUS"
cat "$OUTDIR/smoke/STATUS_SMOKE.txt" | tee -a "$MASTER"
termux-wake-unlock >/dev/null 2>&1 || true
exit 0
