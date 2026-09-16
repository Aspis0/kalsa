#!/usr/bin/env bash
# Save a real .kvs, HOME 50s, recents reopen, n_common ≈ saved.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in JELLY*|192.168.1.193*) exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-LIFECYCLE-8be587c-RESTORE-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
MSG1="${MSG1:-Dimmi una sola frase sul pane, in italiano.}"
MSG2="${MSG2:-E adesso una sul caffè, in italiano.}"
mkdir -p "$EVID"
RUN="$EVID/run.log"
FLOG="$EVID/logcat-full.txt"
cd /Users/marco/Projects/kalsa
source scripts/device-share-send.sh
device_keepawake_begin
trap 'adb shell svc power stayon false >/dev/null 2>&1 || true; device_termux_wakelock_restore; device_keepawake_restore' EXIT
adb shell svc power stayon true >/dev/null 2>&1 || true
rlog() { echo "[s23-restore] $*" | tee -a "$RUN"; }
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
sleep 3
dump_idle "$EVID/ui-boot.xml"
if coords_for "Tocca per ricaricare" "$EVID/ui-boot.xml" >/tmp/s23-xy.txt 2>/dev/null; then
  read -r RX RY < /tmp/s23-xy.txt
  rlog "tap reload $RX,$RY"
  adb shell input tap "$RX" "$RY"
  adb shell cmd statusbar collapse >/dev/null 2>&1 || true
fi

: > "$FLOG"
adb logcat -c
adb logcat -v threadtime >> "$FLOG" &
LPID=$!
rlog "logcat $LPID"
t0=$(date +%s)
ready=0
while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
  if grep KALSA_PREWARM "$FLOG" | grep -qE '"op":"done"|kv_holds_chat'; then
    rlog "engine ready"
    grep KALSA_PREWARM "$FLOG" | tail -4 | tee -a "$RUN"
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  dump_idle "$EVID/ui-ready.xml"
  coords_for "Pronto" "$EVID/ui-ready.xml" >/dev/null 2>&1 && ready=1 && rlog "Pronto UI"
fi
if [ "$ready" -ne 1 ]; then
  rlog FAIL_not_ready
  kill "$LPID" 2>/dev/null || true
  echo FAIL > "$EVID/verdict.txt"
  exit 1
fi

dump_idle "$EVID/ui-ready.xml"
NC=$(coords_for "Nuova chat" "$EVID/ui-ready.xml" || echo "984 285")
read -r NX NY <<< "$NC"
rlog "tap Nuova chat $NX,$NY"
adb shell input tap "$NX" "$NY"
sleep 2

send_one() {
  local msg="$1" needle="$2" tag="$3"
  dump_idle "$EVID/ui-$tag.xml"
  local INV; INV=$(coords_for "Invia" "$EVID/ui-$tag.xml") || INV="963 2115"
  read -r IX IY <<< "$INV"
  device_collapse_shade
  device_share_intent "$msg" "${tag}_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1600
  sleep 2
  dump_idle "$EVID/ui-$tag-c.xml"
  if ! grep -qF "$needle" "$EVID/ui-$tag-c.xml"; then
    device_share_intent "$msg" "${tag}r_$(date +%s)"
    sleep 1
    device_collapse_shade
    adb shell input tap 540 1600
    sleep 2
    dump_idle "$EVID/ui-$tag-c.xml"
  fi
  grep -qF "$needle" "$EVID/ui-$tag-c.xml" || return 1
  rlog "Invia $IX,$IY tag=$tag utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  adb shell input tap "$IX" "$IY"
}

MARK=$(wc -l < "$FLOG" | tr -d ' ')
send_one "$MSG1" "pane" "t1" || { rlog FAIL_send; kill "$LPID"; exit 1; }
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 30 ]; do
  tail -n +"$((MARK+1))" "$FLOG" | grep -q KALSA_SEND && break
  sleep 0.4
done
rlog "wait save ok:true"
SAVE_OK=0
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  if tail -n +"$((MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"save"' | grep -q '"ok":true'; then
    if tail -n +"$((MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"save"' | grep '"ok":true' | grep -vq 'kv_not_chat'; then
      rlog "chat save ok"
      tail -n +"$((MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep save | tail -3 | tee -a "$RUN"
      SAVE_OK=1
      break
    fi
  fi
  grep -q KALSA_STALL "$FLOG" && { rlog stall; break; }
  sleep 0.5
done
if [ "$SAVE_OK" -ne 1 ]; then
  rlog FAIL_no_chat_save
  kill "$LPID" 2>/dev/null || true
  echo FAIL > "$EVID/verdict.txt"
  exit 1
fi
sleep 1

# reset capture so HOME save is obvious
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
: > "$FLOG"
adb logcat -c
adb logcat -v threadtime >> "$FLOG" &
LPID=$!
sleep 0.5
HOME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HOME_EPOCH=$(python3 -c 'import time; print(f"{time.time():.3f}")')
rlog "HOME utc=$HOME_UTC"
echo "utc=$HOME_UTC epoch=$HOME_EPOCH" > "$EVID/home.txt"
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
if [ "$elapsed" -lt 50 ]; then sleep $((50 - elapsed)); fi
if [ -z "$unload_s" ]; then
  rlog "no unload at 50s; wait to 70"
  while [ $(( $(date +%s) - t1 )) -lt 70 ]; do
    if grep "model.unload" "$FLOG" | grep -q background; then
      unload_s=$(( $(date +%s) - t1 ))
      grep "model.unload" "$FLOG" | tee "$EVID/unload.txt" | tee -a "$RUN"
      break
    fi
    sleep 1
  done
fi
echo "unload_s=${unload_s:-none}" | tee "$EVID/unload_s.txt"

rlog "recents utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input keyevent KEYCODE_APP_SWITCH
sleep 1.8
adb shell input tap 540 1000
sleep 2
device_collapse_shade
if ! adb shell dumpsys activity activities | grep -q 'com.kalsa.app'; then
  rlog "recents miss; am start"
  adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
fi
# wait load
t2=$(date +%s)
load_ok=0
while [ $(( $(date +%s) - t2 )) -lt 90 ]; do
  if grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | grep -q '"ok":true'; then
    rlog "LOAD ok:true"
    grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | tee "$EVID/kalsa-load.txt" | tee -a "$RUN"
    load_ok=1
    break
  fi
  if grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | grep -q '"ok":false'; then
    rlog "LOAD false"
    grep 'KALSA_SESSION' "$FLOG" | grep load | tee "$EVID/kalsa-load.txt" | tee -a "$RUN"
    break
  fi
  sleep 1
done
sleep 2

MARK2=$(wc -l < "$FLOG" | tr -d ' ')
send_one "$MSG2" "caffè" "t2" || rlog "send2 composer fail"
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 30 ]; do
  tail -n +"$((MARK2+1))" "$FLOG" | grep -q KALSA_SEND && break
  sleep 0.4
done
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
  if tail -n +"$((MARK2+1))" "$FLOG" | grep 'KALSA_TELEMETRY' | grep -q '"turnId":"1"'; then
    tail -n +"$((MARK2+1))" "$FLOG" | grep 'KALSA_TELEMETRY' | grep '"turnId":"1"' | tee "$EVID/kalsa-telemetry.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.5
done
sleep 2
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
grep -E 'KALSA_SESSION|KALSA_KVPREFIX|KALSA_KVRESUME|KALSA_KVDIAG|KALSA_TELEMETRY|KALSA_PREWARM|KALSA_SEND|model.unload|background.grace|keep_prefix' "$FLOG" \
  > "$EVID/quoted-kalsa.txt" || true
grep 'KALSA_KVPREFIX' "$FLOG" | tee "$EVID/quoted-kvprefix.txt" | tee -a "$RUN"
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "unload_s=${unload_s:-none}" 
