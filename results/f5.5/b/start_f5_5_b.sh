#!/data/data/com.termux/files/usr/bin/bash
# start_f5_5_b.sh — F5.5-B k-sweep quality (8 prompts × k=8/6/5/4)
# Focus: deterministic cache_hit% + mib_tok + generated text for human quality judgment.
# NO tok/s conclusions (phone may be charging). Detached via --detach.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/f5.5/b}"
mkdir -p "$OUTDIR" "$TMPDIR"
MASTER="$OUTDIR/F5.5-B.master.log"
PIDFILE="$OUTDIR/f5_5_b.pid"
STATUS="$OUTDIR/STATUS.txt"
SAFETY_LOG="$OUTDIR/safety.log"
CSV_ALL="$OUTDIR/cells.csv"

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
EXPECTED_SIZE="11522702304"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
PROMPTS_DIR="${PROMPTS_DIR:-$HOME/experiments/prompts}"
THREADS=4
CACHE_MB=2000
IO_THREADS=4
N_CTX=4096
UBATCH=512
BASE_FLAGS="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${UBATCH}"
DIE_STOP_MC=95000
DIE_START_MC=80000
BATT_STOP=25
COOL_TARGET_C=70
COOL_MAX_WAIT_S=600

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

max_die_mc() {
  local max=0 v t z
  for z in /sys/class/thermal/thermal_zone*; do
    t=$(cat "$z/type" 2>/dev/null || true)
    case "$t" in
      cpu-*|cpuss-*|*cpu*|*CPU*)
        v=$(cat "$z/temp" 2>/dev/null || echo 0)
        if [ -n "$v" ] && [ "$v" -gt "$max" ] 2>/dev/null; then max=$v; fi
        ;;
    esac
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

safety_check() {
  local die_mc batt plugged
  die_mc=$(max_die_mc)
  read -r batt _ _ _ plugged <<<"$(batt_fields)"
  if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
    echo "STOP_DIE:$(mc_to_c "$die_mc")"
    return 1
  fi
  if [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then
    echo "STOP_BATT:$batt"
    return 1
  fi
  echo "OK:die=$(mc_to_c "$die_mc"):batt=$batt:plugged=$plugged"
  return 0
}

kill_bmoe_exact() {
  local pid cmd
  for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cmd" in
      *"/bmoe-cli "*|*/bmoe-cli\ --*|*/bmoe-cli\ -m*)
        case "$cmd" in *start_f5_5_b.sh*) ;; *)
          log "killing residual bmoe pid=$pid"
          kill "$pid" 2>/dev/null || true
          sleep 1
          kill -9 "$pid" 2>/dev/null || true
        ;; esac
        ;;
    esac
  done
  sleep 2
}

wait_cool() {
  local target_c="${1:-$COOL_TARGET_C}" max_wait="${2:-$COOL_MAX_WAIT_S}"
  local t0 now die_mc die_c
  t0=$(date +%s)
  while :; do
    die_mc=$(max_die_mc); die_c=$(mc_to_c "$die_mc")
    if awk -v d="$die_c" -v t="$target_c" 'BEGIN{exit !(d+0 <= t+0)}'; then
      log "cool OK die=${die_c}C <= ${target_c}C"
      return 0
    fi
    now=$(date +%s)
    if [ $((now - t0)) -ge "$max_wait" ]; then
      log "cool timeout die=${die_c}C after ${max_wait}s — proceeding carefully"
      return 0
    fi
    sleep 10
  done
}

wait_prestart_gate() {
  # Hard pre-start: die <= 80C, nproc>=6, battery ok
  local max_wait="${1:-900}" t0 now die_mc die_c n nproc_v
  t0=$(date +%s)
  while :; do
    die_mc=$(max_die_mc); die_c=$(mc_to_c "$die_mc")
    nproc_v=$(nproc)
    if [ "$nproc_v" -lt 6 ]; then
      log "FATAL nproc=$nproc_v < 6 (not top-app)"
      echo "FATAL_NPROC:$nproc_v $(ts)" > "$STATUS"
      return 1
    fi
    if [ "$die_mc" -le "$DIE_START_MC" ] 2>/dev/null; then
      local saf
      saf=$(safety_check) || {
        log "FATAL safety prestart: $saf"
        echo "FATAL_SAFETY $saf $(ts)" > "$STATUS"
        return 1
      }
      log "prestart OK die=${die_c}C nproc=$nproc_v $saf"
      return 0
    fi
    now=$(date +%s)
    if [ $((now - t0)) -ge "$max_wait" ]; then
      log "prestart timeout die=${die_c}C after ${max_wait}s"
      if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
        echo "FATAL_DIE_HOT:$die_c $(ts)" > "$STATUS"
        return 1
      fi
      log "WARN proceeding with die=${die_c}C > 80 after timeout"
      return 0
    fi
    log "wait prestart die=${die_c}C (target<=80)"
    sleep 15
  done
}

if [ "${1:-}" = "--detach" ]; then
  shift
  nohup setsid bash "$0" --run "$@" >"$OUTDIR/nohup_launch.log" 2>&1 &
  echo $! > "$OUTDIR/launcher.pid"
  echo "LAUNCHED pid=$(cat "$OUTDIR/launcher.pid") log=$OUTDIR/nohup_launch.log"
  exit 0
fi

if [ "${1:-}" != "--run" ]; then
  echo "Uso: start_f5_5_b.sh --detach"
  exit 2
fi
shift || true

echo $$ > "$PIDFILE"
: > "$MASTER"
: > "$SAFETY_LOG"
echo "RUNNING $(ts)" > "$STATUS"
echo "cell,prompt,k,wall_start,wall_end,elapsed_s,n_prompt,tokens,cache_hit_pct,mib_tok,read_mib,cache_mb,ubatch,n_expert_used,die_start_c,die_end_c,die_max_c,batt_start,batt_end,plugged,gen_chars,rc,stopped_reason,attempt" > "$CSV_ALL"

log "=== F5.5-B START pid=$$ ==="
log "bin=$BIN model=$MODEL"
log "base_flags=$BASE_FLAGS"

if [ ! -x "$BIN" ]; then log "FATAL: binary missing"; echo "FATAL_NO_BIN" > "$STATUS"; exit 2; fi
SZ=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
if [ "$SZ" != "$EXPECTED_SIZE" ]; then log "FATAL: model size $SZ != $EXPECTED_SIZE"; echo "FATAL_SIZE" > "$STATUS"; exit 2; fi
NPROC=$(nproc)
if [ "$NPROC" -lt 6 ]; then log "FATAL: nproc=$NPROC"; echo "FATAL_NPROC" > "$STATUS"; exit 2; fi
CPUSET=$(cat /proc/self/cpuset 2>/dev/null || echo "?")
log "nproc=$NPROC cpuset=$CPUSET"

BINDIR=$(dirname "$BIN")
export LD_LIBRARY_PATH="${BINDIR}:${BINDIR}/..:${LD_LIBRARY_PATH:-}"
log "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"

HELP=$("$BIN" --help 2>&1 || true)
if ! echo "$HELP" | grep -q -- "--n-expert-used"; then
  log "FATAL: --n-expert-used missing from help"
  echo "FATAL_NO_FLAG" > "$STATUS"
  exit 2
fi
log "FLAG_OK --n-expert-used"

# Prompt list: short first for smoke, then f45_*, then long
# n_gen: 200 short suite, 256 long suite
declare -a PROMPT_NAMES=(
  short
  f45_1_esplicativo
  f45_2_scrittura
  f45_3_istruzioni
  f45_4_codice
  f45_5_ragionamento
  long_conversational_it
  d1_long
)
declare -a PROMPT_NGEN=(200 200 200 200 200 200 256 256)
declare -a K_VALUES=(8 6 5 4)

# Verify prompts + write checksums
{
  echo "# F5.5-B prompt checksums $(ts)"
  for pn in "${PROMPT_NAMES[@]}"; do
    pf="$PROMPTS_DIR/${pn}.txt"
    if [ ! -f "$pf" ]; then
      log "FATAL missing prompt $pf"
      echo "FATAL_PROMPT:$pn" > "$STATUS"
      exit 2
    fi
    sha256sum "$pf"
  done
} | tee "$OUTDIR/prompt_sha256.txt"
log "prompt checksums written"

BATT_JSON=$(termux-battery-status 2>/dev/null || echo '{}')
echo "$BATT_JSON" > "$OUTDIR/batt_start.json"
log "battery_start: $BATT_JSON"
saf=$(safety_check) || { log "FATAL safety: $saf"; echo "FATAL_SAFETY $saf" > "$STATUS"; exit 2; }
log "safety $saf"
kill_bmoe_exact

# Smoke: 1-token k=8 vs k=6 on short to confirm flag effect on progress line
smoke_flag() {
  local k="$1"
  local out="$OUTDIR/smoke_k${k}.stderr"
  local sout="$OUTDIR/smoke_k${k}.stdout"
  log "SMOKE k=$k n=1"
  set +e
  "$BIN" -m "$MODEL" -t 4 -c 512 -n 1 --chatml --no-think --progress \
    --moe-stream --cache-mb 500 --force-cache --dense-weights anon --io-threads 4 \
    --n-expert-used "$k" \
    -p "Ciao" >"$sout" 2>"$out"
  local rc=$?
  set -e
  local ov
  ov=$(grep -E "expert_used_count|Using metadata override|n_expert_used" "$out" 2>/dev/null | head -5 || true)
  log "SMOKE k=$k rc=$rc override_lines: $ov"
  grep -E "n_expert_used=$k|expert_used_count.*= $k" "$out" >/dev/null 2>&1 && log "SMOKE k=$k CONFIRM override present" || log "SMOKE k=$k WARN override string not grepped (check stderr)"
  # also dump metrics header if present
  head -6 "$OUTDIR/smoke_k${k}.stdout" 2>/dev/null | tee -a "$MASTER" || true
  grep -E "n_expert_used" "$out" 2>/dev/null | head -3 | tee -a "$MASTER" || true
}

log "=== SMOKE n=1 k=8 then k=6 ==="
wait_prestart_gate 300 || exit 2
# light cold optional for smoke
"$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1 || log "WARN cold smoke"
smoke_flag 8
kill_bmoe_exact
sleep 2
smoke_flag 6
kill_bmoe_exact
wait_cool 75 300

run_cell() {
  local pname="$1" k="$2" n_gen="$3" attempt="${4:-1}"
  local cell="${pname}-k${k}"
  local slog="$OUTDIR/${cell}.stdout"
  local serr="$OUTDIR/${cell}.stderr"
  local csvp="$OUTDIR/${cell}.metrics.csv"
  local genf="$OUTDIR/${cell}.gen.txt"
  local meta="$OUTDIR/${cell}.meta"
  local donef="$OUTDIR/${cell}.done"
  local pfile="$PROMPTS_DIR/${pname}.txt"
  rm -f "$donef"

  log "==== CELL $cell attempt=$attempt n_gen=$n_gen ===="
  echo "CELL $cell attempt=$attempt $(ts)" > "$STATUS"

  if ! wait_prestart_gate 900; then
    log "ABORT prestart gate failed before $cell"
    return 1
  fi

  kill_bmoe_exact
  log "cold_model $MODEL"
  if ! "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1; then
    log "WARN cold_model failed — retry after kill"
    kill_bmoe_exact
    sleep 2
    "$COLD_MODEL_SH" "$MODEL" >> "$MASTER" 2>&1 || log "WARN cold_model failed again"
  fi

  local die_s_mc die_s_c batt_s plugged_s wall_s wall_s_epoch
  die_s_mc=$(max_die_mc); die_s_c=$(mc_to_c "$die_s_mc")
  read -r batt_s _ _ _ plugged_s <<<"$(batt_fields)"
  wall_s=$(ts); wall_s_epoch=$(date +%s)

  local sampler_log="$OUTDIR/${cell}.sampler.csv"
  echo "ts_epoch_ms,die_max_c,read_bytes,rchar,vmrss_kb" > "$sampler_log"
  (
    while :; do
      [ -f "$donef" ] && break
      now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      die_c=$(mc_to_c "$(max_die_mc)")
      # hard stop mid-run if die > 95
      die_mc_now=$(max_die_mc)
      if [ "$die_mc_now" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
        log "HARD_STOP_DIE mid-run $cell die=$(mc_to_c "$die_mc_now")"
        for pid in $(ls /proc | grep -E '^[0-9]+$'); do
          [ -r "/proc/$pid/cmdline" ] || continue
          cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
          case "$cmd" in *"/bmoe-cli "*) kill -9 "$pid" 2>/dev/null || true;; esac
        done
      fi
      bpid=""
      for pid in $(ls /proc | grep -E '^[0-9]+$'); do
        [ -r "/proc/$pid/cmdline" ] || continue
        cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
        case "$cmd" in *"/bmoe-cli "*) bpid=$pid; break;; esac
      done
      rb=0; rc=0; rss=0
      if [ -n "$bpid" ] && [ -r "/proc/$bpid/io" ]; then
        rb=$(awk '/^read_bytes:/{print $2}' "/proc/$bpid/io")
        rc=$(awk '/^rchar:/{print $2}' "/proc/$bpid/io")
        rss=$(awk '/^VmRSS:/{print $2}' "/proc/$bpid/status" 2>/dev/null || echo 0)
      fi
      echo "${now_ms},${die_c},${rb},${rc},${rss}" >> "$sampler_log"
      sleep 1
    done
  ) &
  local samp_pid=$!

  set +e
  # shellcheck disable=SC2086
  "$BIN" -m "$MODEL" -t "$THREADS" -c "$N_CTX" -n "$n_gen" \
    --chatml --no-think --progress --temp 0 --csv "$csvp" \
    $BASE_FLAGS --n-expert-used "$k" \
    -p "$(cat "$pfile")" \
    > "$slog" 2> "$serr"
  local rc_bin=$?
  set -e
  touch "$donef"
  wait "$samp_pid" 2>/dev/null || true

  local wall_e wall_e_epoch elapsed die_e_mc die_e_c batt_e plugged_e
  wall_e=$(ts); wall_e_epoch=$(date +%s); elapsed=$((wall_e_epoch - wall_s_epoch))
  die_e_mc=$(max_die_mc); die_e_c=$(mc_to_c "$die_e_mc")
  read -r batt_e _ _ _ plugged_e <<<"$(batt_fields)"

  # Extract generated text
  if grep -q '=== answer ===' "$slog" 2>/dev/null; then
    sed -n '/=== answer ===/,/=== perf ===/{/=== answer ===/d;/=== perf ===/d;p}' "$slog" > "$genf"
  else
    # reconstruct from delta_text progress lines if present
    python3 - "$slog" "$genf" <<'PY' || true
import sys,re,json
src,dst=sys.argv[1],sys.argv[2]
parts=[]
with open(src,encoding='utf-8',errors='replace') as f:
    for line in f:
        if 'BMOE_PROGRESS' not in line: continue
        i=line.find('{')
        if i<0: continue
        try:
            o=json.loads(line[i:])
        except Exception:
            continue
        t=o.get('delta_text') or ''
        if t: parts.append(t)
text=''.join(parts)
# fallback: last non-BMOE lines
if not text:
    with open(src,encoding='utf-8',errors='replace') as f:
        lines=[ln for ln in f if not ln.startswith('BMOE_')]
    text=''.join(lines[-50:])
open(dst,'w',encoding='utf-8').write(text)
PY
  fi

  local tokens=0 cache_hit=-1 read_mib=0 mib_tok=0 n_prompt=0 n_expert_hdr=""
  # From metrics CSV header
  if [ -f "$csvp" ]; then
    n_expert_hdr=$(grep -oE 'n_expert_used=[0-9]+' "$csvp" | head -1 | cut -d= -f2 || true)
    local ub_hdr cache_hdr
    ub_hdr=$(grep -oE 'n_ubatch=[0-9]+' "$csvp" | head -1 | cut -d= -f2 || true)
    cache_hdr=$(grep -oE 'cache_mb=[0-9]+' "$csvp" | head -1 | cut -d= -f2 || true)
  fi
  # From stderr/stdout perf summary
  tokens=$(grep -oE 'generation: [0-9]+ tokens' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  tokens=${tokens:-0}
  if [ "$tokens" = "0" ]; then
    tokens=$(awk -F, 'NR>6 && $1+0>0 {n=$1} END{print n+0}' "$csvp" 2>/dev/null || echo 0)
  fi
  read_mib=$(grep -oE 'read [0-9.]+ MiB' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  read_mib=${read_mib:-0}
  mib_tok=$(grep -oE '\([0-9.]+ MiB/token\)' "$slog" "$serr" 2>/dev/null | head -1 | tr -dc '0-9.')
  mib_tok=${mib_tok:-0}
  cache_hit=$(grep -oE 'moe-cache: [0-9.]+% hit' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '%')
  cache_hit=${cache_hit:--1}
  n_prompt=$(grep -oE 'prefill: [0-9]+ tokens' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  n_prompt=${n_prompt:-0}
  # last progress line as fallback for hit/read
  local lastprog
  lastprog=$(grep BMOE_PROGRESS "$slog" 2>/dev/null | tail -1 || true)
  if [ -n "$lastprog" ]; then
    local pch prm pstep
    pch=$(echo "$lastprog" | sed -n 's/.*"cache_hit_pct":\([0-9.]*\).*/\1/p')
    [ -n "$pch" ] && cache_hit=$pch
    # sum read_mb from progress if needed
    if [ "$read_mib" = "0" ] || [ -z "$read_mib" ]; then
      read_mib=$(python3 - "$slog" <<'PY'
import sys,json
s=0.0
for line in open(sys.argv[1],encoding='utf-8',errors='replace'):
    if 'BMOE_PROGRESS' not in line: continue
    i=line.find('{')
    if i<0: continue
    try: o=json.loads(line[i:])
    except Exception: continue
    s += float(o.get('read_mb') or 0)
print(round(s,2))
PY
)
    fi
    pstep=$(echo "$lastprog" | sed -n 's/.*"step":\([0-9]*\).*/\1/p')
    if [ "${tokens:-0}" = "0" ] && [ -n "$pstep" ]; then tokens=$pstep; fi
  fi
  if [ "${mib_tok:-0}" = "0" ] || [ -z "$mib_tok" ]; then
    if [ "${tokens:-0}" != "0" ] && [ "${read_mib:-0}" != "0" ]; then
      mib_tok=$(python3 -c "print(round(float('$read_mib')/max(float('$tokens'),1),3))")
    fi
  fi
  # n_prompt from csv first step context if still 0
  if [ "${n_prompt:-0}" = "0" ]; then
    n_prompt=$(grep -oE 'n_ctx=[0-9]+' "$csvp" 2>/dev/null | head -1 | cut -d= -f2 || echo 0)
    # better: look for "prompt eval" style
    n_prompt=$(grep -oE 'prompt eval.* [0-9]+ tokens|eval time.*= *[0-9]+ tokens|n_tokens_prompt[=:][0-9]+' "$slog" "$serr" 2>/dev/null | head -1 | grep -oE '[0-9]+' | tail -1 || echo 0)
    n_prompt=${n_prompt:-0}
  fi

  local die_max_c
  die_max_c=$(awk -F, 'NR>1{if($2+0>m)m=$2+0} END{printf "%.1f", m+0}' "$sampler_log")
  die_max_c=$(python3 -c "print(max(float('$die_s_c'),float('$die_e_c'),float('${die_max_c:-0}')))")

  local gen_chars
  gen_chars=$(wc -c < "$genf" 2>/dev/null | tr -d ' ' || echo 0)

  local stopped="ok"
  [ $rc_bin -ne 0 ] && stopped="bin_rc_$rc_bin"
  # detect OOM-ish
  if grep -qiE 'killed|out of memory|lmkd|Cannot allocate' "$serr" 2>/dev/null; then
    stopped="OOM_OR_KILL"
  fi

  {
    echo "cell=$cell"
    echo "prompt=$pname k=$k n_expert_used_flag=$k n_expert_used_hdr=${n_expert_hdr:-?}"
    echo "rc=$rc_bin elapsed_s=$elapsed attempt=$attempt"
    echo "die_start=$die_s_c die_end=$die_e_c die_max=$die_max_c"
    echo "batt $batt_s -> $batt_e plugged=$plugged_s"
    echo "n_prompt=$n_prompt tokens=$tokens gen_chars=$gen_chars"
    echo "cache_hit=$cache_hit mib_tok=$mib_tok read_mib=$read_mib"
    echo "cache_mb=$CACHE_MB ubatch=$UBATCH n_ctx=$N_CTX n_gen=$n_gen temp=0"
    echo "stopped=$stopped"
    echo "pfile_sha=$(sha256sum "$pfile" | awk '{print $1}')"
  } > "$meta"

  log "CELL $cell DONE hit=$cache_hit mib_tok=$mib_tok tokens=$tokens gen_chars=$gen_chars die ${die_s_c}->${die_e_c} max=$die_max_c batt ${batt_s}->${batt_e} rc=$rc_bin stopped=$stopped"

  echo "$cell,$pname,$k,$wall_s,$wall_e,$elapsed,$n_prompt,$tokens,$cache_hit,$mib_tok,$read_mib,$CACHE_MB,$UBATCH,${n_expert_hdr:-$k},$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,$plugged_s,$gen_chars,$rc_bin,$stopped,$attempt" >> "$CSV_ALL"

  # Return special for retry
  if [ "$stopped" = "OOM_OR_KILL" ] || [ $rc_bin -ne 0 ]; then
    return 2
  fi
  return 0
}

# Main loop: per prompt, k=8 then 6,5,4
TOTAL=0
OK=0
FAIL=0
for i in "${!PROMPT_NAMES[@]}"; do
  pname="${PROMPT_NAMES[$i]}"
  n_gen="${PROMPT_NGEN[$i]}"
  for k in "${K_VALUES[@]}"; do
    TOTAL=$((TOTAL+1))
    cell="${pname}-k${k}"
    # skip if already done successfully
    if [ -f "$OUTDIR/${cell}.meta" ] && grep -q 'stopped=ok' "$OUTDIR/${cell}.meta" 2>/dev/null; then
      log "SKIP already ok $cell"
      OK=$((OK+1))
      continue
    fi
    set +e
    run_cell "$pname" "$k" "$n_gen" 1
    rc=$?
    set -e
    if [ $rc -eq 0 ]; then
      OK=$((OK+1))
    elif [ $rc -eq 2 ]; then
      log "RETRY once $cell after failure"
      wait_cool 70 400
      set +e
      run_cell "$pname" "$k" "$n_gen" 2
      rc2=$?
      set -e
      if [ $rc2 -eq 0 ]; then
        OK=$((OK+1))
      else
        FAIL=$((FAIL+1))
        log "FAIL $cell after retry"
      fi
    else
      FAIL=$((FAIL+1))
      log "ABORTING harness after hard fail on $cell"
      echo "ABORTED $cell $(ts) ok=$OK fail=$FAIL total_attempted=$TOTAL" > "$STATUS"
      exit 1
    fi
    # cool between cells
    wait_cool "$COOL_TARGET_C" 400
  done
done

BATT_END=$(termux-battery-status 2>/dev/null || echo '{}')
echo "$BATT_END" > "$OUTDIR/batt_end.json"
log "=== F5.5-B DONE ok=$OK fail=$FAIL total=$TOTAL ==="
echo "DONE ok=$OK fail=$FAIL total=$TOTAL $(ts)" > "$STATUS"
exit 0
