#!/usr/bin/env bash
# QRD8650: default (plugged as reported) ON-short, then fake-unplugged ON/OFF arms. Cooldown to 40 (cap 120 s); proceed when skin <= 47; hard stop 48.0.
export COOL_TARGET=40.0 COOL_CAP=120 VOID_ABOVE=47.0 BOARD=qrd8650
cd "$(dirname "$0")"; . ./env.sh
bash run.sh r1-on-short short on; echo "== r1-on-short rc=$?"
ad shell "dumpsys battery unplug" >/dev/null 2>&1; ad shell "dumpsys battery | grep -E 'AC powered'" | tr -d '\r'
for spec in "r1u-on-short short on" "r1u-on-long long on" "r1u-off-short short off" "r1u-off-long long off"; do
  set -- $spec; bash run.sh $1 $2 $3; rc=$?; echo "== $1 rc=$rc"; [ $rc = 10 ] && break
done
ad shell "dumpsys battery reset" >/dev/null 2>&1
