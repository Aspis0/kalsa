#!/usr/bin/env bash
# Diagnostic arms with `dumpsys battery unplug` (fake unplugged). Cooldown target relaxed to 47 (board idles ~46 on the rack); hard stop stays 48.0.
export COOL_TARGET=47.0 COOL_CAP=30 BOARD=qrd8750
cd "$(dirname "$0")"
for spec in "r1u-on-long long on" "r1u-off-short short off" "r1u-off-long long off"; do
  set -- $spec; bash run.sh $1 $2 $3; rc=$?; echo "== $1 rc=$rc"; [ $rc = 10 ] && break
done
