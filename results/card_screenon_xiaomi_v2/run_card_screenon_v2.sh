#!/bin/bash
# Xiaomi screen-on card-cell REDO (Doze-contaminated queue item).
# Protocol is NOT ambiguous — match results/xiaomi_t4_round exactly:
#   campaign bin, n=200, --chatml --no-think, fadv cold, stayon+WAKEUP,
#   CalaQwen t6, Marco t4. Extra reps (3 vs original 2/1) for a median.
# Validity: parsed tok/s, bytes>20KB;
#   CalaQwen wall>40s (orig ~58-60s); Marco wall>15s (orig 26s).
# HARD battery floor 30%. Thermal wait if temp > 38.0C.
A="/c/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe"
S="adb-625689a2-9xEOfw._adb-tls-connect._tcp"
export MSYS_NO_PATHCONV=1
D="/c/Users/gualt/Desktop/Kalsa/moe-experiments/results/card_screenon_xiaomi_v2"
OUT="$D/out"; mkdir -p "$OUT"
LOG="$D/STATUS.txt"
log(){ echo "$(date -Is)  $*" | tee -a "$LOG"; }

M_MARCO=/data/local/tmp/gdn_750/taskb/Marco-Mini-Instruct-KEXP.gguf
M_CALA=/data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf
B=/data/local/tmp/gdn_750/taskb/bin
FADV=/data/local/tmp/kf_general/bin/fadv
P=/data/local/tmp/gdn_750/taskb/prompts/p_fact.txt
# Fallback prompt if taskb one is missing.
P2=/data/local/tmp/kf_general/p_fact.txt

adbsh(){ "$A" -s "$S" shell "$@" 2>&1; }

batt_check(){
  local lvl t plugged
  lvl=$(adbsh "dumpsys battery" | grep -E '^\s*level:' | head -1 | grep -oE '[0-9]+' | head -1)
  t=$(adbsh "dumpsys battery" | grep -oE 'temperature: [0-9]+' | grep -oE '[0-9]+' | head -1)
  plugged=$(adbsh "dumpsys battery" | grep -E 'AC powered:|USB powered:|Wireless powered:' | tr '\n' ' ' | tr -d '\r')
  [ -z "$lvl" ] && lvl=999
  [ -z "$t" ] && t=999
  log "BATT level=${lvl}% temp=${t} plugged=[${plugged}]"
  if [ "$lvl" -lt 30 ]; then
    log "BATTERY_FLOOR level=${lvl}% < 30% — STOP"
    return 1
  fi
  return 0
}

temp_wait(){
  while :; do
    t=$(adbsh "dumpsys battery" | grep -oE 'temperature: [0-9]+' | grep -oE '[0-9]+' | head -1)
    [ -z "$t" ] && t=999
    if [ "$t" -le 380 ]; then log "TEMP_OK $t"; break; fi
    log "TEMP_WAIT $t"
    sleep 60
  done
}

wake(){
  adbsh "input keyevent KEYCODE_WAKEUP" >/dev/null
  local w
  w=$(adbsh "dumpsys power" | grep -oE 'mWakefulness=[A-Za-z]+' | head -1 | tr -d '\r')
  log "WAKE $w"
}

parse_tps(){
  local f="$1" tps spt
  tps=$(grep -oE 'generation: [0-9]+ tokens, [0-9.]+ s/token \([0-9.]+ tok/s\)' "$f" | tail -1 | grep -oE '[0-9.]+ tok/s' | awk '{print $1}')
  if [ -n "$tps" ]; then printf '%s' "$tps"; return 0; fi
  spt=$(grep -oE 'generation: [0-9]+ tokens, [0-9.]+ s/token' "$f" | tail -1 | grep -oE '[0-9.]+ s/token' | awk '{print $1}')
  if [ -n "$spt" ]; then
    awk -v s="$spt" 'BEGIN{if(s>0) printf "%.3f", 1.0/s; else print ""}'
    return 0
  fi
  return 1
}

extract_lines(){
  local f="$1" name="$2"
  local gen stream
  gen=$(grep -E '^llama_perf_context_print:        generation' "$f" | tail -1 | tr -d '\r')
  [ -z "$gen" ] && gen=$(grep -E 'generation: [0-9]+ tokens' "$f" | tail -1 | tr -d '\r')
  stream=$(grep -E '^moe-stream:' "$f" | tail -1 | tr -d '\r')
  log "EXTRACT $name gen=[$gen]"
  log "EXTRACT $name stream=[$stream]"
}

runblk(){
  name=$1; model=$2; threads=$3; minwall=$4
  local cmd
  cmd="cd $B && LD_LIBRARY_PATH=$B ./bmoe-cli -m $model -p \"\$(cat $P)\" -n 200 --temp 0 -c 4096 --ubatch 512 -t $threads --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --n-expert-used 6 --drop-cold-experts 0.65 --chatml --no-think"
  for try in 1 2 3; do
    batt_check || return 2
    temp_wait
    wake
    fv=$(adbsh "$FADV $model" | tr -d '\r')
    log "FADV $name: $fv"
    log "RUN $name try=$try t=$threads"
    t0=$(date +%s)
    "$A" -s "$S" shell "$cmd" > "$OUT/$name.txt" 2>&1
    t1=$(date +%s)
    wall=$((t1-t0))
    bytes=$(wc -c <"$OUT/$name.txt" | tr -d ' ')
    tps=$(parse_tps "$OUT/$name.txt") || tps=""
    extract_lines "$OUT/$name.txt" "$name"
    reasons=""
    [ -z "$tps" ] && reasons="${reasons}no_timing_line "
    [ "$wall" -le "$minwall" ] && reasons="${reasons}wall=${wall}s<=${minwall} "
    [ "$bytes" -le 20480 ] && reasons="${reasons}bytes=${bytes}<=20KB "
    if [ -z "$reasons" ]; then
      log "DONE $name tok/s=$tps wall=${wall}s bytes=$bytes try=$try"
      return 0
    fi
    log "RETRY $name try=$try FAIL[$reasons] tok/s=${tps:-none} wall=${wall}s bytes=$bytes"
    sleep 60
  done
  log "FAIL $name after 3 tries — last tok/s=${tps:-none} wall=${wall}s bytes=$bytes"
  return 1
}

# Prompt fallback
if ! adbsh "test -f $P && echo OK" | grep -q OK; then
  log "PROMPT fallback $P missing, using $P2"
  P="$P2"
fi

log "=== CARD SCREEN-ON REDO XIAOMI START (unplugged, stayon, campaign bin, n200, chatml/no-think) ==="
log "SERIAL=$S BIN=$B P=$P"
adbsh "svc power stayon true" >/dev/null
wake
batt_check || { adbsh "svc power stayon false" >/dev/null; log "ABORT battery at start"; exit 2; }

# --- CalaQwen t6, 3 cold (card 4.75 was t6 2-cold median) ---
runblk cq_t6_r1 "$M_CALA" 6 40 || { rc=$?; adbsh "svc power stayon false" >/dev/null; log "ABORT cq_t6_r1 rc=$rc"; exit $rc; }
runblk cq_t6_r2 "$M_CALA" 6 40 || { rc=$?; adbsh "svc power stayon false" >/dev/null; log "ABORT cq_t6_r2 rc=$rc"; exit $rc; }
runblk cq_t6_r3 "$M_CALA" 6 40 || { rc=$?; adbsh "svc power stayon false" >/dev/null; log "ABORT cq_t6_r3 rc=$rc"; exit $rc; }

# --- Marco t4, 3 cold (card 10.57 was t4 1-cold) ---
runblk m1c_t4_r1 "$M_MARCO" 4 15 || { rc=$?; adbsh "svc power stayon false" >/dev/null; log "ABORT m1c_t4_r1 rc=$rc"; exit $rc; }
runblk m1c_t4_r2 "$M_MARCO" 4 15 || { rc=$?; adbsh "svc power stayon false" >/dev/null; log "ABORT m1c_t4_r2 rc=$rc"; exit $rc; }
runblk m1c_t4_r3 "$M_MARCO" 4 15 || { rc=$?; adbsh "svc power stayon false" >/dev/null; log "ABORT m1c_t4_r3 rc=$rc"; exit $rc; }

batt_check || true
adbsh "svc power stayon false" >/dev/null
log "CARD_SCREENON_REDO_DONE"
