#!/usr/bin/env bash
# S23 P0 c498639: healthy force-stop restore + Interrompi then force-stop.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in JELLY*|192.168.1.193*) echo "refused non-S23 $ANDROID_SERIAL" >&2; exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-P0-c498639-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
FLOG="$EVID/logcat-full.txt"
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh
device_keepawake_begin
trap 'adb shell svc power stayon false >/dev/null 2>&1 || true; device_termux_wakelock_restore; device_keepawake_restore' EXIT
adb shell svc power stayon true >/dev/null 2>&1 || true
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
rlog() { echo "[p0] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"

temp_deci() {
  adb shell dumpsys battery 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}'
}
wait_cool() {
  local t
  t=$(temp_deci)
  rlog "temp_deci=$t"
  while [ -n "$t" ] && [ "$t" -ge 400 ]; do
    rlog "thermal pause temp=$t"
    sleep 20
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
  device_collapse_shade </dev/null
  local ui; ui=$(device_dump_ui_retry </dev/null || true)
  printf '%s\n' "$ui" > "$1"
}

wait_cool
dump_idle "$EVID/ui-pre.xml"
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 4
dump_idle "$EVID/ui-boot.xml"
if coords_for "Tocca per ricaricare" "$EVID/ui-boot.xml" >/tmp/p0-xy.txt 2>/dev/null; then
  read -r RX RY < /tmp/p0-xy.txt
  rlog "reload $RX,$RY"
  adb shell input tap "$RX" "$RY" </dev/null
fi

: > "$FLOG"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$FLOG" </dev/null &
LPID=$!
t0=$(date +%s)
ready=0
while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
  if grep KALSA_PREWARM "$FLOG" 2>/dev/null | grep -qE '"op":"done"|kv_holds_chat'; then
    rlog "engine ready"
    grep KALSA_PREWARM "$FLOG" | tail -3 | tee -a "$RUN"
    ready=1
    break
  fi
  sleep 2
done
dump_idle "$EVID/ui-ready.xml"
coords_for "Pronto" "$EVID/ui-ready.xml" >/dev/null 2>&1 && ready=1
if [ "$ready" -ne 1 ]; then
  rlog FAIL_ready
  kill "$LPID" 2>/dev/null || true
  echo FAIL_ready > "$EVID/verdict.txt"
  exit 1
fi

NC=$(coords_for "Nuova chat" "$EVID/ui-ready.xml" || echo "984 285")
read -r NX NY <<< "$NC"
adb shell input tap "$NX" "$NY" </dev/null
sleep 2
dump_idle "$EVID/ui-new.xml"
INV=$(coords_for "Invia" "$EVID/ui-new.xml" || echo "963 2115")
read -r IX IY <<< "$INV"
rlog "invia $IX,$IY"

send_and_wait_complete() {
  local msg="$1" needle="$2" tag="$3"
  dump_idle "$EVID/ui-send-$tag.xml"
  local inv; inv=$(coords_for "Invia" "$EVID/ui-send-$tag.xml" || echo "$IX $IY")
  read -r ix iy <<< "$inv"
  IX=$ix; IY=$iy
  device_share_intent "$msg" "p0_${tag}_$(date +%s)" </dev/null
  sleep 1
  device_collapse_shade </dev/null
  adb shell input tap 540 1600 </dev/null
  sleep 2
  dump_idle "$EVID/ui-comp-$tag.xml"
  if ! grep -qF "$needle" "$EVID/ui-comp-$tag.xml"; then
    device_share_intent "$msg" "p0_${tag}r_$(date +%s)" </dev/null
    sleep 1
    device_collapse_shade </dev/null
    adb shell input tap 540 1600 </dev/null
    sleep 2
    dump_idle "$EVID/ui-comp-$tag.xml"
  fi
  grep -qF "$needle" "$EVID/ui-comp-$tag.xml" || { rlog "FAIL_composer $tag"; return 1; }
  local mark; mark=$(wc -l < "$FLOG" | tr -d ' ')
  rlog "Invia $tag utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  adb shell input tap "$IX" "$IY" </dev/null
  local t0; t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt 25 ]; do
    tail -n +"$((mark+1))" "$FLOG" | grep -q KALSA_SEND && break
    sleep 0.3
  done
  t0=$(date +%s)
  local tel="" save=""
  while [ $(( $(date +%s) - t0 )) -lt 180 ]; do
    if tail -n +"$((mark+1))" "$FLOG" | grep -q KALSA_STALL; then
      rlog "stall $tag"
      return 2
    fi
    tel=$(tail -n +"$((mark+1))" "$FLOG" | grep 'KALSA_TELEMETRY' | grep -v util-extract | tail -1 || true)
    save=$(tail -n +"$((mark+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"save"' | grep '"ok":true' | grep -v kv_not_chat | grep -v unchanged | grep -E '"tokens":[1-9]' | tail -1 || true)
    if [ -n "$tel" ] && [ -n "$save" ]; then
      printf '%s\n' "$tel" > "$EVID/tel-$tag.txt"
      printf '%s\n' "$save" > "$EVID/save-$tag.txt"
      rlog "complete $tag"
      return 0
    fi
    sleep 0.4
  done
  rlog "timeout_complete $tag tel=${tel:+y} save=${save:+y}"
  tail -n +"$((mark+1))" "$FLOG" | grep -E 'KALSA_SESSION|KALSA_TELEMETRY' | tail -12 | tee -a "$RUN"
  return 1
}

force_reopen() {
  local tag="$1"
  local mark
  wait_cool
  rlog "force-stop $tag utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  adb shell am force-stop com.kalsa.app </dev/null
  sleep 2
  mark=$(wc -l < "$FLOG" | tr -d ' ')
  echo "$mark" > "$EVID/reopen-mark-$tag.txt"
  adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
  local t0; t0=$(date +%s)
  local saw=0
  while [ $(( $(date +%s) - t0 )) -lt 120 ]; do
    if tail -n +"$((mark+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"load"' | grep -q .; then
      saw=1
      break
    fi
    if grep KALSA_PREWARM "$FLOG" | tail -5 | grep -qE '"op":"done"|kv_holds_chat'; then
      # load may have already logged
      if tail -n +"$((mark+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"load"' | grep -q .; then
        saw=1
        break
      fi
    fi
    sleep 1
  done
  sleep 2
  tail -n +"$((mark+1))" "$FLOG" | grep 'KALSA_SESSION' | grep '"op":"load"' | tee "$EVID/load-$tag.txt" | tee -a "$RUN" || true
  tail -n +"$((mark+1))" "$FLOG" | grep -E 'KALSA_KVRESUME|kv_inconsistent|save_refused' | tee "$EVID/kvresume-$tag.txt" | tee -a "$RUN" || true
  dump_idle "$EVID/ui-reopen-$tag.xml"
  if coords_for "Tocca per ricaricare" "$EVID/ui-reopen-$tag.xml" >/tmp/p0-xy.txt 2>/dev/null; then
    read -r RX RY < /tmp/p0-xy.txt
    rlog "reload after reopen $RX,$RY"
    adb shell input tap "$RX" "$RY" </dev/null
    sleep 4
  fi
  echo "$mark"
}

# ── 1. healthy turn + save + force-stop restore ────────────────────────
wait_cool
if ! send_and_wait_complete "Dimmi ciao in una riga, in italiano." "ciao" "t1"; then
  rlog FAIL_t1
  kill "$LPID" 2>/dev/null || true
  echo FAIL_t1 > "$EVID/verdict.txt"
  exit 1
fi
sleep 3
grep 'KALSA_SESSION' "$FLOG" | grep save | tee "$EVID/saves-before-kill1.txt" | tee -a "$RUN"
MARK1=$(force_reopen "r1")

# continuation to surface n_common
wait_cool
dump_idle "$EVID/ui-after-r1.xml"
INV=$(coords_for "Invia" "$EVID/ui-after-r1.xml" || echo "$IX $IY")
read -r IX IY <<< "$INV"
MARK_C1=$(wc -l < "$FLOG" | tr -d ' ')
device_share_intent "Una parola sul tè." "p0_c1_$(date +%s)" </dev/null
sleep 1
device_collapse_shade </dev/null
adb shell input tap 540 1600 </dev/null
sleep 2
dump_idle "$EVID/ui-c1.xml"
if grep -qF "tè" "$EVID/ui-c1.xml" || grep -qF "te" "$EVID/ui-c1.xml"; then
  rlog "c1 composer ok"
  adb shell input tap "$IX" "$IY" </dev/null
else
  # still tap send if composer has anything
  rlog "c1 composer miss, tapping Invia anyway"
  adb shell input tap "$IX" "$IY" </dev/null
fi
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
  if tail -n +"$((MARK_C1+1))" "$FLOG" | grep -q 'KALSA_KVPREFIX'; then
    tail -n +"$((MARK_C1+1))" "$FLOG" | grep 'KALSA_KVPREFIX' | tee "$EVID/kvprefix-r1.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.4
done
# wait this continuation to finish so we have a fresh good save before interrupt
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 150 ]; do
  if tail -n +"$((MARK_C1+1))" "$FLOG" | grep 'KALSA_TELEMETRY' | grep -v util-extract | grep -q .; then
    tail -n +"$((MARK_C1+1))" "$FLOG" | grep 'KALSA_TELEMETRY' | grep -v util-extract | tail -1 | tee "$EVID/tel-c1.txt" | tee -a "$RUN"
    break
  fi
  grep -q KALSA_STALL "$FLOG" && break
  sleep 0.4
done
sleep 2
grep 'KALSA_SESSION' "$FLOG" | grep save | grep '"ok":true' | tail -3 | tee "$EVID/saves-before-interrupt.txt" | tee -a "$RUN"

# ── 2. mid-turn Interrompi then force-stop ─────────────────────────────
wait_cool
dump_idle "$EVID/ui-pre-int.xml"
INV=$(coords_for "Invia" "$EVID/ui-pre-int.xml" || echo "$IX $IY")
read -r IX IY <<< "$INV"
rlog "interrupt invia-coords $IX,$IY"
MARK_INT=$(wc -l < "$FLOG" | tr -d ' ')
device_share_intent "Scrivi dieci frasi sul tè, in italiano, senza elenco." "p0_int_$(date +%s)" </dev/null
sleep 1
device_collapse_shade </dev/null
adb shell input tap 540 1600 </dev/null
sleep 2
# no dump during generate
adb shell input tap "$IX" "$IY" </dev/null
rlog "interrupt send utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 20 ]; do
  tail -n +"$((MARK_INT+1))" "$FLOG" | grep -q KALSA_SEND && break
  sleep 0.3
done
sleep 6
# tap stop at last Invia coords (same button becomes Interrompi)
adb shell input tap "$IX" "$IY" </dev/null
rlog "tapped stop-coords utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sleep 2
tail -n +"$((MARK_INT+1))" "$FLOG" | grep -E 'KALSA_SEND|interrupted|Interrompi|KALSA_SESSION|save_refused|kv_inconsistent' | tee "$EVID/interrupt-slice.txt" | tee -a "$RUN" || true
sleep 1
MARK2=$(force_reopen "r2")

# continuation after interrupt-restore to get n_common
wait_cool
dump_idle "$EVID/ui-after-r2.xml"
INV=$(coords_for "Invia" "$EVID/ui-after-r2.xml" || echo "$IX $IY")
read -r IX IY <<< "$INV"
MARK_C2=$(wc -l < "$FLOG" | tr -d ' ')
device_share_intent "Ok." "p0_c2_$(date +%s)" </dev/null
sleep 1
device_collapse_shade </dev/null
adb shell input tap 540 1600 </dev/null
sleep 2
adb shell input tap "$IX" "$IY" </dev/null
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 120 ]; do
  if tail -n +"$((MARK_C2+1))" "$FLOG" | grep -q 'KALSA_KVPREFIX'; then
    tail -n +"$((MARK_C2+1))" "$FLOG" | grep 'KALSA_KVPREFIX' | tee "$EVID/kvprefix-r2.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.4
done
sleep 2

kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
grep -E 'KALSA_SESSION|KALSA_KVPREFIX|KALSA_KVRESUME|KALSA_TELEMETRY|KALSA_PREWARM|kv_inconsistent|save_refused' "$FLOG" \
  > "$EVID/quoted-kalsa.txt" || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) temp=$(temp_deci)"
echo DONE > "$EVID/oneshot.done"
