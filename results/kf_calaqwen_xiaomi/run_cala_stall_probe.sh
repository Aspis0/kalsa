#!/bin/bash
# CalaQwen 35B stall/K-F probe on Xiaomi (PC-driven via adb, UNPLUGGED + stayon).
# Question: does 35B residual overlap-stall share cross the ~20-25% K-F pay threshold?
# Design: a1 warmup OFF (discard, also confirms KF binary loads qwen35moe)
#         -> a2 cold OFF (THE number) -> a3 cold ON
#         -> a4 cold OFF -> a5 cold ON.
# n=150, campaign config, same DONE rules as kf_cold_xiaomi.
# HARD battery floor 30%. Thermal wait if temp > 38.0C.
#
# bmoe-cli has no --prompt-file; pass the on-device prompt via -p "$(cat ...)".
A="/c/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe"
# Wireless port rotates; prefer already-connected mDNS serial, fall back to IP.
S="adb-625689a2-9xEOfw._adb-tls-connect._tcp"
export MSYS_NO_PATHCONV=1
D="/c/Users/gualt/Desktop/Kalsa/moe-experiments/results/kf_calaqwen_xiaomi"
OUT="$D/out"; mkdir -p "$OUT"
LOG="$D/STATUS.txt"
log(){ echo "$(date -Is)  $*" | tee -a "$LOG"; }
MODEL=/data/local/tmp/gdn_750/taskb/Qwen3.6-35B-A3B-KEXP.gguf
B=/data/local/tmp/kf_general/bin
BCAMP=/data/local/tmp/gdn_750/taskb/bin
P=/data/local/tmp/kf_general/p_fact.txt
# Expand $(cat $P) on the DEVICE, not the host. All other $vars expand here.
BASE_KF="cd $B && LD_LIBRARY_PATH=$B ./bmoe-cli -m $MODEL -p \"\$(cat $P)\" -n 150 --temp 0 -c 4096 --ubatch 512 -t 4 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --n-expert-used 6 --drop-cold-experts 0.65"
BASE_CAMP="cd $BCAMP && LD_LIBRARY_PATH=$BCAMP ./bmoe-cli -m $MODEL -p \"\$(cat $P)\" -n 150 --temp 0 -c 4096 --ubatch 512 -t 4 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --n-expert-used 6 --drop-cold-experts 0.65"
ONX=" --kf-prefetch --kf-prefetch-width 4"
# Default: KF binary for everything. If a1 fails to load qwen35moe, OFF blocks
# switch to campaign binary; ON stays on KF (and will fail loudly if KF cannot load).
BASE="$BASE_KF"
BIN_TAG=KF

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

# DONE only if: (a) real generation timing line with parsed ms/tok,
# (b) wall > 40s, (c) output > 20 KB. Else retry (max 3) and FAIL loudly.
parse_mstok(){
  local f="$1" spt mstok
  spt=$(grep -oE 'generation: [0-9]+ tokens, [0-9.]+ s/token' "$f" | tail -1 | grep -oE '[0-9.]+ s/token' | awk '{print $1}')
  if [ -n "$spt" ]; then
    awk -v s="$spt" 'BEGIN{printf "%.1f", s*1000}'
    return 0
  fi
  mstok=$(grep -oE '[0-9.]+ ms per token' "$f" | tail -1 | grep -oE '^[0-9.]+')
  if [ -n "$mstok" ]; then
    printf '%s' "$mstok"
    return 0
  fi
  return 1
}

extract_lines(){
  local f="$1" name="$2"
  local stream overlap stall decode share
  stream=$(grep -E '^moe-stream:' "$f" | tail -1 | tr -d '\r')
  overlap=$(grep -E '^moe-overlap:' "$f" | tail -1 | tr -d '\r')
  decode=$(echo "$stream" | grep -oE 'decode [0-9.]+ s/token' | awk '{print $2}')
  stall=$(echo "$overlap" | grep -oE 'stall [0-9.]+ s/token' | awk '{print $2}')
  log "EXTRACT $name stream=[$stream]"
  log "EXTRACT $name overlap=[$overlap]"
  if [ -n "$decode" ] && [ -n "$stall" ]; then
    share=$(awk -v s="$stall" -v d="$decode" 'BEGIN{if(d>0) printf "%.1f", 100.0*s/d; else print "NA"}')
    log "STALL_SHARE $name stall=${stall} decode=${decode} share=${share}%"
  else
    log "STALL_SHARE $name stall=${stall:-missing} decode=${decode:-missing} share=NA"
  fi
}

load_fail(){
  local f="$1"
  grep -qiE 'unknown (model )?architecture|unknown arch|error loading|failed to load|failed to initialize|unsupported architecture|llama_model_load.*error|qwen35moe' "$f" && return 0
  # Also treat tiny/no-timing output with an error-ish line as load fail.
  if ! parse_mstok "$f" >/dev/null; then
    grep -qiE 'error|fatal|assert|unknown' "$f" && return 0
  fi
  return 1
}

runblk(){ name=$1; extra=$2; cold=$3; cmd="${4:-$BASE}"
  for try in 1 2 3; do
    batt_check || return 2
    temp_wait
    if [ "$cold" = 1 ]; then
      fv=$(adbsh "$B/fadv $MODEL" | tr -d '\r')
      log "FADV $name: $fv"
    fi
    log "RUN $name try=$try bin=$BIN_TAG extra=[$extra]"
    t0=$(date +%s)
    "$A" -s "$S" shell "$cmd$extra" > "$OUT/$name.txt" 2>&1
    t1=$(date +%s)
    wall=$((t1-t0))
    bytes=$(wc -c <"$OUT/$name.txt" | tr -d ' ')
    mstok=$(parse_mstok "$OUT/$name.txt") || mstok=""
    extract_lines "$OUT/$name.txt" "$name"
    reasons=""
    [ -z "$mstok" ] && reasons="${reasons}no_timing_line "
    [ "$wall" -le 40 ] && reasons="${reasons}wall=${wall}s<=40 "
    [ "$bytes" -le 20480 ] && reasons="${reasons}bytes=${bytes}<=20KB "
    if [ -z "$reasons" ]; then
      log "DONE $name ms/tok=$mstok wall=${wall}s bytes=$bytes try=$try bin=$BIN_TAG"
      return 0
    fi
    log "RETRY $name try=$try FAIL[$reasons] ms/tok=${mstok:-none} wall=${wall}s bytes=$bytes"
    if load_fail "$OUT/$name.txt"; then
      log "LOAD_FAIL_HINT $name — see $OUT/$name.txt head:"
      head -40 "$OUT/$name.txt" | tr -d '\r' | while read -r ln; do log "  | $ln"; done
    fi
    sleep 60
  done
  log "FAIL $name after 3 tries — last ms/tok=${mstok:-none} wall=${wall}s bytes=$bytes"
  return 1
}

log "=== CALAQWEN STALL/KF PROBE XIAOMI START (unplugged, stayon, t4, k6d065, n150) ==="
log "SERIAL=$S MODEL=$MODEL BIN_KF=$B BIN_CAMP=$BCAMP"
adbsh "svc power stayon true" >/dev/null
adbsh "input keyevent KEYCODE_WAKEUP" >/dev/null
batt_check || { adbsh "svc power stayon false" >/dev/null; log "ABORT battery at start"; exit 2; }

# --- a1 warmup: confirms KF binary loads qwen35moe ---
if ! runblk a1_warmup_OFF "" 0 "$BASE_KF"; then
  rc=$?
  [ "$rc" = 2 ] && { adbsh "svc power stayon false" >/dev/null; log "ABORT battery"; exit 2; }
  log "KF_LOAD_FAIL a1 did not produce a valid run on KF binary"
  if load_fail "$OUT/a1_warmup_OFF.txt" || [ ! -s "$OUT/a1_warmup_OFF.txt" ]; then
    log "TRY_CAMPAIGN_OFF switching OFF blocks to $BCAMP"
    # Probe campaign binary can load.
    BIN_TAG=CAMP
    BASE="$BASE_CAMP"
    if ! runblk a1_warmup_OFF_camp "" 0 "$BASE_CAMP"; then
      rc=$?
      [ "$rc" = 2 ] && { adbsh "svc power stayon false" >/dev/null; log "ABORT battery"; exit 2; }
      log "CAMP_LOAD_FAIL campaign binary also failed to load qwen35moe"
      log "STOP_PART_A neither KF nor campaign binary loaded CalaQwen"
      adbsh "svc power stayon false" >/dev/null
      exit 3
    fi
    log "CAMPAIGN_OFF_OK will run OFF on campaign, ON on KF"
  else
    log "ABORT warmup (not a clear load-fail — not switching binaries)"
    adbsh "svc power stayon false" >/dev/null
    exit 1
  fi
else
  log "KF_LOAD_OK qwen35moe loaded on KF binary"
  BASE="$BASE_KF"
  BIN_TAG=KF
fi

# --- a2 THE number: cold OFF ---
BIN_TAG=$([ "$BASE" = "$BASE_CAMP" ] && echo CAMP || echo KF)
runblk a2_cold_OFF "" 1 "$BASE" || { rc=$?; adbsh "svc power stayon false" >/dev/null; log "ABORT a2 rc=$rc"; exit $rc; }

# --- a3 cold ON (always KF binary; K-F flags live there) ---
BIN_TAG=KF
runblk a3_cold_ON "$ONX" 1 "$BASE_KF" || { rc=$?; adbsh "svc power stayon false" >/dev/null; log "ABORT a3 rc=$rc"; exit $rc; }

# --- a4 cold OFF repeat ---
BIN_TAG=$([ "$BASE" = "$BASE_CAMP" ] && echo CAMP || echo KF)
runblk a4_cold_OFF "" 1 "$BASE" || { rc=$?; adbsh "svc power stayon false" >/dev/null; log "ABORT a4 rc=$rc"; exit $rc; }

# --- a5 cold ON repeat ---
BIN_TAG=KF
runblk a5_cold_ON "$ONX" 1 "$BASE_KF" || { rc=$?; adbsh "svc power stayon false" >/dev/null; log "ABORT a5 rc=$rc"; exit $rc; }

batt_check || true
adbsh "svc power stayon false" >/dev/null
log "CALAQWEN_STALL_PROBE_DONE"
