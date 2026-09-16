#!/usr/bin/env bash
# Build think-history on 8be587c, save, force-stop, restore, one user turn.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in JELLY*|192.168.1.193*) exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-KV-REUSE-8be587c-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run-measure.log"
FLOG="$EVID/logcat-full.txt"
cd /Users/marco/Projects/kalsa
# shellcheck source=/Users/marco/Projects/kalsa/scripts/device-share-send.sh
source scripts/device-share-send.sh
rlog() { echo "[s23-kv] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "build-and-measure utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

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

send_turn() {
  local msg="$1" needle="$2" tag="$3"
  dump_idle "$EVID/ui-$tag.xml"
  local INV IX IY
  INV=$(coords_for "Invia" "$EVID/ui-$tag.xml") || return 1
  read -r IX IY <<< "$INV"
  device_collapse_shade
  device_share_intent "$msg" "${tag}_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1100
  sleep 2
  dump_idle "$EVID/ui-$tag-composer.xml"
  if ! grep -qF "$needle" "$EVID/ui-$tag-composer.xml"; then
    device_share_intent "$msg" "${tag}r_$(date +%s)"
    sleep 1
    device_collapse_shade
    adb shell input tap 540 1100
    sleep 2
    dump_idle "$EVID/ui-$tag-composer.xml"
  fi
  grep -qF "$needle" "$EVID/ui-$tag-composer.xml" || return 1
  rlog "tap Invia $IX,$IY utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) tag=$tag"
  adb shell input tap "$IX" "$IY"
}

wait_send() {
  local t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt 30 ]; do
    grep -q 'KALSA_SEND' "$FLOG" && return 0
    sleep 0.4
  done
  return 1
}

wait_tel_save() {
  local t0=$(date +%s) saw_tel=0
  while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
    grep -q 'KALSA_STALL' "$FLOG" && { rlog "stall"; return 1; }
    if grep 'KALSA_TELEMETRY' "$FLOG" | grep -q '"turnId":"1"\|"turnId":"2"\|"round":0'; then
      saw_tel=1
    fi
    if grep 'KALSA_SESSION' "$FLOG" | grep '"op":"save"' | grep -q '"ok":true'; then
      rlog "save ok:true elapsed=$(( $(date +%s) - t0 ))s"
      grep 'KALSA_SESSION' "$FLOG" | grep '"op":"save"' | tail -2 | tee -a "$RUN"
      return 0
    fi
    sleep 0.5
  done
  rlog "no save (tel=$saw_tel)"
  return 1
}

# --- BUILD: two thinking turns so history has <think> then a save ---
: > "$FLOG"
adb logcat -c
adb logcat -v threadtime >> "$FLOG" &
LPID=$!
rlog "logcat $LPID build"

send_turn "Dimmi una frase breve sul gelato, in italiano." "gelato" "b1" || { rlog FAIL_send_b1; kill "$LPID"; exit 1; }
wait_send || { rlog FAIL_ksend_b1; kill "$LPID"; exit 1; }
rlog "sent b1; wait tel+save (cold history prefill expected)"
wait_tel_save || { rlog FAIL_save_b1; kill "$LPID"; exit 1; }

# reset log markers for second turn by noting line count
MARK=$(wc -l < "$FLOG" | tr -d ' ')
send_turn "Dimmi una frase breve sul miele, in italiano." "miele" "b2" || { rlog FAIL_send_b2; kill "$LPID"; exit 1; }
# wait SEND after mark
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 30 ]; do
  tail -n +"$((MARK+1))" "$FLOG" | grep -q 'KALSA_SEND' && break
  sleep 0.4
done
rlog "sent b2; wait save"
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  if tail -n +"$((MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"save"' | grep -q '"ok":true'; then
    rlog "save2 ok"
    tail -n +"$((MARK+1))" "$FLOG" | grep 'KALSA_SESSION' | grep save | tail -2 | tee -a "$RUN"
    break
  fi
  sleep 0.5
done

kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
cp "$FLOG" "$EVID/logcat-build.txt"
rlog "force-stop after save"
adb shell am force-stop com.kalsa.app
sleep 2

# --- MEASURE restore ---
: > "$FLOG"
adb logcat -c
adb logcat -v threadtime >> "$FLOG" &
LPID=$!
device_collapse_shade
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
rlog "relaunch utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

load_ok=0
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  if grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | grep -q '"ok":true'; then
    rlog "LOAD ok:true"
    grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | tee "$EVID/kalsa-load.txt" | tee -a "$RUN"
    load_ok=1
    break
  fi
  if grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | grep -q '"ok":false'; then
    rlog "LOAD false: $(grep load "$FLOG" | tail -1)"
    break
  fi
  sleep 1
done
if [ "$load_ok" -ne 1 ]; then
  rlog FAIL_load
  kill "$LPID" 2>/dev/null || true
  echo "FAIL no_load" > "$EVID/verdict.txt"
  exit 1
fi
sleep 3
send_turn "Scrivi una frase breve sul caffè, in italiano." "caffè" "m1" || { rlog FAIL_send_m1; kill "$LPID"; exit 1; }
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 30 ]; do
  grep -q 'KALSA_SEND' "$FLOG" && break
  sleep 0.4
done
rlog "wait user-turn telemetry"
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  grep -q 'KALSA_STALL' "$FLOG" && { rlog stall; break; }
  if grep 'KALSA_TELEMETRY' "$FLOG" | grep -q '"turnId":"1"'; then
    rlog "got telemetry"
    grep 'KALSA_TELEMETRY' "$FLOG" | grep '"turnId":"1"' | tee "$EVID/kalsa-telemetry.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.4
done
sleep 2
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
grep -E 'KALSA_KVPREFIX|KALSA_KVDIAG|KALSA_KVRESUME|KALSA_SESSION|KALSA_TELEMETRY|KALSA_PREWARM|KALSA_SEND|keep_prefix' "$FLOG" \
  > "$EVID/quoted-kalsa.txt" || true
grep -E 'RNLlama|KALSA_KVPREFIX|KALSA_KVDIAG|KALSA_KVRESUME|keep_prefix' "$FLOG" \
  > "$EVID/quoted-rnllama.txt" || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
