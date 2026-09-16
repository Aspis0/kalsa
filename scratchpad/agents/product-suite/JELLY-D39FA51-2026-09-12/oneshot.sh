#!/usr/bin/env bash
# Jelly d39fa51: send1 complete then send2 rematch. No stayon, timeout 10min.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.82:5555}"
case "$ANDROID_SERIAL" in
  adb-R3CW406P8CV*|192.168.1.152*|192.168.1.193*) echo refused S23/Xiaomi >&2; exit 2 ;;
esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/JELLY-D39FA51-2026-09-12}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh
rlog() { echo "[jelly-d39f] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"

SAVED_TIMEOUT=$(adb shell settings get system screen_off_timeout | tr -d '\r')
rlog "timeout_saved=$SAVED_TIMEOUT"
if ! adb shell settings put system screen_off_timeout 600000 </dev/null; then
  rlog "WARNING failed to set screen_off_timeout 600000"
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
coords_for() {
  python3 - "$1" "$2" <<'PY'
import re, sys
needle, path = sys.argv[1], sys.argv[2]
xml = open(path, encoding="utf-8", errors="replace").read()
pat = re.compile(
    r'<node [^>]*?(?:content-desc|text)="[^"]*%s[^"]*"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
    % re.escape(needle))
m = pat.search(xml) or re.compile(
    r'<node [^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*?(?:content-desc|text)="[^"]*%s[^"]*"'
    % re.escape(needle)).search(xml)
if not m: sys.exit(1)
x1,y1,x2,y2=map(int,m.groups()); print(f"{(x1+x2)//2} {(y1+y2)//2}")
PY
}
dump_idle() {
  wake
  local ui; ui=$(device_dump_ui_retry </dev/null || true)
  printf '%s\n' "$ui" > "$1"
}

thermal || exit 3
rlog "stay_on_before=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
wake
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$EVID/logcat.txt"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$EVID/logcat.txt" </dev/null &
LPID=$!
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 6
wake
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  grep KALSA_PREWARM "$EVID/logcat.txt" 2>/dev/null | grep -qE 'done|kv_holds_chat|skip' && break
  grep 'KALSA_SESSION' "$EVID/logcat.txt" 2>/dev/null | grep '"op":"load"' | grep -q . && break
  sleep 3
done
grep 'KALSA_SESSION' "$EVID/logcat.txt" | grep '"op":"load"' | tee "$EVID/load.txt" | tee -a "$RUN" || true
sleep 3
dump_idle "$EVID/ui-ready.xml"
INV=$(coords_for "Invia" "$EVID/ui-ready.xml" || echo "630 1100")
read -r IX IY <<< "$INV"
rlog "invia $IX,$IY"

send_ciao() {
  local tag="$1"
  wake
  device_share_intent "Ciao." "${tag}_$(date +%s)" </dev/null
  sleep 1
  device_collapse_shade </dev/null
  adb shell input tap 360 900 </dev/null
  sleep 2
  adb shell input tap "$IX" "$IY" </dev/null
  rlog "Invia $tag utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

MARK1=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
send_ciao s1
t0=$(date +%s)
got1=0
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  thermal || break
  if tail -n +"$((MARK1+1))" "$EVID/logcat.txt" | grep -q KALSA_KVPREFIX; then
    got1=1
    tail -n +"$((MARK1+1))" "$EVID/logcat.txt" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|window_slide|window_align' | tee "$EVID/send1.txt" | tee -a "$RUN"
    break
  fi
  sleep 2
done
rlog "got1=$got1"

# Wait send1 COMPLETE: telemetry after SEND (not a pre-send save)
t0=$(date +%s)
got_done=0
while [ $(( $(date +%s) - t0 )) -lt 480 ]; do
  thermal || break
  wake
  if tail -n +"$((MARK1+1))" "$EVID/logcat.txt" | grep KALSA_TELEMETRY | grep -v util-extract | grep -q .; then
    got_done=1
    tail -n +"$((MARK1+1))" "$EVID/logcat.txt" | grep KALSA_TELEMETRY | grep -v util-extract | tail -2 | tee "$EVID/tel1.txt" | tee -a "$RUN"
    break
  fi
  sleep 4
done
rlog "got_done=$got_done"
if [ "$got_done" -ne 1 ]; then
  rlog FAIL_send1_incomplete
  kill "$LPID" 2>/dev/null || true
  echo FAIL_send1 > "$EVID/verdict-raw.txt"
  exit 1
fi
sleep 3

MARK2=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
send_ciao s2
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  thermal || break
  if tail -n +"$((MARK2+1))" "$EVID/logcat.txt" | grep -q KALSA_KVPREFIX; then
    tail -n +"$((MARK2+1))" "$EVID/logcat.txt" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|window_slide|window_align' | tee "$EVID/send2.txt" | tee -a "$RUN"
    break
  fi
  sleep 2
done

kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo DONE > "$EVID/oneshot.done"
