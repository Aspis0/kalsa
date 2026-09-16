#!/usr/bin/env bash
# S23 d3959aa: LOAD ONLY of existing 4454-token .kvs. No stayon, no 24h, no uninstall.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp}"
case "$ANDROID_SERIAL" in
  JELLY*|192.168.1.82*|192.168.1.193*|192.168.1.152*) echo refused >&2; exit 2 ;;
esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-D3959AA-2026-09-12}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh
rlog() { echo "[d395] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

SAVED_TIMEOUT=$(adb shell settings get system screen_off_timeout | tr -d '\r')
rlog "timeout_saved=$SAVED_TIMEOUT"
if ! adb shell settings put system screen_off_timeout 300000 </dev/null; then
  rlog "WARNING failed to set screen_off_timeout 300000"
fi

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

thermal || exit 3
rlog "stay_on_before=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
KVS=$(adb shell run-as com.kalsa.app ls -l files/sessions/lfm2_002e5-2_002e6b__conv-g1-i14-1789042691__71419929.kvs)
rlog "kvs_pre=$KVS"
echo "$KVS" | grep -q 30078316 || { rlog FAIL_kvs_missing; echo FAIL_kvs > "$EVID/verdict-raw.txt"; exit 1; }

wake
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$EVID/logcat.txt"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$EVID/logcat.txt" </dev/null &
LPID=$!
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 5
wake
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 120 ]; do
  grep 'KALSA_SESSION' "$EVID/logcat.txt" 2>/dev/null | grep '"op":"load"' | grep -q . && break
  sleep 2
done
sleep 2
grep 'KALSA_SESSION' "$EVID/logcat.txt" | grep '"op":"load"' | tee "$EVID/load.txt" | tee -a "$RUN" || true
grep -E 'history_not_reproducible|no_file|historyHash|KALSA_KVRESUME' "$EVID/logcat.txt" | tee "$EVID/load-extra.txt" | tee -a "$RUN" || true

LOAD_OK=0
if grep 'KALSA_SESSION' "$EVID/logcat.txt" | grep '"op":"load"' | grep '"ok":true' | grep -qE '"tokens":[1-9]'; then
  LOAD_OK=1
  rlog LOAD_PASS
else
  rlog LOAD_FAIL
fi

if [ "$LOAD_OK" -eq 1 ]; then
  thermal || { kill "$LPID" 2>/dev/null || true; exit 3; }
  wake
  device_share_intent "Ok." "d395_$(date +%s)" </dev/null
  sleep 1
  device_collapse_shade </dev/null
  adb shell input tap 540 1600 </dev/null
  sleep 2
  adb shell input tap 963 2115 </dev/null
  rlog "Invia utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt 90 ]; do
    if grep -q KALSA_KVPREFIX "$EVID/logcat.txt"; then
      grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|window_slide|window_align' "$EVID/logcat.txt" | tee "$EVID/kvprefix.txt" | tee -a "$RUN"
      break
    fi
    sleep 1
  done
fi

kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
KVS2=$(adb shell run-as com.kalsa.app ls -l files/sessions/lfm2_002e5-2_002e6b__conv-g1-i14-1789042691__71419929.kvs)
rlog "kvs_post=$KVS2"
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo DONE > "$EVID/oneshot.done"
