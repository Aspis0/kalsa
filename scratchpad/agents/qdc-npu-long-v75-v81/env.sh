# QDC logit-oracle R5 cell (QRD8750 / SM8750) shared env. BOARD must be set by the caller.
# Remote adb ONLY via the SSH tunnel on 6037; never the local server on 5037.
export ANDROID_ADB_SERVER_PORT=6037
LAB=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-npu-long-v75-v81
BOARD=${BOARD:?set BOARD}
OUT=$LAB/raw/$BOARD; TMPD=/tmp/qdcr5/$BOARD; mkdir -p "$OUT" "$TMPD"
# A local adb server on 6037 (started by `adb devices` before the tunnel) makes the tunnel bind [::1] only. Refuse unless the listener is ssh.
LISTENER=$(lsof -nP -iTCP:6037 -sTCP:LISTEN -Fc 2>/dev/null | sed -n 's/^c//p' | head -1)
[ "$LISTENER" = ssh ] || { echo "6037 listener is '${LISTENER:-none}', not the QDC ssh tunnel: STOP"; return 2 2>/dev/null || exit 2; }
APP=com.kalsa.app
APK=/tmp/apk-v73.wS32/kalsa-apk-arm64-v8a-debuggable-e32aa433b001e9d1290a2066eff83fb3d7073c3c/app-release.apk
APK_SHA=0bcace2794cfbe526147203384f75f22b25bc98a7bdb4834430ba9386d4fdf56
MODEL=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
MODEL_SIZE=1593894944; MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf
COOL_TARGET=${COOL_TARGET:-40.0}; COOL_CAP=${COOL_CAP:-600}; STOP_C=${STOP_C:-48.0}
SER=$(adb devices | awk '$2=="device"{print $1; exit}')
[ -n "$SER" ] || { echo "NO_DEVICE on 6037"; return 2 2>/dev/null || exit 2; }
ad() { perl -e 'alarm shift; exec @ARGV or exit 127' "${ADT:-90}" adb -s "$SER" "$@"; }
# skin temp (C) from the HAL list. QDC lists two mName=skin entries; one is FROZEN. setup.sh writes
# raw/$BOARD/skin-index.txt = the 1-based position of the LIVE entry (the one whose value moves). Never max().
SKIN_IDX=$(cat "$OUT/skin-index.txt" 2>/dev/null)
skin_c() { ad shell dumpsys thermalservice 2>/dev/null | tr -d '\r' | grep -i "mName=skin" | grep -v Threshold | sed -n "${SKIN_IDX:-1}p" | sed -n 's/.*mValue=\([0-9.]*\).*/\1/p'; }
batt_c() { ad shell dumpsys battery 2>/dev/null | tr -d '\r' | grep -m1 "^  temperature" | grep -oE "[0-9]+" | head -1 | awk '{printf "%.1f",$1/10}'; }
# center of a node by exact text/content-desc in a uiautomator dump file
center() { tr '>' '\n' < "$2" | grep -E "(content-desc|text)=\"$1\"" | sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1 | awk '{printf "%d %d", ($1+$3)/2, ($2+$4)/2}'; }
dump_ui() { local d="$1" i; for i in 1 2 3 4 5; do rm -f "$d"; ad shell "rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null 2>&1"; ad shell cat /sdcard/ui.xml 2>/dev/null | tr -d '\r' > "$d"; grep -q "<hierarchy" "$d" && return 0; sleep 3; done; return 1; }