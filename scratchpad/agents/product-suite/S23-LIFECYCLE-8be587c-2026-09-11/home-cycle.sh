#!/usr/bin/env bash
# Engine already Pronto. HOME, wait 90s, recents reopen.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in JELLY*|192.168.1.193*) exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-LIFECYCLE-8be587c-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
FLOG="$EVID/logcat-full.txt"
cd /Users/marco/Projects/kalsa
source scripts/device-share-send.sh
device_keepawake_begin
trap 'adb shell svc power stayon false >/dev/null 2>&1 || true; device_termux_wakelock_restore; device_keepawake_restore' EXIT
adb shell svc power stayon true >/dev/null 2>&1 || true
rlog() { echo "[s23-life] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "home-cycle utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) pid=$(adb shell pidof com.kalsa.app | tr -d '\r')"

heap() {
  local tag="$1"
  {
    echo "=== $tag utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) pid=$(adb shell pidof com.kalsa.app | tr -d '\r') ==="
    adb shell dumpsys meminfo com.kalsa.app 2>/dev/null | tr -d '\r' | grep -E 'TOTAL PSS:|Native Heap|Dalvik Heap|TOTAL RSS:' | head -12
  } | tee -a "$EVID/heap.txt"
}

: > "$FLOG"
adb logcat -c
adb logcat -v threadtime >> "$FLOG" &
LPID=$!
sleep 1
heap before_home
echo "$(adb shell pidof com.kalsa.app | tr -d '\r')" > "$EVID/pid-before.txt"
HOME_EPOCH=$(python3 -c 'import time; print(f"{time.time():.3f}")')
HOME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
rlog "HOME utc=$HOME_UTC epoch=$HOME_EPOCH"
echo "utc=$HOME_UTC epoch=$HOME_EPOCH" > "$EVID/home.txt"
adb shell input keyevent KEYCODE_HOME

unload_s=""
t1=$(date +%s)
while [ $(( $(date +%s) - t1 )) -lt 90 ]; do
  if grep "model.unload" "$FLOG" | grep -q background; then
    unload_s=$(( $(date +%s) - t1 ))
    rlog "UNLOAD ${unload_s}s after HOME"
    grep "model.unload" "$FLOG" | tee "$EVID/unload.txt" | tee -a "$RUN"
    break
  fi
  sleep 1
done
if [ -z "$unload_s" ]; then
  rlog "no unload in 90s"
  echo none > "$EVID/unload.txt"
fi
# stay background ≥50s total
elapsed=$(( $(date +%s) - t1 ))
if [ "$elapsed" -lt 50 ]; then sleep $((50 - elapsed)); fi
# if unload happened early, still sit until 50s; if none, already 90s
heap after_bg
rlog "recents utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input keyevent KEYCODE_APP_SWITCH
sleep 1.6
adb shell input tap 540 900
sleep 2
device_collapse_shade
# if recents miss, am start (still resume, noted)
if ! adb shell pidof com.kalsa.app | grep -q .; then
  rlog "recents miss; am start"
  adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
fi
sleep 6
heap after_reopen
rlog "reopen logs:"
grep -E 'model.unload|background.grace|KALSA_SESSION|KALSA_PREWARM|KALSA_KVRESUME' "$FLOG" | tail -20 | tee -a "$RUN"

# short send if we have a live engine
CLEAN=0
grep -q 'cancelled":true' "$FLOG" && CLEAN=1
grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | grep -q '"ok":true' && CLEAN=1
grep -q 'kv_holds_chat' "$FLOG" && CLEAN=1
# still-warm: no unload, or cancelled
if [ -z "$unload_s" ] || grep -q 'cancelled":true' "$FLOG"; then CLEAN=1; fi
if [ "$CLEAN" -eq 1 ]; then
  rlog "short send"
  device_collapse_shade
  device_share_intent "Ciao, una parola sul pane." "life_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1600
  sleep 2
  ui=$(device_dump_ui_retry || true)
  printf '%s\n' "$ui" > "$EVID/ui-composer.xml"
  if grep -qF "pane" "$EVID/ui-composer.xml"; then
    adb shell input tap 963 2115
    t2=$(date +%s)
    while [ $(( $(date +%s) - t2 )) -lt 120 ]; do
      if grep 'KALSA_TELEMETRY' "$FLOG" | grep -q '"turnId":"1"'; then
        grep 'KALSA_TELEMETRY' "$FLOG" | grep '"turnId":"1"' | tee "$EVID/kalsa-telemetry.txt" | tee -a "$RUN"
        break
      fi
      sleep 0.5
    done
  else
    rlog "composer miss"
  fi
fi
sleep 2
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
grep -E 'KALSA_SESSION|KALSA_KVPREFIX|KALSA_KVRESUME|KALSA_KVDIAG|KALSA_TELEMETRY|KALSA_PREWARM|KALSA_SEND|model.unload|background.grace' "$FLOG" \
  > "$EVID/quoted-kalsa.txt" || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) unload_s=${unload_s:-none}"
echo "unload_s=${unload_s:-none}" > "$EVID/unload_s.txt"
