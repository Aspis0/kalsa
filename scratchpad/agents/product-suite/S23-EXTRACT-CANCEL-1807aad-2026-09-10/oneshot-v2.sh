#!/usr/bin/env bash
# S23 extract-cancel one-shot v2 (f99fe45). Keep-awake, force-stop hung prewarm,
# prove submit via KALSA_SEND, tap Nuova chat on KALSA_MEMORY {, read EXTRACT.
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in
  JELLY*|192.168.1.193*) echo "refusing serial $ANDROID_SERIAL" >&2; exit 2 ;;
esac

EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-EXTRACT-CANCEL-1807aad-2026-09-10}"
export OUT="$EVID"
export BENCH_TARGET=device
export PKG=com.kalsa.app
MSG="${MSG:-Scrivi una frase breve sul pane, in italiano.}"
mkdir -p "$EVID"
RUN="$EVID/run-v2.log"
KLOG="$EVID/logcat-kalsa-v2.txt"
LOADLOG="$EVID/logcat-load-v2.txt"

cd /Users/marco/Projects/kalsa
# shellcheck source=/Users/marco/Projects/kalsa/scripts/device-share-send.sh
source scripts/device-share-send.sh

device_keepawake_begin
rlog() { echo "[s23-extract] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL msg=$MSG"

coords_for() {
  python3 - "$1" "$2" <<'PY'
import re, sys
needle, path = sys.argv[1], sys.argv[2]
xml = open(path, encoding="utf-8", errors="replace").read()
if "com.android.systemui" in xml and "com.kalsa.app" not in xml:
    sys.exit(2)
pat = re.compile(
    r'<node [^>]*?(?:content-desc|text)="[^"]*%s[^"]*"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
    % re.escape(needle)
)
m = pat.search(xml)
if not m:
    pat = re.compile(
        r'<node [^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*?(?:content-desc|text)="[^"]*%s[^"]*"'
        % re.escape(needle)
    )
    m = pat.search(xml)
if not m:
    sys.exit(1)
x1, y1, x2, y2 = map(int, m.groups())
print(f"{(x1+x2)//2} {(y1+y2)//2} {x1} {y1} {x2} {y2}")
PY
}

dump_kalsa() {
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

rlog "force-stop hung engine"
adb shell am force-stop com.kalsa.app
sleep 2
device_collapse_shade
adb shell am start -n com.kalsa.app/.MainActivity
rlog "started utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sleep 8
device_collapse_shade

: > "$LOADLOG"
adb logcat -c
adb logcat -v threadtime -s ReactNativeJS:I >> "$LOADLOG" &
LPID=$!
rlog "load-logcat pid=$LPID"

dump_kalsa "$EVID/ui-boot.xml"
if ! RC=$(coords_for "Tocca per ricaricare" "$EVID/ui-boot.xml" || coords_for "Tap to reload" "$EVID/ui-boot.xml"); then
  if PR=$(coords_for "Pronto" "$EVID/ui-boot.xml"); then
    rlog "already Pronto; skip reload tap"
    RC=""
  else
    rlog "no reload/pronto chip; tapping 400,230 anyway"
    adb shell input tap 400 230
    RC="400 230"
  fi
fi
if [ -n "$RC" ]; then
  read -r RX RY _ <<< "$RC"
  rlog "tap reload ${RX},${RY}"
  adb shell input tap "$RX" "$RY"
fi
adb shell cmd statusbar collapse >/dev/null 2>&1 || true

rlog "wait PREWARM done"
prewarm_ok=0
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  if grep -F '"op":"done"' "$LOADLOG" | grep -q KALSA_PREWARM; then
    rlog "PREWARM done utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) elapsed=$(( $(date +%s) - t0 ))s"
    grep KALSA_PREWARM "$LOADLOG" | tail -5 | tee -a "$RUN"
    prewarm_ok=1
    break
  fi
  if grep -F 'model.unload' "$LOADLOG" | tail -1 | grep -q background; then
    rlog "WARN unload during load; collapsing and tapping chat"
    device_collapse_shade
    adb shell input tap 540 1100
  fi
  sleep 2
done
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
if [ "$prewarm_ok" -ne 1 ]; then
  rlog "FAIL no PREWARM done"
  echo '{"verdict":"FAIL","reason":"no_prewarm"}' > "$EVID/verdict-detail.json"
  exit 1
fi

dump_kalsa "$EVID/ui-ready.xml"
if ! coords_for "Pronto" "$EVID/ui-ready.xml" >/dev/null; then
  rlog "WARN Pronto not in dump; continuing if engine logged done"
fi

# Shot capture
: > "$KLOG"
adb logcat -c
adb logcat -v threadtime -s ReactNativeJS:I >> "$KLOG" &
KPID=$!
rlog "shot-logcat pid=$KPID utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

device_collapse_shade
rlog "share-intent"
device_share_intent "$MSG" "v2_$(date +%s)"
sleep 1
# Resume AppState so 45s background grace does not dispose the engine.
device_collapse_shade
adb shell input tap 540 1100
sleep 2
device_collapse_shade

seen=0
for attempt in 1 2 3; do
  dump_kalsa "$EVID/ui-composer-$attempt.xml"
  if grep -qF "pane" "$EVID/ui-composer-$attempt.xml"; then
    rlog "composer has prompt attempt=$attempt"
    seen=1
    break
  fi
  rlog "composer missing prompt; re-share attempt=$attempt"
  device_share_intent "$MSG" "v2r${attempt}_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1100
  sleep 2
done
if [ "$seen" -ne 1 ]; then
  rlog "FAIL composer never showed prompt"
  kill "$KPID" 2>/dev/null || true
  echo '{"verdict":"FAIL","reason":"composer"}' > "$EVID/verdict-detail.json"
  exit 1
fi

if ! INV=$(coords_for "Invia" "$EVID/ui-composer-1.xml" 2>/dev/null || coords_for "Invia" "$EVID/ui-composer-2.xml" 2>/dev/null || coords_for "Invia" "$EVID/ui-composer-3.xml"); then
  rlog "FAIL no Invia coords"
  kill "$KPID" 2>/dev/null || true
  echo '{"verdict":"FAIL","reason":"no_invia"}' > "$EVID/verdict-detail.json"
  exit 1
fi
read -r IX IY _ <<< "$INV"
rlog "tap Invia ${IX},${IY} utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input tap "$IX" "$IY"

rlog "wait KALSA_SEND"
send_ok=0
t1=$(date +%s)
while [ $(( $(date +%s) - t1 )) -lt 30 ]; do
  if grep -q 'KALSA_SEND' "$KLOG"; then
    rlog "KALSA_SEND utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    grep KALSA_SEND "$KLOG" | tee -a "$RUN" | tee "$EVID/kalsa-send-line.txt"
    send_ok=1
    break
  fi
  sleep 0.4
done
if [ "$send_ok" -ne 1 ]; then
  rlog "FAIL no KALSA_SEND"
  grep -E 'KALSA_|error' "$KLOG" | tail -20 >> "$RUN" || true
  kill "$KPID" 2>/dev/null || true
  echo '{"verdict":"FAIL","reason":"no_kalsa_send"}' > "$EVID/verdict-detail.json"
  exit 1
fi

sleep 2
dump_kalsa "$EVID/ui-during-gen.xml"
if ! NC=$(coords_for "Nuova chat" "$EVID/ui-during-gen.xml"); then
  rlog "Nuova chat missing in gen dump; using ready dump"
  NC=$(coords_for "Nuova chat" "$EVID/ui-ready.xml" || echo "984 285 930 231 1038 339")
fi
read -r NCX NCY NCX1 NCY1 NCX2 NCY2 <<< "$NC"
rlog "nuova_chat ${NCX},${NCY} bounds=[${NCX1},${NCY1}][${NCX2},${NCY2}]"
echo "$NC" > "$EVID/nuova-chat-coords.txt"

rlog "wait KALSA_MEMORY {"
mem_ok=0
t2=$(date +%s)
MEMORY_LINE=""
while [ $(( $(date +%s) - t2 )) -lt 180 ]; do
  MEMORY_LINE=$(grep -F 'KALSA_MEMORY {' "$KLOG" | grep -v MEMORY_EXTRACT | tail -1 || true)
  if [ -n "$MEMORY_LINE" ]; then
    rlog "turn-end MEMORY utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) elapsed=$(( $(date +%s) - t2 ))s"
    printf '%s\n' "$MEMORY_LINE" | tee "$EVID/kalsa-memory-line.txt" | tee -a "$RUN"
    mem_ok=1
    break
  fi
  sleep 0.25
done
if [ "$mem_ok" -ne 1 ]; then
  rlog "FAIL no turn-end KALSA_MEMORY"
  grep -E 'KALSA_MEMORY|KALSA_TELEMETRY' "$KLOG" | tail -20 >> "$RUN" || true
  kill "$KPID" 2>/dev/null || true
  echo '{"verdict":"FAIL","reason":"no_turn_end_memory"}' > "$EVID/verdict-detail.json"
  exit 1
fi

TAP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TAP_EPOCH=$(python3 -c 'import time; print(f"{time.time():.3f}")')
rlog "TAP Nuova chat ${NCX},${NCY} utc=$TAP_UTC epoch=$TAP_EPOCH"
adb shell input tap "$NCX" "$NCY"
echo "utc=$TAP_UTC epoch=$TAP_EPOCH xy=$NCX,$NCY" > "$EVID/tap-newchat.txt"

rlog "wait KALSA_MEMORY_EXTRACT"
ext_ok=0
t3=$(date +%s)
EXTRACT_LINE=""
while [ $(( $(date +%s) - t3 )) -lt 90 ]; do
  EXTRACT_LINE=$(grep -F 'KALSA_MEMORY_EXTRACT {' "$KLOG" | tail -1 || true)
  if [ -n "$EXTRACT_LINE" ]; then
    rlog "EXTRACT utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) elapsed_after_tap=$(( $(date +%s) - t3 ))s"
    printf '%s\n' "$EXTRACT_LINE" | tee "$EVID/kalsa-extract-line.txt" | tee -a "$RUN"
    ext_ok=1
    break
  fi
  sleep 0.25
done
kill "$KPID" 2>/dev/null || true
wait "$KPID" 2>/dev/null || true
if [ "$ext_ok" -ne 1 ]; then
  rlog "FAIL no EXTRACT line"
  echo '{"verdict":"FAIL","reason":"no_extract_line"}' > "$EVID/verdict-detail.json"
  exit 1
fi

python3 - "$EVID" "$MEMORY_LINE" "$EXTRACT_LINE" "$TAP_UTC" <<'PY'
import json, re, sys, pathlib
evid = pathlib.Path(sys.argv[1])
mem_line, ext_line, tap_utc = sys.argv[2], sys.argv[3], sys.argv[4]

def payload(line, prefix):
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
if not ext:
    verdict, reason = "FAIL", "extract_unparseable"
elif ext.get("memoryEnabled") in (0, "0"):
    verdict, reason = "VOID", "memory_off"
elif ext.get("stopReason") == "aborted_by_send":
    verdict, reason = "PASS", "aborted_by_send"
elif ext.get("stopReason") == "done":
    verdict, reason = "FAIL", "extract_completed_done_after_tap"
else:
    verdict, reason = "FAIL", f"stopReason={ext.get('stopReason')}"
detail = {
    "verdict": verdict,
    "reason": reason,
    "tap_utc": tap_utc,
    "memory": mem,
    "extract": ext,
    "memory_line": mem_line,
    "extract_line": ext_line,
}
(evid / "verdict-detail.json").write_text(json.dumps(detail, indent=2) + "\n")
(evid / "verdict.txt").write_text(f"{verdict} {reason}\n")
print(f"VERDICT {verdict} {reason}")
print(json.dumps({
    "memoryEnabled": (ext or {}).get("memoryEnabled"),
    "stopReason": (ext or {}).get("stopReason"),
    "durationMs": (ext or {}).get("durationMs"),
    "extractStopReason": (ext or {}).get("extractStopReason"),
    "extractGateSource": (ext or {}).get("extractGateSource"),
}, indent=2))
PY

rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) $(cat "$EVID/verdict.txt")"
