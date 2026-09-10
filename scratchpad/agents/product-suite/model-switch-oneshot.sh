#!/usr/bin/env bash
# One-shot Jelly: Stop mid-turn, then switch LFM → Qwen 3.5 4B.
# Proves selectModel dispose is bounded (not stuck on "checking").
# Never MiniCPM5. Never Xiaomi. APK must contain 1807aad+.
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
export BENCH_TARGET=device
export PKG=com.kalsa.app
KALSA_ROOT=/Users/marco/Projects/kalsa
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/MODEL-SWITCH-EVIDENCE-2026-09-10}"
mkdir -p "$OUT"
export OUT

# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-share-send.sh"

log() { echo "[model-switch] $*" | tee -a "$OUT/run.log"; }

PROMPT='Dimmi solo la parola: pronto.'
QWEN_LABEL="Qwen 3.5 4B"

dump_ui() {
  adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1 || return 1
  adb pull /data/local/tmp/ui.xml "$1" >/dev/null 2>&1 || return 1
}

ui_has() {
  python3 - "$1" "$2" <<'PY'
import re, sys
xml, needle = open(sys.argv[1], encoding="utf-8", errors="replace").read(), sys.argv[2].lower()
for m in re.finditer(r'<node [^>]*>', xml):
    s = m.group(0)
    blob = " ".join(re.findall(r'(?:text|content-desc)="([^"]*)"', s)).lower()
    if needle in blob:
        raise SystemExit(0)
raise SystemExit(1)
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

adb logcat -c
if ! device_share_send "$PROMPT"; then
  log "FATAL: share-send failed"
  exit 1
fi
log "submitted utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sleep 2
log "stop tap 426,805"
adb shell input tap 426 805
sleep 2

# Open settings. Menu content-desc on Jelly.
if ! tap_node "Menu"; then
  log "FATAL: Menu not found"
  dump_ui "$OUT/ui-no-menu.xml" || true
  exit 1
fi
sleep 1
if ! tap_node "Settings" && ! tap_node "Impostazioni"; then
  log "FATAL: Settings not found"
  dump_ui "$OUT/ui-no-settings.xml" || true
  exit 1
fi
log "opened Settings"
sleep 2
dump_ui "$OUT/ui-settings.xml" || true

if ! tap_node "$QWEN_LABEL"; then
  log "FATAL: $QWEN_LABEL not in settings (cannot switch without MiniCPM5)"
  exit 1
fi
log "tapped $QWEN_LABEL utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

stuck=1
t=0
while [ "$t" -lt 40 ]; do
  dump_ui "$OUT/ui-switch-poll.xml" || true
  if ui_has "$OUT/ui-switch-poll.xml" "checking" || ui_has "$OUT/ui-switch-poll.xml" "Verifica"; then
    log "t=${t}s still checking"
  else
    stuck=0
    log "t=${t}s left checking"
    break
  fi
  sleep 2
  t=$((t + 2))
done

adb logcat -d -v time > "$OUT/logcat-after.txt" || true
dump_ui "$OUT/ui-after.xml" || true
python3 - "$OUT/logcat-after.txt" "$OUT/ui-after.xml" "$stuck" "$OUT/verdict.txt" "$OUT/verdict-detail.json" <<'PY'
import json, sys, re
log, ui, stuck = open(sys.argv[1], encoding="utf-8", errors="replace").read(), open(sys.argv[2], encoding="utf-8", errors="replace").read(), sys.argv[3]
timeout_warn = "model switch dispose timed out" in log
retry_copy = "Riprova a cambiare modello" in ui or "Retry the model switch" in ui
qwen = "qwen" in ui.lower()
checking = "checking" in ui.lower() or "verifica" in ui.lower()
ok = stuck == "0" and not checking
detail = {
    "left_checking": stuck == "0",
    "ui_still_checking": checking,
    "dispose_timeout_warn": timeout_warn,
    "retry_copy_visible": retry_copy,
    "qwen_in_ui": qwen,
    "pass": ok,
}
json.dump(detail, open(sys.argv[5], "w"), indent=2)
open(sys.argv[4], "w").write("PASS" if ok else "FAIL")
print(json.dumps(detail))
PY
log "verdict=$(cat "$OUT/verdict.txt")"
log "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
