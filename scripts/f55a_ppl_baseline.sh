#!/data/data/com.termux/files/usr/bin/bash
# F5.5-A PPL baseline on mixed_it corpus (~50k tok target)
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/f5.5/a}"
CORPUS="${CORPUS:-$HOME/experiments/quality/corpus_it/mixed_it.txt}"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"

# --- campaign binary pin (fix-bloccanti-audit §C) ---
_PIN_LIB=""
for _d in \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" \
  "$HOME/experiments/scripts" \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." 2>/dev/null && pwd)/scripts" \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." 2>/dev/null && pwd)/scripts"
do
  [ -n "$_d" ] && [ -f "$_d/lib_campaign_pin.sh" ] && _PIN_LIB="$_d/lib_campaign_pin.sh" && break
done
if [ -n "$_PIN_LIB" ]; then
  # shellcheck disable=SC1090
  source "$_PIN_LIB"
  assert_campaign_pin "$BIN"
else
  _sha_file="${CAMPAIGN_SHA_FILE:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256}"
  _exp=$(awk 'NF{print $1; exit}' "$_sha_file" 2>/dev/null || true)
  _got=$(sha256sum "$BIN" 2>/dev/null | awk '{print $1}')
  BIN_SHA256="$_got"
  if [ "${ALLOW_UNPINNED:-0}" != "1" ]; then
    case "$BIN" in *.CAMPAIGN) ;; *)
      echo "ERRORE pin campagna: usare bmoe-cli.CAMPAIGN (got $BIN). ALLOW_UNPINNED=1 per override." >&2
      exit 6
    ;; esac
    if [ -z "$_exp" ] || [ "$_got" != "$_exp" ]; then
      echo "ERRORE pin campagna: sha mismatch got=$_got expected=$_exp ($_sha_file)" >&2
      exit 6
    fi
  fi
fi
export BIN_SHA256="${BIN_SHA256:-}"
# --- end pin ---

MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
export LD_LIBRARY_PATH="$(dirname "$BIN")"
mkdir -p "$OUTDIR"
MASTER="$OUTDIR/ppl_baseline.master.log"
STDOUT="$OUTDIR/ppl_baseline.stdout"
STDERR="$OUTDIR/ppl_baseline.stderr"
CSV="$OUTDIR/ppl_baseline.per_token.csv"
JSON="$OUTDIR/ppl_baseline.json"
STATUS="$OUTDIR/STATUS_PPL.txt"

THREADS=4; CACHE_MB=2000; IO_THREADS=4; N_CTX=4096; UBATCH=512
BASE="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${UBATCH} --n-expert-used 6 --drop-cold-experts 0.65"
DIE_STOP_MC=95000; DIE_START_MC=80000

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

: > "$MASTER"
log "F5.5-A PPL baseline start"
log "bin=$BIN"
sha256sum "$BIN" | tee -a "$MASTER"
log "corpus=$CORPUS"
sha256sum "$CORPUS" | tee -a "$MASTER"
log "model=$(ls -l "$MODEL" | awk '{print $5,$NF}')"

wait_prestart
die_s=$(max_die_mc)
if [ -x "$HOME/bin/cold_model.sh" ]; then
  "$HOME/bin/cold_model.sh" "$MODEL" >>"$MASTER" 2>&1 || true
fi

# RAW text: no chatml, no think. n_ctx 4096, ubatch 512, k=6 drop=0.65 campaign gate.
# --ppl-file path is the only new flag; rest matches campaign gate.
set +e
"$BIN" -m "$MODEL" -t $THREADS -c $N_CTX \
  $BASE \
  --ppl-file "$CORPUS" --ppl-csv "$CSV" \
  >"$STDOUT" 2>"$STDERR"
rc=$?
set -e
die_e=$(max_die_mc)

log "ppl rc=$rc die_start=$(mc_to_c $die_s) die_end=$(mc_to_c $die_e)"
tail -20 "$STDERR" | tee -a "$MASTER"
cat "$STDOUT" | tee -a "$MASTER"

# Parse BMOE_PPL line into a frozen JSON result
python3 - <<'PY' "$STDOUT" "$JSON" "$CORPUS" "$BIN" "$MODEL" "$rc" "$CSV"
import sys, json, hashlib, os, time
stdout, outj, corpus, binary, model, rc, csvp = sys.argv[1:8]
line=None
for L in open(stdout, encoding="utf-8", errors="replace"):
    if L.startswith("BMOE_PPL "):
        line=L[len("BMOE_PPL "):].strip(); break
def sha(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for c in iter(lambda:f.read(1<<20), b""): h.update(c)
    return h.hexdigest()
obj={"status":"COMPLETE" if rc=="0" and line else "FAILED",
     "date": time.strftime("%Y-%m-%d"),
     "phase":"F5.5-A",
     "rc": int(rc),
     "model":{"path":model, "size_bytes": os.path.getsize(model), "name":os.path.basename(model)},
     "binary":{"path":binary, "sha256":sha(binary), "runtime_commit_base":"b0c4e5b",
               "feature":"--ppl-file teacher-forced logprob"},
     "corpus":{"path":corpus, "sha256":sha(corpus), "bytes":os.path.getsize(corpus)},
     "gate_config":"--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65 -c 4096 -t 4",
     "ppl_csv": csvp if os.path.exists(csvp) else None,
     "raw_line": line}
if line:
    try:
        d=json.loads(line)
        obj.update({k:d[k] for k in ("n_tokens","n_scored","sum_logprob","ppl","seconds","cancelled") if k in d})
    except Exception as e:
        obj["parse_error"]=str(e)
# command to reproduce
obj["command"]=(
    f'{binary} -m {model} -t 4 -c 4096 '
    f'--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 '
    f'--n-expert-used 6 --drop-cold-experts 0.65 --ppl-file {corpus} --ppl-csv {csvp}'
)
json.dump(obj, open(outj,"w",encoding="utf-8"), indent=2)
print(json.dumps(obj, indent=2))
PY

echo "DONE rc=$rc $(ts)" | tee "$STATUS"
exit $rc
