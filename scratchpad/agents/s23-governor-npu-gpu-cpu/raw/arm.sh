#!/usr/bin/env bash
# usage: arm.sh ARMNAME cpu|gpu|auto on|off — preflight, write keys, 6 turns,
# post-arm crash/marker check. Exit 8 = thermal stop, 9 = battery floor.
set -u
. /tmp/s23-gov/env.sh
ARM=$1; ROUTE=$2; LANE=$3

adb -s $S shell 'dumpsys battery | grep -E "level|powered"; dumpsys thermalservice | grep -m1 "Thermal Status"; dumpsys thermalservice | grep -m1 "mName=SKIN"; dumpsys thermalservice | grep -m1 "mName=BAT"; getprop persist.traced.enable' > $OUT/arm-$ARM-preflight.txt 2>&1
level=$(grep "^  level" $OUT/arm-$ARM-preflight.txt | grep -oE "[0-9]+" | head -1)
plugged=$(grep -cE "^  (AC|USB|Wireless) powered: true" $OUT/arm-$ARM-preflight.txt)
echo "ARM $ARM route=$ROUTE lane=$LANE start level=$level plugged=$plugged $(grep 'Thermal Status' $OUT/arm-$ARM-preflight.txt)"
[ "$plugged" -eq 0 ] || { echo "PLUGGED - ABORT ALL"; exit 9; }
[ -n "$level" ] && [ "$level" -ge 20 ] || { echo "LEVEL < 20 - ABORT ALL"; exit 9; }
grep -qE "Thermal Status: [0-2]" $OUT/arm-$ARM-preflight.txt || { echo "THERMAL >= 3 - ARM INVALID"; exit 8; }

bash /tmp/s23-gov/sqlw.sh kalsa.bench.route $ROUTE || exit 3
bash /tmp/s23-gov/sqlw.sh kalsa.bench.npu_lane $LANE || exit 3
bash /tmp/s23-gov/sqlq.sh "SELECT key,value FROM catalystLocalStorage WHERE key LIKE 'kalsa.bench%' ORDER BY key;" > $OUT/arm-$ARM-keys.txt
cat $OUT/arm-$ARM-keys.txt

rc=0
for t in s1 s2 s3 l1 l2 l3; do
  p=short; case $t in l*) p=long;; esac
  bash /tmp/s23-gov/turn.sh $ARM-$t $p || rc=$?
  case $rc in 8) echo "ARM $ARM STOPPED (thermal)"; exit 8;; 9) echo "CAMPAIGN ABORT (battery)"; exit 9;; 7) echo "TURN $ARM-$t FAILED (load/hang) - continuing arm"; rc=0;; esac
done

adb -s $S shell 'dumpsys dropbox --print' 2>/dev/null | grep -E "^\d|data_app_native_crash|SYSTEM_TOMBSTONE" | tail -40 > $OUT/arm-$ARM-dropbox.txt
adb -s $S shell 'ls -la /data/tombstones' > $OUT/arm-$ARM-tombstones.txt 2>&1
dead=$(bash /tmp/s23-gov/sqlq.sh "SELECT key FROM catalystLocalStorage WHERE key LIKE 'kalsa.load.dead%';")
echo "ARM $ARM DONE dead_marker=${dead:-none} rc=$rc"
exit $rc
