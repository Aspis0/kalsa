#!/usr/bin/env bash
# S23 cb1d92d: A bake facts-diverge + B background unload. No stayon, no keepawake.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp}"
case "$ANDROID_SERIAL" in
  JELLY*|192.168.1.82*|192.168.1.193*|192.168.1.152*)
    echo "refused serial $ANDROID_SERIAL" >&2
    exit 2
    ;;
esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-CB1D92D-2026-09-12}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
FLOG="$EVID/logcat-full.txt"
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh
# NEVER device_keepawake_begin / stayon true.

rlog() { echo "[cb1d] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"

cleanup() {
  rlog "cleanup utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  adb shell am force-stop com.kalsa.app </dev/null
  if adb shell svc power stayon false </dev/null; then
    rlog "stayon false"
  else
    rlog "WARNING stayon false failed"
  fi
  rlog "stay_on_while_plugged_in=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
  rlog "screen_off_timeout=$(adb shell settings get system screen_off_timeout | tr -d '\r')"
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

thermal_abort || exit 3
rlog "stay_on_before=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
rlog "timeout_before=$(adb shell settings get system screen_off_timeout | tr -d '\r')"

adb shell input keyevent KEYCODE_WAKEUP </dev/null
device_collapse_shade </dev/null

rlog "force-stop then start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$FLOG"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$FLOG" </dev/null &
LPID=$!
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 4
dump_idle "$EVID/ui-boot.xml"
if coords_for "Tocca per ricaricare" "$EVID/ui-boot.xml" >/tmp/cb1d-xy.txt 2>/dev/null; then
  read -r RX RY < /tmp/cb1d-xy.txt
  rlog "reload $RX,$RY"
  adb shell input tap "$RX" "$RY" </dev/null
fi

t0=$(date +%s)
ready=0
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  thermal_abort || { kill "$LPID" 2>/dev/null || true; exit 3; }
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
device_share_intent "Ok." "cb1d_$(date +%s)" </dev/null
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
# A: wait KVPREFIX (do not dump during generate)
t0=$(date +%s)
got_prefix=0
while [ $(( $(date +%s) - t0 )) -lt 90 ]; do
  if tail -n +"$((MARK+1))" "$FLOG" | grep -q KALSA_KVPREFIX; then
    got_prefix=1
    tail -n +"$((MARK+1))" "$FLOG" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|window_slide|window_align|KALSA_THINKING|KALSA_SEND' \
      | tee "$EVID/after-send.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.4
done
if [ "$got_prefix" -ne 1 ]; then
  rlog FAIL_noprefix
  kill "$LPID" 2>/dev/null || true
  echo FAIL_noprefix > "$EVID/verdict-raw.txt"
  exit 1
fi

# Wait until the turn is DONE (telemetry, not mid-stream) before HOME.
t0=$(date +%s)
got_done=0
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  thermal_abort || { kill "$LPID" 2>/dev/null || true; exit 3; }
  if tail -n +"$((MARK+1))" "$FLOG" | grep KALSA_TELEMETRY | grep -v util-extract | grep -q .; then
    tail -n +"$((MARK+1))" "$FLOG" | grep KALSA_TELEMETRY | grep -v util-extract | tail -3 | tee "$EVID/tel.txt" | tee -a "$RUN"
    got_done=1
    break
  fi
  if tail -n +"$((MARK+1))" "$FLOG" | grep -q KALSA_STALL; then
    rlog stall
    break
  fi
  sleep 1
done
sleep 3
grep 'KALSA_SESSION' "$FLOG" | grep save | tail -5 | tee "$EVID/saves.txt" | tee -a "$RUN" || true

if [ "$got_done" -ne 1 ]; then
  rlog "WARN turn not settled; skip HOME unload (must not HOME mid-stream)"
  echo SKIP_B_midstream > "$EVID/verdict-raw.txt"
else
  thermal_abort || { kill "$LPID" 2>/dev/null || true; exit 3; }
  MARK_B=$(wc -l < "$FLOG" | tr -d ' ')
  rlog "HOME utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  adb shell input keyevent KEYCODE_HOME </dev/null
  t0=$(date +%s)
  got_unload=0
  while [ $(( $(date +%s) - t0 )) -lt 55 ]; do
    if tail -n +"$((MARK_B+1))" "$FLOG" | grep -q 'model.unload'; then
      got_unload=1
      break
    fi
    sleep 1
  done
  sleep 2
  tail -n +"$((MARK_B+1))" "$FLOG" | grep -E 'model.unload|background.grace|KALSA_SESSION' \
    | tee "$EVID/after-home.txt" | tee -a "$RUN" || true
  echo "got_unload=$got_unload" | tee "$EVID/b-unload.txt" | tee -a "$RUN"
fi

kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
grep -E 'KALSA_SESSION|KALSA_KVPREFIX|KALSA_KVDIVERGE|KALSA_KVRESUME|KALSA_THINKING|KALSA_TELEMETRY|window_slide|window_align|model.unload|background.grace' "$FLOG" \
  > "$EVID/quoted-kalsa.txt" || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) temp=$(temp_deci)"
echo DONE > "$EVID/oneshot.done"
