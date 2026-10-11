#!/usr/bin/env bash
# usage: BOARD=x skin-id.sh — pick the LIVE "mName=skin" entry. Sample every entry 3x, 30 s apart: a frozen sensor repeats its value,
# the live one moves. Exactly one entry must move, else exit 1 (never guess). Cross-check against the kernel thermal zones, logged only.
set -u; . "$(dirname "$0")/env.sh"
all() { ad shell dumpsys thermalservice 2>/dev/null | tr -d '\r' | grep -i "mName=skin" | grep -v Threshold | sed -n 's/.*mValue=\([0-9.]*\).*/\1/p' | tr '\n' ' '; }
s1=$(all); sleep 30; s2=$(all); sleep 30; s3=$(all)
n=$(echo $s1 | wc -w | tr -d ' ')
{ echo "entries=$n"; echo "sample1=[$s1] sample2=[$s2] sample3=[$s3]"
  ad shell 'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type 2>/dev/null) $(cat $z/temp 2>/dev/null)"; done' | tr -d '\r' | grep -iE "skin|cpu|gpu" | head -20
} > $OUT/skin-samples.txt
cat $OUT/skin-samples.txt
[ "$n" = 2 ] || { echo "expected 2 skin entries, got $n"; exit 1; }
live=""
for i in 1 2; do
  a=$(echo $s1 | cut -d' ' -f$i); b=$(echo $s2 | cut -d' ' -f$i); c=$(echo $s3 | cut -d' ' -f$i)
  { [ "$a" != "$b" ] || [ "$b" != "$c" ]; } && live="$live $i"
done
set -- $live
[ $# = 1 ] || { echo "live entry ambiguous or missing: [$live]"; exit 1; }
echo "$1" > $OUT/skin-index.txt
echo "live skin entry = $1 (of 2)"
