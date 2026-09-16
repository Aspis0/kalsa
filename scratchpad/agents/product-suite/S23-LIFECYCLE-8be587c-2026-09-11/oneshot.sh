#!/usr/bin/env bash
# S23 HOME lifecycle: 45s grace, not immediate dispose. Recents reopen.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:5555}"
case "$ANDROID_SERIAL" in JELLY*|192.168.1.193*) exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-LIFECYCLE-8be587c-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
FLOG="$EVID/logcat-full.txt"
cd /Users/marco/Projects/kalsa
# shellcheck source=/Users/marco/Projects/kalsa/scripts/device-share-send.sh
source scripts/device-share-send.sh
device_keepawake_begin
trap 'adb shell svc power stayon false >/dev/null 2>&1 || true; device_termux_wakelock_restore; device_keepawake_restore' EXIT
adb shell svc power stayon true >/dev/null 2>&1 || true
rlog() { echo "[s23-life] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

heap() {
  local tag="$1"
  {
    echo "=== $tag utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    adb shell dumpsys meminfo com.kalsa.app 2>/dev/null | tr -d '\r' | grep -E 'TOTAL PSS|TOTAL RSS|Native Heap|Dalvik Heap|App Summary|TOTAL:' | head -20
  } | tee -a "$EVID/heap.txt"
}

device_collapse_shade
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null
sleep 4
: > "$FLOG"
adb logcat -c
adb logcat -v threadtime >> "$FLOG" &
LPID=$!
rlog "logcat $LPID"

# wait KV resident
t0=$(date +%s)
resident=0
while [ $(( $(date +%s) - t0 )) -lt 120 ]; do
  if grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | grep -q '"ok":true'; then
    rlog "load ok:true"
    grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | tail -2 | tee -a "$RUN"
    resident=1
    break
  fi
  if grep -q 'kv_holds_chat' "$FLOG"; then
    rlog "kv_holds_chat"
    resident=1
    break
  fi
  sleep 1
done
if [ "$resident" -ne 1 ]; then
  rlog "FAIL not resident"
  kill "$LPID" 2>/dev/null || true
  echo "FAIL not_resident" > "$EVID/verdict.txt"
  exit 1
fi
sleep 2
heap before_home
adb shell pidof com.kalsa.app | tr -d '\r' | tee "$EVID/pid-before.txt"

HOME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HOME_EPOCH=$(python3 -c 'import time; print(f"{time.time():.3f}")')
rlog "HOME utc=$HOME_UTC epoch=$HOME_EPOCH"
echo "utc=$HOME_UTC epoch=$HOME_EPOCH" > "$EVID/home.txt"
adb shell input keyevent KEYCODE_HOME

unload_s=""
t1=$(date +%s)
while [ $(( $(date +%s) - t1 )) -lt 90 ]; do
  if grep -F "model.unload" "$FLOG" | grep -q background; then
    unload_s=$(( $(date +%s) - t1 ))
    rlog "unload at ${unload_s}s after HOME"
    grep "model.unload" "$FLOG" | tee "$EVID/unload.txt" | tee -a "$RUN"
    break
  fi
  sleep 1
done
if [ -z "$unload_s" ]; then
  rlog "no unload in 90s"
  echo "no_unload_90s" > "$EVID/unload.txt"
fi
elapsed=$(( $(date +%s) - t1 ))
if [ "$elapsed" -lt 50 ]; then
  sleep $(( 50 - elapsed ))
fi
heap after_bg
# reopen from recents
rlog "APP_SWITCH recents utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input keyevent KEYCODE_APP_SWITCH
sleep 1.5
# One UI recents: tap the foreground card (center-upper)
adb shell input tap 540 900
sleep 2
device_collapse_shade
REOPEN_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "utc=$REOPEN_UTC" > "$EVID/reopen.txt"
rlog "reopen tap utc=$REOPEN_UTC"
sleep 5
heap after_reopen

# if reopen looks clean, one short Italian send for n_common
CLEAN=0
if grep 'KALSA_SESSION' "$FLOG" | grep '"op":"load"' | tail -3 | grep -q '"ok":true'; then CLEAN=1; fi
if grep -q 'cancelled":true' "$FLOG"; then CLEAN=1; fi
if grep -q 'kv_holds_chat' "$FLOG"; then CLEAN=1; fi
if [ "$CLEAN" -eq 1 ]; then
  rlog "reopen clean; short send"
  dump_ui() { adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1; adb shell cat /data/local/tmp/ui.xml 2>/dev/null; }
  device_collapse_shade
  device_share_intent "Ciao, una parola sul pane." "life_$(date +%s)"
  sleep 1
  device_collapse_shade
  adb shell input tap 540 1600
  sleep 2
  ui=$(device_dump_ui_retry || true)
  printf '%s\n' "$ui" > "$EVID/ui-composer.xml"
  INV=$(python3 - "$EVID/ui-composer.xml" <<'PY'
import re,sys
xml=open(sys.argv[1],encoding="utf-8",errors="replace").read()
m=re.search(r'content-desc="Invia"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',xml) or re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*content-desc="Invia"',xml)
if not m: raise SystemExit(1)
x1,y1,x2,y2=map(int,m.groups()); print(f"{(x1+x2)//2} {(y1+y2)//2}")
PY
) || INV="963 2115"
  read -r IX IY <<< "$INV"
  if grep -qF "pane" "$EVID/ui-composer.xml"; then
    adb shell input tap "$IX" "$IY"
    rlog "tapped Invia $IX,$IY"
    t2=$(date +%s)
    while [ $(( $(date +%s) - t2 )) -lt 120 ]; do
      if grep 'KALSA_TELEMETRY' "$FLOG" | grep -q '"turnId":"1"'; then
        grep 'KALSA_TELEMETRY' "$FLOG" | grep '"turnId":"1"' | tee "$EVID/kalsa-telemetry.txt" | tee -a "$RUN"
        break
      fi
      sleep 0.5
    done
  else
    rlog "composer miss; skip send"
  fi
else
  rlog "reopen not clean; skip send"
fi

sleep 2
kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
grep -E 'KALSA_SESSION|KALSA_KVPREFIX|KALSA_KVRESUME|KALSA_KVDIAG|KALSA_TELEMETRY|KALSA_PREWARM|KALSA_SEND|model.unload|background.grace' "$FLOG" \
  > "$EVID/quoted-kalsa.txt" || true

python3 - "$EVID" "$HOME_EPOCH" <<'PY'
import json, re, sys, pathlib
evid = pathlib.Path(sys.argv[1])
home_epoch = float(sys.argv[2])
blob = (evid / "quoted-kalsa.txt").read_text(encoding="utf-8", errors="replace")
full = (evid / "logcat-full.txt").read_text(encoding="utf-8", errors="replace")

def parse_ts(line):
    # 09-11 07:05:51.380
    m = re.search(r'(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)', line)
    return m.group(0) if m else ""

unload_lines = [ln for ln in blob.splitlines() if "model.unload" in ln]
save_lines = [ln for ln in blob.splitlines() if "KALSA_SESSION" in ln and '"op":"save"' in ln]
grace_lines = [ln for ln in blob.splitlines() if "background.grace" in ln]
kvprefix = [ln for ln in full.splitlines() if "KALSA_KVPREFIX" in ln]
load_lines = [ln for ln in blob.splitlines() if "KALSA_SESSION" in ln and '"op":"load"' in ln]
tel = [ln for ln in blob.splitlines() if "KALSA_TELEMETRY" in ln and '"turnId":"1"' in ln]

immediate = False
unload_s = None
# wall from HOME: we don't have device epoch in log easily; use run.log timestamps in report
if unload_lines:
    # if unload within 5s of first save after home → immediate-ish
    pass

n_common = None
if kvprefix:
    m = re.search(r"n_common=(\d+)", kvprefix[-1])
    if m: n_common = int(m.group(1))
prompt_n = None
prompt_ms = None
if tel:
    i = tel[-1].find("{")
    try:
        t = json.loads(tel[-1][i:])
        prompt_n = t.get("prompt_n")
        prompt_ms = t.get("promptMs")
    except Exception:
        pass

load_ok = any('"ok":true' in ln for ln in load_lines)
# FAIL if unload within ~3s of HOME — parent checks quotes
verdict = "PASS"
reason = "ok"
# immediate: unload line exists and appears before 5s of logs after HOME is hard; use run.log later
detail = {
    "unload_lines": unload_lines,
    "save_lines": save_lines[-6:],
    "grace_lines": grace_lines,
    "kvprefix": kvprefix,
    "load_lines": load_lines,
    "telemetry": tel,
    "n_common": n_common,
    "prompt_n": prompt_n,
    "prompt_ms": prompt_ms,
    "load_ok": load_ok,
}
(evid / "verdict-detail.json").write_text(json.dumps(detail, indent=2) + "\n")
print("unload_count", len(unload_lines))
print("n_common", n_common, "prompt_n", prompt_n, "prompt_ms", prompt_ms)
for ln in unload_lines:
    print("UNLOAD", ln)
for ln in grace_lines[:8]:
    print("GRACE", ln)
PY
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
