#!/usr/bin/env bash
# Nuova chat, one turn, HOME on first chat save (before extract wipes KV).
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in JELLY*|192.168.1.193*) exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-LIFECYCLE-8be587c-RESTORE-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run2.log"
FLOG="$EVID/logcat-full.txt"
cd /Users/marco/Projects/kalsa
source scripts/device-share-send.sh
device_keepawake_begin
trap 'adb shell svc power stayon false >/dev/null 2>&1 || true; device_termux_wakelock_restore; device_keepawake_restore' EXIT
adb shell svc power stayon true >/dev/null 2>&1 || true
rlog() { echo "[s23-r2] $*" | tee -a "$RUN"; }
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
sleep 2
dump_idle "$EVID/ui-r2-boot.xml"
if coords_for "Tocca per ricaricare" "$EVID/ui-r2-boot.xml" >/tmp/xy.txt 2>/dev/null; then
  read -r RX RY < /tmp/xy.txt
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
  if grep KALSA_PREWARM "$FLOG" | grep -qE '"op":"done"|kv_holds_chat'; then ready=1; rlog ready; break; fi
  sleep 2
done
dump_idle "$EVID/ui-r2-ready.xml"
coords_for "Pronto" "$EVID/ui-r2-ready.xml" >/dev/null 2>&1 && ready=1
[ "$ready" -eq 1 ] || { rlog FAIL_ready; kill "$LPID"; exit 1; }

NC=$(coords_for "Nuova chat" "$EVID/ui-r2-ready.xml" || echo "984 285")
read -r NX NY <<< "$NC"
adb shell input tap "$NX" "$NY"
sleep 2
dump_idle "$EVID/ui-r2-new.xml"
if ! grep -q "Fai una domanda" "$EVID/ui-r2-new.xml"; then
  rlog "WARN nuova chat may have missed"
fi
INV=$(coords_for "Invia" "$EVID/ui-r2-new.xml" || echo "963 2115")
read -r IX IY <<< "$INV"
device_share_intent "Dimmi ciao in una riga." "r2_$(date +%s)"
sleep 1
device_collapse_shade
adb shell input tap 540 1600
sleep 2
dump_idle "$EVID/ui-r2-c.xml"
if ! grep -qF "ciao" "$EVID/ui-r2-c.xml"; then
  device_share_intent "Dimmi ciao in una riga." "r2b_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1600
  sleep 2
  dump_idle "$EVID/ui-r2-c.xml"
fi
grep -qF "ciao" "$EVID/ui-r2-c.xml" || { rlog FAIL_composer; kill "$LPID"; exit 1; }
rlog "Invia utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input tap "$IX" "$IY"

# HOME on first chat save ok:true (usedTokens>0), before extract wipes.
t0=$(date +%s)
got=0
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  line=$(grep 'KALSA_SESSION' "$FLOG" | grep '"op":"save"' | grep '"ok":true' | grep -v kv_not_chat | tail -1 || true)
  if [ -n "$line" ] && echo "$line" | grep -qE '"tokens":[1-9]|"usedTokens":[1-9]'; then
    rlog "chat save — HOME immediately"
    printf '%s\n' "$line" | tee "$EVID/save-before-home.txt" | tee -a "$RUN"
    got=1
    break
  fi
  grep -q KALSA_STALL "$FLOG" && { rlog stall; break; }
  sleep 0.2
done
[ "$got" -eq 1 ] || { rlog FAIL_save; kill "$LPID"; exit 1; }

HOME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
rlog "HOME utc=$HOME_UTC"
echo "utc=$HOME_UTC" > "$EVID/home.txt"
adb shell input keyevent KEYCODE_HOME

unload_s=""
t1=$(date +%s)
while [ $(( $(date +%s) - t1 )) -lt 55 ]; do
  if grep "model.unload" "$FLOG" | grep -q background; then
    unload_s=$(( $(date +%s) - t1 ))
    rlog "unload ${unload_s}s"
    grep "model.unload" "$FLOG" | tee "$EVID/unload.txt" | tee -a "$RUN"
    break
  fi
  sleep 1
done
elapsed=$(( $(date +%s) - t1 ))
[ "$elapsed" -lt 50 ] && sleep $((50 - elapsed))
echo "unload_s=${unload_s:-none}" | tee "$EVID/unload_s.txt"

rlog "recents"
adb shell input keyevent KEYCODE_APP_SWITCH
sleep 1.8
adb shell input tap 540 1000
sleep 2
device_collapse_shade
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
t2=$(date +%s)
while [ $(( $(date +%s) - t2 )) -lt 90 ]; do
  if grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | grep -q '"ok":true'; then
    rlog LOAD_OK
    grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | tee "$EVID/kalsa-load.txt" | tee -a "$RUN"
    break
  fi
  if grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | grep -q '"ok":false'; then
    rlog LOAD_FALSE
    grep 'KALSA_SESSION' "$FLOG" | grep load | tee "$EVID/kalsa-load.txt" | tee -a "$RUN"
    break
  fi
  sleep 1
done
sleep 3
dump_idle "$EVID/ui-r2-reopen.xml"
INV=$(coords_for "Invia" "$EVID/ui-r2-reopen.xml" || echo "963 2115")
read -r IX IY <<< "$INV"
device_share_intent "Una parola sul tè." "r2t_$(date +%s)"
sleep 1
device_collapse_shade
adb shell input tap 540 1600
sleep 2
dump_idle "$EVID/ui-r2-t.xml"
if grep -qF "tè" "$EVID/ui-r2-t.xml" || grep -qF "te" "$EVID/ui-r2-t.xml"; then
  adb shell input tap "$IX" "$IY"
  rlog "sent reopen turn"
fi
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
  if grep 'KALSA_TELEMETRY' "$FLOG" | grep -q '"turnId":"1"'; then
    grep 'KALSA_TELEMETRY' "$FLOG" | grep '"turnId":"1"' | tee "$EVID/kalsa-telemetry.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.5
done
sleep 2
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
grep -E 'KALSA_SESSION|KALSA_KVPREFIX|KALSA_KVRESUME|KALSA_TELEMETRY|KALSA_PREWARM|model.unload|background.grace|kv_holds' "$FLOG" \
  > "$EVID/quoted-kalsa.txt" || true
grep KALSA_KVPREFIX "$FLOG" | tee "$EVID/quoted-kvprefix.txt" | tee -a "$RUN"
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
