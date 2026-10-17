# usage: BOARD=x arm.sh LABEL KIND [A_LABEL] [short|long] — arm one turn's keys (kmulti reads them back),
# wipe the chat store, run one prompt turn, parse probs/ids.
# KIND  NPU  default governor (NPU prefill, S23 kind H): governor on, governor_force ABSENT, npu_lane/route/thermo ABSENT,
#            teacher-forced to A_LABEL's first 32 ids. This is the arm under test.
#       CPU  reference: governor off, greedy, probs on (R5 A-arm keys). Not free-run: no force_ids.
#       CTRL CPU-vs-CPU control: governor off, forced to A_LABEL's first 32 ids.
set -u; . "$(dirname "$0")/env.sh"
LABEL=$1; KIND=$2; ALABEL=${3:-}; PROMPT=${4:-long}
P1=(kalsa.bench.sampling=greedy kalsa.bench.probs=1 kalsa.bench.toolchoice=none kalsa.web.enabled=false kalsa.tools.device=false kalsa.tools.calendar=false)
OFF=(kalsa.bench.governor_force=--del kalsa.bench.npu_lane=--del kalsa.bench.route=--del kalsa.bench.thermo=--del)
ids_of() { local f=$OUT/$ALABEL-ids.txt; [ "$(wc -l < "$f" 2>/dev/null | tr -d ' ')" = 32 ] || { echo "A ids missing for $ALABEL" >&2; return 3; }; paste -sd, "$f"; }
IDS=""
case $KIND in NPU|CTRL) IDS=$(ids_of) || exit 3 ;; esac
case $KIND in
  NPU)  KV=("${P1[@]}" kalsa.governor.enabled=1 "kalsa.bench.force_ids=[$IDS]" "${OFF[@]}") ;;
  CPU)  KV=("${P1[@]}" kalsa.governor.enabled=0 kalsa.bench.force_ids=--del "${OFF[@]}") ;;
  CTRL) KV=("${P1[@]}" kalsa.governor.enabled=0 "kalsa.bench.force_ids=[$IDS]" "${OFF[@]}") ;;
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
