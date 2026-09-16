#!/usr/bin/env bash
# S23 d3959aa: send1 heal then send2 reuse in SAME process. No reinstall, no stayon.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp}"
case "$ANDROID_SERIAL" in
  JELLY*|192.168.1.82*|192.168.1.193*|192.168.1.152*) echo refused >&2; exit 2 ;;
esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-D3959AA-HEAL-2026-09-12}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh
rlog() { echo "[heal] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

SAVED_TIMEOUT=$(adb shell settings get system screen_off_timeout | tr -d '\r')
rlog "timeout_saved=$SAVED_TIMEOUT"
if ! adb shell settings put system screen_off_timeout 300000 </dev/null; then
  rlog "WARNING failed to set screen_off_timeout 300000"
fi

cleanup() {
  rlog "cleanup utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  adb shell am force-stop com.kalsa.app </dev/null
  case "$SAVED_TIMEOUT" in
    ''|null)
      if adb shell settings delete system screen_off_timeout </dev/null; then
        rlog "timeout restore: deleted"
      else
        rlog "WARNING timeout restore delete failed"
      fi
      ;;
    *)
      if adb shell settings put system screen_off_timeout "$SAVED_TIMEOUT" </dev/null; then
        rlog "timeout restore: put $SAVED_TIMEOUT"
      else
        rlog "WARNING timeout restore put failed"
      fi
      ;;
  esac
  rlog "stay_on_after=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
  rlog "timeout_after=$(adb shell settings get system screen_off_timeout | tr -d '\r')"
}
trap cleanup EXIT

wake() { adb shell input keyevent KEYCODE_WAKEUP </dev/null; device_collapse_shade </dev/null; }
thermal() {
  local t
  t=$(adb shell dumpsys battery 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}')
  rlog "temp_deci=$t"
  [ -n "$t" ] && [ "$t" -ge 400 ] && return 1
  return 0
}
send_ciao() {
  local tag="$1"
  wake
  device_share_intent "Ciao." "${tag}_$(date +%s)" </dev/null
  sleep 1
  device_collapse_shade </dev/null
  adb shell input tap 540 1600 </dev/null
  sleep 2
  adb shell input tap 963 2115 </dev/null
  rlog "Invia $tag utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

thermal || exit 3
wake
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
: > "$EVID/logcat.txt"
adb logcat -c </dev/null
adb logcat -v threadtime >> "$EVID/logcat.txt" </dev/null &
LPID=$!
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 5
wake
t0=$(date +%s)
while [ $(( $(date +%s) - t0 )) -lt 120 ]; do
  grep KALSA_PREWARM "$EVID/logcat.txt" 2>/dev/null | grep -qE 'done|kv_holds_chat|skip' && break
  grep 'KALSA_SESSION' "$EVID/logcat.txt" 2>/dev/null | grep '"op":"load"' | grep -q . && break
  sleep 2
done
grep 'KALSA_SESSION' "$EVID/logcat.txt" | grep '"op":"load"' | tee "$EVID/load.txt" | tee -a "$RUN" || true
sleep 3

MARK1=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
send_ciao s1
t0=$(date +%s)
got1=0
while [ $(( $(date +%s) - t0 )) -lt 90 ]; do
  thermal || break
  if tail -n +"$((MARK1+1))" "$EVID/logcat.txt" | grep -q KALSA_KVPREFIX; then
    got1=1
    tail -n +"$((MARK1+1))" "$EVID/logcat.txt" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|window_slide|window_align' | tee "$EVID/send1.txt" | tee -a "$RUN"
    break
  fi
  sleep 1
done
rlog "got1=$got1"
NEED2=1
if tail -n +"$((MARK1+1))" "$EVID/logcat.txt" | grep -q window_slide; then
  rlog "send1 slid"
fi
python3 - "$EVID/logcat.txt" "$MARK1" <<'PY' && NEED2=0
import re, sys
path, mark = sys.argv[1], int(sys.argv[2])
lines = open(path, encoding="utf-8", errors="replace").read().splitlines()[mark:]
for ln in lines:
    m = re.search(r"KALSA_KVPREFIX embd=(\d+) text_tokens=\d+ n_common=(\d+)", ln)
    if not m:
        continue
    embd, n = int(m.group(1)), int(m.group(2))
    # reuse if n_common ≈ embd and not system-prefix
    if embd > 2000 and n >= embd - 50:
        sys.exit(0)
    sys.exit(1)
sys.exit(1)
PY
rlog "need_send2=$NEED2"

if [ "$NEED2" -eq 1 ]; then
  # wait send1 to finish so send2 is a new turn in the same process
  t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt 300 ]; do
    thermal || break
    if tail -n +"$((MARK1+1))" "$EVID/logcat.txt" | grep KALSA_TELEMETRY | grep -v util-extract | grep -q .; then
      rlog "send1 telemetry"
      tail -n +"$((MARK1+1))" "$EVID/logcat.txt" | grep KALSA_TELEMETRY | grep -v util-extract | tail -2 | tee -a "$RUN"
      break
    fi
    if tail -n +"$((MARK1+1))" "$EVID/logcat.txt" | grep 'KALSA_SESSION' | grep '"op":"save"' | grep '"ok":true' | grep -v unchanged | grep -q '"tokens":'; then
      rlog "send1 save"
      break
    fi
    sleep 3
  done
  sleep 2
  MARK2=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
  send_ciao s2
  t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt 90 ]; do
    thermal || break
    if tail -n +"$((MARK2+1))" "$EVID/logcat.txt" | grep -q KALSA_KVPREFIX; then
      tail -n +"$((MARK2+1))" "$EVID/logcat.txt" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|window_slide|window_align' | tee "$EVID/send2.txt" | tee -a "$RUN"
      break
    fi
    sleep 1
  done
fi

kill "$LPID" 2>/dev/null || true
wait "$LPID" 2>/dev/null || true
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo DONE > "$EVID/oneshot.done"
