#!/usr/bin/env bash
# S23 f0862e6: completed-turn save then force-stop restore. No stayon, no 24h timeout.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp}"
case "$ANDROID_SERIAL" in
  JELLY*|192.168.1.82*|192.168.1.193*|192.168.1.152*)
    echo "refused serial $ANDROID_SERIAL" >&2
    exit 2
    ;;
esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-F0862E6-2026-09-12}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
FLOG="$EVID/logcat-full.txt"
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh

rlog() { echo "[f086] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"

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
        rlog "timeout restore: deleted (was ${SAVED_TIMEOUT:-empty})"
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

temp_deci() {
  adb shell dumpsys battery 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}'
}
thermal_abort() {
  local t st
  t=$(temp_deci)
  st=$(adb shell dumpsys thermalservice 2>/dev/null | tr -d '\r' | awk '/Thermal Status:/ {print $3; exit}')
  rlog "temp_deci=$t thermal_status=${st:-?}"
  if [ -n "$t" ] && [ "$t" -ge 400 ]; then
    rlog "ABORT thermal battery ${t}"
    return 1
  fi
  case "$st" in
    ''|0|1) return 0 ;;
    *) rlog "ABORT thermal status $st"; return 1 ;;
  esac
}
wake() {
  adb shell input keyevent KEYCODE_WAKEUP </dev/null
  device_collapse_shade </dev/null
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

thermal_abort || exit 3
rlog "stay_on_before=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"

wake
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$FLOG"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$FLOG" </dev/null &
LPID=$!
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 4
dump_idle "$EVID/ui-boot.xml"
if coords_for "Tocca per ricaricare" "$EVID/ui-boot.xml" >/tmp/f086-xy.txt 2>/dev/null; then
  read -r RX RY < /tmp/f086-xy.txt
  rlog "reload $RX,$RY"
  adb shell input tap "$RX" "$RY" </dev/null
fi

t0=$(date +%s)
ready=0
while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
  if grep KALSA_PREWARM "$FLOG" 2>/dev/null | grep -qE '"op":"done"|kv_holds_chat|skip'; then
    rlog "engine ready"
    ready=1
    break
  fi
  if grep 'KALSA_SESSION' "$FLOG" 2>/dev/null | grep '"op":"load"' | grep -q .; then
    # load logged; wait a beat for Pronto
    sleep 2
    ready=1
    rlog "engine load seen"
    break
  fi
  sleep 3
done
dump_idle "$EVID/ui-ready.xml"
coords_for "Pronto" "$EVID/ui-ready.xml" >/dev/null 2>&1 && ready=1
grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | tee "$EVID/load1.txt" | tee -a "$RUN" || true
if [ "$ready" -ne 1 ]; then
  rlog FAIL_ready
  kill "$LPID" 2>/dev/null || true
  echo FAIL_ready > "$EVID/verdict-raw.txt"
  exit 1
fi

INV=$(coords_for "Invia" "$EVID/ui-ready.xml" || echo "963 2115")
read -r IX IY <<< "$INV"
rlog "invia $IX,$IY"
thermal_abort || { kill "$LPID" 2>/dev/null || true; exit 3; }
MARK=$(wc -l < "$FLOG" | tr -d ' ')
wake
device_share_intent "Ciao." "f086_$(date +%s)" </dev/null
sleep 1
device_collapse_shade </dev/null
adb shell input tap 540 1600 </dev/null
sleep 2
dump_idle "$EVID/ui-comp.xml"
rlog "Invia utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input tap "$IX" "$IY" </dev/null

t0=$(date +%s)
got_send=0
while [ $(( $(date +%s) - t0 )) -lt 20 ]; do
  tail -n +"$((MARK+1))" "$FLOG" | grep -q KALSA_SEND && { got_send=1; break; }
  sleep 0.4
done
rlog "got_send=$got_send"

# Wait COMPLETED save (ok:true, not native_shorter, not mid-think only).
t0=$(date +%s)
got_save=0
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  thermal_abort || { kill "$LPID" 2>/dev/null || true; exit 3; }
  if tail -n +"$((MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"save"' | grep '"ok":true' | grep -v unchanged | grep -qE '"tokens":[1-9]'; then
    got_save=1
    tail -n +"$((MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"save"' | grep '"ok":true' | grep -v unchanged | tail -3 | tee "$EVID/save.txt" | tee -a "$RUN"
    break
  fi
  if tail -n +"$((MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"save"' | grep -q native_shorter_than_npast; then
    rlog "save refused native_shorter_than_npast"
    tail -n +"$((MARK+1))" "$FLOG" | grep native_shorter | tee -a "$RUN"
    break
  fi
  sleep 2
done
tail -n +"$((MARK+1))" "$FLOG" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|KALSA_THINKING|KALSA_TELEMETRY' | grep -v util-extract | tee "$EVID/turn1.txt" | tee -a "$RUN" || true
if [ "$got_save" -ne 1 ]; then
  rlog FAIL_nosave
  kill "$LPID" 2>/dev/null || true
  echo FAIL_nosave > "$EVID/verdict-raw.txt"
  exit 1
fi
sleep 2

# Force-stop + relaunch same chat
rlog "force-stop utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$EVID/logcat-restore.txt"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$EVID/logcat-restore.txt" </dev/null &
LPID=$!
wake
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 4
dump_idle "$EVID/ui-restore.xml"
if coords_for "Tocca per ricaricare" "$EVID/ui-restore.xml" >/tmp/f086-xy.txt 2>/dev/null; then
  read -r RX RY < /tmp/f086-xy.txt
  adb shell input tap "$RX" "$RY" </dev/null
fi
t0=$(date +%s)
got_load=0
while [ $(( $(date +%s) - t0 )) -lt 120 ]; do
  if grep 'KALSA_SESSION' "$EVID/logcat-restore.txt" 2>/dev/null | grep '"op":"load"' | grep -q .; then
    got_load=1
    break
  fi
  sleep 2
done
sleep 2
grep 'KALSA_SESSION' "$EVID/logcat-restore.txt" | grep '"op":"load"' | tee "$EVID/load2.txt" | tee -a "$RUN" || true
grep -E 'window_slide|window_align|KALSA_KVRESUME|meta_mismatch' "$EVID/logcat-restore.txt" | tee "$EVID/restore-extra.txt" | tee -a "$RUN" || true

if [ "$got_load" -ne 1 ]; then
  rlog FAIL_noload
  echo FAIL_noload > "$EVID/verdict-raw.txt"
else
  echo LOAD_SEEN > "$EVID/verdict-raw.txt"
fi

kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) temp=$(temp_deci)"
echo DONE > "$EVID/oneshot.done"
