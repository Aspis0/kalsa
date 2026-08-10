#!/usr/bin/env bash
# run_adopt_dropcold_final.sh — giro finale scheda prodotto con --drop-cold-experts 0.50
# Mandato: mandates/adopt-dropcold.md
# Regole: NESSUN rebuild/re-pin; CAMPAIGN pin; UNPLUGGED only; floor 30%; guardrail+flight.
# Priorità se batteria scarseggia: #2, #3, #1, #4.
set -euo pipefail
export LC_ALL=C
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"

HOME="${HOME:-/data/data/com.termux/files/home}"
EXP="${EXP:-$HOME/experiments}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
BIN="${BINARY:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN}"
MODEL="${MODEL:-$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf}"
COLD_MODEL_SH="${COLD_MODEL_SH:-$HOME/bin/cold_model.sh}"
OUTDIR="${OUTDIR:-$EXP/results/adopt_dropcold}"
TAG_PHASE="ADOPT-DROPCOLD"
THREADS=4
N_CTX=4096
IO_THREADS=4
CACHE_MB=2000
UBATCH=512
N_EXPERT=8
DROP_F=0.50
DIE_START_MC=80000
BATT_FLOOR=30
RUNTIME_COMMIT="${RUNTIME_COMMIT:-b0c4e5b}"

# shellcheck disable=SC1090
[ -f "$SCRIPT_DIR/lib_campaign_pin.sh" ] && source "$SCRIPT_DIR/lib_campaign_pin.sh"
# shellcheck disable=SC1090
[ -f "$SCRIPT_DIR/lib_guardrails.sh" ] && source "$SCRIPT_DIR/lib_guardrails.sh"

if declare -f assert_campaign_pin >/dev/null 2>&1; then
  assert_campaign_pin "$BIN"
else
  _sha_file="${CAMPAIGN_SHA_FILE:-$HOME/src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256}"
  _exp=$(awk 'NF{print $1; exit}' "$_sha_file" 2>/dev/null || true)
  _got=$(sha256sum "$BIN" 2>/dev/null | awk '{print $1}')
  BIN_SHA256="$_got"
  if [ "${ALLOW_UNPINNED:-0}" != "1" ]; then
    case "$BIN" in *.CAMPAIGN) ;; *)
      echo "ERRORE pin: usare bmoe-cli.CAMPAIGN" >&2; exit 6;;
    esac
    if [ -z "$_exp" ] || [ "$_got" != "$_exp" ]; then
      echo "ERRORE pin sha mismatch got=$_got expected=$_exp" >&2; exit 6
    fi
  fi
fi
export BIN_SHA256="${BIN_SHA256:-}"

_ld_dir="$(cd "$(dirname "$BIN")" && pwd -P 2>/dev/null || dirname "$BIN")"
export LD_LIBRARY_PATH="${_ld_dir}:${_ld_dir}/../bin:${LD_LIBRARY_PATH:-}"

mkdir -p "$OUTDIR"/{load,conv5,decode,sostenuto,prompts}
MASTER="$OUTDIR/ADOPT_DROPCOLD.master.log"
FLIGHT_LOG="$OUTDIR/flight.log"
STATUS="$OUTDIR/STATUS.txt"
RUNS_CSV="$OUTDIR/runs.csv"
CELLS_CSV="$OUTDIR/cells.csv"
exec > >(tee -a "$MASTER") 2>&1

ts(){ date '+%Y-%m-%dT%H:%M:%S%z'; }
log(){ echo "[$(ts)] $*"; }

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

batt_fields(){
  # pct temp plugged
  termux-battery-status 2>/dev/null | python3 -c 'import sys,json
s=sys.stdin.read()
try:
 d=json.loads(s)
 print(int(d.get("percentage", d.get("level", -1))), float(d.get("temperature", -1)), str(d.get("plugged","")))
except Exception:
 print(-1, -1, "")
' 2>/dev/null
}

kill_bmoe(){
  pkill -f 'bmoe-cli' 2>/dev/null || true
  sleep 1
}

lmkd_count(){
  # best-effort
  dmesg 2>/dev/null | grep -cE 'lowmemorykiller|lmkd' || echo 0
}

require_unplugged(){
  local label="$1"
  read -r pct temp plugged <<<"$(batt_fields)"
  if [ "$plugged" != "UNPLUGGED" ]; then
    log "FATAL PLUGGED before $label (plugged=$plugged) — skip, no CSV"
    return 4
  fi
  if [ "$pct" -lt "$BATT_FLOOR" ] 2>/dev/null; then
    log "FATAL BATT_FLOOR $pct% < $BATT_FLOOR before $label — STOP session"
    echo "STOPPED_BATT $pct" | tee -a "$STATUS"
    return 5
  fi
  return 0
}

preflight(){
  local label="$1"
  require_unplugged "$label" || return $?
  local die_mc die_c n tries=0
  while :; do
    die_mc=$(max_die_mc); die_c=$(mc_to_c "$die_mc"); n=$(nproc)
    read -r pct _ plugged <<<"$(batt_fields)"
    if [ "$plugged" != "UNPLUGGED" ]; then
      log "FATAL PLUGGED mid-preflight $label"; return 4
    fi
    if [ "$pct" -lt "$BATT_FLOOR" ] 2>/dev/null; then
      log "FATAL BATT $pct%"; return 5
    fi
    if [ "$die_mc" -le "$DIE_START_MC" ] 2>/dev/null && [ "$n" -ge 6 ]; then
      log "preflight OK $label die=${die_c}C nproc=$n batt=$pct%"
      return 0
    fi
    tries=$((tries+1))
    if [ "$tries" -gt 40 ]; then
      log "preflight TIMEOUT $label die=${die_c}C nproc=$n"
      return 3
    fi
    log "preflight wait $label die=${die_c}C nproc=$n batt=$pct%"
    termux-wake-lock >/dev/null 2>&1 || true
    /system/bin/am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1 || true
    sleep 15
  done
}

append_run(){
  if [ ! -f "$RUNS_CSV" ]; then
    echo "run_id,date,phase,model,quant,file_gb,runtime,runtime_commit,flags,threads,n_ctx,kv_type,n_gen,run_type,prompt_id,prompt_tok_s,eval_tok_s,ttft_ms,majflt_delta,minflt_delta,read_bytes_delta,vmrss_peak_mb,memfree_min_mb,batt_temp_start,batt_temp_end,battery_pct,expert_hit_rate,nproc,affinity_mask,notes" > "$RUNS_CSV"
  fi
  echo "$1" >> "$RUNS_CSV"
}

# flight sampler for one pid
sample_loop(){
  local pid="$1" samp="$2"
  echo "ts_epoch_ms,die_c,vmrss_kb,memfree_kb" > "$samp"
  if declare -f guardrails_reset >/dev/null 2>&1; then guardrails_reset; fi
  while kill -0 "$pid" 2>/dev/null; do
    now_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
    die_mc=$(max_die_mc); die_c=$(mc_to_c "$die_mc")
    rss=0; [ -r "/proc/$pid/status" ] && rss=$(awk '/^VmRSS:/{print $2}' "/proc/$pid/status")
    mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
    echo "${now_ms},${die_c},${rss},${mf}" >> "$samp"
    if declare -f guardrail_tick >/dev/null 2>&1; then
      guardrail_tick "$die_mc" "$mf"
      case "${GR_ACTION:-CONTINUE}" in
        PAUSE_THERMAL)
          log "GUARDRAIL PAUSE_THERMAL die=$die_c pid=$pid"
          kill "$pid" 2>/dev/null || true
          echo "PAUSE_THERMAL" > "${samp}.guardrail"
          return 88
          ;;
        ABORT_MEM)
          log "GUARDRAIL ABORT_MEM mf=$mf pid=$pid"
          kill "$pid" 2>/dev/null || true
          echo "ABORT_MEM" > "${samp}.guardrail"
          return 89
          ;;
        HARD_DIE)
          log "GUARDRAIL HARD_DIE die=$die_c pid=$pid"
          kill "$pid" 2>/dev/null || true
          echo "HARD_DIE" > "${samp}.guardrail"
          return 98
          ;;
      esac
    fi
    # flight line
    echo "SAMPLE,$(date +%s.%N),$(date '+%Y-%m-%dT%H:%M:%S%z'),die=${die_c},rss=${rss},mf=${mf},pid=${pid}" >> "$FLIGHT_LOG"
    sleep 0.5
  done
  return 0
}

parse_eval(){
  # stdin combo logs
  grep -E 'generation:.*tok/s|eval time.*=.*tokens per second' | tail -1 | \
    sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p;s/.*\([0-9.]*\) tokens per second.*/\1/p' | head -1
}

# ─────────────────────────────────────────────────────────────
# #1 LOAD COLD — 2 rep, fadvise each, load_s from BMOE_READY / first token
# ─────────────────────────────────────────────────────────────
run_load_cold(){
  local sdir="$OUTDIR/load"
  mkdir -p "$sdir"
  log "==== #1 LOAD COLD 2 rep ===="
  local rep load_s
  for rep in 1 2; do
    preflight "load_r${rep}" || return $?
    kill_bmoe
    log "fadvise cold load rep=$rep"
    if ! "$COLD_MODEL_SH" "$MODEL" >>"$MASTER" 2>&1; then
      log "FATAL cold_model load r$rep"; return 2
    fi
    read -r batt_s btemp_s plugged_s <<<"$(batt_fields)"
    local ptext; ptext=$(cat "$EXP/prompts/short.txt")
    local opfx="$sdir/load_r${rep}"
    : > "${opfx}.stdout"; : > "${opfx}.stderr"
    local t0 t1
    t0=$(date +%s.%N)
    set +e
    "$BIN" -m "$MODEL" -p "$ptext" -t $THREADS -c $N_CTX -n 8 \
      --temp 0 --chatml --no-think \
      --moe-stream --cache-mb $CACHE_MB --dense-weights anon --overlap \
      --io-threads $IO_THREADS --ubatch $UBATCH --n-expert-used $N_EXPERT \
      --drop-cold-experts $DROP_F \
      > "${opfx}.stdout" 2> "${opfx}.stderr" &
    local BPID=$!
    sample_loop "$BPID" "${opfx}.sampler.csv" &
    local SPID=$!
    wait $BPID; local brc=$?
    set -e
    t1=$(date +%s.%N)
    kill $SPID 2>/dev/null || true; wait $SPID 2>/dev/null || true
    local _combo; _combo=$(cat "${opfx}.stdout" "${opfx}.stderr" 2>/dev/null || true)
    load_s=$(printf '%s\n' "$_combo" | grep -oE '"load_s":[0-9.]+' | head -1 | cut -d: -f2)
    if [ -z "$load_s" ]; then
      # fallback wall to first BMOE_DONE/READY
      load_s=$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.3f", b-a}')
    fi
    local die_max
    die_max=$(awk -F, 'NR>1{if($2+0>m)m=$2+0}END{print m+0}' "${opfx}.sampler.csv" 2>/dev/null || echo 0)
    read -r batt_e btemp_e _ <<<"$(batt_fields)"
    {
      echo "rep=$rep"
      echo "load_s=$load_s"
      echo "rc=$brc"
      echo "batt_s=$batt_s batt_e=$batt_e"
      echo "die_max=$die_max"
      echo "bin_sha256=$BIN_SHA256"
    } | tee "${opfx}.summary.txt" | tee -a "$MASTER"
    echo "load,r${rep},${load_s},${brc},${batt_s},${batt_e},${die_max},${BIN_SHA256}" >> "$CELLS_CSV"
    log "LOAD r$rep load_s=$load_s rc=$brc"
  done
  return 0
}

# ─────────────────────────────────────────────────────────────
# #2 CONVERSAZIONE 5 TURNI KV (F5.1 prompts) — priorità 1
# ─────────────────────────────────────────────────────────────
run_conv5(){
  local sdir="$OUTDIR/conv5"
  mkdir -p "$sdir"
  log "==== #2 CONVERSAZIONE 5 TURNI KV ===="
  preflight "conv5" || return $?
  kill_bmoe
  log "fadvise cold conv5"
  if ! "$COLD_MODEL_SH" "$MODEL" >>"$MASTER" 2>&1; then
    log "FATAL cold_model conv5"; return 2
  fi

  # Build session JSONL from F5.1 prompts
  local jsin="$sdir/conv5_in.jsonl"
  : > "$jsin"
  local i ck
  for i in 1 2 3 4 5; do
    local pf="$EXP/prompts/f5_1_t${i}.txt"
    if [ ! -f "$pf" ]; then
      log "FATAL missing $pf"; return 2
    fi
    if [ "$i" = "1" ]; then ck=true; else ck=false; fi
    PROMPT_FILE="$pf" CK="$ck" ID="$i" python3 - <<'PY' >> "$jsin"
import json, os
p=open(os.environ["PROMPT_FILE"],encoding="utf-8").read()
obj={"cmd":"generate","prompt":p,"id":int(os.environ["ID"]),"n_predict":256,"clear_kv": os.environ["CK"]=="true","think":False}
print(json.dumps(obj, ensure_ascii=False))
PY
  done
  echo '{"cmd":"close"}' >> "$jsin"
  sha256sum "$jsin" | tee -a "$MASTER"
  for i in 1 2 3 4 5; do sha256sum "$EXP/prompts/f5_1_t${i}.txt"; done | tee -a "$MASTER"

  read -r batt_s btemp_s plugged_s <<<"$(batt_fields)"
  if [ "$plugged_s" != "UNPLUGGED" ]; then log "FATAL PLUGGED conv5"; return 4; fi

  local FLAGS=(
    -m "$MODEL" -t $THREADS -c $N_CTX -n 256
    --temp 0 --chatml --no-think --moe-stream
    --cache-mb $CACHE_MB --dense-weights anon --overlap
    --io-threads $IO_THREADS --ubatch $UBATCH
    --n-expert-used $N_EXPERT --drop-cold-experts $DROP_F
    --session
  )
  local opfx="$sdir/conv5"
  : > "${opfx}.stdout"; : > "${opfx}.stderr"
  set +e
  "$BIN" "${FLAGS[@]}" < "$jsin" > "${opfx}.stdout" 2> "${opfx}.stderr" &
  local BPID=$!
  sample_loop "$BPID" "${opfx}.sampler.csv" &
  local SPID=$!
  wait $BPID; local brc=$?
  set -e
  kill $SPID 2>/dev/null || true; wait $SPID 2>/dev/null || true

  # Parse BMOE_DONE lines
  python3 - <<'PY' "${opfx}.stdout" "${opfx}.stderr" "${opfx}.turns.csv" "${opfx}.summary.json" "$BIN_SHA256" "$brc"
import sys, json, re
from pathlib import Path
outp, errp, csvp, jsp, sha, rc = sys.argv[1:7]
text = Path(outp).read_text(encoding="utf-8", errors="replace") + "\n" + Path(errp).read_text(encoding="utf-8", errors="replace")
rows=[]
for line in text.splitlines():
    if "BMOE_DONE" not in line: continue
    i=line.find("{")
    if i<0: continue
    try:
        o=json.loads(line[i:])
    except Exception:
        continue
    n_prompt=int(o.get("n_prompt") or 0)
    n_past=int(o.get("n_past") or 0)
    tokens=int(o.get("tokens") or 0)
    n_common = n_past - n_prompt - tokens if n_past else 0
    if n_common < 0: n_common = 0
    rows.append({
        "id": o.get("id"),
        "n_prompt": n_prompt,
        "n_past": n_past,
        "tokens": tokens,
        "n_common": n_common,
        "prefill_s": o.get("prefill_s"),
        "prefill_tps": o.get("prefill_tps"),
        "tok_s": o.get("tok_s"),
        "load_s": o.get("load_s"),
        "cache_hit_pct": o.get("cache_hit_pct"),
    })
with open(csvp,"w",encoding="utf-8") as f:
    f.write("id,n_prompt,n_past,n_common,tokens,prefill_s,prefill_tps,tok_s,load_s,cache_hit_pct\n")
    for r in rows:
        f.write("{id},{n_prompt},{n_past},{n_common},{tokens},{prefill_s},{prefill_tps},{tok_s},{load_s},{cache_hit_pct}\n".format(**r))
obj={"rc":int(rc),"bin_sha256":sha,"turns":rows,"n_turns":len(rows)}
if len(rows)>=5:
    t5=rows[4]
    obj["t5_prefill_s"]=t5.get("prefill_s")
    obj["t5_n_common"]=t5.get("n_common")
    obj["t5_n_prompt"]=t5.get("n_prompt")
    obj["t5_n_past"]=t5.get("n_past")
    # reuse full if n_common grows and n_prompt stays suffix-sized
    obj["reuse_ok"]= all(rows[i]["n_common"]>0 for i in range(1,min(5,len(rows)))) and (t5.get("n_common") or 0) > 1000
Path(jsp).write_text(json.dumps(obj,indent=2),encoding="utf-8")
print(json.dumps(obj,indent=2))
PY
  read -r batt_e btemp_e _ <<<"$(batt_fields)"
  log "conv5 rc=$brc batt ${batt_s}->${batt_e}"
  cat "${opfx}.turns.csv" | tee -a "$MASTER"
  echo "conv5,${brc},${batt_s},${batt_e},${BIN_SHA256}" >> "$CELLS_CSV"
  return 0
}

# ─────────────────────────────────────────────────────────────
# #3 DECODE short + f45_1, n=200, 2 rep each, cold each
# ─────────────────────────────────────────────────────────────
run_one_decode(){
  local label="$1" pfile="$2" pid="$3" rep="$4"
  local sdir="$OUTDIR/decode"
  mkdir -p "$sdir"
  preflight "decode_${label}_r${rep}" || return $?
  kill_bmoe
  log "fadvise cold decode $label r$rep"
  if ! "$COLD_MODEL_SH" "$MODEL" >>"$MASTER" 2>&1; then
    log "FATAL cold decode $label r$rep"; return 2
  fi
  read -r batt_s btemp_s plugged_s <<<"$(batt_fields)"
  if [ "$plugged_s" != "UNPLUGGED" ]; then log "FATAL PLUGGED decode"; return 4; fi
  local ptext; ptext=$(cat "$pfile")
  local opfx="$sdir/${label}_r${rep}"
  : > "${opfx}.stdout"; : > "${opfx}.stderr"
  local nproc_s; nproc_s=$(nproc)
  local die_s; die_s=$(mc_to_c "$(max_die_mc)")
  set +e
  "$BIN" -m "$MODEL" -p "$ptext" -t $THREADS -c $N_CTX -n 200 \
    --temp 0 --chatml --no-think \
    --moe-stream --cache-mb $CACHE_MB --dense-weights anon --overlap \
    --io-threads $IO_THREADS --ubatch $UBATCH --n-expert-used $N_EXPERT \
    --drop-cold-experts $DROP_F \
    > "${opfx}.stdout" 2> "${opfx}.stderr" &
  local BPID=$!
  sample_loop "$BPID" "${opfx}.sampler.csv" &
  local SPID=$!
  local wall_s; wall_s=$(date +%s)
  wait $BPID; local brc=$?
  local wall_e; wall_e=$(date +%s); local elapsed=$((wall_e-wall_s))
  set -e
  kill $SPID 2>/dev/null || true; wait $SPID 2>/dev/null || true
  local _combo; _combo=$(cat "${opfx}.stdout" "${opfx}.stderr" 2>/dev/null || true)
  local eval_tok_s prompt_tok_s hit drop_pct mib_tok load_s n_prompt ttft_ms
  eval_tok_s=$(printf '%s\n' "$_combo" | grep -E 'generation:.*tok/s' | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  if [ -z "$eval_tok_s" ]; then
    eval_tok_s=$(printf '%s\n' "$_combo" | grep -oE '"tok_s":[0-9.]+' | tail -1 | cut -d: -f2)
  fi
  prompt_tok_s=$(printf '%s\n' "$_combo" | grep -E 'prompt eval.*tok/s' | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  if [ -z "$prompt_tok_s" ]; then
    prompt_tok_s=$(printf '%s\n' "$_combo" | grep -oE '"prefill_tps":[0-9.]+' | tail -1 | cut -d: -f2)
  fi
  hit=$(printf '%s\n' "$_combo" | grep -oE 'expert.?hit[^0-9]*[0-9.]+%?' | tail -1 | grep -oE '[0-9.]+' | head -1)
  if [ -z "$hit" ]; then
    hit=$(printf '%s\n' "$_combo" | grep -oE '"cache_hit_pct":[0-9.]+' | tail -1 | cut -d: -f2)
  fi
  drop_pct=$(printf '%s\n' "$_combo" | grep -oE 'drop[=: ]+[0-9.]+%?' | tail -1 | grep -oE '[0-9.]+' | head -1)
  if [ -z "$drop_pct" ]; then
    drop_pct=$(printf '%s\n' "$_combo" | grep -oE 'moe-drop[^0-9]*[0-9.]+' | tail -1 | grep -oE '[0-9.]+' | head -1)
  fi
  mib_tok=$(printf '%s\n' "$_combo" | grep -oE 'read [0-9.]+ MiB \([0-9.]+ MiB/token\)' | tail -1 | sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p')
  load_s=$(printf '%s\n' "$_combo" | grep -oE '"load_s":[0-9.]+' | head -1 | cut -d: -f2)
  n_prompt=$(printf '%s\n' "$_combo" | grep -oE '"n_prompt":[0-9]+' | head -1 | cut -d: -f2)
  local die_max
  die_max=$(awk -F, 'NR>1{if($2+0>m)m=$2+0}END{print m+0}' "${opfx}.sampler.csv" 2>/dev/null || echo 0)
  local memfree_min
  memfree_min=$(awk -F, 'NR>1{v=$4+0; if(m==""||v<m)m=v}END{if(m=="")print 0; else printf "%.0f", m/1024}' "${opfx}.sampler.csv" 2>/dev/null || echo 0)
  local vmrss_peak
  vmrss_peak=$(awk -F, 'NR>1{if($3+0>m)m=$3+0}END{printf "%.0f", m/1024}' "${opfx}.sampler.csv" 2>/dev/null || echo 0)
  read -r batt_e btemp_e _ <<<"$(batt_fields)"
  {
    echo "label=$label rep=$rep"
    echo "eval_tok_s=$eval_tok_s"
    echo "prompt_tok_s=$prompt_tok_s"
    echo "hit=$hit"
    echo "drop_pct=$drop_pct"
    echo "mib_tok=$mib_tok"
    echo "load_s=$load_s"
    echo "die_max=$die_max"
    echo "memfree_min_mb=$memfree_min"
    echo "vmrss_peak_mb=$vmrss_peak"
    echo "wall_s=$elapsed"
    echo "rc=$brc"
    echo "batt_s=$batt_s batt_e=$batt_e"
    echo "bin_sha256=$BIN_SHA256"
  } | tee "${opfx}.summary.txt" | tee -a "$MASTER"

  local flags_s="--moe-stream --cache-mb ${CACHE_MB} --dense-weights anon --overlap --io-threads 4 --ubatch ${UBATCH} --n-expert-used ${N_EXPERT} --drop-cold-experts ${DROP_F}"
  local run_id="adopt-dropcold-${label}-r${rep}-$(date +%Y%m%d-%H%M%S)"
  append_run "${run_id},$(date -Iseconds),${TAG_PHASE},${MODEL##*/},UD-IQ2_M,11.52,bigmoe,${RUNTIME_COMMIT},${flags_s//,/;},4,4096,f16,200,cold,${pid},${prompt_tok_s},${eval_tok_s},,,,${vmrss_peak},${memfree_min},${btemp_s},${btemp_e},${batt_s},${hit}%,${nproc_s},,bin_sha256=${BIN_SHA256};drop_pct=${drop_pct};mib_tok=${mib_tok};die_max=${die_max};wall_s=${elapsed};load_s=${load_s}"
  echo "decode,${label},r${rep},${eval_tok_s},${prompt_tok_s},${hit},${drop_pct},${mib_tok},${die_max},${memfree_min},${batt_s},${batt_e},${brc},${BIN_SHA256}" >> "$CELLS_CSV"
  log "DECODE $label r$rep eval=${eval_tok_s} hit=$hit drop=$drop_pct die_max=$die_max"
  return 0
}

run_decode(){
  log "==== #3 DECODE short+f45 n=200 2rep each ===="
  local pf_short="$EXP/prompts/short.txt"
  local pf_f45="$EXP/prompts/f45_1.txt"
  [ -f "$pf_f45" ] || pf_f45="$EXP/prompts/f45_1_esplicativo.txt"
  sha256sum "$pf_short" "$pf_f45" | tee -a "$MASTER"
  run_one_decode short "$pf_short" short 1 || return $?
  run_one_decode short "$pf_short" short 2 || return $?
  run_one_decode f45_1 "$pf_f45" f45_1 1 || return $?
  run_one_decode f45_1 "$pf_f45" f45_1 2 || return $?
  return 0
}

# ─────────────────────────────────────────────────────────────
# #4 SOSTENUTO n=512, 1 run
# ─────────────────────────────────────────────────────────────
run_sostenuto(){
  local sdir="$OUTDIR/sostenuto"
  mkdir -p "$sdir"
  log "==== #4 SOSTENUTO n=512 ===="
  preflight "sostenuto" || return $?
  kill_bmoe
  log "fadvise cold sostenuto"
  if ! "$COLD_MODEL_SH" "$MODEL" >>"$MASTER" 2>&1; then
    log "FATAL cold sostenuto"; return 2
  fi
  read -r batt_s btemp_s plugged_s <<<"$(batt_fields)"
  if [ "$plugged_s" != "UNPLUGGED" ]; then log "FATAL PLUGGED sostenuto"; return 4; fi
  local plat="$sdir/plateau_n512.txt"
  if [ ! -f "$plat" ]; then
    printf '%s' 'Scrivi un saggio tecnico dettagliato e continuo (senza elenchi numerati brevi) sul funzionamento della memoria KV e dello streaming degli expert MoE su smartphone con 8 GB di RAM. Continua a scrivere fino al limite di token: spiega prefill, decode, cache LRU, page fault, thermal throttling, e ripeti i concetti con esempi concreti su Qwen 35B-A3B. Non chiudere la risposta.' > "$plat"
  fi
  local ptext; ptext=$(cat "$plat")
  local opfx="$sdir/B-short-n512"
  : > "${opfx}.stdout"; : > "${opfx}.stderr"
  set +e
  "$BIN" -m "$MODEL" -p "$ptext" -t $THREADS -c $N_CTX -n 512 \
    --temp 0 --chatml --no-think \
    --moe-stream --cache-mb $CACHE_MB --dense-weights anon --overlap \
    --io-threads $IO_THREADS --ubatch $UBATCH --n-expert-used $N_EXPERT \
    --drop-cold-experts $DROP_F --progress \
    > "${opfx}.stdout" 2> "${opfx}.stderr" &
  local BPID=$!
  sample_loop "$BPID" "${opfx}.sampler.csv" &
  local SPID=$!
  local wall_s; wall_s=$(date +%s)
  wait $BPID; local brc=$?
  local wall_e; wall_e=$(date +%s); local elapsed=$((wall_e-wall_s))
  set -e
  kill $SPID 2>/dev/null || true; wait $SPID 2>/dev/null || true
  if [ -f "${opfx}.sampler.csv.guardrail" ]; then
    log "sostenuto GUARDRAIL $(cat "${opfx}.sampler.csv.guardrail") — annotate, no retry"
  fi
  local _combo; _combo=$(cat "${opfx}.stdout" "${opfx}.stderr" 2>/dev/null || true)
  local eval_tok_s hit drop_pct mib_tok
  eval_tok_s=$(printf '%s\n' "$_combo" | grep -E 'generation:.*tok/s' | tail -1 | sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' | head -1)
  if [ -z "$eval_tok_s" ]; then
    eval_tok_s=$(printf '%s\n' "$_combo" | grep -oE '"tok_s":[0-9.]+' | tail -1 | cut -d: -f2)
  fi
  hit=$(printf '%s\n' "$_combo" | grep -oE '"cache_hit_pct":[0-9.]+' | tail -1 | cut -d: -f2)
  drop_pct=$(printf '%s\n' "$_combo" | grep -oE 'drop[=: ]+[0-9.]+' | tail -1 | grep -oE '[0-9.]+' | head -1)
  mib_tok=$(printf '%s\n' "$_combo" | grep -oE 'read [0-9.]+ MiB \([0-9.]+ MiB/token\)' | tail -1 | sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p')
  local die_max
  die_max=$(awk -F, 'NR>1{if($2+0>m)m=$2+0}END{print m+0}' "${opfx}.sampler.csv" 2>/dev/null || echo 0)
  read -r batt_e btemp_e _ <<<"$(batt_fields)"
  {
    echo "eval_tok_s=$eval_tok_s"
    echo "hit=$hit"
    echo "drop_pct=$drop_pct"
    echo "mib_tok=$mib_tok"
    echo "die_max=$die_max"
    echo "wall_s=$elapsed"
    echo "rc=$brc"
    echo "batt_s=$batt_s batt_e=$batt_e"
    echo "bin_sha256=$BIN_SHA256"
    echo "guardrail=$(cat ${opfx}.sampler.csv.guardrail 2>/dev/null || echo none)"
  } | tee "${opfx}.summary.txt" | tee -a "$MASTER"
  echo "sostenuto,${eval_tok_s},${hit},${drop_pct},${die_max},${batt_s},${batt_e},${brc},${BIN_SHA256}" >> "$CELLS_CSV"
  log "SOSTENUTO eval=${eval_tok_s} die_max=$die_max rc=$brc"
  return 0
}

# ─────────────────────────────────────────────────────────────
# MAIN — priority if battery low: #2, #3, #1, #4
# ─────────────────────────────────────────────────────────────
main(){
  : > "$MASTER"
  : > "$FLIGHT_LOG"
  echo "metric,fields..." > "$CELLS_CSV"
  log "ADOPT DROPCOLD FINAL START"
  log "bin=$BIN sha=$BIN_SHA256"
  log "model=$MODEL"
  log "config: -t $THREADS -c $N_CTX --moe-stream --cache-mb $CACHE_MB --dense-weights anon --overlap --io-threads $IO_THREADS --ubatch $UBATCH --n-expert-used $N_EXPERT --drop-cold-experts $DROP_F"
  termux-wake-lock >/dev/null 2>&1 || true
  /system/bin/am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1 || true

  read -r BATT_START BTEMP_START PLUGGED_START <<<"$(batt_fields)"
  echo "{\"percentage\":$BATT_START,\"temperature\":$BTEMP_START,\"plugged\":\"$PLUGGED_START\"}" > "$OUTDIR/batt_start.json"
  log "batt_start=$BATT_START plugged=$PLUGGED_START temp=$BTEMP_START nproc=$(nproc) die=$(mc_to_c "$(max_die_mc)")"
  if [ "$PLUGGED_START" != "UNPLUGGED" ]; then
    log "FATAL session starts PLUGGED — abort all timing"
    echo "ABORTED_PLUGGED" > "$STATUS"
    exit 4
  fi
  if [ "$BATT_START" -lt 45 ] 2>/dev/null; then
    log "WARN batt_start=$BATT_START <45 — proceed with priority order"
  fi

  SKIPPED=""
  # priority: #2, #3, #1, #4
  if ! run_conv5; then
    rc=$?
    if [ $rc -eq 5 ]; then SKIPPED="#3,#1,#4"; echo "STOPPED_BATT after #2" | tee "$STATUS"; _end; exit 0; fi
    log "WARN conv5 rc=$rc"
  fi
  if ! run_decode; then
    rc=$?
    if [ $rc -eq 5 ]; then SKIPPED="#1,#4"; echo "STOPPED_BATT after #3" | tee "$STATUS"; _end; exit 0; fi
    log "WARN decode rc=$rc"
  fi
  if ! run_load_cold; then
    rc=$?
    if [ $rc -eq 5 ]; then SKIPPED="#4"; echo "STOPPED_BATT after #1" | tee "$STATUS"; _end; exit 0; fi
    log "WARN load rc=$rc"
  fi
  if ! run_sostenuto; then
    rc=$?
    if [ $rc -eq 5 ]; then SKIPPED=""; echo "STOPPED_BATT after #4" | tee "$STATUS"; _end; exit 0; fi
    log "WARN sostenuto rc=$rc (annotate, no retry)"
  fi

  echo "DONE $(ts) skipped=${SKIPPED:-none}" | tee "$STATUS"
  _end
}

_end(){
  read -r BATT_END BTEMP_END PLUGGED_END <<<"$(batt_fields)"
  echo "{\"percentage\":$BATT_END,\"temperature\":$BTEMP_END,\"plugged\":\"$PLUGGED_END\"}" > "$OUTDIR/batt_end.json"
  log "batt_end=$BATT_END plugged=$PLUGGED_END temp=$BTEMP_END"
  log "ADOPT DROPCOLD FINAL END"
}

main "$@"
