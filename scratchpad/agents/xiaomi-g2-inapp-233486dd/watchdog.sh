#!/bin/bash
# Night watchdog for the Xiaomi in-app session (2026-10-11). Every 60 s while the harness runs:
#  - battery level < 30 %: stop the harness (its EXIT trap force-stops the app);
#  - screen not Awake: wake it and dismiss the keyguard (the phone is left unlocked);
#  - log level, skin, status, wakefulness and the focused app to watchdog.log.
# When the harness is gone (finished, stopped or crashed): stop the side sampler, force-stop Kalsa and put the
# screen timeout back to 60 s so the owner's phone can sleep for the rest of the night.
X=adb-625689a2-9xEOfw._adb-tls-connect._tcp
LOG=/tmp/g2-xiaomi/watchdog.log
SKIN_KILL=46
sleep 5
while pgrep -f "scripts/campaign/run-t20c.sh" >/dev/null; do
  row=$(adb -s $X shell 'tail -1 /data/local/tmp/kalsa-g2/g2-side.csv' 2>/dev/null | tr -d '\r')
  lv=$(echo "$row" | cut -d, -f7)
  wake=$(adb -s $X shell 'dumpsys power | grep -m1 -o "mWakefulness=[A-Za-z]*"' 2>/dev/null | tr -d '\r' | cut -d= -f2)
  focus=$(adb -s $X shell 'dumpsys window | grep -m1 mCurrentFocus' 2>/dev/null | tr -d '\r' | sed -E 's/.*\{[^ ]+ [^ ]+ ([^ }]+)\}.*/\1/')
  echo "$(date +%H:%M:%S) level=${lv:-?} wake=${wake:-?} focus=${focus:-?} side=[$row]" >> $LOG
  sk=$(echo "$row" | cut -d, -f5); ski=${sk%.*}
  if [ -n "$ski" ] && [ "$ski" -ge $SKIN_KILL ] 2>/dev/null; then
    echo "$(date +%H:%M:%S) skin $sk >= $SKIN_KILL: stopping the harness" >> $LOG
    pkill -f "scripts/campaign/run-t20c.sh"
    break
  fi
  if [ -n "$lv" ] && [ "$lv" -lt 30 ] 2>/dev/null; then
    echo "$(date +%H:%M:%S) level $lv < 30: stopping the harness" >> $LOG
    pkill -f "scripts/campaign/run-t20c.sh"
    break
  fi
  if [ -n "$wake" ] && [ "$wake" != "Awake" ]; then
    echo "$(date +%H:%M:%S) screen $wake: waking and dismissing the keyguard" >> $LOG
    adb -s $X shell 'input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard' >/dev/null 2>&1
  fi
  sleep 60
done
sleep 20
echo "$(date +%H:%M:%S) harness gone: stopping the sampler, force-stopping Kalsa, screen timeout 60 s" >> $LOG
adb -s $X shell 'touch /data/local/tmp/kalsa-g2/stop; am force-stop com.kalsa.app; settings put system screen_off_timeout 60000; settings get system screen_off_timeout' >> $LOG 2>&1
