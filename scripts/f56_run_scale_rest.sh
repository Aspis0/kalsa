#!/data/data/com.termux/files/usr/bin/bash
# F5.6 PASSO1 rest — k4 then k5 (k6 already COMPLETE). drop BLOCKED.
set -euo pipefail
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
export LC_ALL=C

ROOT=$HOME/experiments/results/f5.6
BIN=$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli
MODEL=$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf
CORPUS=$ROOT/corpus/mixed_it.part1.txt
export LD_LIBRARY_PATH=$(dirname $BIN)
BASE="--moe-stream --cache-mb 0 --dense-weights anon --overlap --io-threads 4 --ubatch 512"
THREADS=4
N_CTX=4096
MASTER=$ROOT/scale.master.log
STATUS=$ROOT/STATUS_SCALE.txt

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

wait_pre(){
  while :; do
    d=$(max_die_mc); n=$(nproc)
    if [ "$d" -gt 98000 ] 2>/dev/null; then
      log "HARD STOP die=$(mc_to_c $d)C — waiting"; sleep 30; continue
    fi
    if [ "$d" -le 80000 ] 2>/dev/null && [ "$n" -ge 6 ]; then
      log "prestart OK die=$(mc_to_c $d)C nproc=$n"; return 0
    fi
    log "prestart wait die=$(mc_to_c $d)C nproc=$n"; sleep 15
  done
}

write_meta(){
  local name="$1"
  local extra="$2"
  local dir="$3"
  python3 - "$name" "$extra" "$dir" "$CORPUS" "$BIN" <<'PY'
import json, hashlib, time, sys
from pathlib import Path
name, extra, dir_s, corpus, binary = sys.argv[1:6]
dir = Path(dir_s)
stdout = (dir / "stdout").read_text(errors="replace")
d = None
for L in stdout.splitlines():
    if L.startswith("BMOE_PPL "):
        d = json.loads(L[len("BMOE_PPL "):])
        break
assert d is not None

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()

k = None
if "--n-expert-used" in extra:
    parts = extra.split()
    k = int(parts[parts.index("--n-expert-used") + 1])
traf = (k / 8.0) if k else None
meta = {
    "variant": name,
    "flag": extra,
    "ppl": d,
    "corpus_sha256": sha(corpus),
    "binary_sha256": sha(binary),
    "csv_sha256": sha(dir / "per_token.csv"),
    "csv_rows": sum(1 for _ in open(dir / "per_token.csv")) - 1,
    "k": k,
    "traffic_frac_vs_k8_theoretical": traf,
    "traffic_saved_pct_theoretical": (1.0 - traf) * 100 if traf is not None else None,
    "hit_pct": 0.0,
    "mib_tok_note": "ppl path does not emit BMOE_PROGRESS; with cache_mb=0 hit=0; theoretical mib proportional to k",
    "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
}
json.dump(meta, open(dir / "result.json", "w"), indent=2)
print(json.dumps({kk: meta[kk] for kk in ("variant", "ppl", "k", "traffic_saved_pct_theoretical")}, indent=2))
open(dir / "STATUS.txt", "w").write(
    "COMPLETE %s ppl=%s n_scored=%s\n" % (name, d["ppl"], d["n_scored"])
)
PY
}

run_var(){
  local name="$1"; shift
  local extra="$*"
  local dir=$ROOT/$name
  mkdir -p "$dir"
  if [ -f "$dir/STATUS.txt" ] && grep -q "^COMPLETE" "$dir/STATUS.txt" 2>/dev/null; then
    log "SKIP $name already COMPLETE"; return 0
  fi
  wait_pre
  die_s=$(max_die_mc)
  if [ -x "$HOME/bin/cold_model.sh" ]; then
    "$HOME/bin/cold_model.sh" "$MODEL" >>"$MASTER" 2>&1 || true
  fi
  log "START $name die_s=$(mc_to_c $die_s)C extra=[$extra]"
  set +e
  $BIN -m $MODEL -t $THREADS -c $N_CTX $BASE $extra \
    --ppl-file $CORPUS --ppl-csv $dir/per_token.csv \
    >$dir/stdout 2>$dir/stderr
  rc=$?
  set -e
  die_e=$(max_die_mc)
  log "END $name rc=$rc die_s=$(mc_to_c $die_s) die_e=$(mc_to_c $die_e)"
  {
    echo "rc=$rc"
    echo "die_start_mc=$die_s"
    echo "die_end_mc=$die_e"
    echo "extra=$extra"
  } > $dir/meta.txt
  grep -E "BMOE_PPL|ppl:|error|Error|config" $dir/stdout $dir/stderr | tee -a $MASTER || true
  if [ "$rc" -ne 0 ]; then
    echo "FAIL $name rc=$rc $(ts)" | tee $dir/STATUS.txt | tee $STATUS
    return $rc
  fi
  if ! grep -q "^BMOE_PPL " $dir/stdout; then
    echo "FAIL $name no BMOE_PPL $(ts)" | tee $dir/STATUS.txt | tee $STATUS
    return 2
  fi
  write_meta "$name" "$extra" "$dir"
  log "COMPLETE $name ppl ok"
  sleep 30
  return 0
}

log "F5.6 scale REST start (k4, k5; k6 already done)"
sha256sum $CORPUS $BIN | tee -a $MASTER
run_var k4 --n-expert-used 4
run_var k5 --n-expert-used 5
echo "DONE scale $(ts)" | tee $STATUS
log "ALL DONE"
