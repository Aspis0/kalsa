#!/usr/bin/env bash
# usage: bisect.sh LEVEL  A=core, B=+env/set -u/cd, C=+logcat -c,
# D=+preflight reads, E=+guard loops, F=+amstart-to-file
set -u
LEVEL=$1
if [ "$LEVEL" != A ]; then . /tmp/s23-proof/env.sh; cd $LAB/raw; fi
S=${S:-192.168.1.152:34673}
D=/tmp/s23-proof/bisect-$LEVEL; mkdir -p $D
dump(){ adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb -s $S shell cat /sdcard/ui.xml > $D/$1.xml 2>/dev/null; echo "$1: frag=$(grep -o 'battery percentage reading' $D/$1.xml 2>/dev/null | wc -l | tr -d ' ')"; }
[ "$LEVEL" = D -o "$LEVEL" = E -o "$LEVEL" = F ] && { adb -s $S shell dumpsys battery > $D/bat.txt 2>&1; adb -s $S shell input keyevent 224; sleep 1; adb -s $S shell input keyevent 82; sleep 1; adb -s $S shell 'dumpsys power | grep mWakefulness=' | tr -d '\r'; }
[ "$LEVEL" = C -o "$LEVEL" = E -o "$LEVEL" = F ] && adb -s $S logcat -c
adb -s $S shell 'monkey -p com.kalsa.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1'
sleep 30
[ "$LEVEL" = E -o "$LEVEL" = F ] && { adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb -s $S shell cat /sdcard/ui.xml > $D/load.xml 2>/dev/null; grep -q riprovare $D/load.xml || true; }
adb -s $S shell input tap 117 164; sleep 2
adb -s $S shell input tap 540 339; sleep 2
dump d4
adb -s $S shell input tap 400 2071; sleep 2
adb -s $S shell input keycombination 113 29 >/dev/null 2>&1; sleep 1
adb -s $S shell input keyevent 67; sleep 1
adb -s $S shell input keyevent 4; sleep 1
dump d7
if [ "$LEVEL" = F ]; then
  adb -s $S shell "am start -a android.intent.action.VIEW -d 'kalsa://share?text=$(cat enc-short.txt)#n=bis-$LEVEL'" > $D/amstart.txt 2>&1
else
  adb -s $S shell "am start -a android.intent.action.VIEW -d 'kalsa://share?text=$(cat enc-short.txt)#n=bis-$LEVEL'" 2>&1 | head -2
fi
sleep 5
dump d8
