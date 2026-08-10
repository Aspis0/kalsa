#!/data/data/com.termux/files/usr/bin/bash
# run_2_thread_sweep.sh — BUCO 2: thread sweep (-t 4/5/6[/7]) on CAMPAIGN binary
# Mandato: mandates/buchi-calcolo.md BUCO 2
# Predizione a verbale: -t5/6 ±0 vs -t4
# Drop F: 0.65 (valore campagna corrente post speed-065; dichiarato)
# Solo f45_1_esplicativo, n=200, 2 rep, cold, UNPLUGGED.
# Se med(t6) >= med(t4) → add -t7. Vincitore × sostenuto n=512 (2 rep).
# STOP ai gate. Nessun rebuild. CAMPAIGN pin.
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
export LC_ALL=C

OUTDIR="${OUTDIR:-$HOME/experiments/results/buchi/thread}"
mkdir -p "$OUTDIR"/{runs,sostenuto} "$TMPDIR"
MASTER="$OUTDIR/THREAD_SWEEP.master.log"
PIDFILE="$OUTDIR/thread_sweep.pid"
STATUS="$OUTDIR/STATUS.txt"
FLIGHT_LOG="$OUTDIR/flight.log"
FLIGHT_PIDF="$OUTDIR/flight.pid"
CELL_CSV="$OUTDIR/runs.csv"
TAG_PHASE="BUCHI-THREAD-2"
DROP_F="0.65"   # DECLARED: campaign current after speed-065 (not harness default 0.50)

BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf}"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
PROMPTS_DIR="${PROMPTS_DIR:-$HOME/experiments/prompts}"
PROMPT_FILE="$PROMPTS_DIR/f45_1_esplicativo.txt"
PROMPT_ID="f45_1_esplicativo"
PROMPT_SHA_EXPECTED="bc5c1e584031aa57f53d47ecabe8139537fbd54c32421ce4ca9ef2204f55cbcf"
RUNTIME_COMMIT="${RUNTIME_COMMIT:-1ca51420}"

IO_THREADS=4
N_CTX=4096
N_GEN=200
N_SOSTENUTO=512
UBATCH=512
CACHE_MB=2000
N_EXPERT=8
DIE_STOP_MC=98000
DIE_START_MC=80000
BATT_STOP=30

echo $$ > "$PIDFILE"
echo "RUNNING $(date -Iseconds)" > "$STATUS"

# --- campaign pin ---
_PIN_LIB=""
for _d in \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" \
  "$HOME/experiments/scripts" \
  "$HOME/experiments/results/buchi"
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
  case "$BIN" in *.CAMPAIGN) ;; *)
    echo "ERRORE pin: usare bmoe-cli.CAMPAIGN" >&2; exit 6;;
  esac
  if [ -z "$_exp" ] || [ "$_got" != "$_exp" ]; then
    echo "ERRORE pin sha mismatch got=$_got exp=$_exp" >&2; exit 6
  fi
fi
export BIN_SHA256="${BIN_SHA256:-}"

# --- guardrail ---
_GR_LIB=""
for _d in \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" \
  "$HOME/experiments/scripts"
do
  [ -n "$_d" ] && [ -f "$_d/lib_guardrails.sh" ] && _GR_LIB="$_d/lib_guardrails.sh" && break
done
if [ -n "$_GR_LIB" ]; then
  # shellcheck disable=SC1090
  source "$_GR_LIB"
else
  echo "WARN: lib_guardrails.sh assente" >&2
fi

BINDIR=$(dirname "$BIN")
export LD_LIBRARY_PATH="${BINDIR}:${BINDIR}/..:${LD_LIBRARY_PATH:-}"

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
  local out
  out=$(timeout 5 termux-battery-status 2>/dev/null || true)
  if [ -n "$out" ] && echo "$out" | grep -q 'percentage'; then
    echo "$out" | python3 -c '
import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get("percentage",-1), d.get("voltage",-1), d.get("current",0),
        d.get("temperature",-1), d.get("plugged","?"))
except Exception:
  print(-1,-1,0,-1,"?")
'
    return 0
  fi
  local pct temp st pl="UNPLUGGED"
  pct=$(cat /sys/class/power_supply/battery/capacity 2>/dev/null || echo -1)
  temp=$(cat /sys/class/power_supply/battery/temp 2>/dev/null || echo -1)
  if [ "$temp" -gt 100 ] 2>/dev/null; then
    temp=$(python3 -c "print(round($temp/10.0,1))" 2>/dev/null || echo -1)
  fi
  st=$(cat /sys/class/power_supply/battery/status 2>/dev/null || echo Unknown)
  case "$st" in Charging|Full) pl="PLUGGED";; esac
  echo "$pct -1 0 $temp $pl"
}

# best-effort CPU freq snapshot (kHz) for little/mid/big clusters
freq_snapshot() {
  local f0 f4 f7
  f0=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo NA)
  f4=$(cat /sys/devices/system/cpu/cpu4/cpufreq/scaling_cur_freq 2>/dev/null || echo NA)
  f7=$(cat /sys/devices/system/cpu/cpu7/cpufreq/scaling_cur_freq 2>/dev/null || echo NA)
  echo "cpu0=${f0};cpu4=${f4};cpu7=${f7}"
}

kill_bmoe() {
  local pid cmd
  for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cmd" in *"/bmoe-cli"*|*/bmoe-cli\ *)
      case "$cmd" in *run_2_thread*|*thread_sweep*) ;; *)
        kill "$pid" 2>/dev/null || true
        sleep 1
        kill -9 "$pid" 2>/dev/null || true
      ;; esac
    ;; esac
  done
  sleep 1
}

start_flight() {
  if [ -f "$FLIGHT_PIDF" ] && kill -0 "$(cat "$FLIGHT_PIDF")" 2>/dev/null; then
    log "flight already running pid=$(cat "$FLIGHT_PIDF")"
    return 0
  fi
  : > "$FLIGHT_LOG"
  echo "ts_epoch,ts_local,die_c,memfree_kb,batt_pct,plugged,freq_snap" > "$FLIGHT_LOG"
  (
    while :; do
      now=$(date +%s.%N 2>/dev/null || date +%s)
      iso=$(date '+%Y-%m-%dT%H:%M:%S%z')
      die=$(mc_to_c "$(max_die_mc)")
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      read -r bp _ _ _ pl <<<"$(batt_fields)"
      fs=$(freq_snapshot)
      echo "${now},${iso},${die},${mf},${bp},${pl},${fs}" >> "$FLIGHT_LOG"
      python3 -c "import os; f=open('$FLIGHT_LOG','a'); os.fsync(f.fileno()); f.close()" 2>/dev/null || true
      sleep 5
    done
  ) &
  echo $! > "$FLIGHT_PIDF"
  log "flight started pid=$(cat "$FLIGHT_PIDF")"
}

check_flight() {
  if [ ! -f "$FLIGHT_PIDF" ] || ! kill -0 "$(cat "$FLIGHT_PIDF")" 2>/dev/null; then
    log "WARN flight dead — restarting"
    start_flight
  fi
}

stop_flight() {
  if [ -f "$FLIGHT_PIDF" ]; then
    kill "$(cat "$FLIGHT_PIDF")" 2>/dev/null || true
    rm -f "$FLIGHT_PIDF"
  fi
}

repromote_termux() {
  termux-wake-lock >/dev/null 2>&1 || true
  echo "$(ts) nproc=$(nproc) cpuset=$(cat /proc/self/cpuset 2>/dev/null)" > "$OUTDIR/REPROMOTE.request"
  /system/bin/am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1 || true
  termux-notification --id buchi_thread --title "BUCHI-THREAD nproc" \
    --content "nproc=$(nproc): tieni Termux foreground / schermo acceso" >/dev/null 2>&1 || true
}

preflight_cella() {
  local cell="$1"
  check_flight
  local n die_mc die_c
  n=$(nproc)
  die_mc=$(max_die_mc)
  die_c=$(mc_to_c "$die_mc")
  read -r batt _ _ btemp plugged <<<"$(batt_fields)"
  log "PREFLIGHT $cell nproc=$n die=${die_c}C batt=$batt% plugged=$plugged btemp=$btemp freq=$(freq_snapshot)"

  if [ "$plugged" != "UNPLUGGED" ]; then
    log "FATAL PLUGGED=$plugged — not citable, STOP"
    echo "FATAL_PLUGGED $cell $(ts)" > "$STATUS"
    echo "PLUGGED" > "$OUTDIR/STOP_REASON.txt"
    return 4
  fi
  if [ "$batt" -ge 0 ] 2>/dev/null && [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then
    log "FATAL batt=$batt < $BATT_STOP"
    echo "FATAL_BATT $cell batt=$batt $(ts)" > "$STATUS"
    echo "BATT_LOW" > "$OUTDIR/STOP_REASON.txt"
    return 92
  fi
  local t0 now
  t0=$(date +%s)
  while :; do
    n=$(nproc)
    die_mc=$(max_die_mc)
    die_c=$(mc_to_c "$die_mc")
    read -r batt _ _ _ plugged <<<"$(batt_fields)"
    if [ "$plugged" != "UNPLUGGED" ]; then
      log "FATAL became PLUGGED during preflight wait"
      return 4
    fi
    if [ "$batt" -ge 0 ] 2>/dev/null && [ "$batt" -lt "$BATT_STOP" ] 2>/dev/null; then
      log "FATAL batt low during preflight wait"
      return 92
    fi
    if [ "$n" -ge 6 ] && [ "$die_mc" -le "$DIE_START_MC" ] 2>/dev/null; then
      rm -f "$OUTDIR/REPROMOTE.request"
      break
    fi
    now=$(date +%s)
    if [ $((now - t0)) -ge 600 ]; then
      if [ "$n" -lt 6 ]; then
        log "FATAL nproc=$n < 6 after 600s"
        echo "FATAL_NPROC $cell nproc=$n $(ts)" > "$STATUS"
        echo "NPROC_LOW" > "$OUTDIR/STOP_REASON.txt"
        return 93
      fi
      log "WARN die still ${die_c}C after 600s — proceed cautiously"
      break
    fi
    log "preflight wait cell=$cell nproc=$n die=${die_c}C — re-promote"
    repromote_termux
    sleep 30
  done
  n=$(nproc)
  if [ "$n" -lt 6 ]; then
    log "FATAL nproc=$n < 6"
    return 93
  fi
  log "PREFLIGHT $cell OK die=$(mc_to_c "$(max_die_mc)")C batt=$batt nproc=$n"
  return 0
}

run_single() {
  # args: label threads n_gen run_type out_prefix
  local label="$1" threads="$2" ngen="$3" rtype="$4" opfx="$5"
  local slog="${opfx}.stdout.log"
  local serr="${opfx}.stderr.log"
  local samp="${opfx}.sampler.csv"
  local sumf="${opfx}.summary.txt"
  : > "$slog"; : > "$serr"
  echo "ts_epoch_ms,die_c,vmrss_kb,vmhwm_kb,memfree_kb,freq_snap" > "$samp"

  log "---- single $label t=$threads n=$ngen type=$rtype ----"
  check_flight

  read -r batt_s _ _ btemp_s plugged_s <<<"$(batt_fields)"
  if [ "$plugged_s" != "UNPLUGGED" ]; then
    log "FATAL PLUGGED before $label"
    return 4
  fi
  if [ "$batt_s" -ge 0 ] 2>/dev/null && [ "$batt_s" -lt "$BATT_STOP" ] 2>/dev/null; then
    # finish in-progress only; before start → STOP
    log "FATAL batt=$batt_s < $BATT_STOP before start"
    echo "BATT_LOW" > "$OUTDIR/STOP_REASON.txt"
    return 92
  fi
  local die_s nproc_s freq_s
  die_s=$(mc_to_c "$(max_die_mc)")
  nproc_s=$(nproc)
  freq_s=$(freq_snapshot)

  local ptext
  ptext=$(cat "$PROMPT_FILE")
  local FLAGS=(
    -m "$MODEL" -p "$ptext" -t "$threads" -c "$N_CTX" -n "$ngen"
    --temp 0 --chatml --no-think --moe-stream
    --cache-mb "$CACHE_MB" --dense-weights anon --overlap
    --io-threads "$IO_THREADS" --ubatch "$UBATCH"
    --n-expert-used "$N_EXPERT"
    --drop-cold-experts "$DROP_F"
  )

  "$BIN" "${FLAGS[@]}" > "$slog" 2> "$serr" &
  local BPID=$!
  echo "$BPID" > "${opfx}.pid"

  (
    guardrails_reset 2>/dev/null || true
    while kill -0 "$BPID" 2>/dev/null; do
      now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
      die_mc=$(max_die_mc)
      die_c=$(mc_to_c "$die_mc")
      rss=0; hwm=0
      [ -r "/proc/$BPID/status" ] && rss=$(awk '/^VmRSS:/{print $2}' "/proc/$BPID/status")
      [ -r "/proc/$BPID/status" ] && hwm=$(awk '/^VmHWM:/{print $2}' "/proc/$BPID/status")
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      fs=$(freq_snapshot)
      echo "${now_ms},${die_c},${rss},${hwm},${mf},${fs}" >> "$samp"
      if type guardrail_tick >/dev/null 2>&1; then
        guardrail_tick "$die_mc" "${mf:-0}"
        if [ "$GR_ACTION" != "CONTINUE" ]; then
          if type guardrail_apply_to_pid >/dev/null 2>&1; then
            guardrail_apply_to_pid "$BPID" "$opfx"
          else
            kill -TERM "$BPID" 2>/dev/null || true
          fi
          echo "${GR_ACTION}" > "${opfx}.guardrail_action"
          break
        fi
      else
        if [ "$die_mc" -gt "$DIE_STOP_MC" ] 2>/dev/null; then
          kill -TERM "$BPID" 2>/dev/null || true
        fi
      fi
      sleep 0.5
    done
  ) &
  local SPID=$!

  local wall_s wall_e elapsed
  wall_s=$(date +%s)
  set +e
  wait "$BPID"
  local brc=$?
  set -e
  wall_e=$(date +%s)
  elapsed=$((wall_e - wall_s))
  kill "$SPID" 2>/dev/null || true
  wait "$SPID" 2>/dev/null || true

  read -r batt_e _ _ btemp_e _ <<<"$(batt_fields)"
  local die_e freq_e
  die_e=$(mc_to_c "$(max_die_mc)")
  freq_e=$(freq_snapshot)

  local prompt_tok_s="" eval_tok_s="" hit="" n_prompt=""
  local mib_tok="" drop_pct=""
  local _combo
  _combo=$(cat "$slog" "$serr" 2>/dev/null || true)
  eval_tok_s=$(printf '%s\n' "$_combo" | grep -E 'generation:.*tok/s' | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  prompt_tok_s=$(printf '%s\n' "$_combo" | grep -E 'prefill:.*tok/s' | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  hit=$(printf '%s\n' "$_combo" | grep -E 'moe-cache:.*hit' | tail -1 | sed -n 's/.*moe-cache: *\([0-9.]*\)% hit.*/\1/p' | head -1)
  n_prompt=$(printf '%s\n' "$_combo" | grep -E 'prefill: *[0-9]+ tokens' | tail -1 | sed -n 's/.*prefill: *\([0-9]*\) tokens.*/\1/p' | head -1)
  mib_tok=$(printf '%s\n' "$_combo" | grep -E 'MiB/token' | tail -1 | sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p' | head -1)
  drop_pct=$(printf '%s\n' "$_combo" | grep -E 'moe-drop:' | tail -1 | sed -n 's/.*(\([0-9.]*\)%).*/\1/p' | head -1)
  if [ -z "$drop_pct" ]; then drop_pct="0"; fi

  local memfree_min_kb vmhwm_max_kb die_max_c
  memfree_min_kb=$(awk -F, 'NR>1{if(m==""||$5+0<m)m=$5+0} END{print m+0}' "$samp")
  vmhwm_max_kb=$(awk -F, 'NR>1{if($4+0>m)m=$4+0} END{print m+0}' "$samp")
  die_max_c=$(awk -F, 'NR>1{if($2+0>m)m=$2+0} END{printf "%.1f", m+0}' "$samp")
  local memfree_min_mb vmrss_peak_mb
  memfree_min_mb=$(python3 -c "print(int($memfree_min_kb/1024))")
  vmrss_peak_mb=$(python3 -c "print(int($vmhwm_max_kb/1024))")

  {
    echo "label=$label"
    echo "threads=$threads"
    echo "n_gen=$ngen"
    echo "run_type=$rtype"
    echo "rc=$brc"
    echo "wall_s=$elapsed"
    echo "prompt_tok_s=$prompt_tok_s"
    echo "eval_tok_s=$eval_tok_s"
    echo "n_prompt=$n_prompt"
    echo "expert_hit_rate=$hit"
    echo "mib_per_token=$mib_tok"
    echo "drop_pct=$drop_pct"
    echo "memfree_min_mb=$memfree_min_mb"
    echo "vmhwm_mb=$vmrss_peak_mb"
    echo "die_max_c=$die_max_c"
    echo "batt_s=$batt_s batt_e=$batt_e"
    echo "die_s=$die_s die_e=$die_e"
    echo "freq_s=$freq_s"
    echo "freq_e=$freq_e"
    echo "nproc=$nproc_s"
    echo "bin_sha256=$BIN_SHA256"
    echo "drop_f=$DROP_F"
  } > "$sumf"
  cat "$sumf" | tee -a "$MASTER"
  log "single $label DONE eval=${eval_tok_s} prefill=${prompt_tok_s} hit=${hit}% die_max=${die_max_c} wall=${elapsed}s rc=$brc"

  # CSV: label,threads,n_gen,run_type,eval,prefill,hit,mib,drop,memfree_min,vmhwm,die_max,batt_s,batt_e,die_s,die_e,wall,rc,nproc,freq_s,freq_e,bin_sha
  echo "${label},${threads},${ngen},${rtype},${eval_tok_s},${prompt_tok_s},${hit},${mib_tok},${drop_pct},${memfree_min_mb},${vmrss_peak_mb},${die_max_c},${batt_s},${batt_e},${die_s},${die_e},${elapsed},${brc},${nproc_s},${freq_s//,/;},${freq_e//,/;},${BIN_SHA256}" >> "$CELL_CSV"

  if [ $brc -ne 0 ]; then
    log "WARN $label rc=$brc"
  fi
  return 0
}

cold_or_fail() {
  if [ ! -x "$COLD_MODEL_SH" ]; then
    log "FATAL cold_model.sh missing"
    return 5
  fi
  kill_bmoe
  sleep 2
  if ! "$COLD_MODEL_SH" "$MODEL"; then
    log "WARN cold failed once — retry after kill"
    kill_bmoe
    sleep 3
    "$COLD_MODEL_SH" "$MODEL" || {
      log "FATAL cold failed twice"
      return 5
    }
  fi
  log "COLD_OK $MODEL"
}

# --- main ---
trap 'stop_flight; rm -f "$PIDFILE"; echo "TRAP_EXIT $(ts)" >> "$MASTER"' EXIT

log "==== BUCO 2 THREAD SWEEP START ===="
log "BIN=$BIN sha=$BIN_SHA256"
log "MODEL=$MODEL"
log "DROP_F=$DROP_F (DECLARED campaign post speed-065)"
log "PROMPT=$PROMPT_FILE"
log "IO_THREADS fixed=$IO_THREADS CACHE_MB=$CACHE_MB UBATCH=$UBATCH N_EXPERT=$N_EXPERT"

# prompt sha
psha=$(sha256sum "$PROMPT_FILE" | awk '{print $1}')
if [ "$psha" != "$PROMPT_SHA_EXPECTED" ]; then
  log "FATAL prompt sha mismatch got=$psha exp=$PROMPT_SHA_EXPECTED"
  exit 7
fi
log "prompt sha OK $psha"
echo "prompt_sha256=$psha" > "$OUTDIR/prompt_sha.txt"
echo "drop_f=$DROP_F" >> "$OUTDIR/prompt_sha.txt"
echo "bin_sha256=$BIN_SHA256" >> "$OUTDIR/prompt_sha.txt"
echo "prediction=t5/t6 within ±0 of t4" >> "$OUTDIR/prompt_sha.txt"

# CSV header
if [ ! -f "$CELL_CSV" ] || [ ! -s "$CELL_CSV" ]; then
  echo "label,threads,n_gen,run_type,eval_tok_s,prompt_tok_s,hit_pct,mib_per_token,drop_pct,memfree_min_mb,vmhwm_mb,die_max_c,batt_s,batt_e,die_s,die_e,wall_s,rc,nproc,freq_s,freq_e,bin_sha256" > "$CELL_CSV"
fi

start_flight
termux-wake-lock >/dev/null 2>&1 || true
repromote_termux

read -r BATT_START _ _ _ PLUG_START <<<"$(batt_fields)"
echo "batt_start=$BATT_START plugged=$PLUG_START die_start=$(mc_to_c "$(max_die_mc)") nproc=$(nproc) $(ts)" > "$OUTDIR/session_meta.txt"
log "SESSION START batt=$BATT_START% plugged=$PLUG_START die=$(mc_to_c "$(max_die_mc)")C nproc=$(nproc)"

# ABBA-ish order for t4/t5/t6 with 2 rep (thermal balance):
# t4r1, t5r1, t6r1, t6r2, t5r2, t4r2
SCHEDULE=(
  "t4r1 4 1"
  "t5r1 5 1"
  "t6r1 6 1"
  "t6r2 6 2"
  "t5r2 5 2"
  "t4r2 4 2"
)

for entry in "${SCHEDULE[@]}"; do
  # shellcheck disable=SC2086
  set -- $entry
  label="$1"; thr="$2"; rep="$3"
  opfx="$OUTDIR/runs/${label}"
  if [ -f "${opfx}.summary.txt" ]; then
    log "skip existing ${label}"
    continue
  fi
  preflight_cella "$label" || {
    rc=$?
    log "preflight failed rc=$rc — STOP"
    echo "PREFLIGHT_FAIL $label rc=$rc $(ts)" > "$STATUS"
    exit $rc
  }
  # cool if hot
  die_mc=$(max_die_mc)
  if [ "$die_mc" -gt 75000 ] 2>/dev/null; then
    log "cool before $label die=$(mc_to_c $die_mc)C"
    t0=$(date +%s)
    while [ "$(max_die_mc)" -gt 70000 ] 2>/dev/null; do
      now=$(date +%s)
      [ $((now-t0)) -ge 600 ] && break
      sleep 15
    done
  fi
  cold_or_fail || exit 5
  run_single "$label" "$thr" "$N_GEN" "burst" "$opfx" || {
    rc=$?
    log "run_single failed rc=$rc"
    if [ "$rc" = "4" ] || [ "$rc" = "92" ] || [ "$rc" = "93" ] || [ "$rc" = "99" ]; then
      echo "STOP_RC $rc $label $(ts)" > "$STATUS"
      exit $rc
    fi
  }
  # mid-session batt check: if <30 after a finished run → STOP (finished run stays)
  read -r batt_now _ _ _ plug_now <<<"$(batt_fields)"
  if [ "$batt_now" -ge 0 ] 2>/dev/null && [ "$batt_now" -lt "$BATT_STOP" ] 2>/dev/null; then
    log "BATT floor hit after $label batt=$batt_now — STOP (completed cells keep)"
    echo "BATT_FLOOR_AFTER $label batt=$batt_now $(ts)" > "$STATUS"
    echo "BATT_LOW" > "$OUTDIR/STOP_REASON.txt"
    break
  fi
done

# Decide whether to run t7: if med(t6) >= med(t4)
log "==== decide t7 ===="
python3 - <<'PY' > "$OUTDIR/burst_medians.txt"
import csv, statistics, os
path = os.path.expanduser("~/experiments/results/buchi/thread/runs.csv")
rows = []
with open(path) as f:
    r = csv.DictReader(f)
    for row in r:
        if row.get("run_type") != "burst":
            continue
        try:
            t = int(row["threads"])
            e = float(row["eval_tok_s"])
        except Exception:
            continue
        rows.append((t, e))
by = {}
for t, e in rows:
    by.setdefault(t, []).append(e)
def med(xs):
    return statistics.median(xs) if xs else None
m4 = med(by.get(4, []))
m5 = med(by.get(5, []))
m6 = med(by.get(6, []))
print(f"med_t4={m4}")
print(f"med_t5={m5}")
print(f"med_t6={m6}")
print(f"vals_t4={by.get(4, [])}")
print(f"vals_t5={by.get(5, [])}")
print(f"vals_t6={by.get(6, [])}")
if m4 is not None and m6 is not None and m6 >= m4:
    print("t7=YES")
else:
    print("t7=NO")
cands = [(t, m) for t, m in [(4, m4), (5, m5), (6, m6)] if m is not None]
if cands:
    win = max(cands, key=lambda x: x[1])
    print(f"winner_burst_t={win[0]}")
    print(f"winner_burst_med={win[1]}")
    if m4 and m4 > 0:
        for t, m in cands:
            d = 100.0 * (m - m4) / m4
            print(f"delta_t{t}_vs_t4_pct={d:.2f}")
PY
cat "$OUTDIR/burst_medians.txt" | tee -a "$MASTER"

DO_T7=$(grep -E '^t7=' "$OUTDIR/burst_medians.txt" | cut -d= -f2)
WIN_T=$(grep -E '^winner_burst_t=' "$OUTDIR/burst_medians.txt" | cut -d= -f2)
WIN_T=${WIN_T:-4}

if [ "$DO_T7" = "YES" ]; then
  log "t6 >= t4 → add -t 7 (2 rep)"
  for entry in "t7r1 7 1" "t7r2 7 2"; do
    # shellcheck disable=SC2086
    set -- $entry
    label="$1"; thr="$2"; rep="$3"
    opfx="$OUTDIR/runs/${label}"
    if [ -f "${opfx}.summary.txt" ]; then
      log "skip existing ${label}"
      continue
    fi
    preflight_cella "$label" || { echo "PREFLIGHT_FAIL $label $(ts)" > "$STATUS"; exit $?; }
    die_mc=$(max_die_mc)
    if [ "$die_mc" -gt 75000 ] 2>/dev/null; then
      t0=$(date +%s)
      while [ "$(max_die_mc)" -gt 70000 ] 2>/dev/null; do
        now=$(date +%s); [ $((now-t0)) -ge 600 ] && break; sleep 15
      done
    fi
    cold_or_fail || exit 5
    run_single "$label" "$thr" "$N_GEN" "burst" "$opfx" || true
    read -r batt_now _ _ _ _ <<<"$(batt_fields)"
    if [ "$batt_now" -ge 0 ] 2>/dev/null && [ "$batt_now" -lt "$BATT_STOP" ] 2>/dev/null; then
      log "BATT floor after $label — STOP before sostenuto"
      echo "BATT_FLOOR_AFTER $label $(ts)" > "$STATUS"
      break
    fi
  done
  # recompute winner including t7
  python3 - <<'PY' > "$OUTDIR/burst_medians.txt"
import csv, statistics, os
path = os.path.expanduser("~/experiments/results/buchi/thread/runs.csv")
by = {}
with open(path) as f:
    for row in csv.DictReader(f):
        if row.get("run_type") != "burst":
            continue
        try:
            t = int(row["threads"]); e = float(row["eval_tok_s"])
        except Exception:
            continue
        by.setdefault(t, []).append(e)
def med(xs):
    return statistics.median(xs) if xs else None
for t in sorted(by):
    print(f"med_t{t}={med(by[t])}")
    print(f"vals_t{t}={by[t]}")
m4 = med(by.get(4, []))
cands = [(t, med(xs)) for t, xs in by.items() if med(xs) is not None]
win = max(cands, key=lambda x: x[1]) if cands else (4, m4)
print(f"winner_burst_t={win[0]}")
print(f"winner_burst_med={win[1]}")
if m4 and m4 > 0:
    for t, m in cands:
        print(f"delta_t{t}_vs_t4_pct={100.0*(m-m4)/m4:.2f}")
print("t7=YES")
PY
  cat "$OUTDIR/burst_medians.txt" | tee -a "$MASTER"
  WIN_T=$(grep -E '^winner_burst_t=' "$OUTDIR/burst_medians.txt" | cut -d= -f2)
  WIN_T=${WIN_T:-4}
fi

log "==== SOSTENUTO n=$N_SOSTENUTO winner_t=$WIN_T (2 rep) + baseline t4 if winner!=4 ===="
# Always run sostenuto for winner; if winner!=4 also run t4 for fair sustained comparison
SOST_THREADS=("$WIN_T")
if [ "$WIN_T" != "4" ]; then
  SOST_THREADS+=("4")
fi

for thr in "${SOST_THREADS[@]}"; do
  for rep in 1 2; do
    label="sost_t${thr}_r${rep}"
    opfx="$OUTDIR/sostenuto/${label}"
    if [ -f "${opfx}.summary.txt" ]; then
      log "skip existing $label"
      continue
    fi
    read -r batt_now _ _ _ plug_now <<<"$(batt_fields)"
    if [ "$plug_now" != "UNPLUGGED" ]; then
      log "FATAL PLUGGED before sostenuto"
      echo "PLUGGED" > "$OUTDIR/STOP_REASON.txt"
      break 2
    fi
    if [ "$batt_now" -ge 0 ] 2>/dev/null && [ "$batt_now" -lt "$BATT_STOP" ] 2>/dev/null; then
      log "BATT floor before sostenuto — STOP"
      echo "BATT_LOW" > "$OUTDIR/STOP_REASON.txt"
      break 2
    fi
    preflight_cella "$label" || { echo "PREFLIGHT_FAIL $label $(ts)" > "$STATUS"; break 2; }
    die_mc=$(max_die_mc)
    if [ "$die_mc" -gt 75000 ] 2>/dev/null; then
      t0=$(date +%s)
      while [ "$(max_die_mc)" -gt 70000 ] 2>/dev/null; do
        now=$(date +%s); [ $((now-t0)) -ge 600 ] && break; sleep 15
      done
    fi
    cold_or_fail || exit 5
    run_single "$label" "$thr" "$N_SOSTENUTO" "sostenuto" "$opfx" || true
  done
done

# Final summary
python3 - <<'PY' > "$OUTDIR/summary.txt"
import csv, statistics, os
from pathlib import Path
path = Path(os.path.expanduser("~/experiments/results/buchi/thread/runs.csv"))
rows = list(csv.DictReader(path.open()))
def med(xs):
    return statistics.median(xs) if xs else None
burst = {}
sost = {}
for r in rows:
    try:
        t = int(r["threads"]); e = float(r["eval_tok_s"]); d = float(r.get("die_max_c") or 0)
    except Exception:
        continue
    rt = r.get("run_type")
    if rt == "burst":
        burst.setdefault(t, {"eval": [], "die": []})
        burst[t]["eval"].append(e); burst[t]["die"].append(d)
    elif rt == "sostenuto":
        sost.setdefault(t, {"eval": [], "die": []})
        sost[t]["eval"].append(e); sost[t]["die"].append(d)

print("=== BURST n=200 ===")
m4 = med(burst.get(4, {}).get("eval", []))
for t in sorted(burst):
    me = med(burst[t]["eval"]); md = max(burst[t]["die"]) if burst[t]["die"] else None
    delta = (100.0*(me-m4)/m4) if (m4 and me is not None) else None
    print(f"t={t} vals={burst[t]['eval']} med={me} die_max={md} delta_vs_t4={delta}")

print("=== SOSTENUTO n=512 ===")
m4s = med(sost.get(4, {}).get("eval", []))
for t in sorted(sost):
    me = med(sost[t]["eval"]); md = max(sost[t]["die"]) if sost[t]["die"] else None
    delta = (100.0*(me-m4s)/m4s) if (m4s and me is not None and m4s>0) else None
    print(f"t={t} vals={sost[t]['eval']} med={me} die_max={md} delta_vs_t4={delta}")

# Verdict rules from mandato
# ≥+5% also on sostenuto → candidato; only burst → resta 4; all ±3% → chiuso
def within(pct, thr=3.0):
    return pct is not None and abs(pct) <= thr

deltas_burst = {}
for t in sorted(burst):
    me = med(burst[t]["eval"])
    if m4 and me is not None:
        deltas_burst[t] = 100.0*(me-m4)/m4
deltas_sost = {}
for t in sorted(sost):
    me = med(sost[t]["eval"])
    base = m4s if m4s is not None else m4
    # if no t4 sostenuto, compare to burst baseline only for info
    if m4s and me is not None:
        deltas_sost[t] = 100.0*(me-m4s)/m4s

print("=== VERDICT ===")
print(f"deltas_burst={deltas_burst}")
print(f"deltas_sost={deltas_sost}")

candidato = None
for t, db in deltas_burst.items():
    if t == 4: continue
    ds = deltas_sost.get(t)
    if db >= 5.0 and ds is not None and ds >= 5.0:
        candidato = t
        break

all_small = all(within(v, 3.0) for v in deltas_burst.values() if True)
# only non-baseline
nonbase = [v for t,v in deltas_burst.items() if t != 4]
all_small = all(abs(v) <= 3.0 for v in nonbase) if nonbase else True

if candidato:
    verdict = f"CANDIDATO_ADOZIONE t={candidato} (>=+5% burst AND sostenuto)"
elif nonbase and any(v >= 5.0 for v in nonbase) and not any((deltas_sost.get(t) or -999) >= 5.0 for t in deltas_burst if t != 4):
    verdict = "RESTA_4 (vince solo sul burst, non sul sostenuto)"
elif all_small:
    verdict = "CHIUSO (tutto entro ±3%: 4 era giusto)"
else:
    # intermediate band 3-5 or mixed
    best = max(deltas_burst.items(), key=lambda x: x[1])
    verdict = f"RESTA_4 (nessun +5% sostenuto; best burst t={best[0]} {best[1]:.2f}%)"

print(f"verdict={verdict}")
print(f"prediction_a_verbale=t5/t6 ±0 vs t4")
PY
cat "$OUTDIR/summary.txt" | tee -a "$MASTER"

read -r BATT_END _ _ _ PLUG_END <<<"$(batt_fields)"
{
  echo "batt_end=$BATT_END plugged=$PLUG_END die_end=$(mc_to_c "$(max_die_mc)") nproc=$(nproc) $(ts)"
  echo "batt_start=$(grep batt_start "$OUTDIR/session_meta.txt")"
} >> "$OUTDIR/session_meta.txt"
log "SESSION END batt=$BATT_END% plugged=$PLUG_END"
echo "DONE $(ts) batt_end=$BATT_END" > "$STATUS"
log "==== BUCO 2 THREAD SWEEP DONE ===="
exit 0
