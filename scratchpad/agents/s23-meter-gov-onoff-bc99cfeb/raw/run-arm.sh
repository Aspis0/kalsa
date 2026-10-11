#!/bin/bash
# Meter A/B on the S23 (2026-10-11): one arm = run-t20c.sh on campaigns/meter-<arm>.json, stopped cleanly after
# N turns by touching the runner's own stop flag ($OUT/.STOP-CHARGING, checked at turn boundaries).
# Safety: HAL skin >= 44 C or battery level < 30 % -> kill the runner (its EXIT trap force-stops the app).
ARM=${1:?on|off}; N=${2:-5}
S=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp; W=/Users/marco/Projects/kalsa-wt-gov
OUT=$W/results/meter-$ARM-bc99cfeb; LOG=/tmp/meter-s23/$ARM.watch.log
adb -s $S shell 'setsid sh /data/local/tmp/kalsa-g2-sampler.sh </dev/null >/dev/null 2>&1 &'
cd $W && CAMPAIGN_APK_PATH=/tmp/kalsa-apk-bc99cfeb/kalsa-apk-arm64-v8a-debuggable-bc99cfeb10b5c43185360a4fd3004e82b7df4e8f/app-release.apk ANDROID_SERIAL=$S CAMPAIGN_CONFIG=$W/campaigns/meter-$ARM.json bash scripts/${RUNNER_DIR:-campaign}/run-t20c.sh > /tmp/meter-s23/$ARM.harness.log 2>&1 &
HP=$!; echo "$(date +%H:%M:%S) harness pid $HP" >> $LOG
sleep 30
while kill -0 $HP 2>/dev/null; do
  j=$(ls $OUT/*/*.jsonl 2>/dev/null | head -1); n=0
  [ -n "$j" ] && n=$(python3 $W/scripts/campaign/acceptanceStats.py "$j" 2>/dev/null | awk '{print $1}')
  row=$(adb -s $S shell 'tail -1 /data/local/tmp/kalsa-g2/g2-side.csv' 2>/dev/null | tr -d '\r')
  lv=$(adb -s $S shell 'dumpsys battery | grep -m1 "  level:"' 2>/dev/null | tr -dc '0-9')
  echo "$(date +%H:%M:%S) turns=${n:-?} level=${lv:-?} side=[$row]" >> $LOG
  sk=$(echo "$row" | cut -d, -f5); ski=${sk%.*}
  if [ -n "$ski" ] && [ "$ski" -ge 44 ] 2>/dev/null; then echo "$(date +%H:%M:%S) skin $sk >= 44: kill" >> $LOG; kill $HP; break; fi
  if [ -n "$lv" ] && [ "$lv" -lt 30 ] 2>/dev/null; then echo "$(date +%H:%M:%S) level $lv < 30: kill" >> $LOG; kill $HP; break; fi
  if [ "${n:-0}" -ge "$N" ] 2>/dev/null && [ ! -f $OUT/.STOP-CHARGING ]; then echo "$(date +%H:%M:%S) $n turns: stop flag" >> $LOG; : > $OUT/.STOP-CHARGING; fi
  sleep 20
done
wait $HP 2>/dev/null; echo "$(date +%H:%M:%S) harness exited" >> $LOG
adb -s $S shell 'touch /data/local/tmp/kalsa-g2/stop'
mkdir -p /tmp/meter-s23/$ARM-energy
for f in $(adb -s $S shell 'run-as com.kalsa.app ls files/energy' 2>/dev/null | tr -d '\r' | grep -vxF -f /tmp/meter-s23/pre-list.txt); do
  adb -s $S exec-out run-as com.kalsa.app cat files/energy/$f > /tmp/meter-s23/$ARM-energy/$f
done
adb -s $S exec-out cat /data/local/tmp/kalsa-g2/g2-side.csv > /tmp/meter-s23/$ARM-side.csv
echo "$(date +%H:%M:%S) pulled $(ls /tmp/meter-s23/$ARM-energy | wc -l) energy files" >> $LOG
