#!/usr/bin/env bash
# usage: campaign.sh cool | warm — M5 full run, one group per invocation.
#   cool : pairs c1, c2, each {A production NPU, B governor_force GPU forced to A's ids}
#   warm : warm-up long turns with the settle gates off until min(nspss-*) >= NPU_WARM_C, then
#          pairs w1, w2 started under the same gate.
# Stop rules belong to turn.sh's monitor and are absolute: battery >= 42.0 C or thermal status
# >= 3 kills the turn, and cool_until_38 runs before anything continues. level < 30 % only
# matters unplugged. A non-Awake sample is a turn INVALID and gets exactly one re-run.
set -u; . "$(dirname "$0")/env.sh"
LOG=$OUT/campaign.log
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a $LOG; }
# Any key read-back mismatch must stop the whole run, not just this turn.
keycheck() { grep -q "VERIFY FAIL\|PULL FAILED\|SQLITE FAIL\|PUSH FAILED\|READBACK PULL\|SIZE CHANGED" "$1" && return 1; return 0; }

cool_until_38() {
  ad shell am force-stop $APP >/dev/null 2>&1
  local t0=$(date +%s) b
  while [ $(( $(date +%s) - t0 )) -lt ${COOLDOWN_CAP:-1800} ]; do
    ad shell "input keyevent 224; wm dismiss-keyguard" >/dev/null 2>&1
    sleep 30; b=$(batt_c)
    awk "BEGIN{exit !($b <= ${COOL_TO:-38.0})}" 2>/dev/null && { say "COOLDOWN done ${COOLDOWN_CAP:-1800}s cap, battery $b C, npu $(npu_c)"; return 0; }
  done
  say "COOLDOWN CAP HIT, battery $b C"; return 0
}

measured() {  # LABEL KIND A_LABEL START
  local L=$1 K=$2 AL=$3 ST=$4 attempt rc
  for attempt in 1 2; do
    START=$ST bash "$(dirname "$0")/arm.sh" "$L" "$K" $AL > $OUT/$L-run.log 2>&1; rc=$?
    keycheck $OUT/$L-run.log || { say "DB WRITE READ-BACK WRONG on $L — STOPPING RUN"; exit 20; }
    if [ -f $OUT/$L-stopped.txt ]; then
      say "$L attempt $attempt KILLED/INVALID: $(cut -c1-90 $OUT/$L-stopped.txt)"
      [ "$attempt" = 2 ] && return 1
      cool_until_38; continue
    fi
    [ "$rc" = 0 ] || { say "$L attempt $attempt turn failed rc=$rc"; [ "$attempt" = 2 ] && return 1; continue; }
    say "$L attempt $attempt OK | send_pre: $(cat $OUT/$L-send-pre.txt)"
    return 0
  done
}

run_pair() {  # PREFIX START
  local P=$1 ST=$2
  measured "${P}a" A "" "$ST" || return 1
  measured "${P}b" B "${P}a" "$ST" || return 1
  say "ORACLE $P: $(bash "$(dirname "$0")/oracle.sh" "${P}a" "${P}b" | grep ^oracle=)"
  return 0
}

warm_up() {
  local t0=$(date +%s) i=0 n L
  while [ $(( $(date +%s) - t0 )) -lt ${WARMUP_CAP:-1500} ]; do
    n=$(npu_c)
    awk "BEGIN{exit !($n >= ${NPU_WARM_C:-70.0})}" 2>/dev/null && { say "WARM-UP REACHED npu=$n after $(( $(date +%s) - t0 ))s"; return 0; }
    i=$((i+1)); L=warm$i
    say "warm-up turn $L (npu now $n)"
    COOL_TARGET=99 COOL_BATT=99 PROMPT=long bash "$(dirname "$0")/arm.sh" "$L" A > $OUT/$L-run.log 2>&1
    keycheck $OUT/$L-run.log || { say "DB WRITE READ-BACK WRONG on $L — STOPPING RUN"; exit 20; }
    say "warm-up $L rc=$? peak_npu=$(awk '{for(i=1;i<=NF;i++){split($i,kv,"=");if(kv[2]+0>m["npu"])m["npu"]=kv[2]+0}} END{print m["npu"]}' $OUT/$L-monitor.txt 2>/dev/null) batt_end=$(batt_c)"
    if [ -f $OUT/$L-stopped.txt ]; then say "WARM-UP STOPPED: $(cut -c1-90 $OUT/$L-stopped.txt) npu=$(npu_c)"; return 1; fi
  done
  say "WARM-UP CAP HIT after $(( $(date +%s) - t0 ))s, npu=$(npu_c) batt=$(batt_c)"; return 1
}

case "${1:-}" in
  cool)
    say "=== COOL GROUP: c1"; run_pair c1 cool || exit 21
    cool_until_38
    say "=== COOL GROUP: c2"; run_pair c2 cool || exit 22
    ;;
  warm)
    say "=== WARM GROUP: warm-up 1"; warm_up || say "warm-up 1 ended early; running w1 at whatever NPU it reached"
    run_pair w1 npu || exit 23
    say "=== WARM GROUP: warm-up 2"; warm_up || say "warm-up 2 ended early; running w2 at whatever NPU it reached"
    run_pair w2 npu || exit 24
    ;;
  *) echo "usage: campaign.sh cool|warm"; exit 2 ;;
esac
say "=== $1 GROUP COMPLETE"