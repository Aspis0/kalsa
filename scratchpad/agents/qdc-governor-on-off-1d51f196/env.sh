# QDC governor ON/OFF campaign shared env. BOARD must be set by the caller.
# Remote adb ONLY via the SSH tunnel on 6037; never the local server on 5037.
export ANDROID_ADB_SERVER_PORT=6037
LAB=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-on-off-1d51f196
BOARD=${BOARD:?set BOARD}
OUT=$LAB/raw/$BOARD; TMPD=/tmp/qdcgov/$BOARD; mkdir -p "$OUT" "$TMPD"
APP=com.kalsa.app
APK=$(ls /Users/marco/kalsa-qdc/apk-1d51f196/kalsa-apk*/app-release.apk)
MODEL=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
MODEL_SIZE=1593894944; MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf
COOL_TARGET=${COOL_TARGET:-40.0}; COOL_CAP=${COOL_CAP:-600}; STOP_C=${STOP_C:-48.0}  # owner 2026-10-03: QDC rack boards stop at 48.0 (HAL hot-throttle line), cooldown <=40 before each turn
SER=$(adb devices | awk '$2=="device"{print $1; exit}')
[ -n "$SER" ] || { echo "NO_DEVICE on 6037"; return 2 2>/dev/null || exit 2; }
ad() { perl -e 'alarm shift; exec @ARGV or exit 127' "${ADT:-90}" adb -s "$SER" "$@"; }
# skin temp (C) from the HAL list; case-insensitive name match; empty on failure
skin_c() { ad shell dumpsys thermalservice 2>/dev/null | tr -d '\r' | grep -i "mName=skin" | grep -v Threshold | sed -n 's/.*mValue=\([0-9.]*\).*/\1/p' | sort -n | tail -1; }  # QDC lists two skin entries, one frozen at 28.24; the max is the live one
batt_c() { ad shell dumpsys battery 2>/dev/null | tr -d '\r' | grep -m1 "^  temperature" | grep -oE "[0-9]+" | head -1 | awk '{printf "%.1f",$1/10}'; }
# center of a node by exact text/content-desc in a uiautomator dump file
center() { tr '>' '\n' < "$2" | grep -E "(content-desc|text)=\"$1\"" | sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1 | awk '{printf "%d %d", ($1+$3)/2, ($2+$4)/2}'; }
dump_ui() { local d="$1" i; for i in 1 2 3 4 5; do rm -f "$d"; ad shell "rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null 2>&1"; ad shell cat /sdcard/ui.xml 2>/dev/null | tr -d '\r' > "$d"; grep -q "<hierarchy" "$d" && return 0; sleep 3; done; return 1; }
