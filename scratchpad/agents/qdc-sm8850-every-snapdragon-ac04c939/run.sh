#!/usr/bin/env bash
# usage: BOARD=x run.sh LABEL short|long on|off — arm the key (ON = governor key ABSENT, OFF = "0"), read back, one turn.
set -u; . "$(dirname "$0")/env.sh"
LABEL=$1; PROMPT=$2; ARM=$3
if [ "$ARM" = on ]; then bash "$LAB/kset.sh" kalsa.governor.enabled --del; else bash "$LAB/kset.sh" kalsa.governor.enabled 0; fi | tee $OUT/$LABEL-arm.txt
bash "$LAB/kset.sh" kalsa.bench.npu_lane --get | sed 's/^/npu_lane=/' >> $OUT/$LABEL-arm.txt
cat $OUT/$LABEL-arm.txt | tail -1
bash "$LAB/turn.sh" $LABEL $PROMPT
