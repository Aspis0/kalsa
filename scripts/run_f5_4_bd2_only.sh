#!/data/data/com.termux/files/usr/bin/bash
# F5.4 B + D2 ONLY — IN CARICA, METRICA INVARIANTE
# B first (Q4_0 vs Q4_K_M interleaved), then D2 (ubatch sweep).
# Gates: termux-battery-status + die thermal. PREFIX/PATH for naked sshd.
# DIE STOP = 95C. Battery floor disabled while PLUGGED_AC.
# B stability: work replicates within ~10%; MemAvailable+RSS recorded each run.
set +e
set -u
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="$HOME/experiments/results/f5.4"
BDIR="$OUTDIR/b"
D2DIR="$OUTDIR/d2"
mkdir -p "$BDIR" "$D2DIR" "$OUTDIR/prompts"
MASTER="$OUTDIR/BD2.master.log"
STATUS="$OUTDIR/BD2.STATUS.txt"
PIDFILE="$OUTDIR/bd2.pid"
SAFETY_LOG="$OUTDIR/bd2.safety.log"
CSV_ALL="$OUTDIR/bd2_cells.csv"
B_STAB="$BDIR/stability.txt"

BIN="$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN"

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

export LD_LIBRARY_PATH="$(dirname "$BIN"):${LD_LIBRARY_PATH:-}"
MODEL35="${MODEL35:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
EXPECTED_SIZE35=11522702304
MODEL_Q40="$HOME/models/LFM2-8B-A1B-Q4_0.gguf"
MODEL_Q4KM="$HOME/models/LFM2-8B-A1B-Q4_K_M.gguf"
EXPECTED_Q40=4733893312
EXPECTED_Q4KM=5044779712
COLD="$HOME/bin/cold_model.sh"
MARK="F5.4 IN-CARICA"

THREADS=4
IO_THREADS=4
DIE_STOP_MC=95000

# B — mandate: -t 4 -c 4096 -n 256 --ubatch 512 --moe-stream --cache-mb 400
# cache small so BOTH models stay in same memory regime (C lesson)
B_N_CTX=4096
B_N_PRED=256
B_CACHE_MB=400
B_UBATCH=512
B_N_REP=3
B_PROMPT="$OUTDIR/prompts/b_prompt.txt"
B_WORK_TOL_PCT=10

# D2 — gate config
D2_N_CTX=4096
D2_N_PRED=256
D2_CACHE_MB=2000
D2_UBATCHES="256 512 1024 2048"
D2_PROMPT="$OUTDIR/d1/d1_prompt.txt"
if [ ! -f "$D2_PROMPT" ]; then D2_PROMPT="$HOME/experiments/prompts/d1_long.txt"; fi
if [ ! -f "$D2_PROMPT" ]; then D2_PROMPT="$OUTDIR/prompts/d1_prompt.txt"; fi
if [ ! -f "$D2_PROMPT" ]; then D2_PROMPT="$OUTDIR/prompts/long_it.txt"; fi

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

mem_available_kb() {
  awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null || echo 0
}
mem_total_kb() {
  awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null || echo 0
}

batt_json() { termux-battery-status 2>/dev/null; }

batt_fields() {
  batt_json | python3 -c '
import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get("percentage",-1), d.get("voltage",-1), d.get("current",0), d.get("temperature",-1), d.get("plugged","?"))
except Exception:
  print(-1,-1,0,-1,"?")
'
}

safety_check() {
  local die_mc die_c pct plug
  if ! command -v termux-battery-status >/dev/null 2>&1; then
    echo "NO_BATT_TOOL"
    return 1
  fi
  read -r pct _ _ _ plug <<<"$(batt_fields)"
  die_mc=$(max_die_mc)
  die_c=$(mc_to_c "$die_mc")
  if [ "$pct" -lt 0 ] 2>/dev/null; then
    echo "BATT_READ_FAIL die=$die_c"
    return 1
  fi
  if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
    echo "DIE_HOT die=$die_c"
    return 1
  fi
  echo "ok pct=$pct plug=$plug die=$die_c"
  return 0
}

kill_bmoe_exact() {
  local pid cmd
  for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cmd" in
      *"/bmoe-cli "*) kill "$pid" 2>/dev/null; sleep 1; kill -9 "$pid" 2>/dev/null || true;;
    esac
  done
  sleep 1
}

wait_cool() {
  local target="${1:-80}" maxw="${2:-180}"
  local start die
  start=$(date +%s)
  while :; do
    die=$(mc_to_c "$(max_die_mc)")
    awk -v d="$die" -v t="$target" 'BEGIN{exit !(d+0 <= t+0)}' && { log "cool OK die=$die <= $target"; return 0; }
    if [ $(( $(date +%s) - start )) -ge "$maxw" ]; then
      log "wait_cool timeout die=$die target=$target"
      return 0
    fi
    sleep 5
  done
}

json_get() {
  local line="$1" key="$2"
  echo "$line" | sed -n "s/.*\"${key}\":\([0-9.-][0-9.eE+-]*\).*/\1/p" | head -1
}

# run_oneshot cell model odir extra n_ctx n_pred pfile cache_mb ubatch phase_tag
run_oneshot() {
  local cell="$1" model="$2" odir="$3" extra="$4" n_ctx="$5" n_pred="$6" pfile="$7"
  local cache_mb="$8" ubatch="$9" phase_tag="${10}"
  local slog="$odir/${cell}.stdout.log"
  local serr="$odir/${cell}.stderr.log"
  local csvp="$odir/${cell}.metrics.csv"
  local genf="$odir/${cell}.gen.txt"
  local donef="$odir/${cell}.done"
  local sampler_log="$odir/${cell}.sampler.csv"
  local meta="$odir/${cell}.meta.txt"
  rm -f "$donef"

  log "==== CELL $cell model=$(basename "$model") cache=$cache_mb ubatch=$ubatch n_ctx=$n_ctx n_pred=$n_pred extra=[$extra] ===="
  echo "CELL $cell $(ts)" > "$STATUS"

  local saf
  saf=$(safety_check)
  if [ $? -ne 0 ]; then
    log "STOP safety before $cell: $saf"
    echo "STOPPED $cell $saf $(ts)" > "$STATUS"
    echo "$cell,$phase_tag,$MARK,$(ts),$(ts),0,,,,,,,,,,,,,,,,,,,,,,,,,,$saf,safety" >> "$CSV_ALL"
    return 1
  fi
  log "safety $saf"
  kill_bmoe_exact

  local mem_avail_pre mem_tot
  mem_avail_pre=$(mem_available_kb)
  mem_tot=$(mem_total_kb)
  log "mem_pre available_kb=$mem_avail_pre total_kb=$mem_tot"

  log "cold_model $model"
  if ! "$COLD" "$model" >> "$MASTER" 2>&1; then
    log "WARN cold_model failed for $model (continuing)"
  fi

  local die_s_mc die_s_c batt_s wall_s wall_s_epoch
  die_s_mc=$(max_die_mc); die_s_c=$(mc_to_c "$die_s_mc")
  read -r batt_s _ _ _ _ <<<"$(batt_fields)"
  wall_s=$(ts); wall_s_epoch=$(date +%s)

  echo "ts_epoch_ms,die_max_c,read_bytes,rchar,vmrss_kb,cur_freq0,cur_freq3,cur_freq5,cur_freq7,mem_available_kb" > "$sampler_log"
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
      mavail=$(mem_available_kb)
      echo "${now_ms},${die_c},${rb},${rc},${rss},${f0},${f3},${f5},${f7},${mavail}" >> "$sampler_log"
      if [ "$(max_die_mc)" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
        echo "[$(ts)] SAMPLER die>stop during $cell" >> "$SAFETY_LOG"
        if [ -n "$bpid" ]; then kill "$bpid" 2>/dev/null; sleep 1; kill -9 "$bpid" 2>/dev/null; fi
        break
      fi
      sleep 0.5
    done
  ) &
  local samp_pid=$!

  local base_flags
  if [ "$phase_tag" = "F5.4-B" ]; then
    # B: no --overlap (tight RAM); small cache + --force-cache (bin rejects <1500 without force)
    base_flags="--moe-stream --cache-mb ${cache_mb} --force-cache --dense-weights anon --io-threads ${IO_THREADS} --ubatch ${ubatch}"
  else
    base_flags="--moe-stream --cache-mb ${cache_mb} --dense-weights anon --overlap --io-threads ${IO_THREADS} --ubatch ${ubatch}"
  fi

  set +e
  # shellcheck disable=SC2086
  "$BIN" -m "$model" -t "$THREADS" -c "$n_ctx" -n "$n_pred" \
    --chatml --no-think --progress --csv "$csvp" \
    --temp 0 \
    $base_flags $extra \
    -p "$(cat "$pfile")" \
    > "$slog" 2> "$serr"
  local rc_bin=$?
  touch "$donef"
  wait "$samp_pid" 2>/dev/null || true
  # keep set +e for entire post-processing (empty logs / greps must not abort)

  local wall_e wall_e_epoch elapsed die_e_mc die_e_c batt_e mem_avail_post
  wall_e=$(ts); wall_e_epoch=$(date +%s); elapsed=$((wall_e_epoch - wall_s_epoch))
  die_e_mc=$(max_die_mc); die_e_c=$(mc_to_c "$die_e_mc")
  read -r batt_e _ _ _ _ <<<"$(batt_fields)"
  mem_avail_post=$(mem_available_kb)

  if grep -q '=== answer ===' "$slog" 2>/dev/null; then
    sed -n '/=== answer ===/,/=== perf ===/{/=== answer ===/d;/=== perf ===/d;p}' "$slog" > "$genf"
  else
    grep -v BMOE_PROGRESS "$slog" 2>/dev/null | tail -300 > "$genf" || true
  fi

  local tok_s=0 tokens=0 compute_s_tok=0 io_s_tok=0 stall_s_tok=0 read_mib=0 mib_tok=0
  local prefill_s=0 prefill_tps=0 cache_hit=-1 n_prompt=0 n_past=0

  tokens=$(grep -oE 'generation: [0-9]+ tokens' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  tokens=${tokens:-0}
  tok_s=$(grep -oE '\([0-9.]+ tok/s\)' "$slog" "$serr" 2>/dev/null | head -1 | tr -dc '0-9.')
  tok_s=${tok_s:-0}
  compute_s_tok=$(grep -oE 'compute [0-9.]+ \+ cache' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  compute_s_tok=${compute_s_tok:-0}
  io_s_tok=$(grep -oE 'flash I/O [0-9.]+ s/token' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $3}')
  io_s_tok=${io_s_tok:-0}
  stall_s_tok=$(grep -oE 'stall [0-9.]+ s/token' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  stall_s_tok=${stall_s_tok:-0}
  read_mib=$(grep -oE 'read [0-9.]+ MiB' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  read_mib=${read_mib:-0}
  mib_tok=$(grep -oE '\([0-9.]+ MiB/token\)' "$slog" "$serr" 2>/dev/null | head -1 | tr -dc '0-9.')
  mib_tok=${mib_tok:-0}
  cache_hit=$(grep -oE 'moe-cache: [0-9.]+% hit' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '%')
  cache_hit=${cache_hit:--1}
  if [ "$tok_s" = "0" ] || [ -z "$tok_s" ]; then
    tok_s=$(grep -oE '[0-9.]+ tok/s' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $1}')
    tok_s=${tok_s:-0}
  fi
  prefill_s=$(grep -oE 'prompt eval time =[[:space:]]*[0-9.]+' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $NF}')
  prefill_s=${prefill_s:-0}
  prefill_s=$(awk -v p="$prefill_s" 'BEGIN{ if(p>1000) printf "%.3f", p/1000; else printf "%.3f", p+0 }')
  prefill_tps=$(grep -oE '[0-9.]+ tokens per second' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $1}')
  prefill_tps=${prefill_tps:-0}

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
    python3 - "$csvp" <<'PYC' > "$odir/${cell}.csv_parse.txt" 2>/dev/null || true
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
PYC
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
  if [ -z "$sched_mib" ]; then
    sched_mib=$(grep -oiE 'compute buffer size[[:space:]]*=[[:space:]]*[0-9.]+' "$serr" 2>/dev/null | head -1 | grep -oE '[0-9.]+')
  fi
  sched_mib=${sched_mib:-0}

  local stats
  stats=$(python3 - "$sampler_log" "$die_s_c" "$die_e_c" <<'PYS'
import sys
path, ds, de = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
die_max = max(ds, de)
rss_peak = 0
mem_min = None
f0s=[]; f3s=[]; f5s=[]; f7s=[]
with open(path, encoding="utf-8", errors="replace") as f:
    next(f, None)
    for line in f:
        p=line.strip().split(",")
        if len(p) < 8: continue
        try:
            die=float(p[1]); rss=int(float(p[4]))
            f0=float(p[5]); f3=float(p[6]); f5=float(p[7]); f7=float(p[8]) if len(p)>8 else 0.0
            mavail=float(p[9]) if len(p)>9 and p[9] else 0.0
        except Exception:
            continue
        if die > die_max: die_max = die
        if rss > rss_peak: rss_peak = rss
        if mavail > 0:
            if mem_min is None or mavail < mem_min: mem_min = mavail
        f0s.append(f0); f3s.append(f3); f5s.append(f5); f7s.append(f7)
def avg(a):
    return round(sum(a)/len(a), 1) if a else 0.0
a0,a3,a5,a7 = avg(f0s), avg(f3s), avg(f5s), avg(f7s)
prime = a3 if a3 >= a5 else a5
mem_min = int(mem_min) if mem_min is not None else 0
print(f"{die_max:.1f} {rss_peak} {a0} {a3} {a5} {a7} {prime} {mem_min}")
PYS
)
  local die_max_c rss_peak f0a f3a f5a f7a fprime mem_avail_min
  read -r die_max_c rss_peak f0a f3a f5a f7a fprime mem_avail_min <<<"$stats"

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
  if awk -v d="$die_max_c" 'BEGIN{exit !(d+0 > 95)}'; then
    stopped_reason="STOP_DIE:$die_max_c"
  fi

  local notes="model=$(basename "$model");cache_mb=${cache_mb};ubatch=${ubatch};n_ctx=${n_ctx};extra=${extra};mem_pre=${mem_avail_pre};mem_min=${mem_avail_min};mem_post=${mem_avail_post};${MARK}"
  log "$cell DONE tokens=$tokens tok_s=$tok_s prefill_tps=$prefill_tps compute=$compute_s_tok hit=$cache_hit sched=$sched_mib freq_prime=$fprime work=$work die_max=$die_max_c rss_peak=$rss_peak mem_pre=$mem_avail_pre mem_min=$mem_avail_min mem_post=$mem_avail_post batt ${batt_s}->${batt_e} reason=$stopped_reason"

  echo "$cell,$phase_tag,$MARK,$wall_s,$wall_e,$elapsed,$n_prompt,$n_past,$tokens,$tok_s,$prefill_s,$prefill_tps,$cache_hit,$compute_s_tok,$io_s_tok,$stall_s_tok,$read_mib,$mib_tok,$rss_peak,$die_s_c,$die_e_c,$die_max_c,$batt_s,$batt_e,$f0a,$f3a,$f5a,$f7a,$fprime,$work,$sched_mib,$extra,$stopped_reason,$mem_avail_pre,$mem_avail_min,$mem_avail_post,$notes" >> "$CSV_ALL"
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
    echo "mem_available_pre_kb=$mem_avail_pre mem_available_min_kb=$mem_avail_min mem_available_post_kb=$mem_avail_post"
    echo "batt_start=$batt_s batt_end=$batt_e"
    echo "rc=$rc_bin reason=$stopped_reason"
  } > "$meta"

  case "$stopped_reason" in
    STOP_DIE*) log "HARD STOP die"; echo "STOPPED $cell $stopped_reason $(ts)" > "$STATUS"; return 1 ;;
  esac
  return 0
}

# ── entry ──
echo $$ > "$PIDFILE"
: > "$MASTER"
: > "$SAFETY_LOG"
: > "$B_STAB"
echo "cell,tag,mark,wall_start,wall_end,elapsed_s,n_prompt,n_past,tokens,tok_s,prefill_s,prefill_tps,cache_hit_pct,compute_s_tok,io_s_tok,stall_s_tok,read_mib,mib_tok,rss_peak_kb,die_start_c,die_end_c,die_max_c,batt_start,batt_end,cur_freq0_avg,cur_freq3_avg,cur_freq5_avg,cur_freq7_avg,cur_freq_prime_avg,work,sched_reserve_mib,extra,stopped_reason,mem_avail_pre_kb,mem_avail_min_kb,mem_avail_post_kb,notes" > "$CSV_ALL"

log "=== F5.4 B+D2 START pid=$$ MARK='$MARK' ==="
log "bin=$BIN LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
log "PATH_has_termux=$(command -v termux-battery-status)"

if ! command -v termux-battery-status >/dev/null 2>&1; then
  log "FAIL termux-battery-status not in PATH"
  echo "FAIL no_batt_tool $(ts)" > "$STATUS"
  exit 2
fi

NPROC=$(nproc)
if [ "$NPROC" -lt 6 ]; then
  log "FATAL nproc=$NPROC"
  echo "FATAL_NPROC $NPROC $(ts)" > "$STATUS"
  exit 2
fi
log "nproc=$NPROC cpuset=$(cat /proc/self/cpuset 2>/dev/null || echo '?')"

if [ ! -x "$BIN" ]; then log "FATAL bin"; echo "FATAL_BIN" > "$STATUS"; exit 2; fi
SZ40=$(stat -c%s "$MODEL_Q40" 2>/dev/null || echo 0)
SZKM=$(stat -c%s "$MODEL_Q4KM" 2>/dev/null || echo 0)
SZ35=$(stat -c%s "$MODEL35" 2>/dev/null || echo 0)
if [ "$SZ40" != "$EXPECTED_Q40" ]; then log "FATAL q40 size $SZ40"; echo "FATAL_Q40" > "$STATUS"; exit 2; fi
if [ "$SZKM" != "$EXPECTED_Q4KM" ]; then log "FATAL q4km size $SZKM"; echo "FATAL_Q4KM" > "$STATUS"; exit 2; fi
if [ "$SZ35" != "$EXPECTED_SIZE35" ]; then log "FATAL model35 size $SZ35"; echo "FATAL_35" > "$STATUS"; exit 2; fi
log "sizes OK q40=$SZ40 q4km=$SZKM m35=$SZ35"

for c in 0 3 5 7; do
  if [ -r "/sys/devices/system/cpu/cpu$c/cpufreq/scaling_cur_freq" ]; then
    log "FREQ_OK cpu$c=$(cat /sys/devices/system/cpu/cpu$c/cpufreq/scaling_cur_freq)"
  else
    log "FREQ_MISS cpu$c"
  fi
done

if [ ! -f "$B_PROMPT" ] || [ ! -s "$B_PROMPT" ]; then
  python3 - <<'PYP' > "$B_PROMPT"
base = open("/data/data/com.termux/files/home/experiments/prompts/long_conversational_it.txt", encoding="utf-8").read().strip()
instr = "Rispondi in italiano con un paragrafo continuo, senza elenchi. "
text = instr + (" " + base) * 6
print(text[:2200])
PYP
fi
log "B_PROMPT=$B_PROMPT sha=$(sha256sum "$B_PROMPT" | awk '{print $1}') bytes=$(wc -c < "$B_PROMPT")"
log "D2_PROMPT=$D2_PROMPT sha=$(sha256sum "$D2_PROMPT" | awk '{print $1}') bytes=$(wc -c < "$D2_PROMPT")"
log "mem_total_kb=$(mem_total_kb) mem_available_kb=$(mem_available_kb)"

saf=$(safety_check)
src=$?
log "preflight safety: $saf"
if [ $src -ne 0 ]; then
  echo "STOPPED preflight $saf $(ts)" > "$STATUS"
  exit 1
fi
kill_bmoe_exact

# ═══════════════════════════════════════════════════════════════
# PHASE B — Q4_0 vs Q4_K_M interleaved A/B x3
# Config IDENTICA: -t 4 -c 4096 -n 256 --ubatch 512 --moe-stream --cache-mb 400
# Stability: work within ~10% across same-model reps; MemAvailable/RSS compared
# ═══════════════════════════════════════════════════════════════
log "==== PHASE B start Q4_0 vs Q4_K_M interleaved ===="
log "B CONFIG IDENTICAL: -t $THREADS -c $B_N_CTX -n $B_N_PRED --ubatch $B_UBATCH --moe-stream --cache-mb $B_CACHE_MB --force-cache --dense-weights anon --io-threads $IO_THREADS --chatml --no-think --temp 0 (NO --overlap; force-cache for <1500)"
log "B cache reduced to $B_CACHE_MB so BOTH Q4_0 (4.7GB) and Q4_K_M (5.0GB) stay same memory regime; RSS+MemAvailable recorded per run"
log "B order: Q4_0 / Q4_K_M x3; cold each; work=compute*freq_prime; cache_mb=$B_CACHE_MB (small for same memory regime)"
echo "PHASE_B $(ts)" > "$STATUS"
echo "PHASE_B $(ts)" > "$BDIR/STATUS.txt"
echo "cache_mb=$B_CACHE_MB n_ctx=$B_N_CTX n_pred=$B_N_PRED ubatch=$B_UBATCH threads=$THREADS" > "$B_STAB"

B_OK=1
i=1
while [ "$i" -le "$B_N_REP" ]; do
  saf=$(safety_check)
  if [ $? -ne 0 ]; then log "STOP B mid: $saf"; echo "STOPPED B $saf $(ts)" > "$STATUS"; B_OK=0; break; fi
  run_oneshot "F5.4-B-Q4_0-r${i}" "$MODEL_Q40" "$BDIR" "" "$B_N_CTX" "$B_N_PRED" "$B_PROMPT" "$B_CACHE_MB" "$B_UBATCH" "F5.4-B"
  if [ $? -ne 0 ]; then B_OK=0; break; fi
  wait_cool 80 120

  saf=$(safety_check)
  if [ $? -ne 0 ]; then log "STOP B mid: $saf"; echo "STOPPED B $saf $(ts)" > "$STATUS"; B_OK=0; break; fi
  run_oneshot "F5.4-B-Q4_K_M-r${i}" "$MODEL_Q4KM" "$BDIR" "" "$B_N_CTX" "$B_N_PRED" "$B_PROMPT" "$B_CACHE_MB" "$B_UBATCH" "F5.4-B"
  if [ $? -ne 0 ]; then B_OK=0; break; fi
  wait_cool 80 120
  i=$((i+1))
done

# Stability check on work across replicates (same model)
if [ "$B_OK" -eq 1 ]; then
  python3 - "$BDIR" "$B_STAB" "$B_WORK_TOL_PCT" <<'PYSTAB' | tee -a "$MASTER" >> "$B_STAB"
import sys, pathlib
bdir = pathlib.Path(sys.argv[1])
tol = float(sys.argv[3])
rows = []
for p in sorted(bdir.glob("F5.4-B-*.meta.txt")):
    if "sent" in p.name: continue
    d = {}
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        if "=" in line:
            k,v = line.split("=",1)
            d[k.strip()] = v.strip()
    d["cell"] = p.name.replace(".meta.txt","")
    rows.append(d)

def fnum(x, default=0.0):
    try: return float(x)
    except: return default

def analyze(label, pred):
    rs = [r for r in rows if pred(r) and "sent" not in r.get("cell","")]
    works = [fnum(r.get("work")) for r in rs if fnum(r.get("work")) > 0]
    rss = [fnum(r.get("rss_peak")) for r in rs]
    mems = [fnum(r.get("mem_available_min_kb")) for r in rs]
    print(f"=== {label} n={len(rs)} ===")
    for r in rs:
        print(f"  {r.get('cell')}: work={r.get('work')} compute={r.get('compute_s_tok')} freq={r.get('cur_freq_prime')} rss={r.get('rss_peak')} mem_min={r.get('mem_available_min_kb')} tok_s={r.get('tok_s')}")
    if not works:
        print(f"STAB_{label}=NO_DATA")
        return False, works, rss, mems
    wmin, wmax = min(works), max(works)
    mid = (wmin+wmax)/2.0 if (wmin+wmax) else 1.0
    spread_pct = 100.0 * (wmax - wmin) / mid if mid else 999.0
    sw = sorted(works)
    med = sw[len(sw)//2]
    max_dev = max(abs(w-med)/med*100.0 for w in works) if med else 999
    ok = max_dev <= tol and spread_pct <= (tol*2)
    print(f"work_min={wmin} work_max={wmax} work_med={med} spread_pct={spread_pct:.2f} max_dev_from_med_pct={max_dev:.2f} tol={tol}")
    print(f"rss_min={min(rss) if rss else 0} rss_max={max(rss) if rss else 0}")
    print(f"mem_min_kb range: {min(mems) if mems else 0}..{max(mems) if mems else 0}")
    print(f"STAB_{label}={'OK' if ok else 'FAIL'}")
    return ok, works, rss, mems

ok40, w40, r40, m40 = analyze("Q4_0", lambda r: "Q4_0" in r.get("model",""))
okkm, wkm, rkm, mkm = analyze("Q4_K_M", lambda r: "Q4_K_M" in r.get("model",""))

if r40 and rkm:
    rss40 = sum(r40)/len(r40); rsskm = sum(rkm)/len(rkm)
    print(f"RSS_mean Q4_0={rss40:.0f} Q4_K_M={rsskm:.0f} delta_pct={100*(rsskm-rss40)/max(rss40,1):.2f}")
if m40 and mkm and min(m40)>0 and min(mkm)>0:
    mm40 = sum(m40)/len(m40); mmkm = sum(mkm)/len(mkm)
    print(f"MemAvail_min_mean Q4_0={mm40:.0f} Q4_K_M={mmkm:.0f} delta_pct={100*(mmkm-mm40)/max(mm40,1):.2f}")
    if abs(mmkm - mm40) / max(mm40, mmkm, 1) > 0.25:
        print("MEM_REGIME=MISMATCH (>25% MemAvailable difference)")
        ok40 = False
        okkm = False
    else:
        print("MEM_REGIME=SIMILAR")

if ok40 and okkm:
    def med(a):
        s=sorted(a); return s[len(s)//2]
    m40w, mkmw = med(w40), med(wkm)
    if mkmw > 0:
        pct_less = 100.0 * (mkmw - m40w) / mkmw
    else:
        pct_less = 0.0
    print(f"MEDIAN_WORK Q4_0={m40w} Q4_K_M={mkmw} Q4_0_pct_less_work={pct_less:.2f}")
    if pct_less >= 20:
        verd = "VIVO"
    elif pct_less >= -5:
        verd = "marginale"
    else:
        verd = "MORTO"
    print(f"VERDICT_B={verd}")
    print("B_VALID=1")
else:
    print("VERDICT_B=INVALID_UNSTABLE")
    print("B_VALID=0")
    print("B non valida: work instabile (regime memoria diverso tra repliche) o dati mancanti")
PYSTAB
  if grep -q 'B_VALID=0' "$B_STAB" 2>/dev/null; then
    log "B STABILITY FAIL — report will say non valida; sentinels skipped"
    B_OK=0
    echo "PHASE_B_INVALID $(ts)" > "$BDIR/STATUS.txt"
  fi
fi

# Optional compute-trace sentinels only if B valid
if [ "$B_OK" -eq 1 ]; then
  saf=$(safety_check)
  if [ $? -eq 0 ]; then
    log "B compute-trace sentinel Q4_0"
    run_oneshot "F5.4-B-Q4_0-sent" "$MODEL_Q40" "$BDIR" "--compute-trace $BDIR/ct_q40.csv" "$B_N_CTX" "$B_N_PRED" "$B_PROMPT" "$B_CACHE_MB" "$B_UBATCH" "F5.4-B" || true
    wait_cool 80 120
  fi
  saf=$(safety_check)
  if [ $? -eq 0 ]; then
    log "B compute-trace sentinel Q4_K_M"
    run_oneshot "F5.4-B-Q4_K_M-sent" "$MODEL_Q4KM" "$BDIR" "--compute-trace $BDIR/ct_q4km.csv" "$B_N_CTX" "$B_N_PRED" "$B_PROMPT" "$B_CACHE_MB" "$B_UBATCH" "F5.4-B" || true
    wait_cool 80 120
  fi
  log "PHASE B done (valid)"
  echo "PHASE_B_DONE $(ts)" > "$BDIR/STATUS.txt"
else
  log "PHASE B incomplete or invalid — continue to D2"
fi

# ═══════════════════════════════════════════════════════════════
# PHASE D2 — ubatch sweep
# ═══════════════════════════════════════════════════════════════
log "==== PHASE D2 start ubatch sweep ${D2_UBATCHES} ===="
log "D2 CONFIG: -t $THREADS -c $D2_N_CTX -n $D2_N_PRED --cache-mb $D2_CACHE_MB --dense-weights anon --overlap --io-threads $IO_THREADS --moe-stream --chatml --no-think --temp 0"
log "D2 prompt=$D2_PROMPT"
echo "PHASE_D2 $(ts)" > "$STATUS"
echo "PHASE_D2 $(ts)" > "$D2DIR/STATUS.txt"

D2_OK=1
for u in $D2_UBATCHES; do
  saf=$(safety_check)
  if [ $? -ne 0 ]; then log "STOP D2 mid: $saf"; echo "STOPPED D2 $saf $(ts)" > "$STATUS"; D2_OK=0; break; fi
  run_oneshot "F5.4-D2-ubatch${u}" "$MODEL35" "$D2DIR" "" "$D2_N_CTX" "$D2_N_PRED" "$D2_PROMPT" "$D2_CACHE_MB" "$u" "F5.4-D2"
  if [ $? -ne 0 ]; then D2_OK=0; break; fi
  wait_cool 80 120
done

if [ "$D2_OK" -eq 1 ]; then
  log "PHASE D2 done"
  echo "PHASE_D2_DONE $(ts)" > "$D2DIR/STATUS.txt"
else
  log "PHASE D2 incomplete"
  echo "PHASE_D2_PARTIAL $(ts)" > "$D2DIR/STATUS.txt"
fi

kill_bmoe_exact
BATT_END=$(batt_json || echo '{}')
echo "$BATT_END" > "$OUTDIR/bd2_batt_end.json"
DIE_END=$(mc_to_c "$(max_die_mc)")
log "batt_end: $BATT_END"
log "die_end=$DIE_END"
{
  echo "DONE $(ts)"
  echo "B_OK=$B_OK D2_OK=$D2_OK"
  echo "mark=$MARK"
  echo "die_end=$DIE_END"
  echo "B_cache_mb=$B_CACHE_MB"
} > "$STATUS"
log "=== F5.4 B+D2 COMPLETE B_OK=$B_OK D2_OK=$D2_OK ==="
exit 0
