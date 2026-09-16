#!/usr/bin/env bash
# Jelly: switch conversation while extract is in flight (testID tap).
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
case "$ANDROID_SERIAL" in
  192.168.1.152*|192.168.1.193*) echo "refusing $ANDROID_SERIAL" >&2; exit 2 ;;
esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/JELLY-SWITCH-EXTRACT-8be587c-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
MSG="${MSG:-Dimmi solo la parola: sale.}"
OTHER_ID="${OTHER_ID:-conv-g1-m01-1789025137}"
MX="${MX:-44}"; MY="${MY:-171}"
TX="${TX:-240}"; TY="${TY:-569}"
mkdir -p "$EVID"
KLOG="$EVID/logcat-race.txt"
RUN="$EVID/run.log"
cd /Users/marco/Projects/kalsa
# shellcheck source=/Users/marco/Projects/kalsa/scripts/device-share-send.sh
source scripts/device-share-send.sh
adb shell svc power stayon true >/dev/null 2>&1 || true
rlog() { echo "[jelly-switch] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) other=$OTHER_ID menu=$MX,$MY target=$TX,$TY"

BEFORE=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';")
BEFORE_ID=$(resolve_active_conversation_id "$BEFORE")
rlog "before_activeId=$BEFORE_ID"
printf '%s\n' "$BEFORE_ID" > "$EVID/before-activeId.txt"
printf '%s\n' "$BEFORE" > "$EVID/index-raw.txt"

: > "$KLOG"
adb logcat -c
adb logcat -v threadtime -s ReactNativeJS:I RNLlama:I RNLlama:W >> "$KLOG" &
KPID=$!
rlog "logcat $KPID"

device_collapse_shade
if ! device_share_send "$MSG"; then
  rlog FAIL_share_send
  kill "$KPID" 2>/dev/null || true
  echo "FAIL share_send" > "$EVID/verdict.txt"
  exit 1
fi

rlog "wait KALSA_MEMORY {"
MEMORY_LINE=""
t1=$(date +%s)
while [ $(( $(date +%s) - t1 )) -lt 360 ]; do
  if grep -q 'KALSA_STALL' "$KLOG"; then
    rlog FAIL_stall
    kill "$KPID" 2>/dev/null || true
    echo "FAIL stall" > "$EVID/verdict.txt"
    exit 1
  fi
  MEMORY_LINE=$(grep -F 'KALSA_MEMORY {' "$KLOG" | grep -v MEMORY_EXTRACT | tail -1 || true)
  if [ -n "$MEMORY_LINE" ]; then
    rlog "turn-end MEMORY elapsed=$(( $(date +%s) - t1 ))s"
    printf '%s\n' "$MEMORY_LINE" | tee "$EVID/kalsa-memory.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.25
done
if [ -z "$MEMORY_LINE" ]; then
  rlog FAIL_no_memory
  kill "$KPID" 2>/dev/null || true
  echo "FAIL no_turn_end_memory" > "$EVID/verdict.txt"
  exit 1
fi

SW_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
rlog "SWITCH Menu $MX,$MY then target $TX,$TY utc=$SW_UTC"
adb shell input tap "$MX" "$MY"
sleep 1.5
adb shell input tap "$TX" "$TY"
echo "utc=$SW_UTC menu=$MX,$MY target=$TX,$TY other=$OTHER_ID" > "$EVID/switch.txt"

EXTRACT_LINE=""
t2=$(date +%s)
while [ $(( $(date +%s) - t2 )) -lt 90 ]; do
  EXTRACT_LINE=$(grep -F 'KALSA_MEMORY_EXTRACT {' "$KLOG" | tail -1 || true)
  if [ -n "$EXTRACT_LINE" ]; then
    rlog "EXTRACT elapsed=$(( $(date +%s) - t2 ))s"
    printf '%s\n' "$EXTRACT_LINE" | tee "$EVID/kalsa-extract.txt" | tee -a "$RUN"
    break
  fi
  sleep 0.25
done
grep -E 'KALSA_TELEMETRY|KALSA_MEMORY|KALSA_SEND|KALSA_THINKING' "$KLOG" > "$EVID/kalsa-excerpt.txt" || true
grep 'util-extractMemory' "$KLOG" | tee "$EVID/kalsa-native-extract.txt" | tee -a "$RUN" || true
kill "$KPID" 2>/dev/null || true
wait "$KPID" 2>/dev/null || true

rlog "force-stop then sql activeId"
adb shell am force-stop com.kalsa.app
sleep 1
AFTER=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';")
AFTER_ID=$(resolve_active_conversation_id "$AFTER")
rlog "after_activeId=$AFTER_ID"
printf '%s\n' "$AFTER_ID" > "$EVID/after-activeId.txt"
printf '%s\n' "$AFTER" > "$EVID/index-raw-after.txt"

python3 - "$EVID" "$MEMORY_LINE" "$EXTRACT_LINE" "$SW_UTC" "$BEFORE_ID" "$AFTER_ID" "$OTHER_ID" <<'PY'
import json, re, sys, pathlib
evid = pathlib.Path(sys.argv[1])
mem_line, ext_line, sw_utc, before_id, after_id, other_id = sys.argv[2:8]
klog = (evid / "logcat-race.txt").read_text(encoding="utf-8", errors="replace")

def payload(line, prefix):
    if not line:
        return None
    i = line.find(prefix)
    if i < 0:
        return None
    raw = line[i + len(prefix):].strip()
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw)
        return json.loads(m.group(0)) if m else None

mem = payload(mem_line, "KALSA_MEMORY ")
ext = payload(ext_line, "KALSA_MEMORY_EXTRACT ")
native = next((ln for ln in klog.splitlines() if "util-extractMemory" in ln), None)
native_interrupted = bool(native and '"interrupted":true' in native)
stop = (ext or {}).get("stopReason")
esr = (ext or {}).get("extractStopReason")
gate = (ext or {}).get("extractGateSource")
dur = (ext or {}).get("durationMs") or 0
enabled = (ext or {}).get("memoryEnabled")
native_started = native_interrupted or (gate == 1 and dur > 0)
switched = bool(after_id) and after_id != before_id
if not switched:
    verdict, reason = "HARNESS_MISS", f"activeId_unchanged before={before_id} after={after_id}"
elif not ext:
    verdict, reason = "FAIL", "no_extract_line"
elif enabled in (0, "0"):
    verdict, reason = "VOID", "memory_off"
elif stop == "done":
    verdict, reason = "FAIL", "extract_kept_running_after_switch"
elif stop == "aborted_by_send" and native_started:
    verdict, reason = "PASS", "switched_and_aborted"
elif stop == "aborted_by_send":
    verdict, reason = "VOID", "aborted_without_native_start"
else:
    verdict, reason = "FAIL", f"stopReason={stop}"
detail = {
    "verdict": verdict, "reason": reason, "switch_utc": sw_utc,
    "before_activeId": before_id, "after_activeId": after_id,
    "other_id": other_id, "switched": switched,
    "memory": mem, "extract": ext, "native_line": native,
    "native_started": native_started,
}
(evid / "verdict-detail.json").write_text(json.dumps(detail, indent=2) + "\n")
(evid / "verdict.txt").write_text(f"{verdict} {reason}\n")
print(f"VERDICT {verdict} {reason}")
print(json.dumps({"before": before_id, "after": after_id, "switched": switched,
                  "stopReason": stop, "durationMs": dur, "extractStopReason": esr,
                  "native_started": native_started}, indent=2))
PY
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) $(cat "$EVID/verdict.txt")"
adb shell svc power stayon false >/dev/null 2>&1 || true
adb shell settings delete system screen_off_timeout >/dev/null 2>&1 || true
