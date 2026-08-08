#!/data/data/com.termux/files/usr/bin/bash
# G-D1 — byte-identity 8/8 for bmoe-cli.DENSE2 vs results/f5.5/b/*-k8.gen.txt
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C
export ALLOW_UNPINNED=1

OUTDIR="${OUTDIR:-$HOME/experiments/results/dense2/gd1}"
REFDIR="${REFDIR:-$HOME/experiments/results/f5.5/b}"
FLIGHT_DIR="${FLIGHT_DIR:-$HOME/experiments/results/dense2}"
mkdir -p "$OUTDIR" "$TMPDIR"
MASTER="$OUTDIR/G-D1.master.log"
PIDFILE="$OUTDIR/gd1.pid"
STATUS="$OUTDIR/STATUS.txt"
SUMMARY="$OUTDIR/SUMMARY.txt"

BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.DENSE2}"
MODEL="${MODEL:-$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf}"
EXPECTED_SIZE="11522702304"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
PROMPTS_DIR="${PROMPTS_DIR:-$HOME/experiments/prompts}"
THREADS=4
CACHE_MB=2000
IO_THREADS=4
N_CTX=4096
UBATCH=512
BASE_FLAGS="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${UBATCH}"
DIE_STOP_MC=98000
DIE_START_MC=80000
BATT_STOP=25

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

max_die_mc() {
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
mc_to_c() { awk -v m="$1" 'BEGIN{ if (m>1000) printf "%.1f", m/1000; else printf "%.1f", m }'; }
batt_fields() {
  termux-battery-status 2>/dev/null | python3 -c '
import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get("percentage",-1), d.get("voltage",-1), d.get("current",0), d.get("temperature",-1), d.get("plugged","?"))
except Exception:
  print(-1,-1,0,-1,"?")
'
}
kill_bmoe_exact() {
  local pid cmd
  for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cmd" in *"/bmoe-cli"*|*/bmoe-cli\ *)
      kill "$pid" 2>/dev/null || true; sleep 1; kill -9 "$pid" 2>/dev/null || true
    ;; esac
  done
}
wait_cool() {
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
wait_prestart_gate() {
  local max_wait="${1:-900}" t0 die_mc die_c nproc_v
  t0=$(date +%s)
  while :; do
    die_mc=$(max_die_mc); die_c=$(mc_to_c "$die_mc")
    nproc_v=$(nproc)
    if [ "$nproc_v" -lt 6 ]; then log "FATAL nproc=$nproc_v"; echo "FATAL_NPROC" > "$STATUS"; return 1; fi
    read -r batt _ _ _ plugged <<<"$(batt_fields)"
    if [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then log "FATAL batt=$batt"; return 1; fi
    if [ "$die_mc" -le "$DIE_START_MC" ] 2>/dev/null; then
      log "prestart OK die=${die_c}C nproc=$nproc_v batt=$batt"; return 0
    fi
    now=$(date +%s)
    if [ $((now - t0)) -ge "$max_wait" ]; then log "prestart timeout die=${die_c}C"; return 0; fi
    log "prestart wait die=${die_c}C"; sleep 15
  done
}
extract_gen() {
  local slog="$1" genf="$2"
  if grep -q '=== answer ===' "$slog" 2>/dev/null; then
    sed -n '/=== answer ===/,/=== perf ===/{/=== answer ===/d;/=== perf ===/d;p}' "$slog" > "$genf"
  else
    python3 - "$slog" "$genf" <<'PY' || true
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
text=''.join(parts)
open(dst,'w',encoding='utf-8').write(text)
PY
  fi
}
check_flight() {
  if [ ! -f "$FLIGHT_DIR/flight.pid" ] || ! kill -0 "$(cat "$FLIGHT_DIR/flight.pid")" 2>/dev/null; then
    log "FATAL flight recorder dead"
    echo "FATAL_FLIGHT" > "$STATUS"
    exit 7
  fi
}

if [ "${1:-}" = "--detach" ]; then
  shift || true
  nohup bash "$0" "$@" >"$OUTDIR/nohup.out" 2>&1 &
  echo $! > "$PIDFILE"
  echo "DETACHED pid=$(cat "$PIDFILE") out=$OUTDIR"
  exit 0
fi

echo $$ > "$PIDFILE"
: > "$MASTER"
echo "RUNNING $(ts)" > "$STATUS"
: > "$SUMMARY"

log "=== G-D1 START pid=$$ ALLOW_UNPINNED=1 ==="
log "bin=$BIN"
if [ ! -x "$BIN" ]; then log "FATAL no bin"; exit 2; fi
BIN_SHA=$(sha256sum "$BIN" | awk '{print $1}')
log "bin_sha=$BIN_SHA"
echo "ALLOW_UNPINNED=1 reason=DENSE2 non-CAMPAIGN gate G-D1" | tee -a "$MASTER" "$SUMMARY"
check_flight
log "flight_pid=$(cat $FLIGHT_DIR/flight.pid) last=$(tail -1 $FLIGHT_DIR/flight.log)"

SZ=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
if [ "$SZ" != "$EXPECTED_SIZE" ]; then log "FATAL size $SZ"; exit 2; fi
NPROC=$(nproc)
if [ "$NPROC" -lt 6 ]; then log "FATAL nproc=$NPROC"; exit 2; fi
log "nproc=$NPROC"

BINDIR=$(dirname "$BIN")
export LD_LIBRARY_PATH="${BINDIR}:${BINDIR}/../bin:${LD_LIBRARY_PATH:-}"

declare -a PROMPT_NAMES=(short f45_1_esplicativo f45_2_scrittura f45_3_istruzioni f45_4_codice f45_5_ragionamento long_conversational_it d1_long)
declare -a PROMPT_NGEN=(200 200 200 200 200 200 256 256)

REF_SHA="$REFDIR/prompt_sha256.txt"
{
  echo "# G-D1 prompt checksums $(ts)"
  for pn in "${PROMPT_NAMES[@]}"; do
    pf="$PROMPTS_DIR/${pn}.txt"
    [ -f "$pf" ] || { log "FATAL missing $pf"; exit 2; }
    sha256sum "$pf"
  done
} | tee "$OUTDIR/prompt_sha256.txt"

python3 - "$OUTDIR/prompt_sha256.txt" "$REF_SHA" <<'PY'
import sys
cur,ref=sys.argv[1],sys.argv[2]
def load(p):
    d={}
    for ln in open(p,encoding='utf-8',errors='replace'):
        ln=ln.strip()
        if not ln or ln.startswith('#'): continue
        parts=ln.split()
        if len(parts)>=2: d[parts[1].split('/')[-1]]=parts[0]
    return d
a,b=load(cur),load(ref)
miss=[f"{k}: got={a.get(k)} exp={v}" for k,v in b.items() if a.get(k)!=v]
if miss:
    print("PROMPT_SHA_MISMATCH:"); print("\n".join(miss)); sys.exit(3)
print("PROMPT_SHA_OK")
PY
log "prompt sha OK"

termux-wake-lock 2>/dev/null || true
echo "$(termux-battery-status 2>/dev/null || echo '{}')" > "$OUTDIR/batt_start.json"
kill_bmoe_exact

pass=0; fail=0
: > "$OUTDIR/compare.tsv"
echo -e "prompt\tresult\tgen_sha\tref_sha\tn_prompt\ttokens\trc" >> "$OUTDIR/compare.tsv"

for i in "${!PROMPT_NAMES[@]}"; do
  pname="${PROMPT_NAMES[$i]}"; n_gen="${PROMPT_NGEN[$i]}"; cell="${pname}-k8"
  slog="$OUTDIR/${cell}.stdout"; serr="$OUTDIR/${cell}.stderr"
  csvp="$OUTDIR/${cell}.metrics.csv"; genf="$OUTDIR/${cell}.gen.txt"
  meta="$OUTDIR/${cell}.meta"; donef="$OUTDIR/${cell}.done"
  pfile="$PROMPTS_DIR/${pname}.txt"; reff="$REFDIR/${cell}.gen.txt"
  rm -f "$donef"
  log "==== CELL $cell n_gen=$n_gen ===="
  echo "CELL $cell $(ts)" > "$STATUS"
  check_flight
  wait_prestart_gate 900 || exit 2
  kill_bmoe_exact
  "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1 || { sleep 2; "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1 || true; }

  (
    while :; do
      [ -f "$donef" ] && break
      die_mc_now=$(max_die_mc)
      if [ "$die_mc_now" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
        log "HARD_STOP_DIE $cell die=$(mc_to_c $die_mc_now)"
        kill_bmoe_exact; break
      fi
      sleep 2
    done
  ) &
  samp_pid=$!

  set +e
  # shellcheck disable=SC2086
  "$BIN" -m "$MODEL" -t "$THREADS" -c "$N_CTX" -n "$n_gen" \
    --chatml --no-think --progress --temp 0 --csv "$csvp" \
    $BASE_FLAGS --n-expert-used 8 \
    -p "$(cat "$pfile")" \
    > "$slog" 2> "$serr"
  rc_bin=$?
  set -e
  touch "$donef"; wait "$samp_pid" 2>/dev/null || true

  grep -E 'dense-anon:|expert-mmap:' "$serr" | tee -a "$SUMMARY" || true

  extract_gen "$slog" "$genf"
  n_prompt=$(grep -oE 'prefill: [0-9]+ tokens' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}'); n_prompt=${n_prompt:-0}
  tokens=$(grep -oE 'generation: [0-9]+ tokens' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}'); tokens=${tokens:-0}
  gen_sha=$(sha256sum "$genf" 2>/dev/null | awk '{print $1}')
  ref_sha=$(sha256sum "$reff" 2>/dev/null | awk '{print $1}')
  result="FAIL"
  if [ -f "$reff" ] && cmp -s "$genf" "$reff"; then result="PASS"; pass=$((pass+1)); else fail=$((fail+1)); fi
  {
    echo "cell=$cell result=$result gen_sha=$gen_sha ref_sha=$ref_sha rc=$rc_bin n_prompt=$n_prompt tokens=$tokens"
  } > "$meta"
  echo -e "${pname}\t${result}\t${gen_sha}\t${ref_sha}\t${n_prompt}\t${tokens}\t${rc_bin}" | tee -a "$OUTDIR/compare.tsv" "$SUMMARY"
  log "RESULT $cell $result gen=${gen_sha:0:12} ref=${ref_sha:0:12}"
  if [ "$result" != "PASS" ]; then
    log "STOP on mismatch"
    echo "STOP_MISMATCH $cell $(ts)" > "$STATUS"
    echo "PASS=$pass FAIL=$fail STOP_ON=$cell" >> "$SUMMARY"
    kill_bmoe_exact; exit 4
  fi
  wait_cool 70 600
done

echo "PASS=$pass FAIL=$fail ALL=8/8" | tee -a "$SUMMARY"
echo "DONE_OK 8/8 $(ts)" > "$STATUS"
log "=== G-D1 DONE 8/8 ==="
log "flight_last=$(tail -1 $FLIGHT_DIR/flight.log)"
kill_bmoe_exact
exit 0
