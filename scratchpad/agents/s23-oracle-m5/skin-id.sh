#!/usr/bin/env bash
# usage: skin-id.sh — pick the LIVE mName=SKIN entry in the HAL list. Sample every entry 3x,
# 30 s apart: a frozen sensor repeats its value, a live one moves. Never max() over the entries.
# The S23 exposes two (one per HAL). They may be two views of one physical sensor, in which case
# both move together — that is recorded as a duplicate pair, not silently treated as one live read.
set -u; . "$(dirname "$0")/env.sh"
all() { ad shell dumpsys thermalservice 2>/dev/null | tr -d '\r' | grep -i "mName=SKIN" | grep -v Threshold | sed -n 's/.*mValue=\([0-9.]*\).*/\1/p' | tr '\n' ' '; }
s1=$(all); sleep 30; s2=$(all); sleep 30; s3=$(all)
n=$(echo $s1 | wc -w | tr -d ' ')
moved=""
for i in $(seq 1 $n); do
  a=$(echo $s1 | cut -d' ' -f$i); b=$(echo $s2 | cut -d' ' -f$i); c=$(echo $s3 | cut -d' ' -f$i)
  { [ "$a" != "$b" ] || [ "$b" != "$c" ]; } && moved="$moved $i"
done
{ echo "entries=$n"; echo "sample1=[$s1] sample2=[$s2] sample3=[$s3]"; echo "moved_entries=[$moved]"
  echo "--- kernel zones (nspss / gpuss / battery); skin has no kernel zone on the S23"
  ad shell 'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type 2>/dev/null) $(cat $z/temp 2>/dev/null)"; done' | tr -d '\r' | grep -iE "^nspss|^gpuss|^battery"
} > $OUT/skin-samples.txt
cat $OUT/skin-samples.txt
[ "$n" -ge 1 ] || { echo "no SKIN entry in the HAL list"; exit 1; }
set -- $moved; cnt=$#
[ "$cnt" -ge 1 ] || { echo "no SKIN entry moved in 60 s; cannot identify a live read: exit 1"; exit 1; }
if [ "$cnt" = 1 ]; then
  echo "$1" > $OUT/skin-index.txt; echo "live skin entry = $1 (of $n)"; exit 0
fi
# Every moving entry must have moved to the same value, else the choice is ambiguous.
uniq_move=$(for i in $moved; do j=$(( i - 1 )); echo $s3 | cut -d' ' -f$i; done | sort -u | tr '\n' ' ')
[ "$(echo $uniq_move | wc -w | tr -d ' ')" = 1 ] || { echo "moving entries disagree ($uniq_move): ambiguous, exit 1"; exit 1; }
# Same value from every entry: the HALs are duplicating one sensor, so any index reads that sensor.
echo "1" > $OUT/skin-index.txt
echo "all entries [$moved] move together to $uniq_move: one physical sensor via $n HAL entries; pinned index 1"