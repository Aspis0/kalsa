#!/usr/bin/env bash
# usage: turn.sh LABEL short|long — one cold-launched turn on the S23.
# Keys are written by arm.sh. Cold launch, settle 30 s (JS init + boot prewarm
# must finish BEFORE the taps/share link, else the staged URL is lost),
# fresh chat, stage via the share deep link, wait for the text to land in the
# compose box + Invia enabled, send.
set -u
. /tmp/s23-gov/env.sh
LABEL=$1; PROMPT=$2
cd $LAB/raw

# --- preflight: plugs, battery floor, wake, thermal ---
adb -s $S shell dumpsys battery > $OUT/$LABEL-battery-pre.txt 2>&1
plugged=$(grep -cE "^  (AC|USB|Wireless) powered: true" $OUT/$LABEL-battery-pre.txt)
level=$(grep "^  level" $OUT/$LABEL-battery-pre.txt | grep -oE "[0-9]+" | head -1)
[ "$plugged" -eq 0 ] || { echo "$LABEL PLUGGED - ABORT ALL"; exit 9; }
[ -n "$level" ] && [ "$level" -ge 20 ] || { echo "$LABEL LEVEL $level < 20 - ABORT ALL"; exit 9; }
adb -s $S shell input keyevent 224; sleep 1
adb -s $S shell 'dumpsys power | grep mWakefulness=; dumpsys battery | grep -E "^  (level|temperature)"; dumpsys thermalservice | grep -m1 "Thermal Status"; dumpsys thermalservice | grep -m1 "mName=SKIN"; dumpsys thermalservice | grep -m1 "mName=BAT"; getprop persist.traced.enable' > $OUT/$LABEL-state-pre.txt
grep -q "mWakefulness=Awake" $OUT/$LABEL-state-pre.txt || { echo "$LABEL NOT AWAKE"; exit 6; }
grep -qE "Thermal Status: [0-2]" $OUT/$LABEL-state-pre.txt || { echo "$LABEL THERMAL>=3 - STOP ARM"; exit 8; }

# --- cold launch, settle, dead-marker recovery ---
adb -s $S logcat -c
adb -s $S shell 'monkey -p com.kalsa.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1'
sleep 30
for i in $(seq 1 24); do
  adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb -s $S shell cat /sdcard/ui.xml > $OUT/$LABEL-ui-load.xml 2>/dev/null
  grep -q "riprovare" $OUT/$LABEL-ui-load.xml || break
  adb -s $S shell input tap 540 2124; echo "$LABEL retried dead marker"; sleep 5
done

# --- system dialog guard (a background-activity prompt steals taps) ---
for try in 1 2 3; do
  adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb -s $S shell cat /sdcard/ui.xml > $OUT/$LABEL-ui-dlg.xml 2>/dev/null
  grep -q "These apps and services" $OUT/$LABEL-ui-dlg.xml || break
  XY=$(grep -oE "text=\"Done\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" $OUT/$LABEL-ui-dlg.xml | grep -oE "\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]" | head -1 | awk -F'[][]' '{print int(($2+$4)/2), int(($6+$8)/2)}')
  adb -s $S shell input tap $XY; echo "$LABEL dismissed bg dialog"; sleep 3
done

# --- fresh chat, stage the prompt ---
adb -s $S shell input tap 117 164; sleep 2   # drawer
adb -s $S shell input tap 540 339; sleep 2   # new chat
adb -s $S shell "am start -a android.intent.action.VIEW -d 'kalsa://share?text=$(cat enc-$PROMPT.txt)#n=$LABEL'" >/dev/null 2>&1

# --- wait for the staged text to land in the compose box ---
case $PROMPT in
  short) frag="battery percentage reading" ;;
  long)  frag="Modern smartphones run large" ;;
esac
staged=0
for i in $(seq 1 30); do
  sleep 3
  adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb -s $S shell cat /sdcard/ui.xml > $OUT/$LABEL-ui.xml 2>/dev/null
  if grep -q "$frag" $OUT/$LABEL-ui.xml && grep -q 'content-desc="Invia"[^>]*enabled="true"' $OUT/$LABEL-ui.xml; then staged=1; break; fi
done
[ "$staged" -eq 1 ] || { echo "$LABEL STAGE NEVER LANDED"; adb -s $S logcat -d > $OUT/$LABEL-stuck.log 2>&1; exit 7; }
adb -s $S exec-out screencap -p > $OUT/$LABEL-presend.png
adb -s $S shell "dumpsys activity activities | grep topResumedActivity | head -1" | grep -q MainActivity || { echo "$LABEL NOT FOREGROUND AT SEND"; exit 8; }

# --- send and wait for telemetry (300 s cap = hang guard) ---
adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
adb -s $S shell cat /sdcard/ui.xml > $OUT/$LABEL-ui-presend.xml 2>/dev/null
if grep -q "These apps and services" $OUT/$LABEL-ui-presend.xml; then echo "$LABEL BG DIALOG AT SEND - abort turn"; exit 7; fi
adb -s $S shell input tap 944 2071
date +%s > $OUT/$LABEL-sendtime.txt
ok=0
for i in $(seq 1 60); do
  sleep 5
  adb -s $S logcat -d 2>/dev/null | grep -q KALSA_TELEMETRY && { ok=1; break; }
done
[ "$ok" -eq 1 ] || echo "$LABEL NO TELEMETRY IN 300s - HANG"

# --- collect (always, pass or hang) ---
PID=$(adb -s $S shell pidof $APP | tr -d '\r' | awk '{print $1}')
adb -s $S logcat -d --pid=$PID | grep -E "KALSA_" > $OUT/$LABEL-kalsa.txt 2>&1
adb -s $S logcat -d --pid=$PID | grep -Ei "ggml-hex|ggml-opencl|hexagon|HTP|OpenCL" > $OUT/$LABEL-hexlog.txt 2>&1
adb -s $S logcat -d | grep -iE "fastrpc|remote_handle" > $OUT/$LABEL-fastrpc.txt 2>&1
adb -s $S shell 'dumpsys power | grep mWakefulness=; dumpsys battery | grep -E "^  (level|temperature)"; dumpsys thermalservice | grep -m1 "Thermal Status"; dumpsys thermalservice | grep -m1 "mName=SKIN"; dumpsys thermalservice | grep -m1 "mName=BAT"' > $OUT/$LABEL-state-post.txt
f=$(adb -s $S shell "run-as $APP ls files/energy" | tr -d '\r' | sort | tail -1)
if [ -n "$f" ] && [ "$f" != "$(cat $OUT/.last-energy-file 2>/dev/null)" ]; then
  adb -s $S shell "run-as $APP cat files/energy/$f" > $OUT/$LABEL.csv 2>/dev/null
  echo "$f" > $OUT/.last-energy-file
  echo "$LABEL energy=$f rows=$(wc -l < $OUT/$LABEL.csv)"
fi
dead=$(bash /tmp/s23-gov/sqlq.sh "SELECT key FROM catalystLocalStorage WHERE key LIKE 'kalsa.load.dead%';")
echo "$LABEL dur=$(($(date +%s) - $(cat $OUT/$LABEL-sendtime.txt)))s pid=$PID dead_marker=${dead:-none}"
grep -E "KALSA_GOVERNOR \{|KALSA_TELEMETRY" $OUT/$LABEL-kalsa.txt | tail -2
[ "$ok" -eq 1 ] || exit 7
