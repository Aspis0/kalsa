#!/usr/bin/env bash
# usage: BOARD=x parm.sh A|B LABEL [A_LABEL] — Part B oracle turn. A = governor off (CPU prefill, CPU decode);
# B = governor on + governor_force=1 + npu_lane=off (GPU prefill, CPU decode) + route=gpu + injected cool thermo + force_ids = first 32 ids of A_LABEL.
# Both: greedy, KALSA_BENCH_PROBS, tools/web off (keeps the CPU arm short enough for the 48.0 stop), cold sessions via turn.sh.
set -u; . "$(dirname "$0")/env.sh"
ARM=$1; LABEL=$2; ALABEL=${3:-}
COMMON=(kalsa.bench.sampling=greedy kalsa.bench.probs=1 kalsa.bench.toolchoice=none kalsa.web.enabled=false kalsa.tools.device=false kalsa.tools.calendar=false)
if [ "$ARM" = A ]; then
  bash "$LAB/kmulti.sh" "${COMMON[@]}" kalsa.governor.enabled=0 kalsa.bench.governor_force=--del kalsa.bench.npu_lane=--del kalsa.bench.route=--del kalsa.bench.force_ids=--del kalsa.bench.thermo=--del
else
  IDS=$(paste -sd, "$OUT/$ALABEL-ids.txt"); [ "$(wc -l < $OUT/$ALABEL-ids.txt | tr -d ' ')" = 32 ] || { echo "A ids missing"; exit 3; }
  TH='{"batt_temp_tenths_c":330,"batt_level_pct":100,"plugged":false,"sensor_valid":true,"t_idle_valid":true,"t_idle_c":30,"trend_c_per_min":0}'
  bash "$LAB/kmulti.sh" "${COMMON[@]}" kalsa.governor.enabled=1 kalsa.bench.governor_force=1 kalsa.bench.npu_lane=off kalsa.bench.route=gpu "kalsa.bench.force_ids=[$IDS]" "kalsa.bench.thermo=$TH"
fi | tee "$OUT/$LABEL-arm.txt"
[ "${PIPESTATUS[0]}" = 0 ] || { echo "ARM FAILED"; exit 4; }
bash "$LAB/turn.sh" "$LABEL" short; rc=$?
bash "$LAB/oparse.sh" "$LABEL"
exit $rc
