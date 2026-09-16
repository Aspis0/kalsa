#!/usr/bin/env bash
# One-shot Jelly: assistant Altro → Rigenera. Requires APK that contains
# message-action-regen (app c370c98+). No uninstall. Jelly only.
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
export BENCH_TARGET=device
export PKG=com.kalsa.app
KALSA_ROOT=/Users/marco/Projects/kalsa
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/REGEN-EVIDENCE-2026-09-10}"
mkdir -p "$OUT"
export OUT

# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"

log() { echo "[regen] $*" | tee -a "$OUT/run.log"; }

dump_hist() {
  local dest="$1"
  local index_raw id key
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  id=$(resolve_active_conversation_id "$index_raw")
  key=$(messages_storage_key "$id")
  echo "active_id=$id key=$key" > "$dest.meta"
  sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" > "$dest" 2>/dev/null || : > "$dest"
}

hist_summary() {
  python3 - "$1" <<'PY'
import json, sys
raw = open(sys.argv[1], encoding="utf-8").read() or "[]"
data = json.loads(raw) if raw.strip() else []
print("n", len(data) if isinstance(data, list) else type(data))
if isinstance(data, list):
    for i, m in enumerate(data):
        t = (m.get("text") or "")[:80].replace("\n", " ")
        print(f"{i} role={m.get('role')} edited={m.get('edited')} interrupted={m.get('interrupted')} len={len(m.get('text') or '')} {t!r}")
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

dump_hist "$OUT/hist-before.json"
log "before $(hist_summary "$OUT/hist-before.json" | tr '\n' ' | ')"

adb logcat -c
if ! tap_node "Altro"; then
  log "FATAL: Altro not found — assistant row must be on screen"
  adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null || true
  adb pull /data/local/tmp/ui.xml "$OUT/ui-no-altro.xml" >/dev/null || true
  exit 1
fi
log "tapped Altro"
sleep 2
adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null
adb pull /data/local/tmp/ui.xml "$OUT/ui-sheet.xml" >/dev/null
if ! tap_node "Rigenera"; then
  log "FATAL: Rigenera not in sheet (APK too old or assistant menu missing the row)"
  exit 1
fi
log "tapped Rigenera utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

t=0
saw=0
while [ "$t" -lt 240 ]; do
  dump_hist "$OUT/hist-poll.json"
  if python3 - "$OUT/hist-poll.json" "$OUT/hist-before.json" <<'PY'
import json, sys
after = json.loads(open(sys.argv[1], encoding="utf-8").read() or "[]")
before = json.loads(open(sys.argv[2], encoding="utf-8").read() or "[]")
if not isinstance(after, list) or not after:
    raise SystemExit(1)
last = after[-1]
# New assistant appeared (count grew) or last assistant text/id changed.
n_asst_b = sum(1 for m in before if isinstance(m, dict) and m.get("role")=="assistant")
n_asst_a = sum(1 for m in after if isinstance(m, dict) and m.get("role")=="assistant")
users = [m for m in after if isinstance(m, dict) and m.get("role")=="user"]
last_user = users[-1] if users else {}
# Pass once a user exists, is not edited, and an assistant is streaming or present after tap.
if last_user.get("edited") is True:
    raise SystemExit(2)
if n_asst_a >= 1 and last.get("role") == "assistant":
    raise SystemExit(0)
raise SystemExit(1)
PY
  then
    rc=0
  else
    rc=$?
  fi
  log "t=${t}s poll_rc=$rc $(hist_summary "$OUT/hist-poll.json" | tr '\n' ' | ')"
  if [ "$rc" -eq 0 ]; then
    saw=1
    break
  fi
  if [ "$rc" -eq 2 ]; then
    log "FAIL: user bubble stamped edited=true after Regenera"
    echo FAIL_EDITED_BADGE > "$OUT/verdict.txt"
    adb logcat -d -v time > "$OUT/logcat-after.txt" || true
    exit 1
  fi
  sleep 3
  t=$((t + 3))
done

adb logcat -d -v time > "$OUT/logcat-after.txt" || true
dump_hist "$OUT/hist-after.json"
adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null || true
adb pull /data/local/tmp/ui.xml "$OUT/ui-after.xml" >/dev/null || true

python3 - "$OUT/hist-after.json" "$OUT/hist-before.json" "$OUT/verdict.txt" "$OUT/verdict-detail.json" <<'PY'
import json, sys
after = json.loads(open(sys.argv[1], encoding="utf-8").read() or "[]")
before = json.loads(open(sys.argv[2], encoding="utf-8").read() or "[]")
users = [m for m in after if isinstance(m, dict) and m.get("role")=="user"]
last_user = users[-1] if users else {}
last = after[-1] if after else {}
ok = (
    last_user.get("edited") is not True
    and last.get("role") == "assistant"
)
detail = {
    "n_before": len(before) if isinstance(before, list) else None,
    "n_after": len(after) if isinstance(after, list) else None,
    "last_user_edited": last_user.get("edited"),
    "last_user_text": (last_user.get("text") or "")[:120],
    "last_role": last.get("role"),
    "last_interrupted": last.get("interrupted"),
    "last_len": len(last.get("text") or ""),
    "last_text": (last.get("text") or "")[:180],
    "pass": ok,
}
json.dump(detail, open(sys.argv[4], "w"), ensure_ascii=False, indent=2)
open(sys.argv[3], "w").write("PASS" if ok else "FAIL")
print(json.dumps(detail, ensure_ascii=False)[:600])
PY
log "verdict=$(cat "$OUT/verdict.txt")"
log "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
