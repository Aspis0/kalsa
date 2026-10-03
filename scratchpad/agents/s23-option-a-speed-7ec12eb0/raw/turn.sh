#!/usr/bin/env bash
# usage: turn.sh LABEL short|long — one cold-launched turn on the S23.
# Reused from s23-layers-device-proof/raw/turn.sh (the baseline protocol) with
# only the deltas listed in /tmp/s23-opta/notes-harness.md: floor 25 %, filtered
# battery dump committed, low_power covariate, intra-turn thermal watchdog
# (poll 10 s, WARN 40.0, force-stop app at 43.0 C), early break when the app
# pid dies, post-telemetry answer-text capture. Send tap logic unchanged
# (single tap, never re-tap while a turn runs).
set -u
. /tmp/s23-opta/env.sh
LABEL=$1; PROMPT=$2
cd $LAB/raw
mkdir -p $SHOTS

# --- cooldown: never start a turn at Thermal Status >= 3 ---
for try in 1 2 3 4 5; do
  st=$(adb -s $S shell dumpsys thermalservice 2>/dev/null | grep -m1 "Thermal Status" | tr -d '\r')
  echo "$st" | grep -qE "[0-2]$" && break
  [ "$try" = 5 ] && { echo "$LABEL THERMAL STILL >=3 AFTER COOLDOWN - ABORT"; exit 8; }
  echo "$LABEL thermal '$st' - cooling 120s"
  sleep 120
done

# --- preflight: plugs, battery floor, wake, thermal, traced ---
adb -s $S shell dumpsys battery > /tmp/s23-opta/$LABEL-battery-full.txt 2>&1
grep -E "^  (AC powered|USB powered|Wireless powered|status|level|temperature|Charge counter)" /tmp/s23-opta/$LABEL-battery-full.txt | tr -d '\r' > $OUT/$LABEL-battery-pre.txt
plugged=$(grep -cE "^  (AC|USB|Wireless) powered: true" /tmp/s23-opta/$LABEL-battery-full.txt)
level=$(grep "^  level" /tmp/s23-opta/$LABEL-battery-full.txt | grep -oE "[0-9]+" | head -1)
temp=$(grep "^  temperature" /tmp/s23-opta/$LABEL-battery-full.txt | grep -oE "[0-9]+" | head -1)
[ "$plugged" -eq 0 ] || { echo "$LABEL PLUGGED - ABORT ALL"; exit 9; }
[ -n "$level" ] && [ "$level" -ge 25 ] || { echo "$LABEL LEVEL $level < 25 - ABORT ALL"; exit 9; }
[ -n "$temp" ] && [ "$temp" -lt 440 ] || { echo "$LABEL TEMP $temp >= 44.0C - STOP ALL"; exit 9; }
adb -s $S shell input keyevent 224; sleep 1
adb -s $S shell input keyevent 82; sleep 1   # dismiss non-secure keyguard
adb -s $S shell 'dumpsys power | grep mWakefulness=; dumpsys window policy | grep showing=; dumpsys battery | grep -E "^  (level|temperature)"; dumpsys thermalservice | grep -m1 "Thermal Status"; dumpsys thermalservice | grep -m1 "mName=SKIN"; dumpsys thermalservice | grep -m1 "mName=BAT"; echo traced=$(getprop persist.traced.enable); echo low_power=$(settings get global low_power)' | tr -d '\r' > $OUT/$LABEL-state-pre.txt
grep -q "mWakefulness=Awake" $OUT/$LABEL-state-pre.txt || { echo "$LABEL NOT AWAKE"; exit 6; }
grep -q "showing=false" $OUT/$LABEL-state-pre.txt || { adb -s $S shell input swipe 540 2000 540 600 200; sleep 1; adb -s $S shell 'dumpsys power | grep mWakefulness=; dumpsys window policy | grep showing=; dumpsys battery | grep -E "^  (level|temperature)"; dumpsys thermalservice | grep -m1 "Thermal Status"; dumpsys thermalservice | grep -m1 "mName=SKIN"; dumpsys thermalservice | grep -m1 "mName=BAT"; echo traced=$(getprop persist.traced.enable); echo low_power=$(settings get global low_power)' | tr -d '\r' > $OUT/$LABEL-state-pre.txt; grep -q "showing=false" $OUT/$LABEL-state-pre.txt || { echo "$LABEL KEYGUARD STILL SHOWING"; exit 6; }; }
grep -qE "Thermal Status: [0-2]" $OUT/$LABEL-state-pre.txt || { echo "$LABEL THERMAL>=3 - STOP ARM"; exit 8; }
grep -q "^traced=0$" $OUT/$LABEL-state-pre.txt || { echo "$LABEL TRACED NOT 0"; exit 5; }

# --- cold launch: force-stop first. The app's share handler is stateful across
# --- a warm relaunch (a successful stage breaks the next one); a virgin
# --- process every turn makes staging deterministic and turns uniform.
adb -s $S logcat -c
adb -s $S shell am force-stop $APP; sleep 2
adb -s $S shell 'monkey -p com.kalsa.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1'
sleep 30
for i in $(seq 1 24); do
  adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb -s $S shell cat /sdcard/ui.xml > $OUT/$LABEL-ui-load.txt 2>/dev/null
  grep -q "riprovare" $OUT/$LABEL-ui-load.txt || break
  adb -s $S shell input tap 540 2124; echo "$LABEL retried dead marker"; sleep 5
done

# --- system dialog guard (a background-activity prompt steals taps) ---
for try in 1 2 3; do
  adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb -s $S shell cat /sdcard/ui.xml > $OUT/$LABEL-ui-dlg.txt 2>/dev/null
  grep -q "These apps and services" $OUT/$LABEL-ui-dlg.txt || break
  XY=$(grep -oE "text=\"Done\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" $OUT/$LABEL-ui-dlg.txt | grep -oE "\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]" | head -1 | awk -F'[][]' '{print int(($2+$4)/2), int(($6+$8)/2)}')
  adb -s $S shell input tap $XY; echo "$LABEL dismissed bg dialog"; sleep 3
done

# --- fresh chat, clear compose, stage the prompt ---
adb -s $S shell input tap 117 164; sleep 2   # drawer
adb -s $S shell input tap 540 339; sleep 2   # new chat
# this build carries a global compose draft across new chats and the share
# deep link APPENDS to existing compose text, so clear it before staging
adb -s $S shell input tap 400 2071; sleep 2  # focus compose (keyboard opens)
adb -s $S shell input keycombination 113 29; sleep 1  # CTRL+A
adb -s $S shell input keyevent 67; sleep 1   # DEL
adb -s $S shell input keyevent 4; sleep 1    # BACK closes keyboard
adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb -s $S shell cat /sdcard/ui.xml > $OUT/$LABEL-ui-prelink.txt 2>/dev/null
adb -s $S shell "am start -a android.intent.action.VIEW -d 'kalsa://share?text=$(cat enc-$PROMPT.txt)#n=$LABEL'" > $OUT/$LABEL-amstart.txt 2>&1
sleep 3
adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb -s $S shell cat /sdcard/ui.xml > $OUT/$LABEL-ui-postlink.txt 2>/dev/null

# --- wait for the staged text to land in the compose box; re-fire the deep
# --- link on retry: the first fire can race the new-chat navigation and drop ---
case $PROMPT in
  short) frag="battery percentage reading" ;;
  long)  frag="Modern smartphones run large" ;;
esac
staged=0
for attempt in 1 2 3 4; do
  [ "$attempt" -gt 1 ] && { echo "$LABEL staging retry $attempt"; adb -s $S shell "am start -a android.intent.action.VIEW -d 'kalsa://share?text=$(cat enc-$PROMPT.txt)#n=$LABEL'" >> $OUT/$LABEL-amstart.txt 2>&1; }
  for i in $(seq 1 4); do
    sleep 3
    adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    adb -s $S shell cat /sdcard/ui.xml > $OUT/$LABEL-ui.txt 2>/dev/null
    if grep -q "$frag" $OUT/$LABEL-ui.txt && grep -q 'content-desc="Invia"[^>]*enabled="true"' $OUT/$LABEL-ui.txt; then staged=1; break; fi
  done
  [ "$staged" -eq 1 ] && break
done
[ "$staged" -eq 1 ] || { echo "$LABEL STAGE NEVER LANDED"; adb -s $S logcat -d > /tmp/s23-opta/$LABEL-stuck.log 2>&1; exit 7; }
grep -c "$frag" $OUT/$LABEL-ui.txt > $OUT/$LABEL-stage-count.txt
adb -s $S exec-out screencap -p > $SHOTS/$LABEL-presend.png
adb -s $S shell "dumpsys activity activities | grep topResumedActivity | head -1" | grep -q MainActivity || { echo "$LABEL NOT FOREGROUND AT SEND"; exit 8; }

# --- send and wait for telemetry (300 s cap = hang guard), under the
# --- mandatory intra-turn thermal watchdog (poll 10 s, WARN 40, KILL 43) ---
adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
adb -s $S shell cat /sdcard/ui.xml > $OUT/$LABEL-ui-presend.txt 2>/dev/null
if grep -q "These apps and services" $OUT/$LABEL-ui-presend.txt; then echo "$LABEL BG DIALOG AT SEND - abort turn"; exit 7; fi
: > $OUT/$LABEL-watchdog.txt
( while :; do
    sleep 10
    t=$(adb -s $S shell dumpsys battery 2>/dev/null | grep "^  temperature" | grep -oE "[0-9]+" | head -1)
    [ -z "$t" ] && continue
    if [ "$t" -ge 430 ]; then
      echo "$(date +%s) KILL temp=$t" >> $OUT/$LABEL-watchdog.txt
      adb -s $S shell am force-stop $APP
      break
    elif [ "$t" -ge 400 ]; then
      echo "$(date +%s) WARN temp=$t" >> $OUT/$LABEL-watchdog.txt
    else
      echo "$(date +%s) ok temp=$t" >> $OUT/$LABEL-watchdog.txt
    fi
  done ) &
WD=$!
adb -s $S shell input tap 944 2071
date +%s > $OUT/$LABEL-sendtime.txt
ok=0
gone=0
for i in $(seq 1 60); do
  sleep 5
  adb -s $S logcat -d 2>/dev/null | grep -q KALSA_TELEMETRY && { ok=1; break; }
  pid=$(adb -s $S shell pidof $APP | tr -d '\r' | awk '{print $1}')
  if [ -z "$pid" ]; then gone=$((gone+1)); [ "$gone" -ge 2 ] && break; else gone=0; fi
done
[ "$ok" -eq 1 ] || echo "$LABEL NO TELEMETRY IN 300s (or app died) - HANG/KILL"

# --- collect (always, pass or hang) ---
kill $WD 2>/dev/null
PID=$(adb -s $S shell pidof $APP | tr -d '\r' | awk '{print $1}')
if [ -n "$PID" ]; then
  adb -s $S logcat -d --pid=$PID | grep -E "KALSA_" > $OUT/$LABEL-kalsa.txt 2>&1
  adb -s $S logcat -d --pid=$PID | grep -Ei "ggml-hex|ggml-opencl|hexagon|HTP|OpenCL" > $OUT/$LABEL-hexlog.txt 2>&1
else
  : > $OUT/$LABEL-kalsa.txt; : > $OUT/$LABEL-hexlog.txt
fi
adb -s $S logcat -d | grep -iE "fastrpc|remote_handle" > $OUT/$LABEL-fastrpc.txt 2>&1
adb -s $S shell 'dumpsys power | grep mWakefulness=; dumpsys battery | grep -E "^  (level|temperature)"; dumpsys thermalservice | grep -m1 "Thermal Status"; dumpsys thermalservice | grep -m1 "mName=SKIN"; dumpsys thermalservice | grep -m1 "mName=BAT"' | tr -d '\r' > $OUT/$LABEL-state-post.txt
adb -s $S shell dumpsys battery 2>/dev/null | grep -E "^  (AC powered|USB powered|Wireless powered|status|level|temperature|Charge counter)" | tr -d '\r' > $OUT/$LABEL-battery-post.txt
dead=$(bash $LAB/raw/sqlq.sh "SELECT key FROM catalystLocalStorage WHERE key LIKE 'kalsa.load.dead%';")
echo "$LABEL dur=$(($(date +%s) - $(cat $OUT/$LABEL-sendtime.txt)))s pid=${PID:-killed} dead_marker=${dead:-none}"
grep -E "KALSA_KVPREFIX" $OUT/$LABEL-kalsa.txt | tail -1
grep -E "KALSA_GOVERNOR \{|KALSA_TELEMETRY" $OUT/$LABEL-kalsa.txt | tail -2
grep -q "KILL" $OUT/$LABEL-watchdog.txt && { echo "$LABEL WATCHDOG KILL AT 43C - STOP ALL"; exit 10; }

# --- answer capture: the answer renders within a few s of telemetry ---
sleep 5
adb -s $S shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
adb -s $S shell cat /sdcard/ui.xml > $SHOTS/$LABEL-answer.xml 2>/dev/null
grep -oE 'text="[^"]+"' $SHOTS/$LABEL-answer.xml | sed 's/^text="//; s/"$//' | grep -v '^$' > $OUT/$LABEL-answer.txt 2>/dev/null
[ "$ok" -eq 1 ] || exit 7
