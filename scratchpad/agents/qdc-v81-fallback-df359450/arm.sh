#!/usr/bin/env bash
# usage: BOARD=x arm.sh LABEL KIND [A_LABEL] — arm one turn's keys (kmulti reads them back), wipe the chat store, run one short-prompt turn, parse probs/ids.
# KIND  P1A  Part 1 CPU oracle arm: governor off, greedy, probs on
#       P1B  Part 1 GPU oracle arm: governor on, route=gpu, npu lane off, forced to A_LABEL's first 32 ids
#       P1C  Part 1 CPU control: governor off, forced to A_LABEL's first 32 ids (P1B's forced path without the GPU)
#       ON   Part 2 timed, shipped governor (keys ABSENT, read back)
#       OFF  Part 2 timed, governor "0"
#       NOLANE V81 fallback: shipped governor, NPU lane forced off (kalsa.bench.npu_lane=off); expect GPU prefill, CPU decode
#       XON  Part 2 extra: shipped config (no bench keys, tools on, default toolchoice); route + correctness only
set -u; . "$(dirname "$0")/env.sh"
LABEL=$1; KIND=$2; ALABEL=${3:-}
P1=(kalsa.bench.sampling=greedy kalsa.bench.probs=1 kalsa.bench.toolchoice=none kalsa.web.enabled=false kalsa.tools.device=false kalsa.tools.calendar=false)
P2=(kalsa.bench.sampling=greedy kalsa.bench.toolchoice=none kalsa.web.enabled=false kalsa.tools.device=false kalsa.tools.calendar=false)
NOGOV=(kalsa.bench.governor_force=--del kalsa.bench.npu_lane=--del kalsa.bench.route=--del kalsa.bench.thermo=--del)
TH='{"batt_temp_tenths_c":330,"batt_level_pct":100,"plugged":false,"sensor_valid":true,"t_idle_valid":true,"t_idle_c":30,"trend_c_per_min":0}'
ids_of() { local f=$OUT/$ALABEL-ids.txt; [ "$(wc -l < "$f" 2>/dev/null | tr -d ' ')" = 32 ] || { echo "A ids missing for $ALABEL" >&2; return 3; }; paste -sd, "$f"; }
IDS=""
case $KIND in P1B|P1C) IDS=$(ids_of) || exit 3 ;; esac
case $KIND in
  P1A) KV=("${P1[@]}" kalsa.governor.enabled=0 kalsa.bench.force_ids=--del "${NOGOV[@]}") ;;
  P1B) KV=("${P1[@]}" kalsa.governor.enabled=1 kalsa.bench.governor_force=1 kalsa.bench.npu_lane=off kalsa.bench.route=gpu "kalsa.bench.force_ids=[$IDS]" "kalsa.bench.thermo=$TH") ;;
  P1C) KV=("${P1[@]}" kalsa.governor.enabled=0 "kalsa.bench.force_ids=[$IDS]" kalsa.bench.governor_force=--del kalsa.bench.npu_lane=--del kalsa.bench.route=--del kalsa.bench.thermo=--del) ;;
  ON)  KV=("${P2[@]}" kalsa.governor.enabled=--del kalsa.bench.force_ids=--del kalsa.bench.probs=--del "${NOGOV[@]}") ;;
  OFF) KV=("${P2[@]}" kalsa.governor.enabled=0 kalsa.bench.force_ids=--del kalsa.bench.probs=--del "${NOGOV[@]}") ;;
  NOLANE) KV=("${P2[@]}" kalsa.governor.enabled=--del kalsa.bench.force_ids=--del kalsa.bench.probs=--del kalsa.bench.governor_force=--del kalsa.bench.npu_lane=off kalsa.bench.route=--del kalsa.bench.thermo=--del) ;;
  XON) KV=(kalsa.bench.sampling=--del kalsa.bench.toolchoice=--del kalsa.bench.probs=--del kalsa.bench.force_ids=--del kalsa.web.enabled=--del kalsa.tools.device=--del kalsa.tools.calendar=--del kalsa.governor.enabled=--del "${NOGOV[@]}") ;;
  *) echo "unknown KIND $KIND"; exit 2 ;;
esac
echo "$KIND" > $OUT/$LABEL-kind.txt
bash "$LAB/kmulti.sh" "${KV[@]}" > $OUT/$LABEL-arm.txt 2>&1; rc=$?
cat $OUT/$LABEL-arm.txt
[ "$rc" = 0 ] || { echo "ARM FAILED rc=$rc"; exit 4; }
bash "$LAB/wipe-chats.sh" > $OUT/$LABEL-chats.txt 2>&1; rc=$?
cat $OUT/$LABEL-chats.txt
[ "$rc" = 0 ] || { echo "CHAT WIPE FAILED rc=$rc"; exit 12; }
bash "$LAB/turn.sh" "$LABEL" short; rc=$?
bash "$LAB/oparse.sh" "$LABEL"
exit $rc
