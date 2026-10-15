#!/bin/sh
# Device-side heat guard (Xiaomi 14, 2026-10-15): every 10 s, hottest HAL skin sensor >= 44 C or
# battery level < 30 % -> force-stop the app and log it. Independent of the Mac watch: if the Mac
# dies, this still stops the phone. Stops when $D/guard.stop exists.
D=/data/local/tmp/kalsa-g2; LOG=$D/guard.log; rm -f $D/guard.stop
echo "$(date +%s) guard start" >> $LOG
while [ ! -e $D/guard.stop ]; do
  sk=$(dumpsys thermalservice | sed -n '/^Current temperatures from HAL/,/^Current cooling devices/p' | grep -i 'mName=.*skin' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p' | sort -n | tail -1)
  lv=$(dumpsys battery | grep -m1 '  level:' | grep -oE '[0-9]+')
  if [ -n "$sk" ] && [ "${sk%.*}" -ge 44 ]; then am force-stop com.kalsa.app; echo "$(date +%s) skin $sk >= 44: force-stop" >> $LOG; fi
  if [ -n "$lv" ] && [ "$lv" -lt 30 ]; then am force-stop com.kalsa.app; echo "$(date +%s) level $lv < 30: force-stop" >> $LOG; fi
  sleep 10
done
echo "$(date +%s) guard stop" >> $LOG