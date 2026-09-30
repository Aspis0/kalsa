#!/usr/bin/env bash
# usage: turn.sh ROUTE LABEL  (ROUTE = npu|gpu|cpu). One cold-launched turn on the S23.
# npu = route gpu + kalsa.bench.npu_lane on; gpu = route gpu lane off; cpu = route cpu lane off.
# Adapted from /tmp/m1/turn.sh (originals untouched). Differences:
#  - stores the battery dumpsys as plug evidence instead of counting matches of
#    a possibly-failed dump (audit finding on the M1 harness);
#  - captures a pre-send state file (wakefulness/foreground/level/temp/thermal);
#  - saves a pre-send screenshot; pid-scoped KALSA extract; ggml-hex extract;
#    device-wide fastrpc extract for the one-session check.
set -u
ROUTE=$1; LABEL=$2
S=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
OUT=/tmp/npu-b
case "$ROUTE" in
  npu) BR=gpu; LANE=on ;;
  gpu) BR=gpu; LANE=off ;;
  cpu) BR=cpu; LANE=off ;;
  *) echo "bad route $ROUTE"; exit 2 ;;
esac
source /tmp/s23env.sh
q() { printf "INSERT OR REPLACE INTO catalystLocalStorage(key,value) VALUES('%s','%s');" "$1" "$2"; }

adb -s $S shell am force-stop com.kalsa.app; sleep 2
sql_write "$(q kalsa.bench.route $BR)" kalsa.bench.route $BR || exit 3
sql_write "$(q kalsa.bench.npu_lane $LANE)" kalsa.bench.npu_lane $LANE || exit 3
sql_write "$(q kalsa.bench.nativelog off)" kalsa.bench.nativelog off || exit 3

adb -s $S shell dumpsys battery > $OUT/$LABEL-battery-pre.txt 2>&1
plugged=$(grep -cE "^  (AC|USB|Wireless) powered: true" $OUT/$LABEL-battery-pre.txt)
valid=$(grep -cE "^  AC powered:" $OUT/$LABEL-battery-pre.txt)
[ "$valid" -ge 1 ] || { echo "BATTERY DUMPSYS EMPTY - abort"; exit 5; }
[ "$plugged" -eq 0 ] || { echo "PLUGGED - abort"; exit 4; }

adb -s $S shell 'input keyevent KEYCODE_WAKEUP'
# pre-launch state: evidence + hard gates on plug/awake/thermal only (the app was
# force-stopped, so the launcher is foreground here by construction; foreground is
# gated again after launch, before Send)
adb -s $S shell 'dumpsys power | grep mWakefulness=; dumpsys activity activities | grep topResumedActivity | head -1; dumpsys battery | grep -E "^  (level|temperature)"; dumpsys thermalservice | grep -m1 "Thermal Status"' > $OUT/$LABEL-state-pre.txt
grep -q "mWakefulness=Awake" $OUT/$LABEL-state-pre.txt || { echo "NOT AWAKE - abort"; exit 6; }
grep -qE "Thermal Status: [0-2]" $OUT/$LABEL-state-pre.txt || { echo "THERMAL >= 3 - abort"; exit 7; }

adb -s $S logcat -c
adb -s $S shell 'monkey -p com.kalsa.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1'
sleep 25
adb -s $S shell input tap 117 164; sleep 2
adb -s $S shell input tap 540 339; sleep 2
adb -s $S shell "am start -a android.intent.action.VIEW -d 'kalsa://share?text=$(cat $OUT/enc.txt)#n=$LABEL'" >/dev/null 2>&1
sleep 4
adb -s $S exec-out screencap -p > $OUT/$LABEL-presend.png
adb -s $S shell "dumpsys activity activities | grep topResumedActivity | head -1" | grep -q MainActivity || { echo "NOT FOREGROUND AT SEND - abort"; exit 8; }
# wait for the model-reload status line to clear (first launch after install), max 120 s
for i in $(seq 1 24); do
  adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb -s $S shell cat /sdcard/ui.xml | grep -q "In attesa" || break
  sleep 5
done
adb -s $S shell input tap 944 2071
date +%s.%N > $OUT/$LABEL-sendtime.txt
for i in $(seq 1 90); do sleep 5; adb -s $S logcat -d | grep -q KALSA_TELEMETRY && break; done
sleep 3
PID=$(adb -s $S shell pidof com.kalsa.app | tr -d '\r' | awk '{print $1}')
adb -s $S logcat -d --pid=$PID | grep -E "KALSA_(TELEMETRY|GOVERNOR|SEND)" > $OUT/$LABEL-kalsa.txt
adb -s $S logcat -d --pid=$PID | grep -E "ggml-hex|ggml-opencl|Hexagon|hexagon|HTP" > $OUT/$LABEL-hexlog.txt
adb -s $S logcat -d | grep -iE "fastrpc|remote_handle|session" | grep -viE "WindowSession|Session{]" > $OUT/$LABEL-fastrpc.txt
adb -s $S shell 'dumpsys power | grep mWakefulness=; dumpsys activity activities | grep topResumedActivity | head -1; dumpsys battery | grep -E "^  (level|temperature)"; dumpsys thermalservice | grep -m1 "Thermal Status"' > $OUT/$LABEL-state-post.txt
f=$(adb -s $S shell 'run-as com.kalsa.app ls files/energy' | tr -d '\r' | sort | tail -1)
adb -s $S shell "run-as com.kalsa.app cat files/energy/$f" > $OUT/$LABEL.csv
echo "$LABEL file=$f"
