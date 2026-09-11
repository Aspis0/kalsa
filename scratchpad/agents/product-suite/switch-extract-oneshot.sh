#!/usr/bin/env bash
# Jelly only: conversation switch while post-turn extract is in flight (f99fe45).
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
export BENCH_TARGET=device
export PKG=com.kalsa.app
KALSA_ROOT=/Users/marco/Projects/kalsa
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/SWITCH-EXTRACT-EVIDENCE-2026-09-11}"
mkdir -p "$OUT"
export OUT

# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-share-send.sh"

log() { echo "[sw-x] $*" | tee -a "$OUT/run.log"; }

wait_pronto() {
  local t=0
  while [ "$t" -lt 120 ]; do
    if dump_ui 2>/dev/null | grep -q "Pronto"; then
      log "header Pronto t=${t}s"
      return 0
    fi
    tap_node "Tocca per ricaricare" 2>/dev/null || true
    sleep 3
    t=$((t + 3))
  done
  log "FATAL: Pronto not seen"
  return 1
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
adb shell am force-stop "$PKG"
sleep 2
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 8
wait_pronto || exit 1

# Open drawer, record Menu + an inactive conversation, close drawer.
if ! tap_node "Menu"; then
  log "FATAL: Menu missing"
  exit 1
fi
sleep 1
adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null
adb pull /data/local/tmp/ui.xml "$OUT/ui-drawer.xml" >/dev/null
python3 - "$OUT/ui-drawer.xml" "$OUT/targets.json" <<'PY'
import json, re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
rows = []
for m in re.finditer(r'text="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
    t, x1, y1, x2, y2 = m.groups()
    rows.append({"desc": t, "x1": int(x1), "y1": int(y1), "x2": int(x2), "y2": int(y2)})
menu = next((n for n in rows if n["desc"] == "Menu"), None)
if menu is None:
    menu = {"desc": "Menu", "x1": 19, "y1": 147, "x2": 69, "y2": 196}
chrome = {
    "Kalsa", "Locale · privato", "Predefinita", "Cerca nelle chat", "CONVERSAZIONI",
    "Nuova chat", "Menu", "Esporta chat", "Web", "Impostazioni", "Settings",
}
# Title rows sit under CONVERSAZIONI; skip the first (active) title after Nuova chat.
titles = [
    n for n in rows
    if n["desc"] not in chrome
    and n["y1"] > 400
    and n["y2"] < 820
    and (n["x2"] - n["x1"]) > 150
    and not n["desc"].startswith("ciao")
    and "Ho capito" not in n["desc"]
]
# Prefer the calculator conversation — unique title.
other = next((n for n in titles if "calcolatrice" in n["desc"].lower()), None)
if other is None and len(titles) >= 2:
    other = titles[1]
out = {"menu": menu, "other": other, "titles": titles[:6]}
json.dump(out, open(sys.argv[2], "w"), indent=2)
print(json.dumps({"other": other, "n_titles": len(titles)}, indent=2))
if other is None:
    raise SystemExit(2)
PY
if [ $? -ne 0 ]; then
  log "FATAL: no inactive conversation in drawer"
  exit 1
fi
# Close drawer by tapping the right edge of the chat (outside drawer).
adb shell input tap 450 400
sleep 1

adb logcat -c
log "share-send"
if ! device_share_send "Scrivi una frase breve sul pane, in italiano."; then
  log "FATAL: share-send failed"
  adb logcat -d -v time > "$OUT/logcat-send-fail.txt" || true
  exit 1
fi

t=0
got_memory=0
while [ "$t" -lt 240 ]; do
  adb logcat -d -v time > "$OUT/logcat-poll.txt" || true
  if grep -q "KALSA_MEMORY {" "$OUT/logcat-poll.txt" && ! grep -q "KALSA_MEMORY_EXTRACT" "$OUT/logcat-poll.txt"; then
    grep "KALSA_MEMORY {" "$OUT/logcat-poll.txt" | tee "$OUT/kalsa-memory-line.txt"
    got_memory=1
    break
  fi
  if grep -q "KALSA_MEMORY_EXTRACT" "$OUT/logcat-poll.txt"; then
    log "extract settled before switch — too slow"
    grep "KALSA_MEMORY_EXTRACT" "$OUT/logcat-poll.txt" | tee "$OUT/extract-early.txt"
    break
  fi
  sleep 2
  t=$((t + 2))
done

if [ "$got_memory" -ne 1 ]; then
  log "FAIL: no turn-end MEMORY before EXTRACT"
  echo FAIL > "$OUT/verdict.txt"
  adb logcat -d -v time > "$OUT/logcat-after.txt" || true
  adb shell am force-stop "$PKG" >/dev/null || true
  exit 1
fi

# Open drawer with an edge swipe (Menu icon taps after a turn did not change
# activeId). Second conversation title sits at y≈533–573.
log "switch utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell input swipe 2 400 300 400 250
sleep 1.5
adb shell input tap 240 553
echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT/tap-switch.txt"

t=0
while [ "$t" -lt 90 ]; do
  adb logcat -d -v time > "$OUT/logcat-after-switch.txt" || true
  if grep -q "KALSA_MEMORY_EXTRACT" "$OUT/logcat-after-switch.txt"; then
    grep "KALSA_MEMORY_EXTRACT" "$OUT/logcat-after-switch.txt" | tee "$OUT/extract-lines.txt"
    break
  fi
  sleep 2
  t=$((t + 2))
done

python3 - "$OUT/extract-lines.txt" "$OUT/verdict.txt" "$OUT/verdict-detail.json" <<'PY'
import json, re, sys, os
path = sys.argv[1]
if not os.path.exists(path):
    json.dump({"pass": False, "reason": "no extract line"}, open(sys.argv[3], "w"))
    open(sys.argv[2], "w").write("FAIL")
    print("FAIL no extract line")
    raise SystemExit(0)
text = open(path, encoding="utf-8", errors="replace").read()
m = re.search(r"KALSA_MEMORY_EXTRACT (\{.*\})", text)
reason = stop = gate = dur = None
if m:
    d = json.loads(m.group(1))
    reason = d.get("stopReason")
    stop = d.get("extractStopReason")
    gate = d.get("extractGateSource")
    dur = d.get("durationMs")
ok = reason == "aborted_by_send"
detail = {"stopReason": reason, "extractStopReason": stop, "extractGateSource": gate, "durationMs": dur, "pass": ok, "raw": m.group(1) if m else None}
json.dump(detail, open(sys.argv[3], "w"), indent=2)
open(sys.argv[2], "w").write("PASS" if ok else "FAIL")
print("SWITCH-EXTRACT", "PASS" if ok else "FAIL", detail)
PY

log "verdict=$(cat "$OUT/verdict.txt")"
adb shell am force-stop "$PKG" >/dev/null || true
adb shell svc power stayon false >/dev/null || true
