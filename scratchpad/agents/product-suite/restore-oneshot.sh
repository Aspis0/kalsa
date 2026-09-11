#!/usr/bin/env bash
# Jelly c906727: process-kill restore + one continuation (G2 session reuse).
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
export BENCH_TARGET=device
export PKG=com.kalsa.app
KALSA_ROOT=/Users/marco/Projects/kalsa
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/RESTORE-C906727-EVIDENCE-2026-09-11}"
mkdir -p "$OUT"
export OUT
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-share-send.sh"
log() { echo "[rst] $*" | tee -a "$OUT/run.log"; }

log "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input keyevent KEYCODE_WAKEUP >/dev/null
adb shell svc power stayon true >/dev/null
device_collapse_shade || true
adb shell am force-stop "$PKG"
sleep 2
adb logcat -c
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
t=0
while [ "$t" -lt 120 ]; do
  if dump_ui 2>/dev/null | grep -q "Pronto"; then
    log "Pronto t=${t}s"
    break
  fi
  tap_node "Tocca per ricaricare" 2>/dev/null || true
  sleep 3
  t=$((t + 3))
done
adb logcat -d -v time > "$OUT/logcat-load.txt" || true
grep "KALSA_SESSION" "$OUT/logcat-load.txt" | tee "$OUT/session-load.txt" || true

log "share-send continuation"
if ! device_share_send "Dimmi solo: ok."; then
  log "FATAL share-send"
  exit 1
fi
t=0
while [ "$t" -lt 240 ]; do
  adb logcat -d -v time > "$OUT/logcat-turn.txt" || true
  if grep -q "KALSA_TELEMETRY" "$OUT/logcat-turn.txt"; then
    grep -E "KALSA_SESSION|KALSA_TELEMETRY|KALSA_THINKING|KALSA_MEMORY " "$OUT/logcat-turn.txt" | tee "$OUT/kalsa-lines.txt"
    break
  fi
  sleep 3
  t=$((t + 3))
done
python3 - "$OUT/session-load.txt" "$OUT/kalsa-lines.txt" "$OUT/verdict.txt" "$OUT/verdict-detail.json" <<'PY'
import json, re, sys, os
load = open(sys.argv[1], encoding="utf-8", errors="replace").read() if os.path.exists(sys.argv[1]) else ""
turn = open(sys.argv[2], encoding="utf-8", errors="replace").read() if os.path.exists(sys.argv[2]) else ""
loads = re.findall(r'KALSA_SESSION (\{.*\})', load + "\n" + turn)
teles = re.findall(r'KALSA_TELEMETRY (\{.*\})', turn)
load_ok = None
tokens = None
for b in loads:
    try:
        d = json.loads(b)
    except json.JSONDecodeError:
        continue
    if d.get("op") == "load":
        load_ok = d.get("ok")
        tokens = d.get("tokensOnDisk") or d.get("tokens")
prompt_ms = cached = predicted = interrupted = None
for b in teles:
    try:
        d = json.loads(b)
    except json.JSONDecodeError:
        continue
    if d.get("turnId") == "1" or (prompt_ms is None and "promptMs" in d):
        prompt_ms = d.get("promptMs")
        cached = d.get("tokensCached")
        predicted = d.get("tokensPredicted")
        interrupted = d.get("interrupted")
# Reuse: load ok with tokens, continuation prompt not a cold ~30s+ prewarm.
ok = load_ok is True and interrupted is False and prompt_ms is not None and prompt_ms < 20000
detail = {
    "load_ok": load_ok,
    "tokensOnDisk": tokens,
    "promptMs": prompt_ms,
    "tokensCached": cached,
    "tokensPredicted": predicted,
    "interrupted": interrupted,
    "pass": ok,
}
json.dump(detail, open(sys.argv[4], "w"), indent=2)
open(sys.argv[3], "w").write("PASS" if ok else "FAIL")
print("RESTORE", "PASS" if ok else "FAIL", detail)
PY
log "verdict=$(cat "$OUT/verdict.txt" 2>/dev/null || echo NONE)"
adb shell am force-stop "$PKG" >/dev/null || true
adb shell svc power stayon false >/dev/null || true
