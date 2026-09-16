#!/usr/bin/env bash
# Conversation SWITCH during in-flight memory extract (f99fe45).
# Idle dumps only. Require KALSA_SEND. Prove activeId change after force-stop.
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in
  JELLY*|192.168.1.193*) echo "refusing serial $ANDROID_SERIAL" >&2; exit 2 ;;
esac

EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-SWITCH-EXTRACT-CANCEL-1807aad-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
MSG="${MSG:-Scrivi una frase breve sul limone, in italiano.}"
mkdir -p "$EVID"
RUN="$EVID/run.log"
KLOG="$EVID/logcat-kalsa.txt"

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

rlog() { echo "[s23-switch-extract] $*" | tee -a "$RUN"; }
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
print(f"{(x1+x2)//2} {(y1+y2)//2} {x1} {y1} {x2} {y2}")
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

device_collapse_shade
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
sleep 8
device_collapse_shade

LOADLOG="$EVID/logcat-load.txt"
: > "$LOADLOG"
adb logcat -c
adb logcat -v threadtime -s ReactNativeJS:I >> "$LOADLOG" &
LPID=$!
dump_idle "$EVID/ui-boot.xml"
if XY=$(coords_for "Tocca per ricaricare" "$EVID/ui-boot.xml" 2>/dev/null \
     || coords_for "Tap to reload" "$EVID/ui-boot.xml" 2>/dev/null); then
  read -r RX RY _ <<< "$XY"
  rlog "tap reload $RX,$RY"
  adb shell input tap "$RX" "$RY"
fi
t0=$(date +%s)
ready=0
while [ $(( $(date +%s) - t0 )) -lt 120 ]; do
  if grep KALSA_PREWARM "$LOADLOG" 2>/dev/null | grep -qE '"op":"done"|kv_holds_chat'; then
    rlog "engine ready elapsed=$(( $(date +%s) - t0 ))s"
    grep KALSA_PREWARM "$LOADLOG" | tail -5 | tee -a "$RUN"
    ready=1
    break
  fi
  dump_idle "$EVID/ui-boot.xml"
  if coords_for "Pronto" "$EVID/ui-boot.xml" >/dev/null 2>&1; then
    rlog "Pronto in UI elapsed=$(( $(date +%s) - t0 ))s"
    ready=1
    break
  fi
  sleep 3
done
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
if [ "$ready" -ne 1 ]; then
  rlog "FAIL engine not ready"
  echo '{"verdict":"FAIL","reason":"no_pronto"}' > "$EVID/verdict-detail.json"
  exit 1
fi

dump_idle "$EVID/ui-idle.xml"
if ! MENU=$(coords_for "Menu" "$EVID/ui-idle.xml"); then
  rlog "FAIL no Menu"
  echo '{"verdict":"FAIL","reason":"no_menu"}' > "$EVID/verdict-detail.json"
  exit 1
fi
read -r MX MY MX1 MY1 MX2 MY2 <<< "$MENU"
rlog "Menu $MX,$MY bounds=[$MX1,$MY1][$MX2,$MY2]"
echo "$MENU" > "$EVID/menu-coords.txt"

if ! INV=$(coords_for "Invia" "$EVID/ui-idle.xml"); then
  rlog "FAIL no Invia"
  echo '{"verdict":"FAIL","reason":"no_invia"}' > "$EVID/verdict-detail.json"
  exit 1
fi
read -r IX IY _ <<< "$INV"
rlog "Invia $IX,$IY"

adb shell input tap "$MX" "$MY"
sleep 2
ui=$(device_dump_ui_retry || true)
printf '%s\n' "$ui" > "$EVID/ui-drawer.xml"
python3 - "$EVID/ui-drawer.xml" "$EVID/target.txt" <<'PY'
import re, sys, pathlib
xml = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
outp = pathlib.Path(sys.argv[2])
skip = {"Chiudi", "Persona", "Cerca nelle chat", "Nuova chat", "Menu", "Invia"}
rows = []
for n in re.findall(r"<node [^/]*?(?:/>|>)", xml):
    desc = re.search(r'content-desc="([^"]*)"', n)
    click = re.search(r'clickable="([^"]*)"', n)
    selected = re.search(r'selected="([^"]*)"', n)
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    if not (desc and click and bounds and click.group(1) == "true"):
        continue
    title = desc.group(1)
    if not title or title in skip or title.startswith("Cerca"):
        continue
    x1, y1, x2, y2 = map(int, bounds.groups())
    if y2 <= y1 or x2 <= x1:
        continue
    rows.append((selected.group(1) == "true" if selected else False, title, x1, y1, x2, y2))
inactive = [r for r in rows if not r[0]]
if not inactive:
    sys.exit(1)
title, x1, y1, x2, y2 = inactive[0][1], inactive[0][2], inactive[0][3], inactive[0][4], inactive[0][5]
cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
outp.write_text(f"{cx} {cy} {x1} {y1} {x2} {y2}\n{title}\n")
print(f"target {cx},{cy} bounds=[{x1},{y1}][{x2},{y2}] title={title}")
PY
if [ $? -ne 0 ]; then
  rlog "FAIL no inactive conversation in drawer"
  echo '{"verdict":"FAIL","reason":"no_inactive_row"}' > "$EVID/verdict-detail.json"
  exit 1
fi
read -r TX TY TX1 TY1 TX2 TY2 < "$EVID/target.txt"
TARGET_TITLE=$(sed -n '2p' "$EVID/target.txt")
rlog "target $TX,$TY title=$TARGET_TITLE"
# Close drawer without KEYCODE_BACK (BACK from chat goes to launcher).
adb shell input tap 1040 700
sleep 1
device_collapse_shade

BEFORE_INDEX=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';")
BEFORE_ID=$(resolve_active_conversation_id "$BEFORE_INDEX")
rlog "before_activeId=$BEFORE_ID"
printf '%s\n' "$BEFORE_ID" > "$EVID/before-activeId.txt"

: > "$KLOG"
adb logcat -c
adb logcat -v threadtime -s ReactNativeJS:I >> "$KLOG" &
KPID=$!
rlog "shot-logcat pid=$KPID utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

device_collapse_shade
device_share_intent "$MSG" "sw_$(date +%s)"
sleep 1
device_collapse_shade
adb shell input tap 540 1100
sleep 2
dump_idle "$EVID/ui-composer.xml"
if ! grep -qF "limone" "$EVID/ui-composer.xml"; then
  device_share_intent "$MSG" "swr_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1100
  sleep 2
  dump_idle "$EVID/ui-composer.xml"
fi
if ! grep -qF "limone" "$EVID/ui-composer.xml"; then
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

# Race: no dump. Open drawer at saved Menu coords, tap saved inactive row.
SWITCH_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SWITCH_EPOCH=$(python3 -c 'import time; print(f"{time.time():.3f}")')
rlog "SWITCH Menu-tap $MX,$MY utc=$SWITCH_UTC"
adb shell input tap "$MX" "$MY"
sleep 1.2
rlog "SWITCH tap-target $TX,$TY title=$TARGET_TITLE"
adb shell input tap "$TX" "$TY"
echo "utc=$SWITCH_UTC epoch=$SWITCH_EPOCH menu=$MX,$MY target=$TX,$TY sleep_s=1.2 title=$TARGET_TITLE" > "$EVID/switch.txt"

EXTRACT_LINE=""
t3=$(date +%s)
while [ $(( $(date +%s) - t3 )) -lt 90 ]; do
  EXTRACT_LINE=$(grep -F 'KALSA_MEMORY_EXTRACT {' "$KLOG" | tail -1 || true)
  if [ -n "$EXTRACT_LINE" ]; then
    rlog "EXTRACT elapsed_after_switch=$(( $(date +%s) - t3 ))s"
    printf '%s\n' "$EXTRACT_LINE" | tee "$EVID/kalsa-extract.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.25
done
grep -E 'KALSA_TELEMETRY|KALSA_MEMORY|KALSA_SEND' "$KLOG" > "$EVID/kalsa-excerpt.txt" || true
grep 'util-extractMemory' "$KLOG" | tee "$EVID/kalsa-native-extract.txt" | tee -a "$RUN" || true
kill "$KPID" 2>/dev/null || true
wait "$KPID" 2>/dev/null || true
# Race is over — dump once to see if the drawer actually opened.
dump_idle "$EVID/ui-after-switch.xml"

rlog "force-stop then read activeId"
adb shell am force-stop com.kalsa.app
sleep 1
AFTER_INDEX=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';")
AFTER_ID=$(resolve_active_conversation_id "$AFTER_INDEX")
rlog "after_activeId=$AFTER_ID"
printf '%s\n' "$AFTER_ID" > "$EVID/after-activeId.txt"
python3 -c 'import json,sys; json.dump(json.loads(sys.argv[1]), open(sys.argv[2],"w"), indent=2)' \
  "$AFTER_INDEX" "$EVID/conversations-after.json" 2>/dev/null || printf '%s\n' "$AFTER_INDEX" > "$EVID/conversations-after.json"

python3 - "$EVID" "$MEMORY_LINE" "$EXTRACT_LINE" "$SWITCH_UTC" "$BEFORE_ID" "$AFTER_ID" "$TARGET_TITLE" <<'PY'
import json, re, sys, pathlib
evid = pathlib.Path(sys.argv[1])
mem_line, ext_line, switch_utc, before_id, after_id, target_title = sys.argv[2:8]
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
switched = bool(after_id) and after_id != before_id
if not ext:
    verdict, reason = "FAIL", "no_extract_line"
elif enabled in (0, "0"):
    verdict, reason = "VOID", "memory_off"
elif not switched:
    verdict, reason = "HARNESS_MISS", "activeId_unchanged"
elif stop == "done":
    verdict, reason = "FAIL", "extract_completed_done_after_switch"
elif stop == "aborted_by_send" and native_started:
    verdict, reason = "PASS", "aborted_by_send_native_switched"
elif stop == "aborted_by_send":
    verdict, reason = "VOID", "aborted_without_native_start"
else:
    verdict, reason = "FAIL", f"stopReason={stop}"
detail = {
    "verdict": verdict, "reason": reason, "switch_utc": switch_utc,
    "before_activeId": before_id, "after_activeId": after_id,
    "target_title": target_title, "switched": switched,
    "memory": mem, "extract": ext, "native_line": native,
    "native_started": native_started, "memory_line": mem_line,
    "extract_line": ext_line,
}
(evid / "verdict-detail.json").write_text(json.dumps(detail, indent=2) + "\n")
(evid / "verdict.txt").write_text(f"{verdict} {reason}\n")
print(f"VERDICT {verdict} {reason}")
print(json.dumps({
    "before_activeId": before_id, "after_activeId": after_id, "switched": switched,
    "memoryEnabled": enabled, "stopReason": stop, "durationMs": dur,
    "extractStopReason": esr, "extractGateSource": gate,
    "native_started": native_started,
}, indent=2))
PY

rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) $(cat "$EVID/verdict.txt")"
