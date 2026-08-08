#!/data/data/com.termux/files/usr/bin/bash
# F5.5-A PPL baseline via 2 sequential halves
# Workaround: bmoe-cli process gets SIGKILL (~rc 137) around 45k scored tokens / ~2h
# whether cache-mb is 2000 or 0. Split is paragraph-aligned mid-file; combine sum_logprob.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/f5.5/a}"
SPLITDIR="$OUTDIR/split"
CORPUS="${CORPUS:-$HOME/experiments/quality/corpus_it/mixed_it.txt}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli}"
MODEL="${MODEL:-$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf}"
export LD_LIBRARY_PATH="$(dirname "$BIN")"
mkdir -p "$OUTDIR" "$SPLITDIR"
MASTER="$OUTDIR/ppl_baseline.master.log"
STATUS="$OUTDIR/STATUS_PPL.txt"
JSON="$OUTDIR/ppl_baseline.json"
COMBINED_CSV="$OUTDIR/ppl_baseline.per_token.csv"

THREADS=4
CACHE_MB=0
IO_THREADS=4
N_CTX=4096
UBATCH=512
BASE="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${UBATCH}"
DIE_STOP_MC=95000
DIE_START_MC=80000

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

wait_prestart(){
  local die_mc die_c n
  while :; do
    die_mc=$(max_die_mc); die_c=$(mc_to_c "$die_mc")
    n=$(nproc)
    if [ "$die_mc" -le "$DIE_START_MC" ] 2>/dev/null && [ "$n" -ge 6 ]; then
      log "prestart OK die=${die_c}C nproc=$n"; return 0
    fi
    if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
      log "HARD STOP die=${die_c}C"; sleep 30; continue
    fi
    log "prestart wait die=${die_c}C nproc=$n"
    sleep 15
  done
}

# --- split corpus paragraph-aligned if parts missing ---
if [ ! -f "$SPLITDIR/mixed_it.part1.txt" ] || [ ! -f "$SPLITDIR/mixed_it.part2.txt" ]; then
  python3 - "$CORPUS" "$SPLITDIR" <<'PY'
import sys, hashlib
from pathlib import Path
src = Path(sys.argv[1]); out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
text = src.read_text(encoding="utf-8")
paras = text.split("\n\n")
target = len(text)//2
acc=0; cut=len(paras)//2
for i,p in enumerate(paras):
    acc += len(p)+2
    if acc >= target:
        cut=i+1; break
h1="\n\n".join(paras[:cut]).rstrip()+"\n"
h2="\n\n".join(paras[cut:]).lstrip()
if not h2.endswith("\n"):
    h2 += "\n"
(out/"mixed_it.part1.txt").write_text(h1, encoding="utf-8")
(out/"mixed_it.part2.txt").write_text(h2, encoding="utf-8")
print(f"paras={len(paras)} cut_para={cut}")
print(f"part1_bytes={len(h1.encode())} part2_bytes={len(h2.encode())} full_bytes={len(text.encode())}")
for name in ("mixed_it.part1.txt","mixed_it.part2.txt"):
    p=out/name
    print(hashlib.sha256(p.read_bytes()).hexdigest(), p)
print("PART1_END", repr(h1[-80:]))
print("PART2_START", repr(h2[:80]))
PY
fi

: > "$MASTER"
log "F5.5-A PPL baseline SPLIT start (cache-mb=0, 2 halves; LMK workaround)"
log "bin=$BIN"
sha256sum "$BIN" | tee -a "$MASTER"
log "corpus_full=$CORPUS"
sha256sum "$CORPUS" | tee -a "$MASTER"
log "parts:"
sha256sum "$SPLITDIR/mixed_it.part1.txt" "$SPLITDIR/mixed_it.part2.txt" | tee -a "$MASTER"
log "model=$(ls -l "$MODEL" | awk '{print $5,$NF}')"
log "NOTE: split paragraph-aligned mid-file. PPL already non-overlapping n_ctx windows; combine sum_logprob/n_scored."

run_part(){
  local part="$1"
  local corpus="$SPLITDIR/mixed_it.part${part}.txt"
  local stdout="$SPLITDIR/part${part}.stdout"
  local stderr="$SPLITDIR/part${part}.stderr"
  local csv="$SPLITDIR/part${part}.per_token.csv"
  local die_s die_e rc
  wait_prestart
  die_s=$(max_die_mc)
  if [ -x "$HOME/bin/cold_model.sh" ]; then
    "$HOME/bin/cold_model.sh" "$MODEL" >>"$MASTER" 2>&1 || true
  fi
  log "PART $part START corpus=$corpus"
  set +e
  "$BIN" -m "$MODEL" -t $THREADS -c $N_CTX \
    $BASE --n-expert-used 8 \
    --ppl-file "$corpus" --ppl-csv "$csv" \
    >"$stdout" 2>"$stderr"
  rc=$?
  set -e
  die_e=$(max_die_mc)
  log "PART $part rc=$rc die_start=$(mc_to_c $die_s) die_end=$(mc_to_c $die_e)"
  grep -E "ppl:|BMOE_PPL|error|Error|config error" "$stderr" | tail -n 40 | tee -a "$MASTER" || true
  cat "$stdout" | tee -a "$MASTER"
  if [ "$rc" -ne 0 ]; then
    echo "FAIL part${part} rc=$rc $(ts)" | tee "$STATUS"
    exit "$rc"
  fi
  if ! grep -q "^BMOE_PPL " "$stdout"; then
    log "PART $part missing BMOE_PPL line"
    echo "FAIL part${part} no BMOE_PPL $(ts)" | tee "$STATUS"
    exit 2
  fi
}

run_part 1
log "cool-down 20s between parts"
sleep 20
run_part 2

python3 - "$SPLITDIR" "$JSON" "$COMBINED_CSV" "$BIN" "$MODEL" "$MASTER" "$CORPUS" <<'PY'
import sys, json, hashlib, os, time, math
from pathlib import Path
splitdir, outj, comb_csv, binary, model, master, corpus_full = sys.argv[1:8]
splitdir = Path(splitdir)
corpus_full = Path(corpus_full)

def sha(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for c in iter(lambda:f.read(1<<20), b""):
            h.update(c)
    return h.hexdigest()

parts=[]
for i in (1,2):
    stdout = (splitdir/f"part{i}.stdout").read_text(encoding="utf-8", errors="replace")
    line=None
    for L in stdout.splitlines():
        if L.startswith("BMOE_PPL "):
            line=L[len("BMOE_PPL "):].strip()
            break
    if not line:
        raise SystemExit(f"missing BMOE_PPL for part{i}")
    d=json.loads(line)
    d["part"]=i
    d["corpus_sha256"]=sha(splitdir/f"mixed_it.part{i}.txt")
    d["csv"]=str(splitdir/f"part{i}.per_token.csv")
    parts.append(d)
    print(f"part{i}: n_tokens={d.get('n_tokens')} n_scored={d.get('n_scored')} sum_logprob={d.get('sum_logprob')} ppl={d.get('ppl')}")

n_scored = sum(p["n_scored"] for p in parts)
sum_lp = sum(p["sum_logprob"] for p in parts)
n_tokens = sum(p["n_tokens"] for p in parts)
mean_lp = sum_lp / n_scored if n_scored else float("nan")
ppl = math.exp(-mean_lp) if n_scored else float("nan")
seconds = sum((p.get("seconds") or 0) for p in parts)

with open(comb_csv,"w",encoding="utf-8") as out:
    out.write("pos,token_id,logprob\n")
    offset=0
    for i in (1,2):
        path=splitdir/f"part{i}.per_token.csv"
        maxpos=-1
        with open(path,encoding="utf-8") as f:
            next(f)
            for line in f:
                line=line.strip()
                if not line:
                    continue
                pos,tid,lp=line.split(",")
                pos_i=int(pos)
                out.write(f"{pos_i+offset},{tid},{lp}\n")
                if pos_i>maxpos:
                    maxpos=pos_i
        offset = maxpos+1 if maxpos>=0 else offset

sum_csv=0.0; n_csv=0
with open(comb_csv,encoding="utf-8") as f:
    next(f)
    for line in f:
        if not line.strip():
            continue
        lp=float(line.strip().split(",")[2])
        sum_csv += lp
        n_csv += 1
mean_csv = sum_csv/n_csv if n_csv else float("nan")
ppl_csv = math.exp(-mean_csv) if n_csv else float("nan")

obj={
  "status":"COMPLETE",
  "date": time.strftime("%Y-%m-%d"),
  "phase":"F5.5-A",
  "rc":0,
  "method":"split_2_halves_paragraph_aligned_cache_mb_0",
  "method_note":"Process LMK/SIGKILL (rc=137) at ~45k tok/~2h twice (cache-mb 2000 and 0). Split corpus mid-file on paragraph boundary; run sequential PPL; combine sum_logprob/n_scored. PPL path already uses non-overlapping n_ctx windows with memory clear; split only changes window alignment at the cut.",
  "model":{"path":model,"size_bytes":os.path.getsize(model),"name":os.path.basename(model)},
  "binary":{
    "path":binary,
    "sha256":sha(binary),
    "runtime_commit_base":"b0c4e5b",
    "fork_commit":"7567e9f",
    "feature":"--ppl-file teacher-forced logprob",
    "binary_sha256_prefix":"5c95cb5f"
  },
  "corpus":{
    "path":str(corpus_full),
    "sha256":sha(corpus_full),
    "bytes":os.path.getsize(corpus_full),
    "parts":[
      {"path":str(splitdir/f"mixed_it.part{i}.txt"),
       "sha256":sha(splitdir/f"mixed_it.part{i}.txt"),
       "bytes":os.path.getsize(splitdir/f"mixed_it.part{i}.txt")}
      for i in (1,2)
    ]
  },
  "gate_config":"--moe-stream --cache-mb 0 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8 -c 4096 -t 4",
  "gate_config_note":"cache-mb=0 for PPL only (LMK under cache-mb=2000 at ~65%; 1200 rejected as pathological). Decode campaign gate remains cache-mb 2000. Logprob independent of expert cache hit (same sum_logprob milestones vs cache-mb 2000).",
  "parts":parts,
  "n_tokens":n_tokens,
  "n_scored":n_scored,
  "sum_logprob":sum_lp,
  "mean_logprob":mean_lp,
  "ppl":ppl,
  "seconds":seconds,
  "audit_csv":{"n_rows":n_csv,"sum_logprob":sum_csv,"mean_logprob":mean_csv,"ppl":ppl_csv},
  "ppl_csv":comb_csv,
  "non_regression":{
    "ok":8,"fail":0,"total":8,
    "ref":"F5.5-B k=8",
    "summary":"ok=8 fail=0 total=8",
    "binary_sha256":"5c95cb5fe2cc97f3b7a0ae4245ccca4975236b2a29f1be393d9e33ca055f059d"
  },
  "command":(
    f"# part1\n{binary} -m {model} -t 4 -c 4096 "
    f"--moe-stream --cache-mb 0 --dense-weights anon --overlap --io-threads 4 --ubatch 512 "
    f"--n-expert-used 8 --ppl-file {splitdir}/mixed_it.part1.txt --ppl-csv {splitdir}/part1.per_token.csv\n"
    f"# part2\n{binary} -m {model} -t 4 -c 4096 "
    f"--moe-stream --cache-mb 0 --dense-weights anon --overlap --io-threads 4 --ubatch 512 "
    f"--n-expert-used 8 --ppl-file {splitdir}/mixed_it.part2.txt --ppl-csv {splitdir}/part2.per_token.csv\n"
    f"# combine: ppl=exp(-(sum_logprob_1+sum_logprob_2)/(n_scored_1+n_scored_2))"
  ),
}
json.dump(obj, open(outj,"w",encoding="utf-8"), indent=2)
print(json.dumps({k:obj[k] for k in ("status","n_tokens","n_scored","sum_logprob","mean_logprob","ppl","audit_csv")}, indent=2))
with open(master,"a",encoding="utf-8") as m:
    m.write(f"[{time.strftime('%Y-%m-%dT%H:%M:%S%z')}] COMBINED n_scored={n_scored} sum_logprob={sum_lp} mean={mean_lp} ppl={ppl} audit_ppl={ppl_csv}\n")
PY

echo "DONE rc=0 $(ts)" | tee "$STATUS"
exit 0
