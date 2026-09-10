#!/usr/bin/env bash
# Attempt 2: do NOT poll uiautomator during streaming (dump waits for idle
# and only returns after the turn completes). Detect visible text via the
# 10s streaming partial in SQLite, then tap the composer button coordinates
# captured while thinking.
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
export BENCH_TARGET=device
export PKG=com.kalsa.app
KALSA_ROOT=/Users/marco/Projects/kalsa
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/STOP-PARTIAL-EVIDENCE-2026-09-10}"
mkdir -p "$OUT"
export OUT

# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-share-send.sh"

log() { echo "[stop-partial2] $*" | tee -a "$OUT/run2.log"; }

PROMPT='Elenca in italiano venti paragrafi sul mare, ciascuno di almeno tre frasi. Inizia il primo paragrafo con: Il mare è vasto.'
VISIBLE_MIN=80
WAIT_S=480
CX="${STOP_CX:-426}"
CY="${STOP_CY:-805}"

dump_ui_timed() {
  local dest="$1"
  if ! timeout 4 adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1; then
    return 1
  fi
  adb pull /data/local/tmp/ui.xml "$dest" >/dev/null 2>&1 || return 1
  [ -s "$dest" ]
}

dump_hist() {
  local dest="$1"
  local index_raw id key
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  id=$(resolve_active_conversation_id "$index_raw")
  key=$(messages_storage_key "$id")
  echo "active_id=$id key=$key" > "$dest.meta"
  sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" > "$dest" 2>/dev/null || : > "$dest"
}

last_assistant_json() {
  python3 - "$1" <<'PY'
import json, sys
raw = open(sys.argv[1], encoding="utf-8").read() or "[]"
try:
    data = json.loads(raw)
except Exception:
    print(json.dumps({"ok": False}))
    raise SystemExit
msgs = data if isinstance(data, list) else []
asst = [m for m in msgs if isinstance(m, dict) and m.get("role") == "assistant"]
last = asst[-1] if asst else {}
text = last.get("text") or ""
print(json.dumps({
    "ok": True,
    "n": len(msgs),
    "n_asst": len(asst),
    "len": len(text),
    "streaming": last.get("streaming"),
    "interrupted": last.get("interrupted"),
    "head": text[:180],
}, ensure_ascii=False))
PY
}

find_stop_coords() {
  python3 - "$1" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for m in re.finditer(r"<node [^>]*>", xml):
    s = m.group(0)
    desc = re.search(r'content-desc="([^"]*)"', s)
    text = re.search(r'text="([^"]*)"', s)
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', s)
    blob = ((desc.group(1) if desc else "") + " " + (text.group(1) if text else "")).lower()
    if b and ("interrompi generazione" in blob):
        x1,y1,x2,y2 = map(int, b.groups())
        print(f"{(x1+x2)//2} {(y1+y2)//2}")
        raise SystemExit
print("")
PY
}

log "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"
case "$(adb devices)" in
  *JELLYS0000053795*) ;;
  *) log "FATAL: Jelly not attached"; exit 1 ;;
esac
if adb devices | grep -q '192.168.1.193'; then
  log "FATAL: Xiaomi visible"; exit 1
fi

adb shell input keyevent KEYCODE_WAKEUP >/dev/null
adb shell svc power stayon true >/dev/null
device_collapse_shade || true
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 2

dump_hist "$OUT/hist2-before.json"
log "before $(last_assistant_json "$OUT/hist2-before.json")"

log "clearing logcat"
adb logcat -c
adb shell "log -t KALSA_STOPPARTIAL 'attempt2_start $(date -u +%Y-%m-%dT%H:%M:%SZ)'" || true

log "share-send"
if ! device_share_send "$PROMPT"; then
  log "FATAL: share-send failed"
  dump_ui_timed "$OUT/ui2-send-fail.xml" || true
  adb logcat -d -v time > "$OUT/logcat2-send-fail.txt" || true
  exit 1
fi
log "submitted utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Capture stop-button coords during thinking (dump still returns then).
got_coords=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if dump_ui_timed "$OUT/ui2-thinking.xml"; then
    coords=$(find_stop_coords "$OUT/ui2-thinking.xml")
    log "thinking-dump i=$i coords='$coords'"
    if [ -n "$coords" ]; then
      read -r CX CY <<< "$coords"
      got_coords=1
      log "using stop coords $CX,$CY"
      break
    fi
  else
    log "thinking-dump i=$i timed out/failed"
  fi
  sleep 1
done
if [ "$got_coords" != 1 ]; then
  log "WARN: no Interrompi node; falling back to $CX,$CY"
fi

t=0
tapped=0
saw_text=0
while [ "$t" -lt "$WAIT_S" ]; do
  dump_hist "$OUT/hist2-poll.json"
  parsed=$(last_assistant_json "$OUT/hist2-poll.json")
  log "t=${t}s sql=$parsed"
  blen=$(python3 -c 'import json,sys; print(int(json.loads(sys.argv[1]).get("len") or 0))' "$parsed")
  streaming=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("streaming"))' "$parsed")
  if [ "$blen" -ge "$VISIBLE_MIN" ]; then
    saw_text=1
    echo "$parsed" > "$OUT/sql-at-visible.json"
    cp "$OUT/hist2-poll.json" "$OUT/hist2-at-visible.json"
    log "visible sql len=$blen streaming=$streaming — tapping $CX,$CY"
    adb shell input tap "$CX" "$CY"
    tapped=1
    log "tapped utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) after ${t}s"
    timeout 3 adb exec-out screencap -p > "$OUT/screen2-at-stop.png" 2>/dev/null || true
    break
  fi
  sleep 2
  t=$((t + 2))
done

if [ "$saw_text" != 1 ]; then
  log "VOID: sql never showed assistant text >= $VISIBLE_MIN"
  dump_hist "$OUT/hist2-timeout.json"
  adb logcat -d -v time > "$OUT/logcat2-timeout.txt" || true
  echo VOID > "$OUT/verdict2.txt"
  exit 2
fi

sleep 8
dump_hist "$OUT/hist2-after-stop.json"
adb logcat -d -v time > "$OUT/logcat2-after.txt" || true
dump_ui_timed "$OUT/ui2-after-stop.xml" || true
timeout 3 adb exec-out screencap -p > "$OUT/screen2-after-stop.png" 2>/dev/null || true
adb shell dumpsys battery | egrep 'level|temperature' | tee -a "$OUT/run2.log"

python3 - "$OUT/hist2-after-stop.json" "$OUT/verdict2.txt" "$OUT/verdict2-detail.json" <<'PY'
import json, sys
hist_path, verdict_path, detail_path = sys.argv[1:4]
raw = open(hist_path, encoding="utf-8").read() or "[]"
try:
    data = json.loads(raw)
except Exception as e:
    open(verdict_path, "w").write("FAIL_PARSE")
    json.dump({"error": str(e)}, open(detail_path, "w"))
    raise SystemExit(0)
msgs = data if isinstance(data, list) else []
last = msgs[-1] if msgs else {}
role = last.get("role")
text = last.get("text") or ""
interrupted = last.get("interrupted")
streaming = last.get("streaming")
ok = (
    role == "assistant"
    and bool(str(text).strip())
    and interrupted is True
    and streaming in (None, False)
)
detail = {
    "n_messages": len(msgs),
    "last_role": role,
    "last_len": len(text),
    "last_interrupted": interrupted,
    "last_streaming": streaming,
    "last_text_head": text[:240],
    "pass": ok,
}
json.dump(detail, open(detail_path, "w"), ensure_ascii=False, indent=2)
open(verdict_path, "w").write("PASS" if ok else "FAIL")
print(json.dumps(detail, ensure_ascii=False))
PY
log "verdict=$(cat "$OUT/verdict2.txt")"
log "detail=$(cat "$OUT/verdict2-detail.json")"
log "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
