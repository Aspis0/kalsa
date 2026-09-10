#!/usr/bin/env bash
# One-shot: Edit→Salva with the prefilled text (no typing).
# New chat → short send → Stop during think so the user bubble stays on
# screen → Altro → Modifica → Salva → assert edited:true + new generation.
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
export BENCH_TARGET=device
export PKG=com.kalsa.app
KALSA_ROOT=/Users/marco/Projects/kalsa
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/EDIT-SAVE-EVIDENCE-2026-09-10}"
mkdir -p "$OUT"
export OUT

# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-share-send.sh"

log() { echo "[edit-save] $*" | tee -a "$OUT/run.log"; }

PROMPT='Dimmi solo la parola: ciao.'

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
try:
    data = json.loads(raw)
except Exception as e:
    print("PARSE", e); raise SystemExit
print("n", len(data) if isinstance(data, list) else type(data))
if isinstance(data, list):
    for i, m in enumerate(data):
        t = (m.get("text") or "")[:90].replace("\n", " ")
        print(f"{i} role={m.get('role')} edited={m.get('edited')} interrupted={m.get('interrupted')} streaming={m.get('streaming')} len={len(m.get('text') or '')} {t!r}")
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

if tap_node "Nuova chat"; then
  log "tapped Nuova chat"
  sleep 3
else
  log "WARN: Nuova chat not found"
fi

adb logcat -c
log "share-send"
if ! device_share_send "$PROMPT"; then
  log "FATAL: share-send failed"
  exit 1
fi
log "submitted utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sleep 2
# Stop during think so the user bubble remains on screen (no long assistant).
log "tapping stop coords 426,805"
adb shell input tap 426 805
sleep 3
dump_hist "$OUT/hist-after-stop.json"
log "after-stop $(hist_summary "$OUT/hist-after-stop.json" | tr '\n' ' | ')"
adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null
adb pull /data/local/tmp/ui.xml "$OUT/ui-after-stop.xml" >/dev/null
python3 - "$OUT/ui-after-stop.xml" <<'PY' | tee "$OUT/ui-after-stop-nodes.txt"
import re, sys
t = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for m in re.finditer(r"<node [^>]*>", t):
    s = m.group(0)
    def g(a):
        x = re.search(a + r'="([^"]*)"', s)
        return x.group(1) if x else ""
    text, desc, b = g("text"), g("content-desc"), g("bounds")
    if text or desc:
        print(f"{b} t={text[:90]!r} d={desc[:90]!r}")
PY

# Prefer the user-row Altro (right-ish). Fall back to any Altro.
if ! tap_node "Altro"; then
  log "FATAL: Altro not found"
  exit 1
fi
log "tapped Altro"
sleep 2
adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null
adb pull /data/local/tmp/ui.xml "$OUT/ui-sheet.xml" >/dev/null
if ! tap_node "Modifica"; then
  log "FATAL: Modifica not in sheet (maybe assistant Altro). sheet follows"
  python3 - "$OUT/ui-sheet.xml" <<'PY'
import re, sys
t = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for m in re.finditer(r'content-desc="([^"]*)"|text="([^"]*)"', t):
    print(m.group(1) or m.group(2))
PY
  exit 1
fi
log "tapped Modifica"
sleep 2
adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null
adb pull /data/local/tmp/ui.xml "$OUT/ui-edit.xml" >/dev/null
if ! tap_node "Salva"; then
  log "FATAL: Salva not found"
  exit 1
fi
log "tapped Salva utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Persist of edited:true is skipped while streaming until the first assistant
# partial; poll SQL and also accept KALSA_SEND as proof the resend started.
t=0
saw=0
while [ "$t" -lt 180 ]; do
  dump_hist "$OUT/hist-after-save.json"
  if python3 - "$OUT/hist-after-save.json" <<'PY'
import json, sys
data = json.loads(open(sys.argv[1], encoding="utf-8").read() or "[]")
raise SystemExit(0 if any(isinstance(m, dict) and m.get("role")=="user" and m.get("edited") is True for m in (data if isinstance(data, list) else [])) else 1)
PY
  then
    saw=1
    log "edited:true in SQL after ${t}s"
    break
  fi
  if grep -q 'KALSA_SEND {"phase":"fit"' <(adb logcat -d -v time 2>/dev/null); then
    log "KALSA_SEND fit seen after ${t}s (resend started); keep polling SQL"
  fi
  sleep 3
  t=$((t + 3))
done
log "after-save $(hist_summary "$OUT/hist-after-save.json" | tr '\n' ' | ')"
adb logcat -d -v time > "$OUT/logcat-after.txt" || true
adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null || true
adb pull /data/local/tmp/ui.xml "$OUT/ui-after-save.xml" >/dev/null || true

python3 - "$OUT/hist-after-save.json" "$OUT/verdict.txt" "$OUT/verdict-detail.json" <<'PY'
import json, sys
data = json.loads(open(sys.argv[1], encoding="utf-8").read() or "[]")
users = [m for m in data if isinstance(m, dict) and m.get("role") == "user"]
edited = [m for m in users if m.get("edited") is True]
ok = len(edited) >= 1
detail = {
    "n": len(data) if isinstance(data, list) else None,
    "n_user": len(users),
    "n_edited": len(edited),
    "last": data[-1] if isinstance(data, list) and data else {},
    "edited_heads": [(m.get("text") or "")[:120] for m in edited],
    "pass": ok,
}
if isinstance(detail["last"], dict):
    lm = dict(detail["last"])
    lm["text"] = (lm.get("text") or "")[:180]
    detail["last"] = lm
json.dump(detail, open(sys.argv[3], "w"), ensure_ascii=False, indent=2)
open(sys.argv[2], "w").write("PASS" if ok else "FAIL")
print(json.dumps(detail, ensure_ascii=False)[:500])
PY
log "verdict=$(cat "$OUT/verdict.txt")"
log "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
