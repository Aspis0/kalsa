#!/usr/bin/env bash
# One-shot: assistant Altro sheet must show Copy when text is non-empty (c906727+).
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
export PKG=com.kalsa.app
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/COPY-SHEET-EVIDENCE-2026-09-10}"
mkdir -p "$OUT"
echo "[copy] start $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee "$OUT/run.log"
adb shell input keyevent KEYCODE_WAKEUP
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 3
# assistant Altro (ciao / last assistant) — caller may retarget
adb shell input tap 404 386
sleep 2
adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null
adb pull /data/local/tmp/ui.xml "$OUT/ui-sheet.xml" >/dev/null
python3 - "$OUT/ui-sheet.xml" "$OUT/verdict.txt" "$OUT/verdict-detail.json" <<'PY'
import json, re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
descs = re.findall(r'content-desc="([^"]*)"', xml)
texts = re.findall(r'text="([^"]*)"', xml)
blob = " ".join(descs + texts).lower()
has_copy = "copia" in blob
has_altro_sheet = "traduci" in blob or "rigenera" in blob or "annulla" in blob
ok = has_copy and has_altro_sheet
json.dump({"has_copy": has_copy, "sheet": has_altro_sheet, "descs": descs[:20], "pass": ok}, open(sys.argv[3], "w"), indent=2)
open(sys.argv[2], "w").write("PASS" if ok else "FAIL")
print("PASS" if ok else "FAIL", "copy", has_copy, "sheet", has_altro_sheet)
PY
echo "verdict=$(cat "$OUT/verdict.txt")" | tee -a "$OUT/run.log"
