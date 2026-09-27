#!/usr/bin/env bash
set -uo pipefail
SERIAL=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
export ANDROID_SERIAL="$SERIAL" PKG=com.kalsa.app BENCH_TARGET=device OUT=/tmp/s23-readiness-diagnostic
source scripts/ci-lib.sh
source scripts/campaign/flags.sh
source scripts/campaign/governor.sh
campaign_governor_enable
printf 'governor_pref_write_completed='; date '+%F %T %Z'
python3 -c 'import time; print("launch_monotonic_before=%.6f" % time.monotonic())' >> "$OUT/timeline.txt"
adb -s "$SERIAL" shell am start -n com.kalsa.app/.MainActivity > "$OUT/am-start.log" 2>&1
printf 'am_start_exit=%s\n' "$?" >> "$OUT/timeline.txt"
printf 'am_start_returned=' >> "$OUT/timeline.txt"; date '+%F %T %Z' >> "$OUT/timeline.txt"
PID=''
for _ in $(seq 1 20); do
  PID=$(adb -s "$SERIAL" shell pidof com.kalsa.app 2>/dev/null | tr -d '\r')
  [ -n "$PID" ] && break
  sleep 1
done
printf 'app_pid=%s\n' "$PID" >> "$OUT/timeline.txt"
python3 -c 'import time; print("launch_monotonic_after=%.6f" % time.monotonic())' >> "$OUT/timeline.txt"
if [ -z "$PID" ]; then echo 'NO_PID' >> "$OUT/timeline.txt"; exit 2; fi
for i in $(seq 1 60); do
  STATE=$(adb -s "$SERIAL" shell dumpsys power 2>/dev/null | grep -m1 'mWakefulness=' | tr -d '\r')
  printf 'poll=%s %s\n' "$i" "$STATE" >> "$OUT/screen-polls.log"
  case "$STATE" in *mWakefulness=Awake*) ;; *) adb -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1; adb -s "$SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1 ;; esac
  if grep -F " $PID " "$OUT/logcat-load.log" | grep -F 'KALSA_PREWARM' | grep -F '"op":"done"' >/dev/null; then
    python3 -c 'import time; print("prewarm_done_detected_monotonic=%.6f" % time.monotonic())' >> "$OUT/timeline.txt"
    echo "prewarm_done_poll=$i pid=$PID"
    exit 0
  fi
  sleep 1
 done
echo 'PREWARM_TIMEOUT' >> "$OUT/timeline.txt"
exit 3
