#!/usr/bin/env bash
export COOL_TARGET=40.0 COOL_CAP=120 VOID_ABOVE=47.0 BOARD=qrd8650
cd "$(dirname "$0")"
for spec in "r2-on-short short on" "r2-on-long long on" "r2-off-short short off"; do
  set -- $spec; bash run.sh $1 $2 $3; rc=$?; echo "== $1 rc=$rc"; [ $rc = 10 ] && break
done
