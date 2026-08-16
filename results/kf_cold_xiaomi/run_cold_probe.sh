#!/bin/bash
# KF COLD-START probe on Xiaomi (PC-driven via adb, phone plugged + stayon).
# Question: does the K-F cold-start win generalize to fast-flash devices?
# Design: b0 warmup (discard) -> w1 warm OFF anchor (must reproduce the
# kf_general probe's 0.398-0.406 s/tok, validates config) -> 6 cold pairs,
# alternating order, fadv (page-cache eviction, self-verifying) before EVERY
# cold block. Exploratory - no prereg claims.
#
# bmoe-cli has no --prompt-file; pass the on-device prompt via -p "$(cat ...)".
A="/c/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe"
S="192.168.1.193:46397"
export MSYS_NO_PATHCONV=1
D="/c/Users/gualt/Desktop/Kalsa/moe-experiments/results/kf_cold_xiaomi"
OUT="$D/out"; mkdir -p "$OUT"
LOG="$D/STATUS.txt"
log(){ echo "$(date -Is)  $*" | tee -a "$LOG"; }
MODEL=/data/local/tmp/gdn_750/taskb/Marco-Mini-Instruct-KEXP.gguf
B=/data/local/tmp/kf_general/bin
P=/data/local/tmp/kf_general/p_fact.txt
# Expand $(cat $P) on the DEVICE, not the host. All other $vars expand here.
BASE="cd $B && LD_LIBRARY_PATH=$B ./bmoe-cli -m $MODEL -p \"\$(cat $P)\" -n 200 --temp 0 -c 4096 --ubatch 512 -t 4 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --n-expert-used 6 --drop-cold-experts 0.65"
ONX=" --kf-prefetch --kf-prefetch-width 4"

adbsh(){ "$A" -s "$S" shell "$@" 2>&1; }
temp_wait(){ while :; do t=$(adbsh "dumpsys battery" | grep -oE 'temperature: [0-9]+' | grep -oE '[0-9]+' | head -1); [ -z "$t" ] && t=999; if [ "$t" -le 380 ]; then log "TEMP_OK $t"; break; fi; log "TEMP_WAIT $t"; sleep 60; done; }

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

runblk(){ name=$1; extra=$2; cold=$3
  for try in 1 2 3; do
    temp_wait
    if [ "$cold" = 1 ]; then fv=$(adbsh "$B/fadv $MODEL" | tr -d '\r'); log "FADV $name: $fv"; fi
    log "RUN $name try=$try"
    t0=$(date +%s)
    "$A" -s "$S" shell "$BASE$extra" > "$OUT/$name.txt" 2>&1
    t1=$(date +%s)
    wall=$((t1-t0))
    bytes=$(wc -c <"$OUT/$name.txt" | tr -d ' ')
    mstok=$(parse_mstok "$OUT/$name.txt") || mstok=""
    reasons=""
    [ -z "$mstok" ] && reasons="${reasons}no_timing_line "
    [ "$wall" -le 40 ] && reasons="${reasons}wall=${wall}s<=40 "
    [ "$bytes" -le 20480 ] && reasons="${reasons}bytes=${bytes}<=20KB "
    if [ -z "$reasons" ]; then
      log "DONE $name ms/tok=$mstok wall=${wall}s bytes=$bytes try=$try"
      return 0
    fi
    log "RETRY $name try=$try FAIL[$reasons] ms/tok=${mstok:-none} wall=${wall}s bytes=$bytes"
    sleep 60
  done
  log "FAIL $name after 3 tries — last ms/tok=${mstok:-none} wall=${wall}s bytes=$bytes"
  return 1
}

log "=== KF COLD PROBE XIAOMI START (plugged, stayon, t4, k6d065, n200) ==="
adbsh "svc power stayon true" >/dev/null
runblk b0_warmup_OFF "" 0 || { log "ABORT warmup"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk w1_warmanchor_OFF "" 0 || { log "ABORT anchor"; adbsh "svc power stayon false" >/dev/null; exit 1; }
log "ANCHOR CHECK: w1 must be ~398-406 ms/tok (kf_general warm OFF) else config mismatch"
runblk c01_OFF ""     1 || { log "ABORT c01"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk c02_ON  "$ONX" 1 || { log "ABORT c02"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk c03_ON  "$ONX" 1 || { log "ABORT c03"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk c04_OFF ""     1 || { log "ABORT c04"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk c05_OFF ""     1 || { log "ABORT c05"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk c06_ON  "$ONX" 1 || { log "ABORT c06"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk c07_ON  "$ONX" 1 || { log "ABORT c07"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk c08_OFF ""     1 || { log "ABORT c08"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk c09_OFF ""     1 || { log "ABORT c09"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk c10_ON  "$ONX" 1 || { log "ABORT c10"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk c11_ON  "$ONX" 1 || { log "ABORT c11"; adbsh "svc power stayon false" >/dev/null; exit 1; }
runblk c12_OFF ""     1 || { log "ABORT c12"; adbsh "svc power stayon false" >/dev/null; exit 1; }
adbsh "svc power stayon false" >/dev/null
log "COLD_PROBE_DONE"
