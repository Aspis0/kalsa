#!/bin/bash
# Learning-governor Stage 0 device check on the S23 (DESIGN 3.4, 2026-10-12): one arm = run-t20c.sh on
# s0-<arm>.json with the given APK, stopped after N turns by the runner's own stop flag.
# Safety: Mac watch kills the runner at HAL skin >= 44 C or battery < 30 %; the device-side guard does the same.
ARM=${1:?control|stage0}; APK=${2:?apk path}; SHA=${3:?sha}; N=${4:-5}
S=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp; W=/Users/marco/Projects/kalsa-wt-severe
OUT=$W/results/s0-$ARM-$SHA; LOG=/tmp/s0-s23/$ARM.watch.log
adb -s $S shell 'setsid sh /data/local/tmp/kalsa-g2-sampler.sh </dev/null >/dev/null 2>&1 &'
adb -s $S shell 'setsid sh /data/local/tmp/kalsa-g2-guard.sh </dev/null >/dev/null 2>&1 &'
cd $W && CAMPAIGN_APK_PATH=$APK ANDROID_SERIAL=$S CAMPAIGN_CONFIG=/tmp/s0-s23/s0-$ARM.json bash scripts/campaign/run-t20c.sh > /tmp/s0-s23/$ARM.harness.log 2>&1 &
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
adb -s $S shell 'touch /data/local/tmp/kalsa-g2/stop /data/local/tmp/kalsa-g2/guard.stop'
adb -s $S exec-out cat /data/local/tmp/kalsa-g2/g2-side.csv > /tmp/s0-s23/$ARM-side.csv
adb -s $S exec-out run-as com.kalsa.app cat files/governor/observations.jsonl > /tmp/s0-s23/$ARM-observations.jsonl 2>/dev/null
echo "$(date +%H:%M:%S) pulled side + $(wc -l < /tmp/s0-s23/$ARM-observations.jsonl) observation rows" >> $LOG
