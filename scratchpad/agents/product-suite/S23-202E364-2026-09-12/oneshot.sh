#!/usr/bin/env bash
# S23 202e364: completed-turn save THEN restore. No stayon, no 24h timeout.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp}"
case "$ANDROID_SERIAL" in
  JELLY*|192.168.1.82*|192.168.1.193*|192.168.1.152*) echo refused >&2; exit 2 ;;
esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-202E364-2026-09-12}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh
rlog() { echo "[202e] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

SAVED_TIMEOUT=$(adb shell settings get system screen_off_timeout | tr -d '\r')
rlog "timeout_saved=$SAVED_TIMEOUT"
if ! adb shell settings put system screen_off_timeout 300000 </dev/null; then
  rlog "WARNING failed to set screen_off_timeout 300000"
fi
rlog "timeout_set=$(adb shell settings get system screen_off_timeout | tr -d '\r')"

cleanup() {
  rlog "cleanup utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  adb shell am force-stop com.kalsa.app </dev/null
  case "$SAVED_TIMEOUT" in
    ''|null)
      if adb shell settings delete system screen_off_timeout </dev/null; then
        rlog "timeout restore: deleted"
      else
        rlog "WARNING timeout restore delete failed"
      fi
      ;;
    *)
      if adb shell settings put system screen_off_timeout "$SAVED_TIMEOUT" </dev/null; then
        rlog "timeout restore: put $SAVED_TIMEOUT"
      else
        rlog "WARNING timeout restore put failed"
      fi
      ;;
  esac
  rlog "stay_on_after=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
  rlog "timeout_after=$(adb shell settings get system screen_off_timeout | tr -d '\r')"
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
find_post_send_save() {
  python3 - "$1" <<'PY'
import sys
path = sys.argv[1]
lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
send_i = None
slide_i = None
for i, ln in enumerate(lines):
    if "KALSA_SEND" in ln and '"empty":false' in ln:
        send_i = i
    if send_i is not None and i > send_i and "window_slide" in ln:
        slide_i = i
if send_i is None:
    sys.exit(1)
start = slide_i if slide_i is not None else send_i
for ln in lines[start + 1 :]:
    if "KALSA_SESSION" not in ln or '"op":"save"' not in ln:
        continue
    if '"ok":true' not in ln:
        continue
    if "unchanged" in ln:
        continue
    if '"tokens":' not in ln:
        continue
    print(ln)
    sys.exit(0)
sys.exit(1)
PY
}

thermal || exit 3
rlog "stay_on_before=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
wake
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$EVID/logcat1.txt"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$EVID/logcat1.txt" </dev/null &
LPID=$!
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 5
wake
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 120 ]; do
  grep 'KALSA_SESSION' "$EVID/logcat1.txt" 2>/dev/null | grep '"op":"load"' | grep -q . && break
  sleep 2
done
sleep 2
grep 'KALSA_SESSION' "$EVID/logcat1.txt" | grep '"op":"load"' | tee "$EVID/load1.txt" | tee -a "$RUN" || true
sleep 3
wake
device_share_intent "Ciao." "202e_$(date +%s)" </dev/null
sleep 1
device_collapse_shade </dev/null
adb shell input tap 540 1600 </dev/null
sleep 2
adb shell input tap 963 2115 </dev/null
rlog "Invia utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

t0=$(date +%s)
got_send=0
while [ $(( $(date +%s) - t0 )) -lt 25 ]; do
  grep KALSA_SEND "$EVID/logcat1.txt" | grep -q '"empty":false' && { got_send=1; break; }
  sleep 0.4
done
rlog "got_send=$got_send"

SAVE_LINE=""
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 420 ]; do
  thermal || break
  if SAVE_LINE=$(find_post_send_save "$EVID/logcat1.txt"); then
    break
  fi
  SAVE_LINE=""
  if grep -q native_shorter_than_npast "$EVID/logcat1.txt"; then
    rlog "saw native_shorter_than_npast"
    grep native_shorter "$EVID/logcat1.txt" | tee -a "$RUN"
  fi
  sleep 3
done
grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|KALSA_THINKING|window_slide|window_align|native_shorter' "$EVID/logcat1.txt" | tee "$EVID/turn1.txt" | tee -a "$RUN" || true
if [ -z "$SAVE_LINE" ]; then
  rlog FAIL_nosave
  kill "$LPID" 2>/dev/null || true
  echo FAIL_nosave > "$EVID/verdict-raw.txt"
  exit 1
fi
printf '%s\n' "$SAVE_LINE" | tee "$EVID/save.txt" | tee -a "$RUN"
sleep 3

rlog "force-stop utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$EVID/logcat2.txt"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$EVID/logcat2.txt" </dev/null &
LPID=$!
wake
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 5
wake
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 120 ]; do
  grep 'KALSA_SESSION' "$EVID/logcat2.txt" 2>/dev/null | grep '"op":"load"' | grep -q . && break
  sleep 2
done
sleep 2
grep 'KALSA_SESSION' "$EVID/logcat2.txt" | grep '"op":"load"' | tee "$EVID/load2.txt" | tee -a "$RUN" || true
grep -E 'meta_mismatch|window_slide|window_align|KALSA_KVRESUME' "$EVID/logcat2.txt" | tee "$EVID/restore-extra.txt" | tee -a "$RUN" || true

kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo DONE > "$EVID/oneshot.done"
