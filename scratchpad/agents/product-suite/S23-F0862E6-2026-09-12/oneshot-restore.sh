#!/usr/bin/env bash
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp}"
case "$ANDROID_SERIAL" in
  JELLY*|192.168.1.82*|192.168.1.193*|192.168.1.152*) echo refused; exit 2 ;;
esac
EVID=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-F0862E6-2026-09-12
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh
rlog() { echo "[f086c] $*" | tee -a "$EVID/run.log"; }
SAVED_TIMEOUT=$(adb shell settings get system screen_off_timeout | tr -d '\r')
rlog "timeout_saved=$SAVED_TIMEOUT"
adb shell settings put system screen_off_timeout 300000 </dev/null
cleanup() {
  adb shell am force-stop com.kalsa.app </dev/null
  case "$SAVED_TIMEOUT" in
    ''|null)
      if adb shell settings delete system screen_off_timeout </dev/null; then
        rlog "timeout deleted"
      else
        rlog "WARNING timeout delete failed"
      fi
      ;;
    *)
      if adb shell settings put system screen_off_timeout "$SAVED_TIMEOUT" </dev/null; then
        rlog "timeout put $SAVED_TIMEOUT"
      else
        rlog "WARNING timeout put failed"
      fi
      ;;
  esac
  rlog "stay_on=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
  rlog "timeout=$(adb shell settings get system screen_off_timeout | tr -d '\r')"
}
trap cleanup EXIT
wake() { adb shell input keyevent KEYCODE_WAKEUP </dev/null; device_collapse_shade </dev/null; }
thermal() {
  local t
  t=$(adb shell dumpsys battery 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}')
  rlog "temp_deci=$t"
  [ -n "$t" ] && [ "$t" -ge 400 ] && return 1
  return 0
}
thermal || exit 3
wake
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$EVID/logcat-c.txt"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$EVID/logcat-c.txt" </dev/null &
LPID=$!
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 6
wake
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 90 ]; do
  grep 'KALSA_SESSION' "$EVID/logcat-c.txt" 2>/dev/null | grep '"op":"load"' | grep -q . && break
  sleep 2
done
grep 'KALSA_SESSION' "$EVID/logcat-c.txt" | grep '"op":"load"' | tee "$EVID/load-c1.txt" | tee -a "$EVID/run.log" || true
sleep 4
wake
device_share_intent "Ciao." "f086c_$(date +%s)" </dev/null
sleep 1
device_collapse_shade </dev/null
adb shell input tap 540 1600 </dev/null
sleep 2
adb shell input tap 963 2115 </dev/null
rlog "Invia utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
t0=$(date +%s)
SEND_LINE=""
while [ $(( $(date +%s) - t0 )) -lt 20 ]; do
  SEND_LINE=$(grep KALSA_SEND "$EVID/logcat-c.txt" | grep '"empty":false' | tail -1)
  [ -n "$SEND_LINE" ] && break
  sleep 0.4
done
rlog "send_seen=${SEND_LINE:+yes}"
t0=$(date +%s)
SAVE_LINE=""
while [ $(( $(date +%s) - t0 )) -lt 300 ]; do
  thermal || break
  # any save ok after first KALSA_SEND, excluding unchanged
  SAVE_LINE=$(awk '
    /KALSA_SEND/ && /"empty":false/ {s=1; next}
    s && /KALSA_SESSION/ && /"op":"save"/ && /"ok":true/ && !/unchanged/ && /"tokens":/ {print; exit}
  ' "$EVID/logcat-c.txt")
  if [ -n "$SAVE_LINE" ]; then
    rlog "SAVE $SAVE_LINE"
    break
  fi
  if grep -q native_shorter_than_npast "$EVID/logcat-c.txt"; then
    rlog "native_shorter_than_npast"
    grep native_shorter "$EVID/logcat-c.txt" | tee -a "$EVID/run.log"
    break
  fi
  sleep 3
done
grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|KALSA_THINKING|KALSA_TELEMETRY|native_shorter' "$EVID/logcat-c.txt" | grep -v util-extract | tee "$EVID/turn-c.txt" | tee -a "$EVID/run.log" || true
if [ -z "$SAVE_LINE" ]; then
  rlog FAIL_nosave
  kill "$LPID" 2>/dev/null || true
  echo FAIL_nosave > "$EVID/verdict-raw.txt"
  exit 1
fi
printf '%s\n' "$SAVE_LINE" > "$EVID/save-c.txt"
sleep 2
rlog "force-stop utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$EVID/logcat-d.txt"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$EVID/logcat-d.txt" </dev/null &
LPID=$!
wake
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 5
wake
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 120 ]; do
  grep 'KALSA_SESSION' "$EVID/logcat-d.txt" 2>/dev/null | grep '"op":"load"' | grep -q . && break
  sleep 2
done
sleep 2
grep 'KALSA_SESSION' "$EVID/logcat-d.txt" | grep '"op":"load"' | tee "$EVID/load-c2.txt" | tee -a "$EVID/run.log"
grep -E 'meta_mismatch|window_slide|window_align|KALSA_KVRESUME' "$EVID/logcat-d.txt" | tee -a "$EVID/run.log" || true
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo DONE > "$EVID/oneshot.done"
