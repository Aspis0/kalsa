#!/usr/bin/env bash
# Attempt 3: wait for a NEW streaming assistant partial in SQLite
# (n_asst increases), then tap composer coords. Ignore the previous
# completed assistant. No uiautomator dump in the wait loop.
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

log() { echo "[stop-partial3] $*" | tee -a "$OUT/run3.log"; }

PROMPT='Continua: scrivi venti paragrafi sul mare, tre frasi ciascuno, in italiano. Il primo paragrafo deve iniziare con: Il mare è vasto.'
VISIBLE_MIN=80
WAIT_S=540
CX=426
CY=805

dump_hist() {
  local dest="$1"
  local index_raw id key
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  id=$(resolve_active_conversation_id "$index_raw")
  key=$(messages_storage_key "$id")
  echo "active_id=$id key=$key" > "$dest.meta"
  sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" > "$dest" 2>/dev/null || : > "$dest"
}

last_json() {
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
last = msgs[-1] if msgs else {}
last_asst = asst[-1] if asst else {}
print(json.dumps({
    "ok": True,
    "n": len(msgs),
    "n_asst": len(asst),
    "last_role": last.get("role"),
    "asst_len": len(last_asst.get("text") or ""),
    "asst_streaming": last_asst.get("streaming"),
    "asst_interrupted": last_asst.get("interrupted"),
    "asst_head": (last_asst.get("text") or "")[:180],
}, ensure_ascii=False))
PY
}

log "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
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

dump_hist "$OUT/hist3-before.json"
before=$(last_json "$OUT/hist3-before.json")
log "before $before"
before_asst=$(python3 -c 'import json,sys; print(int(json.loads(sys.argv[1])["n_asst"]))' "$before")

log "clearing logcat"
adb logcat -c
adb shell "log -t KALSA_STOPPARTIAL 'attempt3_start $(date -u +%Y-%m-%dT%H:%M:%SZ)'" || true

log "share-send"
if ! device_share_send "$PROMPT"; then
  log "FATAL: share-send failed"
  adb logcat -d -v time > "$OUT/logcat3-send-fail.txt" || true
  exit 1
fi
log "submitted utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) before_asst=$before_asst"

t=0
tapped=0
saw_new=0
while [ "$t" -lt "$WAIT_S" ]; do
  dump_hist "$OUT/hist3-poll.json"
  parsed=$(last_json "$OUT/hist3-poll.json")
  log "t=${t}s $parsed"
  n_asst=$(python3 -c 'import json,sys; print(int(json.loads(sys.argv[1]).get("n_asst") or 0))' "$parsed")
  alen=$(python3 -c 'import json,sys; print(int(json.loads(sys.argv[1]).get("asst_len") or 0))' "$parsed")
  streaming=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("asst_streaming"))' "$parsed")
  # New assistant exists once n_asst grows. Empty placeholder is NOT persisted,
  # so the first SQL sighting already has some text.
  if [ "$n_asst" -gt "$before_asst" ] && [ "$alen" -ge "$VISIBLE_MIN" ]; then
    saw_new=1
    echo "$parsed" > "$OUT/sql3-at-visible.json"
    cp "$OUT/hist3-poll.json" "$OUT/hist3-at-visible.json"
    log "NEW assistant len=$alen streaming=$streaming — tapping $CX,$CY"
    adb shell input tap "$CX" "$CY"
    sleep 0.3
    adb shell input tap "$CX" "$CY"
    tapped=1
    log "tapped utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) after ${t}s"
    timeout 3 adb exec-out screencap -p > "$OUT/screen3-at-stop.png" 2>/dev/null || true
    break
  fi
  sleep 2
  t=$((t + 2))
done

if [ "$saw_new" != 1 ]; then
  log "VOID: no new assistant text >= $VISIBLE_MIN (before_asst=$before_asst)"
  dump_hist "$OUT/hist3-timeout.json"
  adb logcat -d -v time > "$OUT/logcat3-timeout.txt" || true
  echo VOID > "$OUT/verdict3.txt"
  exit 2
fi

sleep 12
dump_hist "$OUT/hist3-after-stop.json"
adb logcat -d -v time > "$OUT/logcat3-after.txt" || true
timeout 3 adb exec-out screencap -p > "$OUT/screen3-after-stop.png" 2>/dev/null || true
adb shell dumpsys battery | egrep 'level|temperature' | tee -a "$OUT/run3.log"

python3 - "$OUT/hist3-after-stop.json" "$OUT/hist3-at-visible.json" "$OUT/verdict3.txt" "$OUT/verdict3-detail.json" "$before_asst" <<'PY'
import json, sys
after_path, vis_path, verdict_path, detail_path = sys.argv[1:5]
before_asst = int(sys.argv[5])
def load(p):
    raw = open(p, encoding="utf-8").read() or "[]"
    return json.loads(raw)
after = load(after_path)
vis = load(vis_path)
msgs = after if isinstance(after, list) else []
asst = [m for m in msgs if isinstance(m, dict) and m.get("role") == "assistant"]
last = asst[-1] if asst else {}
text = last.get("text") or ""
ok = (
    len(asst) > before_asst
    and bool(str(text).strip())
    and last.get("interrupted") is True
    and last.get("streaming") in (None, False)
)
detail = {
    "before_asst": before_asst,
    "n_messages": len(msgs),
    "n_asst": len(asst),
    "visible_snapshot": {
        "n": len(vis) if isinstance(vis, list) else None,
        "last": (vis[-1] if isinstance(vis, list) and vis else {}),
    },
    "last_role": last.get("role"),
    "last_len": len(text),
    "last_interrupted": last.get("interrupted"),
    "last_streaming": last.get("streaming"),
    "last_text_head": text[:240],
    "pass": ok,
}
# keep visible last small
if isinstance(detail["visible_snapshot"]["last"], dict):
    lm = dict(detail["visible_snapshot"]["last"])
    t = lm.get("text") or ""
    lm["text"] = t[:240]
    detail["visible_snapshot"]["last"] = lm
json.dump(detail, open(detail_path, "w"), ensure_ascii=False, indent=2)
open(verdict_path, "w").write("PASS" if ok else "FAIL")
print(json.dumps({k: detail[k] for k in ("pass","last_len","last_interrupted","last_streaming","n_asst")}, ensure_ascii=False))
PY
log "verdict=$(cat "$OUT/verdict3.txt")"
log "detail=$(cat "$OUT/verdict3-detail.json")"
log "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
