#!/usr/bin/env bash
# Jelly only, APK c906727+: (1) first-send thinking stays short/EMA null
# (2) Nuova chat during post-turn extraction → aborted_by_send.
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
export BENCH_TARGET=device
export PKG=com.kalsa.app
KALSA_ROOT=/Users/marco/Projects/kalsa
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/EMA-EXTRACT-EVIDENCE-2026-09-11}"
mkdir -p "$OUT"
export OUT

# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-share-send.sh"

log() { echo "[ema-x] $*" | tee -a "$OUT/run.log"; }

dump_hist() {
  local dest="$1" index_raw id key
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  id=$(resolve_active_conversation_id "$index_raw")
  key=$(messages_storage_key "$id")
  echo "active_id=$id key=$key" > "$dest.meta"
  sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" > "$dest" 2>/dev/null || : > "$dest"
}

wait_pronto() {
  local t=0
  while [ "$t" -lt 90 ]; do
    if dump_ui 2>/dev/null | grep -q "Pronto"; then
      log "header Pronto t=${t}s"
      return 0
    fi
    tap_node "Tocca per ricaricare" 2>/dev/null || true
    sleep 3
    t=$((t + 3))
  done
  log "WARN: Pronto not seen in 90s"
  return 1
}

ciao_assistant_done() {
  python3 - "$1" "$2" <<'PY'
import json, sys
before = json.loads(open(sys.argv[1], encoding="utf-8").read() or "[]")
after = json.loads(open(sys.argv[2], encoding="utf-8").read() or "[]")
if not isinstance(after, list):
    raise SystemExit(1)
before_ids = {m.get("id") for m in before if isinstance(m, dict)} if isinstance(before, list) else set()
users = [m for m in after if isinstance(m, dict) and m.get("role") == "user" and "ciao" in (m.get("text") or "").lower()]
if not users:
    raise SystemExit(3)  # share never landed
uid = users[-1].get("id")
asst = [m for m in after if isinstance(m, dict) and m.get("role") == "assistant" and m.get("id") not in before_ids]
if not asst:
    raise SystemExit(1)  # waiting
last = asst[-1]
if last.get("interrupted") is True:
    raise SystemExit(2)
if len((last.get("text") or "").strip()) < 2:
    raise SystemExit(1)
raise SystemExit(0)
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
sleep 8
wait_pronto || true

dump_hist "$OUT/hist-before.json"
log "before $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("n",len(d) if isinstance(d,list) else 0)' "$OUT/hist-before.json")"

adb logcat -c
log "share-send ciao"
if ! device_share_send "Dimmi solo la parola: ciao."; then
  log "FATAL: share-send helper failed"
  adb logcat -d -v time > "$OUT/logcat-send-fail.txt" || true
  dump_hist "$OUT/hist-after-send.json"
  exit 1
fi

t=0
done_ok=0
while [ "$t" -lt 240 ]; do
  dump_hist "$OUT/hist-poll.json"
  ciao_assistant_done "$OUT/hist-before.json" "$OUT/hist-poll.json"
  rc=$?
  log "t=${t}s hist_rc=$rc"
  if [ "$rc" -eq 0 ]; then
    done_ok=1
    break
  fi
  if [ "$rc" -eq 3 ]; then
    log "ciao user still absent in sqlite"
  fi
  sleep 4
  t=$((t + 4))
done
adb logcat -d -v time > "$OUT/logcat-after-turn.txt" || true
grep -E "KALSA_THINKING|KALSA_MEMORY|KALSA_TELEMETRY|KALSA_SEND" "$OUT/logcat-after-turn.txt" | tee "$OUT/kalsa-lines.txt" || true

python3 - "$OUT/kalsa-lines.txt" "$OUT/ema-verdict.txt" "$OUT/ema-detail.json" <<'PY'
import json, re, sys
lines = open(sys.argv[1], encoding="utf-8", errors="replace").read()
thinks = re.findall(r"KALSA_THINKING (\{.*\})", lines)
budget = None
decode = "MISSING"
for blob in thinks:
    try:
        d = json.loads(blob)
    except json.JSONDecodeError:
        continue
    budget = d.get("budget", budget)
    decode = d.get("decodeTokPerSec", decode)
ok = budget == 512 and decode is None
detail = {"budget": budget, "decodeTokPerSec": decode, "n_thinking": len(thinks), "pass": ok}
json.dump(detail, open(sys.argv[3], "w"), indent=2)
open(sys.argv[2], "w").write("PASS" if ok else "FAIL")
print("EMA", "PASS" if ok else "FAIL", detail)
PY

if [ "$done_ok" -ne 1 ]; then
  log "FAIL: ciao turn did not complete in 240s"
  echo FAIL > "$OUT/extract-verdict.txt"
  adb shell am force-stop "$PKG" >/dev/null || true
  exit 1
fi

log "assistant done — tap Nuova chat for extract-cancel utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if ! tap_node "Nuova chat"; then
  log "FATAL: Nuova chat missing after turn"
  echo FAIL > "$OUT/extract-verdict.txt"
  exit 1
fi

t=0
while [ "$t" -lt 90 ]; do
  adb logcat -d -v time > "$OUT/logcat-after-newchat.txt" || true
  if grep -q "KALSA_MEMORY_EXTRACT" "$OUT/logcat-after-newchat.txt"; then
    grep "KALSA_MEMORY_EXTRACT" "$OUT/logcat-after-newchat.txt" | tee "$OUT/extract-lines.txt"
    break
  fi
  sleep 3
  t=$((t + 3))
done

python3 - "$OUT/extract-lines.txt" "$OUT/extract-verdict.txt" "$OUT/extract-detail.json" <<'PY'
import json, re, sys, os
path = sys.argv[1]
if not os.path.exists(path):
    json.dump({"pass": False, "reason": "no extract line"}, open(sys.argv[3], "w"))
    open(sys.argv[2], "w").write("FAIL")
    print("EXTRACT FAIL no line")
    raise SystemExit(0)
text = open(path, encoding="utf-8", errors="replace").read()
m = re.search(r"KALSA_MEMORY_EXTRACT (\{.*\})", text)
stop = None
reason = None
if m:
    try:
        d = json.loads(m.group(1))
        stop = d.get("extractStopReason")
        reason = d.get("stopReason")
    except json.JSONDecodeError:
        d = {}
else:
    d = {}
ok = reason == "aborted_by_send"
detail = {"stopReason": reason, "extractStopReason": stop, "pass": ok, "raw": m.group(1) if m else None}
json.dump(detail, open(sys.argv[3], "w"), indent=2)
open(sys.argv[2], "w").write("PASS" if ok else "FAIL")
print("EXTRACT", "PASS" if ok else "FAIL", detail)
PY

log "ema=$(cat "$OUT/ema-verdict.txt") extract=$(cat "$OUT/extract-verdict.txt")"
adb shell am force-stop "$PKG" >/dev/null || true
adb shell svc power stayon false >/dev/null || true
