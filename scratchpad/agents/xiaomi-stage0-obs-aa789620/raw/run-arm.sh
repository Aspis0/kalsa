#!/bin/bash
# Learning-governor Stage 0 on the Xiaomi 14 (DESIGN 3.4, 2026-10-15): one arm = run-t20c.sh on
# s0-xiaomi.json with the Stage 0 APK aa789620, stopped after N turns by the runner's own stop flag.
# Safety: the device-side guard (raw/guard.sh) and this Mac watch both stop the phone, independently.
#   skin >= 44 C or battery < 30 % -> kill the harness (the device guard also force-stops the app).
#   the harness itself pauses at recovery.thermalMaxC (43 C) and aborts on charging.
# Usage: bash run-arm.sh <N-turns> [APK]
set -u
N=${1:-6}
CELL=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/xiaomi-stage0-obs-aa789620
APK=${2:-/Users/marco/kalsa-apks/aa789620-debuggable/kalsa-apk-arm64-v8a-debuggable-aa789620ca7f1e8b9a034da5d265c20ce4b75598/app-release.apk}
SHA=aa789620
X=adb-625689a2-9xEOfw._adb-tls-connect._tcp
W=/Users/marco/Projects/kalsa-wt-severe
# The runner resolves the conversation script relative to the config dir (<dir>/t20c/script.json),
# so the config must live in the worktree campaigns/ dir; raw/s0-xiaomi.json is the archived copy.
CFG=/Users/marco/Projects/kalsa-wt-severe/campaigns/t20c-xiaomi-s0.json
OUT=$W/results/s0-xiaomi-$SHA
LOG=$CELL/raw/arm.watch.log

[ -f "$APK" ] || { echo "APK missing: $APK"; exit 2; }
[ -f "$CFG" ] || { echo "config missing: $CFG"; exit 2; }
adb -s "$X" get-state >/dev/null 2>&1 || { echo "device $X not reachable"; exit 2; }

: > "$LOG"
echo "$(date +%H:%M:%S) arm start N=$N apk=$(basename "$APK")" >> "$LOG"

# Device side first, so the guard exists before the app does.
adb -s "$X" push "$CELL/raw/guard.sh" /data/local/tmp/kalsa-g2-guard.sh >> "$LOG" 2>&1
adb -s "$X" shell 'rm -f /data/local/tmp/kalsa-g2/stop /data/local/tmp/kalsa-g2/guard.stop'
adb -s "$X" shell 'setsid sh /data/local/tmp/kalsa-g2-guard.sh </dev/null >/dev/null 2>&1 &'
adb -s "$X" shell 'setsid sh /data/local/tmp/kalsa-g2-sampler-xiaomi.sh </dev/null >/dev/null 2>&1 &'
sleep 12
echo "$(date +%s) device-side: $(adb -s "$X" shell 'pidof sh | wc -l' 2>/dev/null | tr -d '\r') sh procs, guard log: $(adb -s "$X" shell 'tail -1 /data/local/tmp/kalsa-g2/guard.log' 2>/dev/null | tr -d '\r')" >> "$LOG"

cd "$W" || exit 2
CAMPAIGN_APK_PATH="$APK" ANDROID_SERIAL="$X" CAMPAIGN_CONFIG="$CFG" \
  CAMPAIGN_MIN_BATTERY_LEVEL="${CAMPAIGN_MIN_BATTERY_LEVEL:-55}" \
  bash scripts/campaign/run-t20c.sh > "$CELL/raw/harness.log" 2>&1 &
HP=$!
echo "$(date +%H:%M:%S) harness pid $HP" >> "$LOG"

sleep 30
while kill -0 $HP 2>/dev/null; do
  j=$(ls $OUT/*/*.jsonl 2>/dev/null | head -1); n=0
  [ -n "$j" ] && n=$(python3 $W/scripts/campaign/acceptanceStats.py "$j" 2>/dev/null | awk '{print $1}')
  row=$(adb -s "$X" shell 'tail -1 /data/local/tmp/kalsa-g2/g2-side.csv' 2>/dev/null | tr -d '\r')
  lv=$(adb -s "$X" shell 'dumpsys battery | grep -m1 "  level:"' 2>/dev/null | tr -dc '0-9')
  echo "$(date +%H:%M:%S) turns=${n:-?} level=${lv:-?} side=[$row]" >> "$LOG"
  sk=$(echo "$row" | cut -d, -f5); ski=${sk%.*}
  if [ -n "$ski" ] && [ "$ski" -ge 44 ] 2>/dev/null; then echo "$(date +%H:%M:%S) skin $sk >= 44: kill" >> "$LOG"; kill $HP; break; fi
  if [ -n "$lv" ] && [ "$lv" -lt 30 ] 2>/dev/null; then echo "$(date +%H:%M:%S) level $lv < 30: kill" >> "$LOG"; kill $HP; break; fi
  if [ "${n:-0}" -ge "$N" ] 2>/dev/null && [ ! -f $OUT/.STOP-CHARGING ]; then echo "$(date +%H:%M:%S) $n turns: stop flag" >> "$LOG"; : > $OUT/.STOP-CHARGING; fi
  sleep 20
done
wait $HP 2>/dev/null; echo "$(date +%H:%M:%S) harness exited" >> "$LOG"

# Stop the device-side helpers, then pull the evidence out.
adb -s "$X" shell 'touch /data/local/tmp/kalsa-g2/stop /data/local/tmp/kalsa-g2/guard.stop'
adb -s "$X" exec-out cat /data/local/tmp/kalsa-g2/g2-side.csv > "$CELL/raw/g2-side.csv" 2>/dev/null
adb -s "$X" exec-out cat /data/local/tmp/kalsa-g2/guard.log > "$CELL/raw/guard.log" 2>/dev/null
adb -s "$X" exec-out run-as com.kalsa.app cat files/governor/observations.jsonl > "$CELL/raw/observations.jsonl" 2>/dev/null
echo "$(date +%H:%M:%S) pulled side=$(wc -l < "$CELL/raw/g2-side.csv" | tr -d ' ') rows, observations=$(wc -l < "$CELL/raw/observations.jsonl" | tr -d ' ') rows" >> "$LOG"
echo "$(date +%H:%M:%S) arm end" >> "$LOG"