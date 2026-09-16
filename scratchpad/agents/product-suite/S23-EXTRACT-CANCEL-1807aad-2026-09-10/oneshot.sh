#!/usr/bin/env bash
# S23 one-shot: Nuova chat during memory extract must abort (f99fe45).
# Do not uninstall, clear-data, or touch other serials.
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-EXTRACT-CANCEL-1807aad-2026-09-10}"
export OUT="$EVID"
export BENCH_TARGET=device
export PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
KLOG="$EVID/logcat-kalsa.txt"
FLOG="$EVID/logcat-full.txt"
MSG="${MSG:-Scrivi una frase breve sul tè, in italiano.}"

# Never target Jelly / Xiaomi even if ANDROID_SERIAL is unset later.
case "$ANDROID_SERIAL" in
  JELLY*|192.168.1.193*) echo "refusing serial $ANDROID_SERIAL" >&2; exit 2 ;;
esac

cd /Users/marco/Projects/kalsa
# shellcheck source=/Users/marco/Projects/kalsa/scripts/device-share-send.sh
source scripts/device-share-send.sh

rlog() { echo "[s23-extract] $*" | tee -a "$RUN"; }

# Substring tap: One UI chip text is "LFM2.5 … Tocca per ricaricare", not an exact label.
tap_node() {
  local needle="$1"
  local ui b
  ui=$(device_dump_ui_retry || true)
  b=$(printf '%s' "$ui" | tr '>' '\n' \
    | grep -E "content-desc=\"[^\"]*${needle}[^\"]*\"|text=\"[^\"]*${needle}[^\"]*\"" \
    | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  [ -z "$b" ] && { log "node '$needle' NOT FOUND"; return 1; }
  local n x1 y1 x2 y2 cx cy
  n=$(echo "$b" | grep -o '[0-9]\+' | tr '\n' ' ')
  read -r x1 y1 x2 y2 <<< "$n"
  cx=$(( (x1 + x2) / 2 )); cy=$(( (y1 + y2) / 2 ))
  log "tap '$needle' at ${cx},${cy} bounds=$b"
  adb shell input tap "$cx" "$cy"
}

coords_for() {
  local needle="$1" xml="$2"
  python3 - "$needle" "$xml" <<'PY'
import re, sys
needle, path = sys.argv[1], sys.argv[2]
xml = open(path, encoding="utf-8", errors="replace").read()
pat = re.compile(r'<node [^>]*?(?:content-desc|text)="[^"]*%s[^"]*"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' % re.escape(needle))
m = pat.search(xml)
if not m:
    pat = re.compile(r'<node [^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*?(?:content-desc|text)="[^"]*%s[^"]*"' % re.escape(needle))
    m = pat.search(xml)
if not m:
    sys.exit(1)
x1,y1,x2,y2 = map(int, m.groups())
print(f"{(x1+x2)//2} {(y1+y2)//2} {x1} {y1} {x2} {y2}")
PY
}

: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL pid=$(adb shell pidof com.kalsa.app | tr -d '\r')"
rlog "msg=$MSG"

device_collapse_shade
adb shell cmd statusbar collapse >/dev/null 2>&1 || true

rlog "logcat -c"
adb logcat -c
: > "$KLOG"
: > "$FLOG"
adb logcat -v threadtime -s ReactNativeJS:I >> "$KLOG" &
KPID=$!
adb logcat -v threadtime >> "$FLOG" &
FPID=$!
rlog "logcat kpid=$KPID fpid=$FPID"

rlog "share-send begin utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
set +e
device_share_send "$MSG"
SEND_RC=$?
set -e
rlog "share-send rc=$SEND_RC utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$SEND_RC" -ne 0 ]; then
  rlog "FAIL share-send"
  kill "$KPID" "$FPID" 2>/dev/null || true
  echo '{"verdict":"FAIL","reason":"share-send"}' > "$EVID/verdict-detail.json"
  exit 1
fi

# Generation in progress: one dump for Nuova chat coords (not in the race window).
device_collapse_shade
sleep 1
ui=$(device_dump_ui_retry || true)
printf '%s\n' "$ui" > "$EVID/ui-during-gen.xml"
if ! NC=$(coords_for "Nuova chat" "$EVID/ui-during-gen.xml"); then
  rlog "Nuova chat coords missing; fallback 984 285"
  NC="984 285 930 231 1038 339"
fi
read -r NCX NCY NCX1 NCY1 NCX2 NCY2 <<< "$NC"
rlog "nuova_chat tap=${NCX},${NCY} bounds=[${NCX1},${NCY1}][${NCX2},${NCY2}]"
echo "$NC" > "$EVID/nuova-chat-coords.txt"

# Wait for turn-end KALSA_MEMORY {  — not KALSA_MEMORY_EXTRACT
TURN_CAP_S=180
t0=$(date +%s)
MEMORY_LINE=""
while :; do
  MEMORY_LINE=$(grep -F 'KALSA_MEMORY {' "$KLOG" | grep -v 'KALSA_MEMORY_EXTRACT' | tail -1 || true)
  if [ -n "$MEMORY_LINE" ]; then
    rlog "turn-end MEMORY utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) elapsed=$(( $(date +%s) - t0 ))s"
    printf '%s\n' "$MEMORY_LINE" | tee "$EVID/kalsa-memory-line.txt" >> "$RUN"
    break
  fi
  if [ $(( $(date +%s) - t0 )) -ge "$TURN_CAP_S" ]; then
    rlog "FAIL no KALSA_MEMORY { within ${TURN_CAP_S}s"
    grep -E 'KALSA_MEMORY|KALSA_TELEMETRY|KALSA_SEND' "$KLOG" | tail -20 >> "$RUN" || true
    kill "$KPID" "$FPID" 2>/dev/null || true
    echo '{"verdict":"FAIL","reason":"no_turn_end_memory"}' > "$EVID/verdict-detail.json"
    exit 1
  fi
  sleep 0.25
done

# Immediate tap — no dump.
TAP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TAP_EPOCH=$(python3 -c 'import time; print(f"{time.time():.3f}")')
rlog "TAP Nuova chat at ${NCX},${NCY} utc=$TAP_UTC epoch=$TAP_EPOCH"
adb shell input tap "$NCX" "$NCY"
echo tap_rc=$? utc="$TAP_UTC" epoch="$TAP_EPOCH" xy="$NCX,$NCY" > "$EVID/tap-newchat.txt"

# Wait for EXTRACT settle
EXT_CAP_S=90
t1=$(date +%s)
EXTRACT_LINE=""
while :; do
  EXTRACT_LINE=$(grep -F 'KALSA_MEMORY_EXTRACT {' "$KLOG" | tail -1 || true)
  if [ -n "$EXTRACT_LINE" ]; then
    rlog "EXTRACT utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) elapsed_after_tap=$(( $(date +%s) - t1 ))s"
    printf '%s\n' "$EXTRACT_LINE" | tee "$EVID/kalsa-extract-line.txt" >> "$RUN"
    break
  fi
  if [ $(( $(date +%s) - t1 )) -ge "$EXT_CAP_S" ]; then
    rlog "FAIL no KALSA_MEMORY_EXTRACT within ${EXT_CAP_S}s after tap"
    grep -E 'KALSA_MEMORY' "$KLOG" | tail -20 >> "$RUN" || true
    kill "$KPID" "$FPID" 2>/dev/null || true
    echo '{"verdict":"FAIL","reason":"no_extract_line"}' > "$EVID/verdict-detail.json"
    exit 1
  fi
  sleep 0.25
done

sleep 2
kill "$KPID" "$FPID" 2>/dev/null || true
wait "$KPID" "$FPID" 2>/dev/null || true

python3 - "$EVID" "$MEMORY_LINE" "$EXTRACT_LINE" "$TAP_UTC" <<'PY'
import json, re, sys, pathlib
evid = pathlib.Path(sys.argv[1])
mem_line, ext_line, tap_utc = sys.argv[2], sys.argv[3], sys.argv[4]

def payload(line, prefix):
    i = line.find(prefix)
    if i < 0:
        return None
    raw = line[i + len(prefix):].strip()
    if raw.startswith("'") and raw.endswith("'"):
        raw = raw[1:-1]
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r'\{.*\}', raw)
        return json.loads(m.group(0)) if m else None

mem = payload(mem_line, "KALSA_MEMORY ")
ext = payload(ext_line, "KALSA_MEMORY_EXTRACT ")
verdict = "FAIL"
reason = "unknown"
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
print(json.dumps({"memoryEnabled": (ext or {}).get("memoryEnabled"), "stopReason": (ext or {}).get("stopReason"), "durationMs": (ext or {}).get("durationMs"), "extractStopReason": (ext or {}).get("extractStopReason")}, indent=2))
PY

rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) verdict=$(cat "$EVID/verdict.txt")"
