#!/bin/sh
# One governor-8B invocation on QDC unit b4bd0901 (session 793164).
# Usage: drive_one.sh <ARM> <TAG>. Aborts (exit 7) WITHOUT launching if thermal gate fails.
set -u
ARM="$1"; TAG="$2"
SER=b4bd0901
export ANDROID_ADB_SERVER_PORT=6037
RAW=~/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-governor-8b/raw
GATE=~/kalsa-qdc/kexp-speed-cell/thermal_gate.sh

"$GATE" "$SER" "$RAW/therm_pre_${ARM}${TAG}_793164.txt"
if [ $? -ne 0 ]; then echo "GATE_FAIL pre ${ARM}${TAG} — NOT LAUNCHED"; exit 7; fi

adb -s $SER shell "cd /data/local/tmp/kalsa && rm -f gov_${ARM}_${TAG}.exit && nohup sh run_gov.sh $ARM $TAG >/dev/null 2>&1 &"
echo "launched ${ARM}${TAG} $(date +%H:%M:%S)"

i=0
while [ $i -lt 90 ]; do
  sleep 20
  E=$(adb -s $SER shell "cat /data/local/tmp/kalsa/gov_${ARM}_${TAG}.exit 2>/dev/null" | tr -d '\r\n ')
  if [ -n "$E" ]; then echo "done ${ARM}${TAG} exit=$E $(date +%H:%M:%S)"; break; fi
  i=$((i+1))
done
if [ $i -ge 90 ]; then echo "TIMEOUT ${ARM}${TAG} after 30min"; exit 8; fi

"$GATE" "$SER" "$RAW/therm_post_${ARM}${TAG}_793164.txt" || true
adb -s $SER pull /data/local/tmp/kalsa/gov_${ARM}_${TAG}.out "$RAW/gov_${ARM}_${TAG}_793164.out" >/dev/null 2>&1
adb -s $SER pull /data/local/tmp/kalsa/gov_${ARM}_${TAG}.exit "$RAW/gov_${ARM}_${TAG}_793164.exit" >/dev/null 2>&1
echo "pulled ${ARM}${TAG}; tail:"
tail -6 "$RAW/gov_${ARM}_${TAG}_793164.out"
