#!/usr/bin/env bash
# 20–25 Italian turns then force-stop restore. stdin on fd 3 (adb must not eat prompts).
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in JELLY*|192.168.1.193*) exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-G2-31495c3-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
PROMPTS="$EVID/prompts.txt"
FLOG="$EVID/logcat-turns.txt"
RUN="$EVID/turns-run.log"
TURNS="$EVID/turns.jsonl"
cd /Users/marco/Projects/kalsa
source scripts/device-share-send.sh
device_keepawake_begin
trap 'adb shell svc power stayon false >/dev/null 2>&1 || true; device_termux_wakelock_restore; device_keepawake_restore' EXIT
adb shell svc power stayon true >/dev/null 2>&1 || true
rlog() { echo "[g2t] $*" | tee -a "$RUN"; }
: > "$RUN"
: > "$TURNS"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

temp_deci() {
  adb shell dumpsys battery 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}'
}
wait_cool() {
  local t; t=$(temp_deci)
  rlog "temp_deci=$t"
  while [ -n "$t" ] && [ "$t" -ge 400 ]; do
    rlog "thermal pause $t"
    sleep 25
    t=$(temp_deci)
  done
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
  device_collapse_shade
  local ui; ui=$(device_dump_ui_retry || true)
  printf '%s\n' "$ui" > "$1"
}

: > "$FLOG"
adb logcat -c
adb logcat -v threadtime >> "$FLOG" &
LPID=$!
device_collapse_shade
adb shell am start -n com.kalsa.app/.MainActivity </dev/null >/dev/null
sleep 2
dump_idle "$EVID/ui-tboot.xml"
if coords_for "Tocca per ricaricare" "$EVID/ui-tboot.xml" >/tmp/g2xy.txt 2>/dev/null; then
  read -r RX RY < /tmp/g2xy.txt
  adb shell input tap "$RX" "$RY" </dev/null
  rlog reload
  t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
    grep KALSA_PREWARM "$FLOG" | grep -qE '"op":"done"|kv_holds_chat' && break
    sleep 2
  done
fi
dump_idle "$EVID/ui-tready.xml"
NC=$(coords_for "Nuova chat" "$EVID/ui-tready.xml" || echo "984 285")
read -r NX NY <<< "$NC"
adb shell input tap "$NX" "$NY" </dev/null
sleep 2

n=0
min_turns=20
target=25
while IFS='|' read -r msg needle <&3; do
  [ -n "${msg:-}" ] || continue
  n=$((n+1))
  wait_cool
  rlog "turn $n needle=$needle"
  dump_idle "$EVID/ui-send.xml"
  INV=$(coords_for "Invia" "$EVID/ui-send.xml" || echo "963 2115")
  read -r IX IY <<< "$INV"
  device_share_intent "$msg" "t${n}_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1600 </dev/null
  sleep 2
  dump_idle "$EVID/ui-comp.xml"
  if ! grep -qF "$needle" "$EVID/ui-comp.xml"; then
    device_share_intent "$msg" "t${n}r_$(date +%s)"
    sleep 1
    device_collapse_shade
    adb shell input tap 540 1600 </dev/null
    sleep 2
    dump_idle "$EVID/ui-comp.xml"
  fi
  if ! grep -qF "$needle" "$EVID/ui-comp.xml"; then
    rlog "composer miss n=$n"
    n=$((n-1))
    break
  fi
  mark=$(wc -l < "$FLOG" | tr -d ' ')
  adb shell input tap "$IX" "$IY" </dev/null
  t0=$(date +%s)
  ok=0
  while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
    tel=$(tail -n +"$((mark+1))" "$FLOG" | grep 'KALSA_TELEMETRY' | grep -v util-extract | tail -1 || true)
    if [ -n "$tel" ]; then
      printf '%s\n' "$tel" | tee -a "$TURNS" | tee -a "$RUN"
      ok=1
      break
    fi
    sleep 0.4
  done
  if [ "$ok" -ne 1 ]; then
    rlog "no tel n=$n"
    n=$((n-1))
    break
  fi
  t=$(temp_deci)
  if [ -n "$t" ] && [ "$t" -ge 400 ] && [ "$n" -ge "$min_turns" ]; then
    rlog "thermal stop at $n"
    break
  fi
  [ "$n" -ge "$target" ] && break
done 3< "$PROMPTS"
echo "$n" > "$EVID/turn-count.txt"
rlog "turns=$n"

# wait extract on last turn
sleep 8
grep KALSA_MEMORY_EXTRACT "$FLOG" | tail -2 | tee -a "$RUN" || true
grep 'KALSA_TELEMETRY' "$FLOG" | grep '"tool"' | tee "$EVID/tool-telemetry.txt" | tee -a "$RUN" || true

rlog "force-stop restore"
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$EVID/logcat-restore.txt"
adb logcat -c
adb logcat -v threadtime >> "$EVID/logcat-restore.txt" &
LPID=$!
adb shell am start -n com.kalsa.app/.MainActivity </dev/null >/dev/null
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
  grep KALSA_PREWARM "$EVID/logcat-restore.txt" | grep -qE '"op":"done"|kv_holds_chat' && break
  grep 'KALSA_SESSION' "$EVID/logcat-restore.txt" | grep '"op":"load"' | grep -q . && sleep 2 && break
  sleep 2
done
grep 'KALSA_SESSION' "$EVID/logcat-restore.txt" | grep load | tee "$EVID/restore-load.txt" | tee -a "$RUN"
dump_idle "$EVID/ui-rest.xml"
INV=$(coords_for "Invia" "$EVID/ui-rest.xml" || echo "963 2115")
read -r IX IY <<< "$INV"
device_share_intent "Continua: una frase sul pane, in italiano." "rest_$(date +%s)"
sleep 1
device_collapse_shade
adb shell input tap 540 1600 </dev/null
sleep 2
dump_idle "$EVID/ui-restc.xml"
if grep -qF "pane" "$EVID/ui-restc.xml"; then
  mark=$(wc -l < "$EVID/logcat-restore.txt" | tr -d ' ')
  adb shell input tap "$IX" "$IY" </dev/null
  t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
    tel=$(tail -n +"$((mark+1))" "$EVID/logcat-restore.txt" | grep 'KALSA_TELEMETRY' | grep -v util-extract | tail -1 || true)
    if [ -n "$tel" ]; then
      printf '%s\n' "$tel" | tee "$EVID/restore-tel.txt" | tee -a "$RUN"
      break
    fi
    sleep 0.4
  done
fi
grep KALSA_KVPREFIX "$EVID/logcat-restore.txt" | tee "$EVID/restore-kvprefix.txt" | tee -a "$RUN"
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) turns=$n temp=$(temp_deci)"
