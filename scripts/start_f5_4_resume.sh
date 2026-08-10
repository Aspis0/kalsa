#!/data/data/com.termux/files/usr/bin/bash
# start_f5_4_resume.sh — F5.4 RESUME IN CARICA (after crash mid C@2500)
# ORDER remaining: C (2500/3000/3500) → D1 → B → D2
# Skips cells that already have .done. APPENDS master/CSV (no wipe).
# OOM at high cache IS a result (continue). STOP only on die > 98C.
# Stronger detach: nohup setsid + stdin closed; survives ssh drop.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/f5.4}"
mkdir -p "$OUTDIR" "$TMPDIR" \
  "$OUTDIR/c" "$OUTDIR/d1" "$OUTDIR/b" "$OUTDIR/d2" "$OUTDIR/prompts"
MASTER="$OUTDIR/F5.4.master.log"
PIDFILE="$OUTDIR/f5_4.pid"
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

MODEL35="${MODEL35:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
EXPECTED_SIZE35="11522702304"
MODEL_Q40="${MODEL_Q40:-$HOME/models/LFM2-8B-A1B-Q4_0.gguf}"
MODEL_Q4KM="${MODEL_Q4KM:-$HOME/models/LFM2-8B-A1B-Q4_K_M.gguf}"
EXPECTED_Q40="4733893312"
EXPECTED_Q4KM="5044779712"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
PROMPT_LONG_SRC="${PROMPT_LONG_SRC:-$HOME/experiments/prompts/long_conversational_it.txt}"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-b0c4e5b}"
MARK="F5.4 IN-CARICA"

THREADS=4
IO_THREADS=4
DIE_STOP_MC=98000

# C params
C_N_CTX=4096
C_N_PRED=256
C_UBATCH=512
C_N_REP=2
C_CACHES="2500 3000 3500"

# D1 params
D1_N_CTX=2048
D1_N_PRED=256
D1_CACHE_MB=2000

# B params
B_N_CTX=2048
B_N_PRED=128
B_CACHE_MB=400
B_UBATCH=256
B_N_REP=3

# D2 params
D2_N_CTX=4096
D2_N_PRED=256
D2_CACHE_MB=2000
D2_UBATCHES="256 512 1024 2048"

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

# STOP only on die>98. Battery floor does NOT apply while charging (mandate design).
safety_check() {
  local die_mc batt plugged
  die_mc=$(max_die_mc)
  read -r batt _ _ _ plugged <<<"$(batt_fields)"
  if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
    echo "STOP_DIE:$(mc_to_c "$die_mc")"
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
        case "$cmd" in *start_f5_4.sh*) ;; *)
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
  local target_c="${1:-55}" max_wait="${2:-120}"
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
      log "cool timeout die=${die_c}C after ${max_wait}s"
      return 0
    fi
    sleep 5
  done
}

json_get() {
  local line="$1" key="$2"
  echo "$line" | sed -n "s/.*\"${key}\":\([0-9.-][0-9.eE+-]*\).*/\1/p" | head -1
}

# ── detach entry ──
if [ "${1:-}" = "--detach" ]; then
  shift
  # Strong detach: setsid + nohup + stdin from /dev/null; log append
  cd "$HOME" || true
  nohup setsid bash "$0" --run "$@" < /dev/null >>"$OUTDIR/nohup_launch.log" 2>&1 &
  echo $! > "$OUTDIR/launcher.pid"
  disown 2>/dev/null || true
  sleep 1
  echo "LAUNCHED pid=$(cat "$OUTDIR/launcher.pid") log=$OUTDIR/nohup_launch.log"
  if kill -0 "$(cat "$OUTDIR/launcher.pid")" 2>/dev/null; then
    echo "DETACH_OK pid=$(cat "$OUTDIR/launcher.pid")"
  else
    echo "DETACH_FAIL"; exit 1
  fi
  exit 0
fi

if [ "${1:-}" != "--run" ]; then
  echo "Uso: start_f5_4_resume.sh --detach"
  exit 2
fi
shift || true

echo $$ > "$PIDFILE"
# RESUME: do NOT wipe MASTER/CSV/safety — append only
if [ ! -f "$CSV_ALL" ] || [ ! -s "$CSV_ALL" ]; then
  echo "cell,tag,phase,mark,wall_start,wall_end,elapsed_s,n_prompt,n_past,tokens,tok_s,prefill_s,prefill_tps,cache_hit_pct,compute_s_tok,io_s_tok,stall_s_tok,read_mib,mib_tok,rss_peak_kb,die_start_c,die_end_c,die_max_c,batt_start,batt_end,cur_freq0_avg,cur_freq3_avg,cur_freq5_avg,cur_freq7_avg,cur_freq_prime_avg,work,sched_reserve_mib,extra,stopped_reason,notes" > "$CSV_ALL"
fi
echo "RUNNING_RESUME $(ts)" > "$STATUS"
(
  while [ -f "$PIDFILE" ] && [ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ]; do
    echo "HB $(ts) pid=$$ cell=$(cat "$STATUS" 2>/dev/null | head -1)" > "$OUTDIR/WATCH.txt"
    sleep 15
  done
) &
HB_PID=$!

log "=== F5.4 RESUME START pid=$$ MARK='$MARK' ==="
log "bin=$BIN runtime_commit=$RUNTIME_COMMIT"
log "model35=$MODEL35 q40=$MODEL_Q40 q4km=$MODEL_Q4KM"
log "ORDER: C → D1 → B → D2"

if [ ! -x "$BIN" ]; then log "FATAL: binary missing"; echo "FATAL_NO_BIN" > "$STATUS"; exit 2; fi
SZ=$(stat -c%s "$MODEL35" 2>/dev/null || echo 0)
if [ "$SZ" != "$EXPECTED_SIZE35" ]; then log "FATAL: model35 size $SZ"; echo "FATAL_SIZE35" > "$STATUS"; exit 2; fi
SZ40=$(stat -c%s "$MODEL_Q40" 2>/dev/null || echo 0)
SZKM=$(stat -c%s "$MODEL_Q4KM" 2>/dev/null || echo 0)
if [ "$SZ40" != "$EXPECTED_Q40" ]; then log "FATAL: q40 size $SZ40"; echo "FATAL_SIZE_Q40" > "$STATUS"; exit 2; fi
if [ "$SZKM" != "$EXPECTED_Q4KM" ]; then log "FATAL: q4km size $SZKM"; echo "FATAL_SIZE_Q4KM" > "$STATUS"; exit 2; fi
NPROC=$(nproc)
if [ "$NPROC" -lt 6 ]; then log "FATAL: nproc=$NPROC"; echo "FATAL_NPROC" > "$STATUS"; exit 2; fi
CPUSET=$(cat /proc/self/cpuset 2>/dev/null || echo "?")
log "nproc=$NPROC cpuset=$CPUSET"

BINDIR=$(dirname "$BIN")
export LD_LIBRARY_PATH="${BINDIR}:${BINDIR}/..:${LD_LIBRARY_PATH:-}"
log "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"

HELP=$("$BIN" --help 2>&1 || true)
for f in ubatch session compute-trace cache-mb moe-stream overlap; do
  if echo "$HELP" | grep -q -- "--$f"; then log "FLAG_OK --$f"; else log "FLAG_MISS --$f"; fi
done

for c in 0 3 5 7; do
  if [ -r "/sys/devices/system/cpu/cpu$c/cpufreq/scaling_cur_freq" ]; then
    log "FREQ_OK cpu$c=$(cat /sys/devices/system/cpu/cpu$c/cpufreq/scaling_cur_freq)"
  else
    log "FREQ_MISS cpu$c"
  fi
done

BATT_JSON=$(termux-battery-status 2>/dev/null || echo '{}')
echo "$BATT_JSON" > "$OUTDIR/batt_start.json"
log "battery_start: $BATT_JSON"
PLUG=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("plugged","?"))' "$OUTDIR/batt_start.json" 2>/dev/null || echo "?")
log "plugged=$PLUG"
saf=$(safety_check) || { log "FATAL safety: $saf"; echo "FATAL_SAFETY $saf" > "$STATUS"; exit 2; }
log "safety $saf"
kill_bmoe_exact

# Prompt files — reuse existing if present (byte-identical across resume); else regenerate
if [ -f "$OUTDIR/prompts/long_it.txt" ] && [ -f "$OUTDIR/prompts/d1_prompt.txt" ] && [ -f "$OUTDIR/prompts/b_prompt.txt" ] && [ -f "$OUTDIR/prompts/hashes.txt" ]; then
  log "REUSING existing prompts (sha):"
  cat "$OUTDIR/prompts/hashes.txt" | tee -a "$MASTER"
else
log "Generating prompts"
python3 - <<'PY' > "$OUTDIR/prompts/long_it.txt"
base = open("/data/data/com.termux/files/home/experiments/prompts/long_conversational_it.txt", encoding="utf-8").read().strip()
instr = "Rispondi in italiano con un paragrafo continuo, senza elenchi. Continua il racconto in modo dettagliato. "
text = instr + (" " + base) * 12
print(text[:4500])
PY
python3 - <<'PY' > "$OUTDIR/prompts/d1_prompt.txt"
base = open("/data/data/com.termux/files/home/experiments/prompts/long_conversational_it.txt", encoding="utf-8").read().strip()
instr = (
  "Sei un narratore deterministico. Scrivi in italiano un racconto continuo e dettagliato "
  "senza elenchi puntati. Usa sempre gli stessi dettagli concreti: orario 23:17, carrozza 7, "
  "finestrino lato corridoio, valigia blu, biglietto posto 14B. Ambientazione treno notturno "
  "Milano-Napoli. Descrivi passeggeri, suoni, odori e pensieri del protagonista in prosa "
  "continua per almeno 200 parole. "
)
text = instr + (" " + base) * 14
print(text[:5200])
PY
python3 - <<'PY' > "$OUTDIR/prompts/b_prompt.txt"
base = open("/data/data/com.termux/files/home/experiments/prompts/long_conversational_it.txt", encoding="utf-8").read().strip()
instr = "Rispondi in italiano con un paragrafo continuo, senza elenchi. "
text = instr + (" " + base) * 6
print(text[:2200])
PY

{
  echo "prompt_src_sha=$(sha256sum "$PROMPT_LONG_SRC" | awk '{print $1}')"
  echo "long_it_sha=$(sha256sum "$OUTDIR/prompts/long_it.txt" | awk '{print $1}')"
  echo "d1_prompt_sha=$(sha256sum "$OUTDIR/prompts/d1_prompt.txt" | awk '{print $1}')"
  echo "b_prompt_sha=$(sha256sum "$OUTDIR/prompts/b_prompt.txt" | awk '{print $1}')"
  wc -c "$OUTDIR/prompts/"*.txt
} | tee -a "$MASTER" > "$OUTDIR/prompts/hashes.txt"
fi

# ── oneshot runner with cur_freq sampler + work metric ──
# args: cell model sub extra n_ctx n_pred pfile do_cold cache_mb ubatch phase_tag [temp_flag]
run_oneshot() {
  local cell="$1" model="$2" sub="$3" extra="$4" n_ctx="$5" n_pred="$6" pfile="$7"
  local do_cold="${8:-1}" cache_mb="${9:-2000}" ubatch="${10:-512}" phase_tag="${11:-X}"
  local temp_flag="${12:---temp 0}"
  local odir="$OUTDIR/$sub"
  mkdir -p "$odir"
  local slog="$odir/${cell}.stdout.log"
  local serr="$odir/${cell}.stderr.log"
  local csvp="$odir/${cell}.metrics.csv"
  local genf="$odir/${cell}.gen.txt"
  local donef="$odir/${cell}.done"
  local sampler_log="$odir/${cell}.sampler.csv"
  local meta="$odir/${cell}.meta.txt"
  # RESUME skip: if .done exists and meta has tokens>0 or reason=ok, skip
  if [ -f "$donef" ] && [ -f "$meta" ]; then
    local prev_reason prev_tokens
    prev_reason=$(grep '^reason=' "$meta" 2>/dev/null | head -1 | cut -d= -f2-)
    prev_tokens=$(grep '^tokens=' "$meta" 2>/dev/null | head -1 | cut -d= -f2-)
    if [ "${prev_tokens:-0}" != "0" ] || [ "$prev_reason" = "ok" ]; then
      log "SKIP already done $cell tokens=$prev_tokens reason=$prev_reason"
      return 0
    fi
  fi
  rm -f "$donef"

  log "==== CELL $cell model=$(basename "$model") cache=$cache_mb ubatch=$ubatch n_ctx=$n_ctx n_pred=$n_pred extra=[$extra] ===="
  echo "CELL $cell $(ts)" > "$STATUS"

  local saf
  saf=$(safety_check) || {
    log "STOP safety before $cell: $saf"
    echo "STOPPED $cell $saf $(ts)" > "$STATUS"
    echo "$cell,$phase_tag,$sub,$MARK,$(ts),$(ts),0,,,,,,,,,,,,,,,,,,,,,,,,,,,$saf,safety" >> "$CSV_ALL"
    return 1
  }
  log "safety $saf"
  kill_bmoe_exact
  if [ "$do_cold" = "1" ]; then
    log "cold_model $model"
    if ! "$COLD_MODEL_SH" "$model" >> "$MASTER" 2>&1; then
      log "WARN cold_model failed for $model (continuing)"
    fi
  fi

  local die_s_mc die_s_c batt_s wall_s wall_s_epoch
  die_s_mc=$(max_die_mc); die_s_c=$(mc_to_c "$die_s_mc")
  read -r batt_s _ _ _ _ <<<"$(batt_fields)"
  wall_s=$(ts); wall_s_epoch=$(date +%s)

  echo "ts_epoch_ms,die_max_c,read_bytes,rchar,vmrss_kb,cur_freq0,cur_freq3,cur_freq5,cur_freq7" > "$sampler_log"
  (
    while :; do
      [ -f "$donef" ] && break
      now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      die_c=$(mc_to_c "$(max_die_mc)")
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
      f0=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f3=$(cat /sys/devices/system/cpu/cpu3/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f5=$(cat /sys/devices/system/cpu/cpu5/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      f7=$(cat /sys/devices/system/cpu/cpu7/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)
      echo "${now_ms},${die_c},${rb},${rc},${rss},${f0},${f3},${f5},${f7}" >> "$sampler_log"
      if [ "$(max_die_mc)" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
        echo "[$(ts)] SAMPLER die>stop during $cell" >> "$SAFETY_LOG"
      fi
      sleep 0.5
    done
  ) &
  local samp_pid=$!

  local base_flags="--moe-stream --cache-mb ${cache_mb} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${ubatch}"
  set +e
  # shellcheck disable=SC2086
  "$BIN" -m "$model" -t "$THREADS" -c "$n_ctx" -n "$n_pred" \
    --chatml --no-think --progress --csv "$csvp" \
    $temp_flag \
    $base_flags $extra \
    -p "$(cat "$pfile")" \
    > "$slog" 2> "$serr"
  local rc_bin=$?
  set -e
  touch "$donef"
  wait "$samp_pid" 2>/dev/null || true

  local wall_e wall_e_epoch elapsed die_e_mc die_e_c batt_e
  wall_e=$(ts); wall_e_epoch=$(date +%s); elapsed=$((wall_e_epoch - wall_s_epoch))
  die_e_mc=$(max_die_mc); die_e_c=$(mc_to_c "$die_e_mc")
  read -r batt_e _ _ _ _ <<<"$(batt_fields)"

  if grep -q '=== answer ===' "$slog" 2>/dev/null; then
    sed -n '/=== answer ===/,/=== perf ===/{/=== answer ===/d;/=== perf ===/d;p}' "$slog" > "$genf"
  else
    grep -v BMOE_PROGRESS "$slog" 2>/dev/null | tail -300 > "$genf" || true
  fi

  local tok_s=0 tokens=0 compute_s_tok=0 io_s_tok=0 stall_s_tok=0 read_mib=0 mib_tok=0
  local prefill_s=0 prefill_tps=0 cache_hit=-1 n_prompt=0 n_past=0

  # Prefer stdout/stderr blob; avoid multi-file grep (filename: prefix corrupts numbers)
  local _blob
  _blob=$(cat "$slog" 2>/dev/null; echo; cat "$serr" 2>/dev/null)
  tokens=$(printf '%s' "$_blob" | grep -oE 'generation: [0-9]+ tokens' | head -1 | awk '{print $2}')
  tokens=${tokens:-0}
  tok_s=$(printf '%s' "$_blob" | grep -oE '\([0-9.]+ tok/s\)' | head -1 | tr -dc '0-9.')
  tok_s=${tok_s:-0}
  compute_s_tok=$(printf '%s' "$_blob" | grep -oE 'compute [0-9.]+ \+ cache' | head -1 | awk '{print $2}')
  compute_s_tok=${compute_s_tok:-0}
  io_s_tok=$(printf '%s' "$_blob" | grep -oE 'flash I/O [0-9.]+ s/token' | head -1 | awk '{print $3}')
  io_s_tok=${io_s_tok:-0}
  stall_s_tok=$(printf '%s' "$_blob" | grep -oE 'stall [0-9.]+ s/token' | head -1 | awk '{print $2}')
  stall_s_tok=${stall_s_tok:-0}
  read_mib=$(printf '%s' "$_blob" | grep -oE 'read [0-9.]+ MiB' | head -1 | awk '{print $2}')
  read_mib=${read_mib:-0}
  mib_tok=$(printf '%s' "$_blob" | grep -oE '\([0-9.]+ MiB/token\)' | head -1 | tr -dc '0-9.')
  mib_tok=${mib_tok:-0}
  cache_hit=$(printf '%s' "$_blob" | grep -oE 'moe-cache: [0-9.]+% hit' | head -1 | awk '{print $2}' | tr -d '%')
  cache_hit=${cache_hit:--1}
  if [ "$tok_s" = "0" ] || [ -z "$tok_s" ]; then
    tok_s=$(printf '%s' "$_blob" | grep -oE '[0-9.]+ tok/s' | head -1 | awk '{print $1}')
    tok_s=${tok_s:-0}
  fi
  prefill_s=$(printf '%s' "$_blob" | grep -oE 'prompt eval time =[[:space:]]*[0-9.]+' | head -1 | awk '{print $NF}')
  prefill_s=${prefill_s:-0}
  prefill_s=$(awk -v p="$prefill_s" 'BEGIN{ if(p>1000) printf "%.3f", p/1000; else printf "%.3f", p+0 }')
  prefill_tps=$(printf '%s' "$_blob" | grep -oE '[0-9.]+ tokens per second' | head -1 | awk '{print $1}')
  prefill_tps=${prefill_tps:-0}
  if [ "$prefill_tps" = "0" ] || [ -z "$prefill_tps" ]; then
    prefill_tps=$(printf '%s' "$_blob" | grep -oE 'prefill:.*\([0-9.]+ tok/s\)' | head -1 | grep -oE '[0-9.]+ tok/s' | head -1 | awk '{print $1}')
    prefill_tps=${prefill_tps:-0}
  fi

  local lastprog
  lastprog=$(grep BMOE_PROGRESS "$slog" 2>/dev/null | tail -1 || true)
  if [ -n "$lastprog" ]; then
    local pt pcs pts ch np
    pt=$(json_get "$lastprog" tokens); [ -n "$pt" ] && [ "$pt" != "0" ] && tokens=$pt
    pts=$(json_get "$lastprog" tok_s); [ -n "$pts" ] && [ "$pts" != "0" ] && tok_s=$pts
    pcs=$(json_get "$lastprog" compute_s_tok); [ -n "$pcs" ] && compute_s_tok=$pcs
    ch=$(json_get "$lastprog" cache_hit_pct); [ -n "$ch" ] && cache_hit=$ch
    np=$(json_get "$lastprog" n_past); [ -n "$np" ] && n_past=$np
  fi
  local doneline
  doneline=$(grep BMOE_DONE "$slog" 2>/dev/null | tail -1 || true)
  if [ -n "$doneline" ]; then
    local v
    v=$(json_get "$doneline" tokens); [ -n "$v" ] && tokens=$v
    v=$(json_get "$doneline" tok_s); [ -n "$v" ] && tok_s=$v
    v=$(json_get "$doneline" compute_s_tok); [ -n "$v" ] && compute_s_tok=$v
    v=$(json_get "$doneline" cache_hit_pct); [ -n "$v" ] && cache_hit=$v
    v=$(json_get "$doneline" prefill_s); [ -n "$v" ] && prefill_s=$v
    v=$(json_get "$doneline" prefill_tps); [ -n "$v" ] && prefill_tps=$v
    v=$(json_get "$doneline" n_prompt); [ -n "$v" ] && n_prompt=$v
    v=$(json_get "$doneline" n_past); [ -n "$v" ] && n_past=$v
    v=$(json_get "$doneline" io_s_tok); [ -n "$v" ] && io_s_tok=$v
    v=$(json_get "$doneline" stall_s_tok); [ -n "$v" ] && stall_s_tok=$v
    v=$(json_get "$doneline" read_mib); [ -n "$v" ] && read_mib=$v
  fi
  if [ -f "$csvp" ]; then
    python3 - "$csvp" <<'PY' > "$odir/${cell}.csv_parse.txt" 2>/dev/null || true
import sys,csv
p=sys.argv[1]
with open(p,encoding="utf-8",errors="replace") as f:
    r=csv.DictReader(f)
    rows=list(r)
if not rows: sys.exit(0)
last=rows[-1]
for k in ("tokens","tok_s","compute_s_tok","io_s_tok","stall_s_tok","cache_hit_pct","prefill_s","prefill_tps","n_prompt","n_past","read_mib","mib_tok"):
    if k in last and last[k] not in (None,""):
        print(f"{k}={last[k]}")
PY
    while IFS= read -r line; do
      case "$line" in
        tokens=*) tokens=${line#tokens=} ;;
        tok_s=*) tok_s=${line#tok_s=} ;;
        compute_s_tok=*) compute_s_tok=${line#compute_s_tok=} ;;
        io_s_tok=*) io_s_tok=${line#io_s_tok=} ;;
        stall_s_tok=*) stall_s_tok=${line#stall_s_tok=} ;;
        cache_hit_pct=*) cache_hit=${line#cache_hit_pct=} ;;
        prefill_s=*) prefill_s=${line#prefill_s=} ;;
        prefill_tps=*) prefill_tps=${line#prefill_tps=} ;;
        n_prompt=*) n_prompt=${line#n_prompt=} ;;
        n_past=*) n_past=${line#n_past=} ;;
        read_mib=*) read_mib=${line#read_mib=} ;;
        mib_tok=*) mib_tok=${line#mib_tok=} ;;
      esac
    done < "$odir/${cell}.csv_parse.txt"
  fi

  if [ "$prefill_tps" = "0" ] || [ -z "$prefill_tps" ]; then
    if [ -n "$n_prompt" ] && [ "$n_prompt" != "0" ] && [ -n "$prefill_s" ] && [ "$prefill_s" != "0" ]; then
      prefill_tps=$(awk -v n="$n_prompt" -v s="$prefill_s" 'BEGIN{ if(s+0>0) printf "%.3f", n/s; else print 0 }')
    fi
  fi

  local sched_mib
  sched_mib=$(grep -oE 'CPU compute buffer size =[[:space:]]*[0-9.]+ MiB' "$serr" 2>/dev/null | head -1 | awk '{print $(NF-1)}')
  sched_mib=${sched_mib:-0}

  local stats
  stats=$(python3 - "$sampler_log" "$die_s_c" "$die_e_c" <<'PY'
import sys
path, ds, de = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
die_max = max(ds, de)
rss_peak = 0
f0s=[]; f3s=[]; f5s=[]; f7s=[]
with open(path, encoding="utf-8", errors="replace") as f:
    next(f, None)
    for line in f:
        p=line.strip().split(",")
        if len(p) < 8: continue
        try:
            die=float(p[1]); rss=int(float(p[4]))
            f0=float(p[5]); f3=float(p[6]); f5=float(p[7]); f7=float(p[8]) if len(p)>8 else 0.0
        except Exception:
            continue
        if die > die_max: die_max = die
        if rss > rss_peak: rss_peak = rss
        f0s.append(f0); f3s.append(f3); f5s.append(f5); f7s.append(f7)
def avg(a):
    return round(sum(a)/len(a), 1) if a else 0.0
a0,a3,a5,a7 = avg(f0s), avg(f3s), avg(f5s), avg(f7s)
prime = a3 if a3 >= a5 else a5
print(f"{die_max:.1f} {rss_peak} {a0} {a3} {a5} {a7} {prime}")
PY
)
  local die_max_c rss_peak f0a f3a f5a f7a fprime
  read -r die_max_c rss_peak f0a f3a f5a f7a fprime <<<"$stats"

  # work = compute_s_tok * cur_freq_prime (kHz units; relative % identical to GHz)
  local work
  work=$(awk -v c="$compute_s_tok" -v f="$fprime" 'BEGIN{ printf "%.1f", (c+0)*(f+0) }')

  local stopped_reason="ok"
  if [ "$rc_bin" -ne 0 ]; then stopped_reason="bin_rc_$rc_bin"; fi
  if [ "$tokens" = "0" ] || [ -z "$tokens" ]; then
    if grep -qi 'killed\|lmkd\|out of memory\|Cannot allocate' "$slog" "$serr" 2>/dev/null; then
      stopped_reason="OOM_OR_KILL"
    elif [ "$rc_bin" -ne 0 ]; then
      stopped_reason="bin_rc_$rc_bin"
    fi
  fi
  if awk -v d="$die_max_c" 'BEGIN{exit !(d+0 > 98)}'; then
    stopped_reason="STOP_DIE:$die_max_c"
  fi

  local notes="model=$(basename "$model");cache_mb=${cache_mb};ubatch=${ubatch};n_ctx=${n_ctx};extra=${extra};${MARK}"
  log "$cell DONE tokens=$tokens tok_s=$tok_s prefill_tps=$prefill_tps compute=$compute_s_tok hit=$cache_hit mib_tok=$mib_tok sched=$sched_mib freq_prime=$fprime work=$work die_max=$die_max_c rss_peak=$rss_peak batt ${batt_s}->${batt_e} reason=$stopped_reason"

  echo "$cell,$phase_tag,$sub,$MARK,$wall_s,$wall_e,$elapsed,$n_prompt,$n_past,$tokens,$tok_s,$prefill_s,$prefill_tps,$cache_hit,$compute_s_tok,$io_s_tok,$stall_s_tok,$read_mib,$mib_tok,$rss_peak,$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,$f0a,$f3a,$f5a,$f7a,$fprime,$work,$sched_mib,$extra,$stopped_reason,$notes" >> "$CSV_ALL"
  {
    echo "cell=$cell"
    echo "mark=$MARK"
    echo "model=$(basename "$model")"
    echo "cache_mb=$cache_mb ubatch=$ubatch n_ctx=$n_ctx n_pred=$n_pred"
    echo "tokens=$tokens tok_s=$tok_s prefill_s=$prefill_s prefill_tps=$prefill_tps"
    echo "compute_s_tok=$compute_s_tok io_s_tok=$io_s_tok"
    echo "cache_hit=$cache_hit mib_tok=$mib_tok read_mib=$read_mib"
    echo "sched_reserve_mib=$sched_mib"
    echo "cur_freq0=$f0a cur_freq3=$f3a cur_freq5=$f5a cur_freq7=$f7a cur_freq_prime=$fprime"
    echo "work=$work"
    echo "die_max=$die_max_c rss_peak=$rss_peak elapsed=$elapsed"
    echo "batt_start=$batt_s batt_end=$batt_e"
    echo "rc=$rc_bin reason=$stopped_reason"
  } > "$meta"

  case "$stopped_reason" in
    STOP_DIE*) log "HARD STOP die"; echo "STOPPED $cell $stopped_reason $(ts)" > "$STATUS"; return 1 ;;
  esac
  return 0
}

# ═══════════════════════════════════════════════════════════════
# PHASE C — cache sweep h(C)
# ═══════════════════════════════════════════════════════════════
run_phase_c() {
  log "==== PHASE C RESUME cache sweep ${C_CACHES} ubatch=$C_UBATCH (skip done; OOM=result) ===="
  echo "PHASE_C $(ts)" > "$STATUS"
  local pfile="$OUTDIR/prompts/long_it.txt"
  local c rep cell last_ok_cache=2000
  if [ -f "$OUTDIR/c/F5.4-C-cache2000-r1.done" ]; then last_ok_cache=2000; fi
  for c in $C_CACHES; do
    # 3500 only if 3000 survived at least one rep with tokens>0
    if [ "$c" = "3500" ] && [ "$last_ok_cache" -lt 3000 ]; then
      log "SKIP cache 3500: last surviving cache=$last_ok_cache (<3000)"
      for rep in $(seq 1 "$C_N_REP"); do
        cell="F5.4-C-cache${c}-r${rep}"
        {
          echo "cell=$cell"
          echo "reason=SKIP_NO_HEADROOM last_ok=$last_ok_cache"
          echo "mark=$MARK"
          echo "tokens=0"
        } > "$OUTDIR/c/${cell}.meta.txt"
        echo "$cell,F5.4-C,c,$MARK,$(ts),$(ts),0,,,,,,,,,,,,,,,,,,,,,,,,,,SKIP_NO_HEADROOM,last_ok=$last_ok_cache;$MARK" >> "$CSV_ALL"
      done
      continue
    fi
    local survived_any=0
    for rep in $(seq 1 "$C_N_REP"); do
      saf=$(safety_check) || { log "STOP C mid: $saf"; echo "STOPPED C $saf $(ts)" > "$STATUS"; return 1; }
      cell="F5.4-C-cache${c}-r${rep}"
      # OOM is a result — run_oneshot returns 1 only on STOP_DIE
      if ! run_oneshot "$cell" "$MODEL35" "c" "" "$C_N_CTX" "$C_N_PRED" "$pfile" 1 "$c" "$C_UBATCH" "F5.4-C"; then
        log "HARD stop in C at $cell"
        return 1
      fi
      local tok rsn
      tok=$(grep '^tokens=' "$OUTDIR/c/${cell}.meta.txt" 2>/dev/null | head -1 | cut -d= -f2)
      rsn=$(grep '^reason=' "$OUTDIR/c/${cell}.meta.txt" 2>/dev/null | head -1 | cut -d= -f2-)
      if [ "${tok:-0}" != "0" ] && [ -n "${tok:-}" ]; then
        survived_any=1
        last_ok_cache=$c
      else
        log "C cell $cell did not produce tokens reason=$rsn (RAM limit candidate)"
      fi
      wait_cool 55 90
    done
    if [ "$survived_any" = "0" ]; then
      log "cache $c: zero surviving reps — further larger caches may be skipped by headroom rule"
    fi
  done
  log "PHASE C done last_ok_cache=$last_ok_cache"
  echo "PHASE_C_DONE $(ts) last_ok=$last_ok_cache" > "$OUTDIR/c/STATUS.txt"
  return 0
}

# ═══════════════════════════════════════════════════════════════
# PHASE D1 — ubatch 512 vs 2048 output equivalence (temp 0, same file)
# ═══════════════════════════════════════════════════════════════
run_phase_d1() {
  log "==== PHASE D1 start ubatch output equivalence ===="
  echo "PHASE_D1 $(ts)" > "$STATUS"
  local pfile="$OUTDIR/prompts/d1_prompt.txt"
  local sha
  sha=$(sha256sum "$pfile" | awk '{print $1}')
  log "D1 prompt sha256=$sha (must be identical for both runs)"
  cp -f "$pfile" "$OUTDIR/d1/d1_prompt.txt"
  echo "$sha" > "$OUTDIR/d1/prompt.sha256"

  saf=$(safety_check) || { log "STOP D1: $saf"; echo "STOPPED D1 $saf $(ts)" > "$STATUS"; return 1; }
  run_oneshot "F5.4-D1-ubatch512" "$MODEL35" "d1" "" "$D1_N_CTX" "$D1_N_PRED" "$pfile" 1 "$D1_CACHE_MB" 512 "F5.4-D1" "--temp 0" || return 1
  wait_cool 55 90

  saf=$(safety_check) || { log "STOP D1: $saf"; echo "STOPPED D1 $saf $(ts)" > "$STATUS"; return 1; }
  # CRITICAL: same file path → byte-identical prompt
  run_oneshot "F5.4-D1-ubatch2048" "$MODEL35" "d1" "" "$D1_N_CTX" "$D1_N_PRED" "$pfile" 1 "$D1_CACHE_MB" 2048 "F5.4-D1" "--temp 0" || return 1

  python3 - <<'PY' > "$OUTDIR/d1/compare.txt" 2>&1
from pathlib import Path
a = Path("/data/data/com.termux/files/home/experiments/results/f5.4/d1/F5.4-D1-ubatch512.gen.txt").read_text(encoding="utf-8", errors="replace")
b = Path("/data/data/com.termux/files/home/experiments/results/f5.4/d1/F5.4-D1-ubatch2048.gen.txt").read_text(encoding="utf-8", errors="replace")
a = a.strip(); b = b.strip()
print(f"len_512={len(a)} len_2048={len(b)}")
if a == b:
    print("VERDICT=IDENTICAL")
else:
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    print(f"VERDICT=DIVERGENT first_diff_at={i}")
    lo = max(0, i-40); hi = min(max(len(a), len(b)), i+40)
    print("CTX_512:", repr(a[lo:hi]))
    print("CTX_2048:", repr(b[lo:hi]))
    print(f"match_prefix_chars={i} match_prefix_frac={i/max(n,1):.4f}")
PY
  log "D1 compare: $(tr '\n' ' | ' < "$OUTDIR/d1/compare.txt")"
  log "PHASE D1 done"
  echo "PHASE_D1_DONE $(ts)" > "$OUTDIR/d1/STATUS.txt"
  return 0
}

# ═══════════════════════════════════════════════════════════════
# PHASE B — Q4_0 vs Q4_K_M interleaved A/B/A/B ×3 + compute-trace
# ═══════════════════════════════════════════════════════════════
run_phase_b() {
  log "==== PHASE B start Q4_0 vs Q4_K_M (interleaved) ===="
  echo "PHASE_B $(ts)" > "$STATUS"
  local pfile="$OUTDIR/prompts/b_prompt.txt"
  log "B config IDENTICAL: -t $THREADS -c $B_N_CTX -n $B_N_PRED --moe-stream --cache-mb $B_CACHE_MB --dense-weights anon --overlap --io-threads $IO_THREADS --ubatch $B_UBATCH --chatml --no-think"
  log "B reps=$B_N_REP interleaved Q40/Q4KM; cold before each; work=compute*freq_prime"

  local i
  for i in $(seq 1 "$B_N_REP"); do
    saf=$(safety_check) || { log "STOP B mid: $saf"; echo "STOPPED B $saf $(ts)" > "$STATUS"; return 1; }
    run_oneshot "F5.4-B-Q4_0-r${i}" "$MODEL_Q40" "b" "" "$B_N_CTX" "$B_N_PRED" "$pfile" 1 "$B_CACHE_MB" "$B_UBATCH" "F5.4-B" || return 1
    wait_cool 55 90

    saf=$(safety_check) || { log "STOP B mid: $saf"; echo "STOPPED B $saf $(ts)" > "$STATUS"; return 1; }
    run_oneshot "F5.4-B-Q4_K_M-r${i}" "$MODEL_Q4KM" "b" "" "$B_N_CTX" "$B_N_PRED" "$pfile" 1 "$B_CACHE_MB" "$B_UBATCH" "F5.4-B" || return 1
    wait_cool 55 90
  done

  saf=$(safety_check) || { log "STOP B before sentinel: $saf"; echo "STOPPED B $saf $(ts)" > "$STATUS"; return 1; }
  run_oneshot "F5.4-B-Q4_0-sent" "$MODEL_Q40" "b" "--compute-trace $OUTDIR/b/ct_q40.csv" "$B_N_CTX" "$B_N_PRED" "$pfile" 1 "$B_CACHE_MB" "$B_UBATCH" "F5.4-B" || true
  wait_cool 55 90
  saf=$(safety_check) || { log "STOP B before sentinel KM: $saf"; echo "STOPPED B $saf $(ts)" > "$STATUS"; return 1; }
  run_oneshot "F5.4-B-Q4_K_M-sent" "$MODEL_Q4KM" "b" "--compute-trace $OUTDIR/b/ct_q4km.csv" "$B_N_CTX" "$B_N_PRED" "$pfile" 1 "$B_CACHE_MB" "$B_UBATCH" "F5.4-B" || true

  log "PHASE B done"
  echo "PHASE_B_DONE $(ts)" > "$OUTDIR/b/STATUS.txt"
  return 0
}

# ═══════════════════════════════════════════════════════════════
# PHASE D2 — ubatch sweep 256/512/1024/2048
# ═══════════════════════════════════════════════════════════════
run_phase_d2() {
  log "==== PHASE D2 start ubatch sweep ${D2_UBATCHES} ===="
  echo "PHASE_D2 $(ts)" > "$STATUS"
  local pfile="$OUTDIR/prompts/long_it.txt"
  local u cell
  for u in $D2_UBATCHES; do
    saf=$(safety_check) || { log "STOP D2 mid: $saf"; echo "STOPPED D2 $saf $(ts)" > "$STATUS"; return 1; }
    cell="F5.4-D2-ubatch${u}"
    run_oneshot "$cell" "$MODEL35" "d2" "" "$D2_N_CTX" "$D2_N_PRED" "$pfile" 1 "$D2_CACHE_MB" "$u" "F5.4-D2" || return 1
    wait_cool 55 90
  done
  log "PHASE D2 done"
  echo "PHASE_D2_DONE $(ts)" > "$OUTDIR/d2/STATUS.txt"
  return 0
}

# ── main sequence C → D1 → B → D2 ──
PHASE_REACHED="none"
rc_c=0; rc_d1=0; rc_b=0; rc_d2=0

set +e
run_phase_c
rc_c=$?
set -e
PHASE_REACHED="C"
log "phase C rc=$rc_c"
if [ $rc_c -ne 0 ]; then
  BATT_END=$(termux-battery-status 2>/dev/null || echo '{}')
  echo "$BATT_END" > "$OUTDIR/batt_end.json"
  echo "DONE_PARTIAL $(ts) phase=$PHASE_REACHED rc_c=$rc_c" > "$STATUS"
  log "=== F5.4 STOPPED after C ==="
  exit 0
fi

set +e
run_phase_d1
rc_d1=$?
set -e
PHASE_REACHED="D1"
log "phase D1 rc=$rc_d1"
if [ $rc_d1 -ne 0 ]; then
  BATT_END=$(termux-battery-status 2>/dev/null || echo '{}')
  echo "$BATT_END" > "$OUTDIR/batt_end.json"
  echo "DONE_PARTIAL $(ts) phase=$PHASE_REACHED rc_d1=$rc_d1" > "$STATUS"
  log "=== F5.4 STOPPED after D1 ==="
  exit 0
fi

set +e
run_phase_b
rc_b=$?
set -e
PHASE_REACHED="B"
log "phase B rc=$rc_b"
if [ $rc_b -ne 0 ]; then
  BATT_END=$(termux-battery-status 2>/dev/null || echo '{}')
  echo "$BATT_END" > "$OUTDIR/batt_end.json"
  echo "DONE_PARTIAL $(ts) phase=$PHASE_REACHED rc_b=$rc_b" > "$STATUS"
  log "=== F5.4 STOPPED after B ==="
  exit 0
fi

set +e
run_phase_d2
rc_d2=$?
set -e
PHASE_REACHED="D2"
log "phase D2 rc=$rc_d2"

kill_bmoe_exact
BATT_END=$(termux-battery-status 2>/dev/null || echo '{}')
echo "$BATT_END" > "$OUTDIR/batt_end.json"
DIE_END=$(max_die_mc)
log "batt_end: $BATT_END"
log "die_end_mc=$DIE_END"
{
  echo "DONE $(ts)"
  echo "phase_reached=$PHASE_REACHED"
  echo "rc_c=$rc_c rc_d1=$rc_d1 rc_b=$rc_b rc_d2=$rc_d2"
  echo "runtime_commit=$RUNTIME_COMMIT"
  echo "nproc=$NPROC cpuset=$CPUSET"
  echo "mark=$MARK"
} > "$STATUS"
log "=== F5.4 RESUME COMPLETE phase=$PHASE_REACHED ==="; rm -f "$PIDFILE" 2>/dev/null || true
exit 0
