#!/usr/bin/env bash
# usage: BOARD=x campaign.sh [round...] — interleaved ON-short, ON-long, OFF-short, OFF-long; default 2 rounds. Stops on exit 9/10 (thermal).
set -u; . "$(dirname "$0")/env.sh"
for r in ${@:-1 2}; do
  for spec in "on short" "on long" "off short" "off long"; do
    set -- $spec; arm=$1; pr=$2; label=r$r-$arm-$pr
    [ -f $OUT/$label-kalsa.txt ] && { echo "skip $label (done)"; continue; }
    bash "$LAB/run.sh" $label $pr $arm; rc=$?
    echo "== $label rc=$rc"
    [ $rc = 9 ] || [ $rc = 10 ] && { echo "THERMAL STOP"; exit $rc; }
  done
done
