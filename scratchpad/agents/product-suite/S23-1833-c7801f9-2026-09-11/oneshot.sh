#!/usr/bin/env bash
# S23 c7801f9 smoke: load existing LFM chat + one send; n_common vs embd.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in JELLY*|192.168.1.193*) echo "refused non-S23 $ANDROID_SERIAL" >&2; exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-1833-c7801f9-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
FLOG="$EVID/logcat-full.txt"
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh
device_keepawake_begin
trap 'adb shell svc power stayon false >/dev/null 2>&1 || true; device_termux_wakelock_restore; device_keepawake_restore' EXIT
adb shell svc power stayon true >/dev/null 2>&1 || true
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
rlog() { echo "[1833] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"

temp_deci() {
  adb shell dumpsys battery 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}'
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
  device_collapse_shade </dev/null
  local ui; ui=$(device_dump_ui_retry </dev/null || true)
  printf '%s\n' "$ui" > "$1"
}

rlog "temp_deci=$(temp_deci)"
rlog "force-stop utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$FLOG"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$FLOG" </dev/null &
LPID=$!
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 4
dump_idle "$EVID/ui-boot.xml"
if coords_for "Tocca per ricaricare" "$EVID/ui-boot.xml" >/tmp/s23-c780-xy.txt 2>/dev/null; then
  read -r RX RY < /tmp/s23-c780-xy.txt
  rlog "reload $RX,$RY"
  adb shell input tap "$RX" "$RY" </dev/null
fi

t0=$(date +%s)
ready=0
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  if grep KALSA_PREWARM "$FLOG" 2>/dev/null | grep -qE '"op":"done"|kv_holds_chat'; then
    rlog "engine ready"
    ready=1
    break
  fi
  sleep 2
done
dump_idle "$EVID/ui-ready.xml"
coords_for "Pronto" "$EVID/ui-ready.xml" >/dev/null 2>&1 && ready=1
grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | tee "$EVID/load.txt" | tee -a "$RUN" || true
grep -E 'window_align|window_slide|KALSA_KVRESUME' "$FLOG" | tee "$EVID/kvresume.txt" | tee -a "$RUN" || true
if [ "$ready" -ne 1 ]; then
  rlog FAIL_ready
  kill "$LPID" 2>/dev/null || true
  echo FAIL_ready > "$EVID/verdict-raw.txt"
  exit 1
fi

INV=$(coords_for "Invia" "$EVID/ui-ready.xml" || echo "963 2115")
read -r IX IY <<< "$INV"
rlog "invia $IX,$IY"
MARK=$(wc -l < "$FLOG" | tr -d ' ')
device_share_intent "Ok." "c780_$(date +%s)" </dev/null
sleep 1
device_collapse_shade </dev/null
adb shell input tap 540 1600 </dev/null
sleep 2
dump_idle "$EVID/ui-comp.xml"
rlog "Invia utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input tap "$IX" "$IY" </dev/null
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 25 ]; do
  tail -n +"$((MARK+1))" "$FLOG" | grep -q KALSA_SEND && break
  sleep 0.3
done
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 90 ]; do
  if tail -n +"$((MARK+1))" "$FLOG" | grep -q KALSA_KVPREFIX; then
    tail -n +"$((MARK+1))" "$FLOG" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|KALSA_THINKING|window_align|window_slide|KALSA_SESSION|KALSA_SEND' | tee "$EVID/after-send.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.4
done
sleep 2
grep -E 'KALSA_SESSION|KALSA_KVPREFIX|KALSA_KVDIVERGE|KALSA_KVRESUME|KALSA_THINKING|KALSA_PREWARM|window_align|window_slide|KALSA_SEND' "$FLOG" \
  > "$EVID/quoted-kalsa.txt" || true
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) temp=$(temp_deci)"
echo DONE > "$EVID/oneshot.done"
