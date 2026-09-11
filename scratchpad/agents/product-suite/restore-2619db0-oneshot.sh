#!/usr/bin/env bash
# Jelly 2619db0: save a turn, kill, restore, continuation. Capture KVPREFIX.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
export BENCH_TARGET=device
export PKG=com.kalsa.app
KALSA_ROOT=/Users/marco/Projects/kalsa
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/RESTORE-2619db0-JELLY-2026-09-11}"
mkdir -p "$OUT"
export OUT
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-share-send.sh"
log() { echo "[r2619] $*" | tee -a "$OUT/run.log"; }

wait_pronto() {
  local t=0
  while [ "$t" -lt 120 ]; do
    if dump_ui 2>/dev/null | grep -q "Pronto"; then
      log "Pronto t=${t}s"
      return 0
    fi
    tap_node "Tocca per ricaricare" 2>/dev/null || true
    sleep 3
    t=$((t + 3))
  done
  log "FATAL: no Pronto"
  return 1
}

wait_kalsa() {
  local needle="$1" dest="$2" t=0
  while [ "$t" -lt 240 ]; do
    adb logcat -d -v time > "$dest" 2>/dev/null || true
    if grep -q "$needle" "$dest"; then
      return 0
    fi
    sleep 3
    t=$((t + 3))
  done
  return 1
}

log "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input keyevent KEYCODE_WAKEUP >/dev/null
adb shell svc power stayon true >/dev/null
device_collapse_shade || true
adb shell am force-stop "$PKG"
sleep 2
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 8
wait_pronto || exit 1
tap_node "Nuova chat" || log "WARN Nuova chat not tapped"
sleep 2

adb logcat -c
log "turn1 share-send"
if ! device_share_send "Dimmi solo la parola: pane."; then
  log "FATAL turn1 send"
  exit 1
fi
wait_kalsa "KALSA_TELEMETRY" "$OUT/logcat-turn1.txt" || log "WARN no telemetry turn1"
t=0
while [ "$t" -lt 60 ]; do
  adb logcat -d -v time > "$OUT/logcat-turn1.txt" 2>/dev/null || true
  if grep 'KALSA_SESSION {"op":"save"' "$OUT/logcat-turn1.txt" | grep -q '"ok":true'; then
    log "save ok:true"
    break
  fi
  sleep 3
  t=$((t + 3))
done
grep -E "KALSA_SESSION|KALSA_TELEMETRY|KALSA_KVPREFIX|KALSA_KVDIVERGE|KALSA_KVDIAG|KALSA_KVRESUME" "$OUT/logcat-turn1.txt" | tee "$OUT/kalsa-turn1.txt" || true
if ! grep 'KALSA_SESSION {"op":"save"' "$OUT/kalsa-turn1.txt" | grep -q '"ok":true'; then
  log "FATAL: no chat save ok:true — not killing"
  exit 1
fi

log "force-stop after save"
adb shell am force-stop "$PKG"
sleep 2
adb logcat -c
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 8
wait_pronto || exit 1
adb logcat -d -v time > "$OUT/logcat-load.txt" || true
grep -E "KALSA_SESSION|KALSA_KVDIAG|KALSA_KVRESUME|KALSA_PREWARM" "$OUT/logcat-load.txt" | tee "$OUT/kalsa-load.txt" || true

log "turn2 continuation"
if ! device_share_send "Dimmi solo: ok."; then
  log "FATAL turn2 send"
  adb logcat -d -v time > "$OUT/logcat-turn2-fail.txt" || true
  exit 1
fi
wait_kalsa "KALSA_TELEMETRY" "$OUT/logcat-turn2.txt" || log "WARN no telemetry turn2"
grep -E "KALSA_SESSION|KALSA_TELEMETRY|KALSA_KVPREFIX|KALSA_KVDIVERGE|KALSA_KVDIAG|KALSA_PREWARM" "$OUT/logcat-turn2.txt" | tee "$OUT/kalsa-turn2.txt" || true

python3 - "$OUT/kalsa-load.txt" "$OUT/kalsa-turn2.txt" "$OUT/verdict.txt" "$OUT/verdict-detail.json" <<'PY'
import json, re, sys, os
load = open(sys.argv[1], encoding="utf-8", errors="replace").read() if os.path.exists(sys.argv[1]) else ""
turn = open(sys.argv[2], encoding="utf-8", errors="replace").read() if os.path.exists(sys.argv[2]) else ""
loads = re.findall(r"KALSA_SESSION (\{.*\})", load)
teles = re.findall(r"KALSA_TELEMETRY (\{.*\})", turn)
prefs = re.findall(r"KALSA_KVPREFIX[^\n]*", turn)
load_ok = tokens = stem = None
for b in loads:
    try:
        d = json.loads(b)
    except json.JSONDecodeError:
        continue
    if d.get("op") == "load":
        load_ok = d.get("ok")
        tokens = d.get("tokens") or d.get("tokensOnDisk")
        stem = d.get("stem")
prompt_ms = evaluated = cached = predicted = interrupted = None
for b in teles:
    try:
        d = json.loads(b)
    except json.JSONDecodeError:
        continue
    if "promptMs" in d:
        prompt_ms = d.get("promptMs")
        evaluated = d.get("tokensEvaluated")
        cached = d.get("tokensCached")
        predicted = d.get("tokensPredicted")
        interrupted = d.get("interrupted")
# Reuse: load ok with tokens, continuation prefill not a ~30s+ cold.
ok = load_ok is True and tokens and interrupted is False and prompt_ms is not None and prompt_ms < 15000
detail = {
    "load_ok": load_ok,
    "tokens": tokens,
    "stem": stem,
    "promptMs": prompt_ms,
    "tokensEvaluated": evaluated,
    "tokensCached": cached,
    "tokensPredicted": predicted,
    "kvprefix": prefs[:3],
    "pass": ok,
}
json.dump(detail, open(sys.argv[4], "w"), indent=2)
open(sys.argv[3], "w").write("PASS" if ok else "FAIL")
print("RESTORE", "PASS" if ok else "FAIL", json.dumps(detail, indent=2))
PY
log "verdict=$(cat "$OUT/verdict.txt" 2>/dev/null || echo NONE)"
adb shell am force-stop "$PKG" >/dev/null || true
adb shell svc power stayon false >/dev/null || true
