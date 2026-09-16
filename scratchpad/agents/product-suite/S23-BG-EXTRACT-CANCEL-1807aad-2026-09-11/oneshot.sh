#!/usr/bin/env bash
# HOME during in-flight memory extract (f99fe45 background discard).
# Dumps only while idle. Require KALSA_SEND. Restore stayon on EXIT.
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in
  JELLY*|192.168.1.193*) echo "refusing serial $ANDROID_SERIAL" >&2; exit 2 ;;
esac

EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-BG-EXTRACT-CANCEL-1807aad-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
MSG="${MSG:-Dimmi una frase breve sul sale, in italiano.}"
mkdir -p "$EVID"
RUN="$EVID/run.log"
KLOG="$EVID/logcat-kalsa.txt"
LOADLOG="$EVID/logcat-load.txt"

cd /Users/marco/Projects/kalsa
# shellcheck source=/Users/marco/Projects/kalsa/scripts/device-share-send.sh
source scripts/device-share-send.sh

STAYON_SAVED=$(adb shell "settings get global stay_on_while_plugged_in" 2>/dev/null | tr -d '\r' || true)
restore_stayon() {
  adb shell svc power stayon false >/dev/null 2>&1 || true
  if [ -n "${STAYON_SAVED:-}" ] && [ "$STAYON_SAVED" != "null" ]; then
    adb shell "settings put global stay_on_while_plugged_in $STAYON_SAVED" >/dev/null 2>&1 || true
  fi
}
device_keepawake_begin
trap 'restore_stayon; device_termux_wakelock_restore; device_keepawake_restore' EXIT
adb shell svc power stayon true >/dev/null 2>&1 || true

rlog() { echo "[s23-bg-extract] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"

coords_for() {
  python3 - "$1" "$2" <<'PY'
import re, sys
needle, path = sys.argv[1], sys.argv[2]
xml = open(path, encoding="utf-8", errors="replace").read()
if "com.android.systemui" in xml and "com.kalsa.app" not in xml:
    sys.exit(2)
pat = re.compile(
    r'<node [^>]*?(?:content-desc|text)="[^"]*%s[^"]*"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
    % re.escape(needle))
m = pat.search(xml) or re.compile(
    r'<node [^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*?(?:content-desc|text)="[^"]*%s[^"]*"'
    % re.escape(needle)).search(xml)
if not m:
    sys.exit(1)
x1, y1, x2, y2 = map(int, m.groups())
print(f"{(x1+x2)//2} {(y1+y2)//2}")
PY
}

dump_idle() {
  local dest="$1" ui
  device_collapse_shade
  ui=$(device_dump_ui_retry || true)
  printf '%s\n' "$ui" > "$dest"
  if ! grep -q 'com.kalsa.app' "$dest" 2>/dev/null; then
    adb shell cmd statusbar collapse >/dev/null 2>&1 || true
    sleep 1
    ui=$(device_dump_ui_retry || true)
    printf '%s\n' "$ui" > "$dest"
  fi
}

rlog "force-stop (clean resident LFM)"
adb shell am force-stop com.kalsa.app
sleep 2
device_collapse_shade
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
sleep 8
device_collapse_shade

: > "$LOADLOG"
adb logcat -c
adb logcat -v threadtime -s ReactNativeJS:I >> "$LOADLOG" &
LPID=$!
dump_idle "$EVID/ui-idle.xml"
if XY=$(coords_for "Tocca per ricaricare" "$EVID/ui-idle.xml" 2>/dev/null \
     || coords_for "Tap to reload" "$EVID/ui-idle.xml" 2>/dev/null); then
  read -r RX RY <<< "$XY"
  rlog "tap reload $RX,$RY"
  adb shell input tap "$RX" "$RY"
  adb shell cmd statusbar collapse >/dev/null 2>&1 || true
fi
rlog "wait PREWARM done"
prewarm_ok=0
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  if grep KALSA_PREWARM "$LOADLOG" | grep -qE '"op":"done"|kv_holds_chat'; then
    rlog "PREWARM ready elapsed=$(( $(date +%s) - t0 ))s"
    grep KALSA_PREWARM "$LOADLOG" | tail -5 | tee -a "$RUN"
    prewarm_ok=1
    break
  fi
  sleep 2
done
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
if [ "$prewarm_ok" -ne 1 ]; then
  rlog "FAIL no PREWARM"
  echo '{"verdict":"FAIL","reason":"no_prewarm"}' > "$EVID/verdict-detail.json"
  exit 1
fi

dump_idle "$EVID/ui-ready.xml"
if ! INV=$(coords_for "Invia" "$EVID/ui-ready.xml"); then
  rlog "FAIL no Invia"
  echo '{"verdict":"FAIL","reason":"no_invia"}' > "$EVID/verdict-detail.json"
  exit 1
fi
read -r IX IY <<< "$INV"
rlog "Invia $IX,$IY"

: > "$KLOG"
adb logcat -c
adb logcat -v threadtime -s ReactNativeJS:I >> "$KLOG" &
KPID=$!
rlog "shot-logcat pid=$KPID utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

device_collapse_shade
device_share_intent "$MSG" "bg_$(date +%s)"
sleep 1
device_collapse_shade
adb shell input tap 540 1100
sleep 2
dump_idle "$EVID/ui-composer.xml"
if ! grep -qF "sale" "$EVID/ui-composer.xml"; then
  device_share_intent "$MSG" "bgr_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1100
  sleep 2
  dump_idle "$EVID/ui-composer.xml"
fi
if ! grep -qF "sale" "$EVID/ui-composer.xml"; then
  rlog "FAIL composer"
  kill "$KPID" 2>/dev/null || true
  echo '{"verdict":"FAIL","reason":"composer"}' > "$EVID/verdict-detail.json"
  exit 1
fi

rlog "tap Invia utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input tap "$IX" "$IY"
send_ok=0
t1=$(date +%s)
while [ $(( $(date +%s) - t1 )) -lt 30 ]; do
  if grep -q 'KALSA_SEND' "$KLOG"; then
    grep KALSA_SEND "$KLOG" | tee "$EVID/kalsa-send.txt" | tee -a "$RUN"
    send_ok=1
    break
  fi
  sleep 0.4
done
if [ "$send_ok" -ne 1 ]; then
  rlog "FAIL no KALSA_SEND"
  kill "$KPID" 2>/dev/null || true
  echo '{"verdict":"FAIL","reason":"no_kalsa_send"}' > "$EVID/verdict-detail.json"
  exit 1
fi

# No dumps until EXTRACT is captured.
rlog "wait KALSA_MEMORY {"
MEMORY_LINE=""
t2=$(date +%s)
while [ $(( $(date +%s) - t2 )) -lt 180 ]; do
  if grep -q 'KALSA_STALL' "$KLOG"; then
    rlog "FAIL stall before turn-end"
    grep KALSA_STALL "$KLOG" | tee -a "$RUN"
    kill "$KPID" 2>/dev/null || true
    echo '{"verdict":"FAIL","reason":"stall_before_memory"}' > "$EVID/verdict-detail.json"
    exit 1
  fi
  MEMORY_LINE=$(grep -F 'KALSA_MEMORY {' "$KLOG" | grep -v MEMORY_EXTRACT | tail -1 || true)
  if [ -n "$MEMORY_LINE" ]; then
    rlog "turn-end MEMORY elapsed=$(( $(date +%s) - t2 ))s"
    printf '%s\n' "$MEMORY_LINE" | tee "$EVID/kalsa-memory.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.25
done
if [ -z "$MEMORY_LINE" ]; then
  rlog "FAIL no KALSA_MEMORY"
  kill "$KPID" 2>/dev/null || true
  echo '{"verdict":"FAIL","reason":"no_turn_end_memory"}' > "$EVID/verdict-detail.json"
  exit 1
fi

HOME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HOME_EPOCH=$(python3 -c 'import time; print(f"{time.time():.3f}")')
rlog "HOME utc=$HOME_UTC epoch=$HOME_EPOCH"
adb shell input keyevent KEYCODE_HOME
echo "utc=$HOME_UTC epoch=$HOME_EPOCH" > "$EVID/home.txt"

EXTRACT_LINE=""
t3=$(date +%s)
while [ $(( $(date +%s) - t3 )) -lt 90 ]; do
  EXTRACT_LINE=$(grep -F 'KALSA_MEMORY_EXTRACT {' "$KLOG" | tail -1 || true)
  if [ -n "$EXTRACT_LINE" ]; then
    rlog "EXTRACT elapsed_after_home=$(( $(date +%s) - t3 ))s"
    printf '%s\n' "$EXTRACT_LINE" | tee "$EVID/kalsa-extract.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.25
done
grep -E 'KALSA_TELEMETRY|KALSA_MEMORY|KALSA_SEND' "$KLOG" > "$EVID/kalsa-excerpt.txt" || true
grep 'util-extractMemory' "$KLOG" | tee "$EVID/kalsa-native-extract.txt" | tee -a "$RUN" || true

kill "$KPID" 2>/dev/null || true
wait "$KPID" 2>/dev/null || true
rlog "am start after EXTRACT"
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
sleep 1

python3 - "$EVID" "$MEMORY_LINE" "$EXTRACT_LINE" "$HOME_UTC" <<'PY'
import json, re, sys, pathlib
evid = pathlib.Path(sys.argv[1])
mem_line, ext_line, home_utc = sys.argv[2], sys.argv[3], sys.argv[4]
klog = (evid / "logcat-kalsa.txt").read_text(encoding="utf-8", errors="replace")

def payload(line, prefix):
    if not line:
        return None
    i = line.find(prefix)
    if i < 0:
        return None
    raw = line[i + len(prefix):].strip()
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw)
        return json.loads(m.group(0)) if m else None

mem = payload(mem_line, "KALSA_MEMORY ")
ext = payload(ext_line, "KALSA_MEMORY_EXTRACT ")
native = next((ln for ln in klog.splitlines() if "util-extractMemory" in ln), None)
native_interrupted = bool(native and '"interrupted":true' in native)
gate = (ext or {}).get("extractGateSource")
dur = (ext or {}).get("durationMs") or 0
stop = (ext or {}).get("stopReason")
esr = (ext or {}).get("extractStopReason")
enabled = (ext or {}).get("memoryEnabled")
native_started = native_interrupted or (gate == 1 and dur > 0)
if not ext:
    verdict, reason = "FAIL", "no_extract_line"
elif enabled in (0, "0"):
    verdict, reason = "VOID", "memory_off"
elif stop == "done":
    verdict, reason = "FAIL", "extract_completed_done_after_home"
elif esr == 4 or (stop == "skipped_no_snapshot" and not native_started):
    verdict, reason = "VOID", "extract_never_armed"
elif stop == "aborted_by_send" and native_started:
    verdict, reason = "PASS", "aborted_by_send_native"
elif stop == "aborted_by_send":
    verdict, reason = "VOID", "aborted_without_native_start"
else:
    verdict, reason = "FAIL", f"stopReason={stop}"
detail = {
    "verdict": verdict, "reason": reason, "home_utc": home_utc,
    "memory": mem, "extract": ext, "native_line": native,
    "native_started": native_started, "memory_line": mem_line,
    "extract_line": ext_line,
}
(evid / "verdict-detail.json").write_text(json.dumps(detail, indent=2) + "\n")
(evid / "verdict.txt").write_text(f"{verdict} {reason}\n")
print(f"VERDICT {verdict} {reason}")
print(json.dumps({"memoryEnabled": enabled, "stopReason": stop, "durationMs": dur,
                  "extractStopReason": esr, "extractGateSource": gate,
                  "native_started": native_started}, indent=2))
PY

rlog "force-stop"
adb shell am force-stop com.kalsa.app
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) $(cat "$EVID/verdict.txt")"
