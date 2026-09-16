#!/usr/bin/env bash
# 31495c3: extract finishes (live snapshot restore), HOME, 50s, recents, n_common.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in JELLY*|192.168.1.193*) exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-HOME-RESTORE-31495c3-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
FLOG="$EVID/logcat-full.txt"
cd /Users/marco/Projects/kalsa
source scripts/device-share-send.sh
device_keepawake_begin
trap 'adb shell svc power stayon false >/dev/null 2>&1 || true; device_termux_wakelock_restore; device_keepawake_restore' EXIT
adb shell svc power stayon true >/dev/null 2>&1 || true
rlog() { echo "[s23-hr] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

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

device_collapse_shade
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
sleep 4
dump_idle "$EVID/ui-boot.xml"
if coords_for "Tocca per ricaricare" "$EVID/ui-boot.xml" >/tmp/hr-xy.txt 2>/dev/null; then
  read -r RX RY < /tmp/hr-xy.txt
  rlog "reload $RX,$RY"
  adb shell input tap "$RX" "$RY"
fi
: > "$FLOG"
adb logcat -c
adb logcat -v threadtime >> "$FLOG" &
LPID=$!
t0=$(date +%s)
ready=0
while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
  if grep KALSA_PREWARM "$FLOG" | grep -qE '"op":"done"|kv_holds_chat'; then
    rlog "engine ready"
    grep KALSA_PREWARM "$FLOG" | tail -3 | tee -a "$RUN"
    ready=1
    break
  fi
  sleep 2
done
dump_idle "$EVID/ui-ready.xml"
coords_for "Pronto" "$EVID/ui-ready.xml" >/dev/null 2>&1 && ready=1
[ "$ready" -eq 1 ] || { rlog FAIL_ready; kill "$LPID"; echo FAIL > "$EVID/verdict.txt"; exit 1; }

NC=$(coords_for "Nuova chat" "$EVID/ui-ready.xml" || echo "984 285")
read -r NX NY <<< "$NC"
adb shell input tap "$NX" "$NY"
sleep 2
dump_idle "$EVID/ui-new.xml"
if ! grep -q "Fai una domanda" "$EVID/ui-new.xml"; then
  rlog "WARN nuova chat placeholder missing"
fi
INV=$(coords_for "Invia" "$EVID/ui-new.xml" || echo "963 2115")
read -r IX IY <<< "$INV"

device_share_intent "Dimmi ciao in una riga, in italiano." "hr1_$(date +%s)"
sleep 1
device_collapse_shade
adb shell input tap 540 1600
sleep 2
dump_idle "$EVID/ui-c1.xml"
if ! grep -qF "ciao" "$EVID/ui-c1.xml"; then
  device_share_intent "Dimmi ciao in una riga, in italiano." "hr1b_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1600
  sleep 2
  dump_idle "$EVID/ui-c1.xml"
fi
grep -qF "ciao" "$EVID/ui-c1.xml" || { rlog FAIL_composer; kill "$LPID"; exit 1; }
SEND_MARK=$(wc -l < "$FLOG" | tr -d ' ')
rlog "Invia utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input tap "$IX" "$IY"

# wait SEND then extract settle OR save ok with tokens
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 30 ]; do
  tail -n +"$((SEND_MARK+1))" "$FLOG" | grep -q KALSA_SEND && break
  sleep 0.3
done
rlog "wait extract finish + chat save"
EXTRACT_DONE=0
CHAT_SAVE=""
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  if tail -n +"$((SEND_MARK+1))" "$FLOG" | grep -q 'KALSA_MEMORY_EXTRACT {'; then
    EXTRACT_DONE=1
  fi
  line=$(tail -n +"$((SEND_MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"save"' | grep '"ok":true' | grep -v kv_not_chat | grep -v unchanged | tail -1 || true)
  if [ -n "$line" ] && echo "$line" | grep -qE '"tokens":[1-9]'; then
    CHAT_SAVE="$line"
  fi
  # HOME only after extract line exists (or 8s after save if no extract)
  if [ -n "$CHAT_SAVE" ] && [ "$EXTRACT_DONE" -eq 1 ]; then
    rlog "extract done + chat save"
    break
  fi
  if [ -n "$CHAT_SAVE" ] && [ $(( $(date +%s) - t0 )) -ge 25 ]; then
    rlog "chat save, no extract after 25s — proceed"
    break
  fi
  grep -q KALSA_STALL "$FLOG" && { rlog stall; break; }
  sleep 0.4
done
if [ -z "$CHAT_SAVE" ]; then
  rlog FAIL_no_save
  tail -n +"$((SEND_MARK+1))" "$FLOG" | grep KALSA_SESSION | tail -8 | tee -a "$RUN"
  kill "$LPID" 2>/dev/null || true
  echo FAIL > "$EVID/verdict.txt"
  exit 1
fi
printf '%s\n' "$CHAT_SAVE" | tee "$EVID/save-before-home.txt" | tee -a "$RUN"
# give extract restore finally() a beat
sleep 1
if grep -q kv_holds_chat "$FLOG"; then rlog kv_holds_chat; fi

HOME_MARK=$(wc -l < "$FLOG" | tr -d ' ')
HOME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
rlog "HOME utc=$HOME_UTC"
echo "utc=$HOME_UTC" > "$EVID/home.txt"
adb shell input keyevent KEYCODE_HOME

# capture HOME save
sleep 2
tail -n +"$((HOME_MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep save | tee "$EVID/save-on-home.txt" | tee -a "$RUN"

unload_s=""
t1=$(date +%s)
while [ $(( $(date +%s) - t1 )) -lt 55 ]; do
  if tail -n +"$((HOME_MARK+1))" "$FLOG" | grep "model.unload" | grep -q background; then
    unload_s=$(( $(date +%s) - t1 ))
    rlog "unload ${unload_s}s"
    tail -n +"$((HOME_MARK+1))" "$FLOG" | grep "model.unload" | tee "$EVID/unload.txt" | tee -a "$RUN"
    break
  fi
  sleep 1
done
elapsed=$(( $(date +%s) - t1 ))
[ "$elapsed" -lt 50 ] && sleep $((50 - elapsed))
echo "unload_s=${unload_s:-none}" | tee "$EVID/unload_s.txt"

REOPEN_MARK=$(wc -l < "$FLOG" | tr -d ' ')
rlog "recents utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input keyevent KEYCODE_APP_SWITCH
sleep 1.8
adb shell input tap 540 1000
sleep 2
device_collapse_shade
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
t2=$(date +%s)
load_ok=0
while [ $(( $(date +%s) - t2 )) -lt 90 ]; do
  if tail -n +"$((REOPEN_MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"load"' | grep -q '"ok":true'; then
    rlog LOAD_OK
    tail -n +"$((REOPEN_MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"load"' | tee "$EVID/kalsa-load.txt" | tee -a "$RUN"
    load_ok=1
    break
  fi
  if tail -n +"$((REOPEN_MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"load"' | grep -q '"ok":false'; then
    rlog LOAD_FALSE
    tail -n +"$((REOPEN_MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep load | tee "$EVID/kalsa-load.txt" | tee -a "$RUN"
    break
  fi
  sleep 1
done
sleep 2
dump_idle "$EVID/ui-reopen.xml"
INV2=$(coords_for "Invia" "$EVID/ui-reopen.xml" || echo "963 2115")
read -r IX2 IY2 <<< "$INV2"
SEND2_MARK=$(wc -l < "$FLOG" | tr -d ' ')
device_share_intent "Una parola sul tè." "hr2_$(date +%s)"
sleep 1
device_collapse_shade
adb shell input tap 540 1600
sleep 2
dump_idle "$EVID/ui-c2.xml"
if grep -qF "tè" "$EVID/ui-c2.xml"; then
  adb shell input tap "$IX2" "$IY2"
  rlog "reopen send"
fi
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
  if tail -n +"$((SEND2_MARK+1))" "$FLOG" | grep 'KALSA_TELEMETRY' | grep -q '"turnId":"1"'; then
    tail -n +"$((SEND2_MARK+1))" "$FLOG" | grep 'KALSA_TELEMETRY' | grep '"turnId":"1"' | tee "$EVID/kalsa-telemetry.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.5
done
sleep 2
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
grep -E 'KALSA_SESSION|KALSA_KVPREFIX|KALSA_KVRESUME|KALSA_TELEMETRY|KALSA_PREWARM|KALSA_MEMORY_EXTRACT|model.unload|background.grace|memory_extract_restore' "$FLOG" \
  > "$EVID/quoted-kalsa.txt" || true
grep 'KALSA_KVPREFIX' "$FLOG" | tee "$EVID/quoted-kvprefix.txt" | tee -a "$RUN"
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
