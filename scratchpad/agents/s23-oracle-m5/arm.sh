#!/usr/bin/env bash
# usage: arm.sh LABEL A|B|C [A_LABEL] — arm one turn's bench keys, read back, then run the turn.
# A  production NPU prefill (shipped governor, no bench prefill override), greedy, probs on.
# B  the same plus kalsa.bench.governor_force=1 and A's 32 ids as a literal grammar.
# C  the reference: governor OFF (kalsa.governor.enabled=0, the switch the QDC R5 cell's CPU and
#    CTRL arms use) so prefill and decode both run on CPU, teacher-forced to A_LABEL's 32 ids.
# Deliberate deviations from the QDC cell: no kalsa.bench.thermo fake (real thermistor, real numbers),
# and no npu_lane/route override (the point is to test governor_force itself), and no chat wipe
# (that would delete the owner's saved conversations).
set -u; . "$(dirname "$0")/env.sh"
LABEL=$1; KIND=$2; ALABEL=${3:-}
P=$OUT/$LABEL
COMMON=(kalsa.bench.sampling=greedy kalsa.bench.probs=1 kalsa.bench.toolchoice=none
        kalsa.web.enabled=false kalsa.tools.device=false kalsa.tools.calendar=false)
OFF=(kalsa.bench.npu_lane=--del kalsa.bench.route=--del kalsa.bench.thermo=--del)
ids_of() { local f=$OUT/$ALABEL-ids.txt; [ "$(wc -l < $f 2>/dev/null | tr -d ' ')" = 32 ] || { echo "A ids missing for $ALABEL" >&2; return 3; }; paste -sd, $f; }
case $KIND in
  A) KV=("${COMMON[@]}" kalsa.governor.enabled=1 kalsa.bench.governor_force=--del kalsa.bench.force_ids=--del "${OFF[@]}") ;;
  B) IDS=$(ids_of) || exit 3
     KV=("${COMMON[@]}" kalsa.governor.enabled=1 "kalsa.bench.force_ids=[$IDS]" kalsa.bench.governor_force=1 "${OFF[@]}") ;;
  C) IDS=$(ids_of) || exit 3
     KV=("${COMMON[@]}" kalsa.governor.enabled=0 "kalsa.bench.force_ids=[$IDS]" kalsa.bench.governor_force=--del "${OFF[@]}") ;;
  *) echo "unknown KIND $KIND"; exit 2 ;;
esac
echo "$KIND" > $P-kind.txt
bash "$(dirname "$0")/kset.sh" "${KV[@]}" > $P-arm.txt 2>&1; rc=$?; cat $P-arm.txt
[ "$rc" = 0 ] || { echo "ARM FAILED rc=$rc"; exit 4; }
# Production means the shipped governor is on; an off governor would make the A arm not-A.
# The C arm is the opposite by construction: the governor MUST be off or it is not a CPU arm.
# A and B therefore set the governor explicitly rather than trusting whatever the last arm left.
gov=$(sqlite3 $TMPD/kdb/readback "SELECT value FROM catalystLocalStorage WHERE key='kalsa.governor.enabled';")
want=1; [ "$KIND" = C ] && want=0
echo "kalsa.governor.enabled=$gov (kind $KIND requires $want)" | tee -a $P-arm.txt
[ "$gov" = "$want" ] || { echo "GOVERNOR NOT IN REQUIRED STATE FOR $KIND"; exit 5; }
bash "$(dirname "$0")/turn.sh" "$LABEL" "${PROMPT:-short}"; rc=$?
bash "$(dirname "$0")/oparse.sh" "$LABEL"
exit $rc