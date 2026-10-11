# Device-side heat guard (S23, 2026-10-11), shell uid: every 10 s, HAL SKIN >= 44 C or battery level < 30 ->
# force-stop the app and log it. Independent of the Mac. Stops when /data/local/tmp/kalsa-g2/guard.stop exists.
D=/data/local/tmp/kalsa-g2; LOG=$D/guard.log; rm -f $D/guard.stop
echo "$(date +%s) guard start" >> $LOG
while [ ! -e $D/guard.stop ]; do
  sk=$(dumpsys thermalservice | sed -n '/^Current temperatures from HAL/,/^Current cooling devices/p' | grep 'mName=SKIN' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p' | head -1)
  lv=$(dumpsys battery | grep -m1 '  level:' | grep -oE '[0-9]+')
  if [ -n "$sk" ] && [ "${sk%.*}" -ge 44 ]; then am force-stop com.kalsa.app; echo "$(date +%s) skin $sk >= 44: force-stop" >> $LOG; fi
  if [ -n "$lv" ] && [ "$lv" -lt 30 ]; then am force-stop com.kalsa.app; echo "$(date +%s) level $lv < 30: force-stop" >> $LOG; fi
  sleep 10
done
echo "$(date +%s) guard stop" >> $LOG
