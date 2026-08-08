#!/data/data/com.termux/files/usr/bin/bash
# F5.5-A non-regression: NEW binary, decode path only (NO --ppl-file), 8 prompts k=8.
# Criterion: gen.txt BYTE-IDENTICAL to F5.5-B *-k8.gen.txt
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/f5.5/a}"
REFDIR="${REFDIR:-$HOME/experiments/results/f5.5/b}"
PROMPTS_DIR="${PROMPTS_DIR:-$HOME/experiments/prompts}"
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

MODEL="${MODEL:-$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf}"
export LD_LIBRARY_PATH="$(dirname "$BIN")"
mkdir -p "$OUTDIR"
MASTER="$OUTDIR/regression.master.log"
CHECKSUMS="$OUTDIR/regression_checksums.txt"
STATUS="$OUTDIR/STATUS_REGRESSION.txt"
: > "$MASTER"

THREADS=4; CACHE_MB=2000; IO_THREADS=4; N_CTX=4096; UBATCH=512
BASE="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${UBATCH}"
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

PROMPTS="short f45_1_esplicativo f45_2_scrittura f45_3_istruzioni f45_4_codice f45_5_ragionamento long_conversational_it d1_long"

{
  echo "# F5.5-A non-regression vs F5.5-B k=8 gens  $(ts)"
  echo "# binary: $BIN"
  sha256sum "$BIN"
  echo "# pristine: $BIN.pristine"
  sha256sum "$BIN.pristine" 2>/dev/null || true
  echo "# ref dir: $REFDIR"
} | tee "$CHECKSUMS" | tee -a "$MASTER"

ok=0; fail=0
for p in $PROMPTS; do
  case "$p" in
    long_conversational_it|d1_long) NGEN=256 ;;
    *) NGEN=200 ;;
  esac
  pfile="$PROMPTS_DIR/${p}.txt"
  cell="${p}-k8"
  out_gen="$OUTDIR/${cell}.gen.txt"
  out_stdout="$OUTDIR/${cell}.stdout"
  out_stderr="$OUTDIR/${cell}.stderr"
  out_meta="$OUTDIR/${cell}.meta"
  ref_gen="$REFDIR/${cell}.gen.txt"

  log "=== cell $cell n_gen=$NGEN ==="
  wait_prestart
  die_s=$(max_die_mc)

  if [ -x "$HOME/bin/cold_model.sh" ]; then
    "$HOME/bin/cold_model.sh" "$MODEL" >>"$MASTER" 2>&1 || true
  fi

  set +e
  "$BIN" -m "$MODEL" -t $THREADS -c $N_CTX -n $NGEN \
    --chatml --no-think --progress --temp 0 \
    $BASE --n-expert-used 8 \
    -p "$(cat "$pfile")" \
    >"$out_stdout" 2>"$out_stderr"
  rc=$?
  set -e

  if grep -q '=== answer ===' "$out_stdout" 2>/dev/null; then
    sed -n '/=== answer ===/,/=== perf ===/{/=== answer ===/d;/=== perf ===/d;p}' "$out_stdout" > "$out_gen"
  else
    log "WARN no === answer === block in $cell stdout"
    : > "$out_gen"
  fi

  die_e=$(max_die_mc)
  new_sha=$(sha256sum "$out_gen" | awk '{print $1}')
  if [ -f "$ref_gen" ]; then
    ref_sha=$(sha256sum "$ref_gen" | awk '{print $1}')
    if cmp -s "$out_gen" "$ref_gen"; then
      verdict=IDENTICAL; ok=$((ok+1))
    else
      verdict=DIFFERS; fail=$((fail+1))
      log "DIFF $cell new=$new_sha ref=$ref_sha"
      wc -c "$out_gen" "$ref_gen" | tee -a "$MASTER" || true
      # first 200 chars of each for diagnosis
      log "NEW head: $(head -c 200 "$out_gen" | tr '\n' ' ')"
      log "REF head: $(head -c 200 "$ref_gen" | tr '\n' ' ')"
    fi
  else
    ref_sha=MISSING; verdict=NO_REF; fail=$((fail+1))
  fi

  {
    echo "cell=$cell rc=$rc n_gen=$NGEN"
    echo "die_start=$(mc_to_c $die_s) die_end=$(mc_to_c $die_e)"
    echo "new_sha=$new_sha ref_sha=$ref_sha verdict=$verdict"
    echo "gen_bytes=$(wc -c < "$out_gen")"
  } > "$out_meta"
  echo "$cell $verdict new=$new_sha ref=$ref_sha" | tee -a "$CHECKSUMS"
  log "cell $cell $verdict rc=$rc"
done

echo "SUMMARY ok=$ok fail=$fail total=$((ok+fail)) $(ts)" | tee -a "$CHECKSUMS" | tee -a "$MASTER"
echo "DONE ok=$ok fail=$fail total=$((ok+fail)) $(ts)" > "$STATUS"
if [ "$fail" -eq 0 ]; then exit 0; else exit 1; fi
