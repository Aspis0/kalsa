#!/bin/sh
# One VL invocation on the QDC unit. Usage: drive_vl.sh <ARM> <TAG> <SERIAL>
# Aborts (exit 7) WITHOUT launching if the thermal gate fails.
set -u
ARM="$1"; TAG="$2"; SER="$3"
export ANDROID_ADB_SERVER_PORT=6037
RAW=~/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-vl3b/raw
GATE=~/kalsa-qdc/kexp-speed-cell/thermal_gate.sh

"$GATE" "$SER" "$RAW/therm_pre_${ARM}${TAG}.txt"
if [ $? -ne 0 ]; then echo "GATE_FAIL pre ${ARM}${TAG} - NOT LAUNCHED"; exit 7; fi

adb -s $SER shell "cd /data/local/tmp/kalsa && rm -f vl_${ARM}_${TAG}.exit && nohup sh run_vl.sh $ARM $TAG >/dev/null 2>&1 &"
echo "launch returned ${ARM}${TAG} $(date +%H:%M:%S)"
i=0
while [ $i -lt 60 ]; do
  sleep 15
  E=$(adb -s $SER shell "cat /data/local/tmp/kalsa/vl_${ARM}_${TAG}.exit 2>/dev/null" | tr -d '\r\n ')
  if [ -n "$E" ]; then echo "done ${ARM}${TAG} exit=$E $(date +%H:%M:%S)"; break; fi
  i=$((i+1))
done
if [ $i -ge 60 ]; then echo "TIMEOUT ${ARM}${TAG} after 15min"; exit 8; fi
"$GATE" "$SER" "$RAW/therm_post_${ARM}${TAG}.txt" || true
adb -s $SER pull /data/local/tmp/kalsa/vl_${ARM}_${TAG}.out "$RAW/vl_${ARM}_${TAG}.out" >/dev/null 2>&1
adb -s $SER pull /data/local/tmp/kalsa/vl_${ARM}_${TAG}.exit "$RAW/vl_${ARM}_${TAG}.exit" >/dev/null 2>&1
echo "pulled ${ARM}${TAG}:"; grep -E "KALSA_VL_TIMING|encoding done" "$RAW/vl_${ARM}_${TAG}.out" | tail -2
