#!/usr/bin/env bash
# S23 G2 campaign: recovery smoke + 20–30 Italian turns + restore.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in JELLY*|192.168.1.193*) exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-G2-31495c3-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
PROMPTS="$EVID/prompts.txt"
mkdir -p "$EVID"
RUN="$EVID/run.log"
FLOG="$EVID/logcat-full.txt"
TURNS="$EVID/turns.jsonl"
cd /Users/marco/Projects/kalsa
source scripts/device-share-send.sh
device_keepawake_begin
trap 'adb shell svc power stayon false >/dev/null 2>&1 || true; device_termux_wakelock_restore; device_keepawake_restore' EXIT
adb shell svc power stayon true >/dev/null 2>&1 || true
rlog() { echo "[g2] $*" | tee -a "$RUN"; }
: > "$RUN"
: > "$TURNS"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

temp_deci() {
  adb shell dumpsys battery 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}'
}
wait_cool() {
  local t
  t=$(temp_deci)
  rlog "temp_deci=$t"
  while [ -n "$t" ] && [ "$t" -ge 400 ]; do
    rlog "thermal pause temp=$t"
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

start_log() {
  : > "$FLOG"
  adb logcat -c
  adb logcat -v threadtime >> "$FLOG" &
  echo $!
}

wait_engine() {
  dump_idle "$EVID/ui-boot.xml"
  if coords_for "Tocca per ricaricare" "$EVID/ui-boot.xml" >/tmp/g2xy.txt 2>/dev/null; then
    read -r RX RY < /tmp/g2xy.txt
    rlog "reload $RX,$RY"
    adb shell input tap "$RX" "$RY"
  fi
  local t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
    if grep KALSA_PREWARM "$FLOG" 2>/dev/null | grep -qE '"op":"done"|kv_holds_chat'; then
      rlog "engine ready"
      return 0
    fi
    sleep 2
  done
  dump_idle "$EVID/ui-ready.xml"
  coords_for "Pronto" "$EVID/ui-ready.xml" >/dev/null 2>&1 && { rlog Pronto; return 0; }
  return 1
}

send_turn() {
  local msg="$1" needle="$2"
  dump_idle "$EVID/ui-send.xml"
  local INV; INV=$(coords_for "Invia" "$EVID/ui-send.xml") || INV="963 2115"
  read -r IX IY <<< "$INV"
  device_collapse_shade
  device_share_intent "$msg" "g2_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1600
  sleep 2
  dump_idle "$EVID/ui-comp.xml"
  if ! grep -qF "$needle" "$EVID/ui-comp.xml"; then
    device_share_intent "$msg" "g2r_$(date +%s)"
    sleep 1
    device_collapse_shade
    adb shell input tap 540 1600
    sleep 2
    dump_idle "$EVID/ui-comp.xml"
  fi
  grep -qF "$needle" "$EVID/ui-comp.xml" || return 1
  local mark; mark=$(wc -l < "$FLOG" | tr -d ' ')
  adb shell input tap "$IX" "$IY"
  local t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt 25 ]; do
    tail -n +"$((mark+1))" "$FLOG" | grep -q KALSA_SEND && break
    sleep 0.3
  done
  t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
    if tail -n +"$((mark+1))" "$FLOG" | grep KALSA_STALL | grep -q .; then return 2; fi
    tel=$(tail -n +"$((mark+1))" "$FLOG" | grep 'KALSA_TELEMETRY' | grep -v util-extract | tail -1 || true)
    if [ -n "$tel" ]; then
      printf '%s\n' "$tel" > "$EVID/last-tel.txt"
      return 0
    fi
    sleep 0.4
  done
  return 3
}

# ── 2. Recovery smoke ──
wait_cool
device_collapse_shade
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
sleep 2
LPID=$(start_log)
rlog "recovery force-stop"
adb shell am force-stop com.kalsa.app
sleep 2
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
LPID=$(start_log)
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
wait_engine || { rlog FAIL_engine_smoke; kill "$LPID"; exit 1; }
sleep 2
# load line
grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | tee "$EVID/smoke-load.txt" | tee -a "$RUN"
send_turn "Ok, una sola parola: ciao." "ciao"
cp "$EVID/last-tel.txt" "$EVID/smoke-tel.txt" 2>/dev/null || true
cat "$EVID/smoke-tel.txt" 2>/dev/null | tee -a "$RUN" || true
grep KALSA_KVPREFIX "$FLOG" | tee "$EVID/smoke-kvprefix.txt" | tee -a "$RUN"
rlog "smoke done temp=$(temp_deci)"

# ── 3. Long chat ──
wait_cool
dump_idle "$EVID/ui-ready2.xml"
NC=$(coords_for "Nuova chat" "$EVID/ui-ready2.xml" || echo "984 285")
read -r NX NY <<< "$NC"
adb shell input tap "$NX" "$NY"
sleep 2
n=0
target=25
min_turns=20
while IFS='|' read -r msg needle; do
  [ -n "$msg" ] || continue
  n=$((n+1))
  wait_cool
  rlog "turn $n/$target needle=$needle temp=$(temp_deci)"
  send_turn "$msg" "$needle" || { rlog "send_fail n=$n rc=$?"; n=$((n-1)); break; }
  cat "$EVID/last-tel.txt" >> "$TURNS"
  cat "$EVID/last-tel.txt" | tee -a "$RUN"
  t=$(temp_deci)
  if [ -n "$t" ] && [ "$t" -ge 400 ] && [ "$n" -ge "$min_turns" ]; then
    rlog "stop at $n turns (thermal $t)"
    break
  fi
  [ "$n" -ge "$target" ] && break
done < "$PROMPTS"
echo "$n" > "$EVID/turn-count.txt"
rlog "completed $n turns"

# wait last extract
sleep 3
grep 'KALSA_MEMORY_EXTRACT' "$FLOG" | tail -3 | tee -a "$RUN" || true
# one extra save wait
sleep 2

# ── 4. Restore continuation ──
wait_cool
rlog "force-stop after long chat"
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
adb shell am force-stop com.kalsa.app
sleep 2
LPID=$(start_log)
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
wait_engine || rlog "engine after restore warn"
grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | tee "$EVID/restore-load.txt" | tee -a "$RUN"
send_turn "Continua: una frase sul pane, in italiano." "pane"
cp "$EVID/last-tel.txt" "$EVID/restore-tel.txt" 2>/dev/null || true
cat "$EVID/restore-tel.txt" 2>/dev/null | tee -a "$RUN" || true
grep KALSA_KVPREFIX "$FLOG" | tee "$EVID/restore-kvprefix.txt" | tee -a "$RUN"
grep KALSA_TELEMETRY "$FLOG" | grep -v util-extract | tail -3 | tee "$EVID/restore-telemetry.txt" | tee -a "$RUN"

kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
grep -E 'KALSA_SESSION|KALSA_KVPREFIX|KALSA_KVRESUME|KALSA_TELEMETRY|KALSA_PREWARM|tool=' "$FLOG" \
  > "$EVID/quoted-kalsa.txt" || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) turns=$n temp=$(temp_deci)"
