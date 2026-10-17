# usage: BOARD=x arm.sh LABEL KIND [A_LABEL] [short|long] — arm one turn's keys (kmulti reads them back),
# wipe the chat store, run one prompt turn, parse probs/ids.
# KIND  CPU  oracle CPU arm: governor off, greedy, probs on
#       GPU  oracle GPU arm: governor on, route=gpu, npu lane off, forced to A_LABEL's first 32 ids
#       CTRL CPU-vs-CPU control: governor off, forced to A_LABEL's first 32 ids (GPU arm's forced path without the GPU)
set -u; . "$(dirname "$0")/env.sh"
LABEL=$1; KIND=$2; ALABEL=${3:-}; PROMPT=${4:-short}
P1=(kalsa.bench.sampling=greedy kalsa.bench.probs=1 kalsa.bench.toolchoice=none kalsa.web.enabled=false kalsa.tools.device=false kalsa.tools.calendar=false)
NOGOV=(kalsa.bench.governor_force=--del kalsa.bench.npu_lane=--del kalsa.bench.route=--del kalsa.bench.thermo=--del)
TH='{"batt_temp_tenths_c":330,"batt_level_pct":100,"plugged":false,"sensor_valid":true,"t_idle_valid":true,"t_idle_c":30,"trend_c_per_min":0}'
ids_of() { local f=$OUT/$ALABEL-ids.txt; [ "$(wc -l < "$f" 2>/dev/null | tr -d ' ')" = 32 ] || { echo "A ids missing for $ALABEL" >&2; return 3; }; paste -sd, "$f"; }
IDS=""
case $KIND in GPU|CTRL) IDS=$(ids_of) || exit 3 ;; esac
case $KIND in
  CPU)  KV=("${P1[@]}" kalsa.governor.enabled=0 kalsa.bench.force_ids=--del "${NOGOV[@]}") ;;
  GPU)  KV=("${P1[@]}" kalsa.governor.enabled=1 kalsa.bench.governor_force=1 kalsa.bench.npu_lane=off kalsa.bench.route=gpu "kalsa.bench.force_ids=[$IDS]" "kalsa.bench.thermo=$TH") ;;
  CTRL) KV=("${P1[@]}" kalsa.governor.enabled=0 "kalsa.bench.force_ids=[$IDS]" kalsa.bench.governor_force=--del kalsa.bench.npu_lane=--del kalsa.bench.route=--del kalsa.bench.thermo=--del) ;;
  *) echo "unknown KIND $KIND"; exit 2 ;;
esac
echo "$KIND prompt=$PROMPT ids_from=${ALABEL:-none}" > $OUT/$LABEL-kind.txt
bash "$LAB/kmulti.sh" "${KV[@]}" > $OUT/$LABEL-arm.txt 2>&1; rc=$?
cat $OUT/$LABEL-arm.txt
[ "$rc" = 0 ] || { echo "ARM FAILED rc=$rc"; exit 4; }
bash "$LAB/wipe-chats.sh" > $OUT/$LABEL-chats.txt 2>&1; rc=$?
cat $OUT/$LABEL-chats.txt
[ "$rc" = 0 ] || { echo "CHAT WIPE FAILED rc=$rc"; exit 12; }
bash "$LAB/turn.sh" "$LABEL" "$PROMPT"; rc=$?
bash "$LAB/oparse.sh" "$LABEL"
exit $rc