#!/data/data/com.termux/files/usr/bin/bash
# S1 — ik_llama vs ref llama-bench on dense IQ2_XXS/IQ3_XXS (ABBA, fadvise cold)
# Rules: UNPLUGGED, battery >= 40%, floor 30%. Do NOT run while charging.
set -euo pipefail
export LC_ALL=C

OUT="${OUT:-$HOME/experiments/results/spike_iq2}"
MODEL_DIR="${MODEL_DIR:-$HOME/models/spike_iq2}"
IQ2="$MODEL_DIR/Llama-3.2-3B-Instruct-UD-IQ2_XXS.gguf"
IQ3="$MODEL_DIR/Llama-3.2-3B-Instruct-UD-IQ3_XXS.gguf"
IK_BIN="${IK_BIN:-$HOME/build/ik_llama-bench/bin/llama-bench}"
REF_BIN="${REF_BIN:-$HOME/build/llamacpp-ref-bench/bin/llama-bench}"
COLD="${COLD:-$HOME/bin/cold_model.sh}"
GR_LIB="${GR_LIB:-$HOME/experiments/scripts/lib_guardrails.sh}"
THREADS=4
REPS_TG=2
BATTERY_FLOOR=30
BATTERY_START_MIN=40

export LD_LIBRARY_PATH="$HOME/build/ik_llama-bench/src:$HOME/build/ik_llama-bench/ggml/src:$HOME/build/llamacpp-ref-bench/bin:${LD_LIBRARY_PATH:-}"

mkdir -p "$OUT/runs" "$OUT/logs"
FLIGHT_LOG="$OUT/flight.log"
STATUS="$OUT/status.txt"
MASTER="$OUT/s1_console.log"
: > "$MASTER"
: > "$FLIGHT_LOG"

log(){ echo "$(date -Iseconds) $*" | tee -a "$MASTER"; }

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

batt_json(){ termux-battery-status 2>/dev/null || echo '{}'; }
batt_pct(){ batt_json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(int(d.get("percentage",0)))' 2>/dev/null || echo 0; }
batt_plugged(){ batt_json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("plugged","UNKNOWN"))' 2>/dev/null || echo UNKNOWN; }

# shellcheck source=/dev/null
source "$GR_LIB"
guardrails_reset

# Preconditions
pct=$(batt_pct); plug=$(batt_plugged)
log "precheck battery=$pct plugged=$plug die=$(mc_to_c "$(max_die_mc)")C"
if [ "$plug" != "UNPLUGGED" ]; then
  log "ABORT: phone is $plug — S1 requires UNPLUGGED"
  echo "S1_ABORT_PLUGGED" > "$STATUS"
  exit 3
fi
if [ "$pct" -lt "$BATTERY_START_MIN" ]; then
  log "ABORT: battery $pct < $BATTERY_START_MIN"
  echo "S1_ABORT_BATTERY" > "$STATUS"
  exit 3
fi
for b in "$IK_BIN" "$REF_BIN" "$IQ2" "$COLD"; do
  [ -e "$b" ] || { log "missing $b"; exit 2; }
done

# optional screen timeout raise + restore
OLD_TIMEOUT=""
if command -v settings >/dev/null 2>&1; then
  OLD_TIMEOUT=$(settings get system screen_off_timeout 2>/dev/null || true)
  settings put system screen_off_timeout 1800000 2>/dev/null || true
fi
restore_timeout(){
  if [ -n "${OLD_TIMEOUT:-}" ] && [ "$OLD_TIMEOUT" != "null" ]; then
    settings put system screen_off_timeout "$OLD_TIMEOUT" 2>/dev/null || true
  fi
}
trap restore_timeout EXIT

CSV="$OUT/s1_results.csv"
echo "cell,order,engine,quant,metric,p,n,rtr,tg_or_pp_ts,die_c_start,die_c_end,batt_pct,plugged,iso" > "$CSV"

run_one(){
  local cell="$1" engine="$2" model="$3" quant="$4" p="$5" n="$6" rtr="$7" reps="$8"
  local bin outf die_s die_e pct_now plug_now iso extra=()
  if [ "$engine" = "ref" ]; then bin="$REF_BIN"; else bin="$IK_BIN"; fi
  if [ "$engine" = "ik" ] && [ -n "$rtr" ]; then extra+=(-rtr "$rtr"); fi
  outf="$OUT/runs/${cell}_${engine}_${quant}.txt"
  iso=$(date -Iseconds)
  pct_now=$(batt_pct); plug_now=$(batt_plugged)
  if [ "$pct_now" -lt "$BATTERY_FLOOR" ]; then
    log "ABORT_FLOOR batt=$pct_now"; echo S1_ABORT_FLOOR > "$STATUS"; exit 4
  fi
  if [ "$plug_now" != "UNPLUGGED" ]; then
    log "ABORT_PLUGGED mid-run"; echo S1_ABORT_PLUGGED > "$STATUS"; exit 3
  fi
  die_s=$(max_die_mc)
  log "cold $model"
  "$COLD" "$model"
  log "RUN $cell engine=$engine quant=$quant p=$p n=$n rtr=$rtr die_s=$(mc_to_c "$die_s") batt=$pct_now"
  set +e
  "$bin" -m "$model" -p "$p" -n "$n" -t "$THREADS" -r "$reps" "${extra[@]}" \
    > "$outf" 2>&1
  local rc=$?
  set -e
  die_e=$(max_die_mc)
  # parse t/s from md table (last numeric tok/s column of tg or pp row)
  local ts
  ts=$(python3 - "$outf" <<'PY'
import sys,re
path=sys.argv[1]
text=open(path,errors="replace").read()
# llama-bench md rows often: | model | size | params | backend | ngl | test | t/s |
# look for tg128 or pp512
val=""
for line in text.splitlines():
    if re.search(r"\btg128\b|\bpp512\b|\btg\b|\bpp\b", line) and "t/s" not in line.lower():
        # grab last float-like token that looks like X.XX
        nums=re.findall(r"(\d+\.\d+)\s*(?:±|$|\|)", line)
        if nums:
            val=nums[0]
print(val)
PY
)
  log "DONE $cell rc=$rc ts=$ts die_e=$(mc_to_c "$die_e")"
  echo "$cell,$engine,$engine,$quant,$( [ "$n" = "0" ] && echo pp || echo tg),$p,$n,${rtr:-0},$ts,$(mc_to_c "$die_s"),$(mc_to_c "$die_e"),$pct_now,$plug_now,$iso" >> "$CSV"
  # guardrail sample post-run
  local mf
  mf=$(awk '/MemFree:/ {print $2; exit}' /proc/meminfo)
  guardrail_tick "$(max_die_mc)" "$mf"
  case "$GR_ACTION" in
    CONTINUE) ;;
    *) log "GUARDRAIL $GR_ACTION $GR_LAST_DETAIL"; echo "S1_GUARD_$GR_ACTION" > "$STATUS"; exit 5 ;;
  esac
}

# ABBA order for IQ2 TG: ref, ik, ik, ref  (cells M1a,M2a,M2b,M1b) with 2 reps each via -r
# Mandate: 2 rep per cell; ABBA for thermal drift neutralization
log "=== M1/M2 IQ2_XXS TG ABBA ==="
run_one M1a ref "$IQ2" IQ2_XXS 0 128 "" "$REPS_TG"
run_one M2a ik  "$IQ2" IQ2_XXS 0 128 1 "$REPS_TG"
run_one M2b ik  "$IQ2" IQ2_XXS 0 128 1 "$REPS_TG"
run_one M1b ref "$IQ2" IQ2_XXS 0 128 "" "$REPS_TG"

log "=== M3 PP512 control (1 rep) ==="
run_one M3r ref "$IQ2" IQ2_XXS 512 0 "" 1
run_one M3i ik  "$IQ2" IQ2_XXS 512 0 1 1

if [ -f "$IQ3" ]; then
  log "=== M4 IQ3_XXS TG ABBA ==="
  run_one M4_1a ref "$IQ3" IQ3_XXS 0 128 "" "$REPS_TG"
  run_one M4_2a ik  "$IQ3" IQ3_XXS 0 128 1 "$REPS_TG"
  run_one M4_2b ik  "$IQ3" IQ3_XXS 0 128 1 "$REPS_TG"
  run_one M4_1b ref "$IQ3" IQ3_XXS 0 128 "" "$REPS_TG"
fi

echo S1_DONE > "$STATUS"
log "S1 complete — see $CSV"
