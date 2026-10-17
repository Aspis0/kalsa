#!/usr/bin/env bash
# usage: arm.sh LABEL A|B [A_LABEL] — arm one turn's bench keys, read back, then run the turn.
# A  production NPU prefill (shipped governor, no bench prefill override), greedy, probs on.
# B  the same plus kalsa.bench.governor_force=1 and A's 32 ids as a literal grammar.
# Deliberate deviations from the QDC cell: no kalsa.governor.enabled=0 (that arm is the CPU
# baseline, not what M5 asks for), no kalsa.bench.thermo fake (real thermistor, real numbers),
# and no npu_lane/route override (the point is to test governor_force itself), and no chat wipe
# (that would delete the owner's saved conversations).
set -u; . "$(dirname "$0")/env.sh"
LABEL=$1; KIND=$2; ALABEL=${3:-}
P=$OUT/$LABEL
COMMON=(kalsa.bench.sampling=greedy kalsa.bench.probs=1 kalsa.bench.toolchoice=none
        kalsa.web.enabled=false kalsa.tools.device=false kalsa.tools.calendar=false)
OFF=(kalsa.bench.npu_lane=--del kalsa.bench.route=--del kalsa.bench.thermo=--del)
case $KIND in
  A) KV=("${COMMON[@]}" kalsa.bench.governor_force=--del kalsa.bench.force_ids=--del "${OFF[@]}") ;;
  B) [ "$(wc -l < $OUT/$ALABEL-ids.txt 2>/dev/null | tr -d ' ')" = 32 ] || { echo "A ids missing for $ALABEL" >&2; exit 3; }
     KV=("${COMMON[@]}" "kalsa.bench.force_ids=[$(paste -sd, $OUT/$ALABEL-ids.txt)]" kalsa.bench.governor_force=1 "${OFF[@]}") ;;
  *) echo "unknown KIND $KIND"; exit 2 ;;
esac
echo "$KIND" > $P-kind.txt
bash "$(dirname "$0")/kset.sh" "${KV[@]}" > $P-arm.txt 2>&1; rc=$?; cat $P-arm.txt
[ "$rc" = 0 ] || { echo "ARM FAILED rc=$rc"; exit 4; }
# Production means the shipped governor is on; an off governor would make the A arm not-A.
gov=$(sqlite3 $TMPD/kdb/readback "SELECT value FROM catalystLocalStorage WHERE key='kalsa.governor.enabled';")
echo "kalsa.governor.enabled=$gov (production must be 1)" | tee -a $P-arm.txt
[ "$gov" = 1 ] || { echo "GOVERNOR NOT IN PRODUCTION STATE"; exit 5; }
bash "$(dirname "$0")/turn.sh" "$LABEL" "${PROMPT:-short}"; rc=$?
bash "$(dirname "$0")/oparse.sh" "$LABEL"
exit $rc