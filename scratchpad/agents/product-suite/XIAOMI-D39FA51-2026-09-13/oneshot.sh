#!/usr/bin/env bash
# Xiaomi 14 d39fa51: A two-send then B kill-recovery. No stayon. Wake often (1 min lock).
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.193:38413}"
case "$ANDROID_SERIAL" in
  192.168.1.82*|adb-R3CW406P8CV*|192.168.1.152*) echo refused >&2; exit 2 ;;
esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/XIAOMI-D39FA51-2026-09-13}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
CHAT_ID="conv-g1-c02-1789009104"
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh
rlog() { echo "[xm] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"

DEV=$(adb shell getprop ro.product.device | tr -d '\r')
MODEL=$(adb shell getprop ro.product.model | tr -d '\r')
rlog "device=$DEV model=$MODEL"
if [ "$DEV" != houji ] || [ "$MODEL" != 23127PN0CG ]; then
  rlog REFUSE_NOT_XIAOMI14
  exit 2
fi

SAVED_TIMEOUT=$(adb shell settings get system screen_off_timeout | tr -d '\r')
rlog "timeout_saved=$SAVED_TIMEOUT"
if ! adb shell settings put system screen_off_timeout 300000 </dev/null; then
  rlog "WARNING failed to set screen_off_timeout 300000"
fi

WPID=""
LPID=""
cleanup() {
  rlog "cleanup utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  [ -n "$WPID" ] && kill "$WPID" 2>/dev/null || true
  [ -n "$LPID" ] && kill "$LPID" 2>/dev/null || true
  adb shell am force-stop com.kalsa.app </dev/null
  REST="${SAVED_TIMEOUT:-120000}"
  case "$REST" in ''|null) REST=120000 ;; esac
  if adb shell settings put system screen_off_timeout "$REST" </dev/null; then
    rlog "timeout restore: put $REST"
  else
    rlog "WARNING timeout restore put failed"
  fi
  rlog "stay_on_after=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
  rlog "timeout_after=$(adb shell settings get system screen_off_timeout | tr -d '\r')"
}
trap cleanup EXIT

wake() {
  adb connect 192.168.1.193:38413 >/dev/null 2>&1 || true
  adb shell input keyevent KEYCODE_WAKEUP </dev/null 2>&1 || true
  device_collapse_shade </dev/null 2>&1 || true
}
poke() { wake; adb shell input swipe 600 1100 600 1125 80 </dev/null 2>&1 || true; }
keep_awake() { while true; do poke; sleep 12; done; }

thermal() {
  local t
  t=$(adb shell dumpsys battery 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}')
  rlog "temp_deci=$t"
  [ -n "$t" ] && [ "$t" -ge 400 ] && return 1
  return 0
}
battery_snap() {
  adb shell dumpsys battery 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+(level|temperature|status|plugged):/ {print}' | paste -sd' ' -
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

dump_ui_file() {
  poke
  local ui
  ui=$(device_dump_ui_retry </dev/null || true)
  printf '%s\n' "$ui" > "$1"
  printf '%s\n' "$ui"
}

abort_if_pin() {
  local ui="$1"
  if printf '%s' "$ui" | grep -qE 'Enter PIN|Inserisci il PIN|use fingerprint to unlock'; then
    rlog BLOCKED_PIN
    printf '%s\n' "$ui" | tr '>' '\n' | grep -E 'PIN|fingerprint|Face unlock' | head -20 | tee -a "$RUN"
    echo BLOCKED_PIN > "$EVID/verdict-raw.txt"
    exit 4
  fi
}

wait_kv() {
  local mark="$1" out="$2" logf="$3" secs="${4:-120}"
  local t0 now
  t0=$(date +%s)
  while true; do
    now=$(date +%s)
    [ $((now - t0)) -ge "$secs" ] && return 1
    thermal || return 3
    poke
    if tail -n +"$((mark+1))" "$logf" | grep -q KALSA_KVPREFIX; then
      tail -n +"$((mark+1))" "$logf" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|window_slide|window_align' | tee "$out" | tee -a "$RUN"
      return 0
    fi
    sleep 2
  done
}

wait_done() {
  local mark="$1" out="$2" logf="$3" secs="${4:-300}"
  local t0 now
  t0=$(date +%s)
  while true; do
    now=$(date +%s)
    [ $((now - t0)) -ge "$secs" ] && return 1
    thermal || return 3
    poke
    if tail -n +"$((mark+1))" "$logf" | grep KALSA_TELEMETRY | grep -v util-extract | grep -q .; then
      tail -n +"$((mark+1))" "$logf" | grep KALSA_TELEMETRY | grep -v util-extract | tail -2 | tee "$out" | tee -a "$RUN"
      return 0
    fi
    if tail -n +"$((mark+1))" "$logf" | grep 'KALSA_SESSION' | grep '"op":"save"' | grep '"ok":true' | grep -v unchanged | grep -q '"tokens":'; then
      tail -n +"$((mark+1))" "$logf" | grep '"op":"save"' | grep '"ok":true' | grep -v unchanged | tail -2 | tee "$out" | tee -a "$RUN"
      return 0
    fi
    sleep 3
  done
}

send_ciao() {
  local tag="$1" ui_path="$2"
  local i ui inv ix iy
  poke
  device_share_intent "Ciao." "${tag}_$(date +%s)" </dev/null
  sleep 2
  device_collapse_shade </dev/null
  for i in 1 2 3 4 5 6 7 8; do
    ui=$(dump_ui_file "$ui_path")
    abort_if_pin "$ui"
    if printf '%s' "$ui" | grep -q 'Tocca per ricaricare'; then
      inv=$(coords_for "Tocca per ricaricare" "$ui_path" || true)
      if [ -n "$inv" ]; then read -r ix iy <<< "$inv"; adb shell input tap "$ix" "$iy" </dev/null; sleep 3; continue; fi
    fi
    if printf '%s' "$ui" | grep 'content-desc="Invia"' | grep -q 'enabled="true"'; then
      inv=$(coords_for "Invia" "$ui_path") || continue
      read -r ix iy <<< "$inv"
      adb shell input tap "$ix" "$iy" </dev/null
      rlog "Invia $tag at $ix,$iy utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      return 0
    fi
    sleep 2
  done
  rlog "FAIL send $tag Invia not enabled"
  return 1
}

start_logcat() {
  local f="$1"
  : > "$f"
  adb logcat -c </dev/null
  adb logcat -v threadtime ReactNativeJS:I RNLlama:W '*:S' >> "$f" </dev/null &
  LPID=$!
}

# --- begin ---
thermal || exit 3
rlog "stay_on_before=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
rlog "battery_before=$(battery_snap)"
rlog "lastUpdateTime=$(adb shell dumpsys package com.kalsa.app | tr -d '\r' | awk '/lastUpdateTime=/ {print; exit}')"
keep_awake &
WPID=$!

ui=$(dump_ui_file "$EVID/ui-pre.xml")
abort_if_pin "$ui"

poke
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
start_logcat "$EVID/logcat.txt"
poke
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 5
poke
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
  thermal || exit 3
  poke
  grep 'KALSA_SESSION' "$EVID/logcat.txt" 2>/dev/null | grep '"op":"load"' | grep -q . && break
  grep KALSA_PREWARM "$EVID/logcat.txt" 2>/dev/null | grep -qE 'done|kv_holds_chat|skip' && break
  ui=$(dump_ui_file "$EVID/ui-ready.xml")
  abort_if_pin "$ui"
  sleep 3
done
grep 'KALSA_SESSION' "$EVID/logcat.txt" | grep '"op":"load"' | tee "$EVID/load1.txt" | tee -a "$RUN" || true
ui=$(dump_ui_file "$EVID/ui-ready.xml")
abort_if_pin "$ui"
if ! printf '%s' "$ui" | grep -q 'LFM2.5'; then
  rlog "WARN chip not LFM; trying Menu"
  inv=$(coords_for "Menu" "$EVID/ui-ready.xml" || true)
  if [ -n "$inv" ]; then read -r ix iy <<< "$inv"; adb shell input tap "$ix" "$iy" </dev/null; sleep 2
    ui=$(dump_ui_file "$EVID/ui-drawer.xml")
    abort_if_pin "$ui"
    inv=$(coords_for "pane" "$EVID/ui-drawer.xml" || true)
    if [ -n "$inv" ]; then read -r ix iy <<< "$inv"; adb shell input tap "$ix" "$iy" </dev/null; sleep 3; fi
  fi
fi
rlog "chat_id=$CHAT_ID"

MARK1=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
send_ciao s1 "$EVID/ui-s1.xml" || { rlog FAIL_A_send1; echo FAIL_A > "$EVID/verdict-raw.txt"; exit 1; }
wait_kv "$MARK1" "$EVID/send1.txt" "$EVID/logcat.txt" 120 || rlog "WARN no KVPREFIX send1"
wait_done "$MARK1" "$EVID/tel1.txt" "$EVID/logcat.txt" 300 || { rlog FAIL_A_send1_incomplete; echo FAIL_A > "$EVID/verdict-raw.txt"; exit 1; }
rlog "send1 complete"
sleep 2

MARK2=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
send_ciao s2 "$EVID/ui-s2.xml" || { rlog FAIL_A_send2; echo FAIL_A > "$EVID/verdict-raw.txt"; exit 1; }
wait_kv "$MARK2" "$EVID/send2.txt" "$EVID/logcat.txt" 120 || rlog "WARN no KVPREFIX send2"
wait_done "$MARK2" "$EVID/tel2.txt" "$EVID/logcat.txt" 300 || rlog "WARN send2 incomplete"
rlog "send2 done"
sleep 2

# B kill-recovery
rlog "force-stop for B utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
start_logcat "$EVID/logcat-b.txt"
poke
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 5
poke
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 120 ]; do
  poke
  grep 'KALSA_SESSION' "$EVID/logcat-b.txt" 2>/dev/null | grep '"op":"load"' | grep -q . && break
  ui=$(dump_ui_file "$EVID/ui-b.xml")
  abort_if_pin "$ui"
  sleep 2
done
sleep 2
grep 'KALSA_SESSION' "$EVID/logcat-b.txt" | grep '"op":"load"' | tee "$EVID/load2.txt" | tee -a "$RUN" || true
grep -E 'KALSA_KVRESUME|history_not_reproducible|no_file|historyHash' "$EVID/logcat-b.txt" | tee "$EVID/load2-extra.txt" | tee -a "$RUN" || true

LOAD_OK=0
if grep 'KALSA_SESSION' "$EVID/logcat-b.txt" | grep '"op":"load"' | grep '"ok":true' | grep -qE '"tokens":[1-9]'; then
  LOAD_OK=1
  rlog LOAD_B_PASS
else
  rlog LOAD_B_FAIL
fi

thermal || exit 3
MARKB=$(wc -l < "$EVID/logcat-b.txt" | tr -d ' ')
send_ciao s3 "$EVID/ui-s3.xml" || rlog "WARN send3 failed"
wait_kv "$MARKB" "$EVID/send3.txt" "$EVID/logcat-b.txt" 120 || rlog "WARN no KVPREFIX send3"
wait_done "$MARKB" "$EVID/tel3.txt" "$EVID/logcat-b.txt" 300 || rlog "WARN send3 incomplete"

rlog "battery_after=$(battery_snap)"
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo DONE > "$EVID/oneshot.done"
