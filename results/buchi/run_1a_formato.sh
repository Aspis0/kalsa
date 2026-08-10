#!/data/data/com.termux/files/usr/bin/bash
# BUCO 1a — micro-bench formato: Q2_K vs IQ2_XXS on dense 3B, ref-mainline only
# Rules: UNPLUGGED, battery >= 40% start / floor 30%, cold each cell, -t 4, 2 rep, ABBA
set -euo pipefail
export LC_ALL=C

OUT="${OUT:-$HOME/experiments/results/buchi}"
MODEL_DIR="${MODEL_DIR:-$HOME/models/spike_iq2}"
Q2K="$MODEL_DIR/Llama-3.2-3B-Instruct-Q2_K.gguf"
IQ2="$MODEL_DIR/Llama-3.2-3B-Instruct-UD-IQ2_XXS.gguf"
REF_BIN="${REF_BIN:-$HOME/build/llamacpp-ref-bench/bin/llama-bench}"
COLD="${COLD:-$HOME/bin/cold_model.sh}"
GR_LIB="${GR_LIB:-$HOME/experiments/scripts/lib_guardrails.sh}"
THREADS=4
REPS=2
BATTERY_FLOOR=30
BATTERY_START_MIN=40

export LD_LIBRARY_PATH="$HOME/build/llamacpp-ref-bench/bin:${LD_LIBRARY_PATH:-}"

mkdir -p "$OUT/runs" "$OUT/logs"
FLIGHT_LOG="$OUT/flight.log"
STATUS="$OUT/status_1a.txt"
MASTER="$OUT/1a_console.log"
: > "$MASTER"
: > "$FLIGHT_LOG"
echo "1a_START $(date -Iseconds)" > "$STATUS"

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

pct=$(batt_pct); plug=$(batt_plugged)
log "precheck battery=$pct plugged=$plug die=$(mc_to_c "$(max_die_mc)")C nproc=$(nproc)"
if [ "$plug" != "UNPLUGGED" ]; then
  log "ABORT: phone is $plug — 1a requires UNPLUGGED"
  echo "1a_ABORT_PLUGGED" > "$STATUS"
  exit 3
fi
if [ "$pct" -lt "$BATTERY_START_MIN" ]; then
  log "ABORT: battery $pct < $BATTERY_START_MIN"
  echo "1a_ABORT_BATTERY" > "$STATUS"
  exit 3
fi
for b in "$REF_BIN" "$Q2K" "$IQ2" "$COLD"; do
  [ -e "$b" ] || { log "missing $b"; echo "1a_MISSING $b" > "$STATUS"; exit 2; }
done
q2k_sz=$(stat -c%s "$Q2K")
if [ "$q2k_sz" -lt 1300000000 ]; then
  log "ABORT: Q2K size $q2k_sz incomplete"
  echo "1a_ABORT_INCOMPLETE_Q2K" > "$STATUS"
  exit 2
fi

log "nproc=$(nproc) (expect >=6; if lower host must re-promote)"

OLD_TIMEOUT=""
if command -v settings >/dev/null 2>&1; then
  OLD_TIMEOUT=$(settings get system screen_off_timeout 2>/dev/null || true)
  settings put system screen_off_timeout 7200000 2>/dev/null || true
fi
restore_timeout(){
  if [ -n "${OLD_TIMEOUT:-}" ] && [ "$OLD_TIMEOUT" != "null" ]; then
    settings put system screen_off_timeout "$OLD_TIMEOUT" 2>/dev/null || true
  else
    settings put system screen_off_timeout 1800000 2>/dev/null || true
  fi
}
trap restore_timeout EXIT

CSV="$OUT/1a_results.csv"
echo "cell,order,quant,metric,p,n,tg_ts,tg_ts_raw,die_c_start,die_c_end,batt_pct,plugged,iso" > "$CSV"

parse_tg(){
  local path="$1"
  python3 - "$path" <<'PY'
import sys,re
path=sys.argv[1]
text=open(path,errors="replace").read()
val=""
raw=""
for line in text.splitlines():
    if re.search(r"\btg128\b|\btg\b", line) and "t/s" not in line.lower():
        m=re.search(r"(\d+\.\d+)\s*±\s*(\d+\.\d+)", line)
        if m:
            val=m.group(1); raw=m.group(0)
        else:
            nums=re.findall(r"(\d+\.\d+)", line)
            if nums:
                val=nums[-1]; raw=val
print(val + "\t" + raw)
PY
}

run_one(){
  local cell="$1" model="$2" quant="$3" order="$4"
  local outf die_s die_e pct_now plug_now iso ts raw
  outf="$OUT/runs/${cell}_${quant}.txt"
  iso=$(date -Iseconds)
  pct_now=$(batt_pct); plug_now=$(batt_plugged)
  if [ "$pct_now" -lt "$BATTERY_FLOOR" ]; then
    log "ABORT_FLOOR batt=$pct_now"; echo 1a_ABORT_FLOOR > "$STATUS"; exit 4
  fi
  if [ "$plug_now" != "UNPLUGGED" ]; then
    log "ABORT_PLUGGED mid-run plug=$plug_now"; echo 1a_ABORT_PLUGGED > "$STATUS"; exit 3
  fi
  die_s=$(max_die_mc)
  if [ "$die_s" -gt 80000 ] 2>/dev/null; then
    log "die hot $(mc_to_c "$die_s") — waiting cool"
    local w=0
    while [ "$(max_die_mc)" -gt 70000 ] 2>/dev/null && [ $w -lt 120 ]; do sleep 5; w=$((w+5)); done
    die_s=$(max_die_mc)
  fi
  log "cold $model"
  "$COLD" "$model" || true
  log "RUN $cell quant=$quant order=$order die_s=$(mc_to_c "$die_s") batt=$pct_now"
  set +e
  "$REF_BIN" -m "$model" -p 0 -n 128 -t "$THREADS" -r "$REPS" > "$outf" 2>&1
  local rc=$?
  set -e
  die_e=$(max_die_mc)
  local parsed
  parsed=$(parse_tg "$outf")
  ts=$(printf "%s" "$parsed" | cut -f1)
  raw=$(printf "%s" "$parsed" | cut -f2)
  log "DONE $cell rc=$rc ts=$ts raw=$raw die_e=$(mc_to_c "$die_e") batt=$(batt_pct)"
  echo "$cell,$order,$quant,tg,0,128,$ts,$raw,$(mc_to_c "$die_s"),$(mc_to_c "$die_e"),$pct_now,$plug_now,$iso" >> "$CSV"
  local mf
  mf=$(awk '/MemFree:/ {print $2; exit}' /proc/meminfo)
  guardrail_tick "$(max_die_mc)" "$mf"
  case "$GR_ACTION" in
    CONTINUE) ;;
    *) log "GUARDRAIL $GR_ACTION $GR_LAST_DETAIL"; echo "1a_GUARD_$GR_ACTION" > "$STATUS"; exit 5 ;;
  esac
}

# ABBA: A=Q2_K, B=IQ2_XXS → A B B A
log "=== 1a ABBA Q2_K vs IQ2_XXS tg128 -t4 r=2 cold ==="
log "PRED_A_VERBALE g_formato >= 1.4 (threshold GO >=1.30)"
run_one A1 "$Q2K" Q2_K A
run_one B1 "$IQ2" IQ2_XXS B
run_one B2 "$IQ2" IQ2_XXS B
run_one A2 "$Q2K" Q2_K A

python3 - "$CSV" "$OUT/1a_summary.txt" <<'PY'
import sys,statistics
csv,outp=sys.argv[1],sys.argv[2]
rows=[]
for line in open(csv):
    if line.startswith("cell") or not line.strip(): continue
    p=line.strip().split(",")
    try:
        ts=float(p[6]) if p[6] else None
    except Exception:
        ts=None
    rows.append((p[0],p[2],ts))
q2=[r[2] for r in rows if r[1]=="Q2_K" and r[2] is not None]
iq=[r[2] for r in rows if r[1]=="IQ2_XXS" and r[2] is not None]
lines=[]
lines.append(f"Q2_K values: {q2}")
lines.append(f"IQ2_XXS values: {iq}")
if q2 and iq:
    med_q=statistics.median(q2)
    med_i=statistics.median(iq)
    g=med_q/med_i if med_i else float("nan")
    lines.append(f"med_Q2_K={med_q:.4f}")
    lines.append(f"med_IQ2_XXS={med_i:.4f}")
    lines.append(f"g_formato={g:.4f}")
    if g>=1.30: v="GO"
    elif g>=1.15: v="GO_CONDIZIONATO"
    else: v="CHIUSO"
    lines.append(f"verdict={v}")
else:
    lines.append("INCOMPLETE")
    lines.append("verdict=INCOMPLETE")
open(outp,"w").write("\n".join(lines)+"\n")
print("\n".join(lines))
PY

echo "1a_DONE $(date -Iseconds)" > "$STATUS"
log "1a complete — see $CSV and $OUT/1a_summary.txt"
settings put system screen_off_timeout 1800000 2>/dev/null || true
