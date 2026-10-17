# S23 logit-oracle M5 rehearsal: shared env + device sensor reads over wireless adb.
# Serial is pinned: `adb devices | head -1` would grab whatever is attached, and this
# phone is the coordinator's daily device, not a disposable bench board.
export SER=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
LAB=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-oracle-m5
OUT=$LAB/raw; TMPD=/tmp/s23m5; mkdir -p "$OUT" "$TMPD"
APP=com.kalsa.app
APK=/tmp/apk-38975826380/kalsa-apk-arm64-v8a-debuggable-8b89c09436ea1fd5c8ac65ef7893bf18e16612bb/app-release.apk
APK_SHA=1e27ba67fcc18851c08123c6b4885aa72249cbaedb596521d6b98fa95cd9cab5
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
MODEL_SIZE=1593894944; MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf
# Stop rules from the task frame: thermal status and level are live reads, never faked.
STOP_BATT_C=${STOP_BATT_C:-42.0}; STOP_TSTAT=${STOP_TSTAT:-3}; STOP_LEVEL=${STOP_LEVEL:-30}

adb get-state -s "$SER" >/dev/null 2>&1 || { echo "S23 NOT ATTACHED ($SER): STOP"; return 2 2>/dev/null || exit 2; }
adb -s "$SER" shell getprop ro.product.model 2>/dev/null | tr -d '\r' | grep -qx SM-S911U || {
  echo "wrong device on $SER: STOP"; return 2 2>/dev/null || exit 2; }
ad() { perl -e 'alarm shift; exec @ARGV or exit 127' "${ADT:-90}" adb -s "$SER" "$@"; }

# --- temperatures (C). The S23 exposes no skin kernel zone, so skin comes from the HAL list;
# skin-id.sh pins which mName=SKIN entry is live. The NPU/GPU legs are kernel zones and are
# read as min() over their group, matching the app's own headroom rule (governorInputs.ts:467).
SKIN_IDX=$(cat "$OUT/skin-index.txt" 2>/dev/null)
# One adb round trip for every sensor, so a sample is coherent and costs ~1 s instead of seven
# trips: the monitor has to hold a 10 s cadence and the NPU moves several degrees per turn.
snapshot() { ad shell '
  dumpsys power | grep -m1 -o "mWakefulness=[A-Za-z]*"
  dumpsys battery | grep -E "^  (AC powered|USB powered|Wireless powered|level|temperature)"
  dumpsys thermalservice | grep -m1 "Thermal Status"
  dumpsys thermalservice | grep -i "mName=SKIN" | grep -v Threshold | sed -n "s/.*mValue=\([0-9.]*\).*/SKIN \1/p"
  for z in /sys/class/thermal/thermal_zone*; do t=$(cat $z/type 2>/dev/null); case $t in nspss-*|gpuss-*) echo "Z $t $(cat $z/temp 2>/dev/null)";; esac; done
' 2>/dev/null | tr -d '\r'; }
# Parsed into key=value. SKIN takes the skin-id.sh-pinned entry; a zone group takes min() over
# its members, which is the same choice the app's own NPU headroom rule makes.
snapshot_kv() { snapshot | awk -v idx="${SKIN_IDX:-1}" '
  $1=="SKIN" { if (++ns == idx) skin=$2 }
  $1=="Z" && $2 ~ /^nspss-/ { if (npu=="" || $3+0 < npu) npu=$3+0 }
  $1=="Z" && $2 ~ /^gpuss-/ { if (gpu=="" || $3+0 < gpu) gpu=$3+0 }
  /^mWakefulness=/ { split($0,a,"="); wake=a[2] }
  /^Thermal/ { tstat=$NF }
  $1=="level:" { lvl=$2 }
  $1=="temperature:" { tb=$2 }
  $2=="powered:" && $3=="true" { plug=plug $1 }
  END { printf "wake=%s skin=%s npu=%s gpu=%s batt=%s lvl=%s tstat=%s plug=%s",
    wake, (skin==""?"NA":skin), (npu==""?"NA":npu/1000), (gpu==""?"NA":gpu/1000),
    (tb==""?"NA":sprintf("%.1f",tb/10)), (lvl==""?"NA":lvl), (tstat==""?"NA":tstat), (plug==""?"none":plug) }'; }
skin_c() { snapshot_kv | sed -n 's/.*skin=\([^ ]*\).*/\1/p'; }
npu_c() { snapshot_kv | sed -n 's/.*npu=\([^ ]*\).*/\1/p'; }   # nspss-0..3, Hexagon/HTP
gpu_c() { snapshot_kv | sed -n 's/.*gpu=\([^ ]*\).*/\1/p'; }   # gpuss-0..7
batt_c() { snapshot_kv | sed -n 's/.*batt=\([^ ]*\).*/\1/p'; }
batt_lvl() { snapshot_kv | sed -n 's/.*lvl=\([^ ]*\).*/\1/p'; }
plugged() { snapshot_kv | sed -n 's/.*plug=\(.*\)/\1/p'; }
tstat() { snapshot_kv | sed -n 's/.*tstat=\([^ ]*\).*/\1/p'; }
wakefulness() { snapshot_kv | sed -n 's/^wake=\([^ ]*\).*/\1/p'; }
# One snapshot line, used by the monitor so every decision is auditable from one file.
thermo_line() { snapshot_kv; }
# Stop rule over a snapshot line: returns 0 with the reason when the turn must die. Charging is
# recorded, never faked — the S23 has a real thermistor and faking it would void the heat numbers.
stop_reason() { local l=$1 b t lv p
  b=$(sed -n 's/.* batt=\([^ ]*\).*/\1/p' <<<"$l"); t=$(sed -n 's/.*tstat=\([^ ]*\).*/\1/p' <<<"$l")
  lv=$(sed -n 's/.* lvl=\([^ ]*\).*/\1/p' <<<"$l"); p=$(sed -n 's/.*plug=\(.*\)/\1/p' <<<"$l")
  awk "BEGIN{exit !($b >= $STOP_BATT_C)}" 2>/dev/null && { echo "battery ${b}C >= ${STOP_BATT_C}C"; return 0; }
  [ "$t" != NA ] && [ "$t" -ge "$STOP_TSTAT" ] && { echo "thermal status $t >= $STOP_TSTAT"; return 0; }
  [ "$p" = none ] && [ "$lv" != NA ] && [ "$lv" -lt "$STOP_LEVEL" ] && { echo "level ${lv}% < ${STOP_LEVEL}% unplugged"; return 0; }
  return 1; }

# center of a node by exact text/content-desc in a uiautomator dump file
center() { tr '>' '\n' < "$2" | grep -E "(content-desc|text)=\"$1\"" | sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1 | awk '{printf "%d %d", ($1+$3)/2, ($2+$4)/2}'; }
dump_ui() { local d="$1" i; for i in 1 2 3 4 5; do rm -f "$d"; ad shell "rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null 2>&1"; ad shell cat /sdcard/ui.xml 2>/dev/null | tr -d '\r' > "$d"; grep -q "<hierarchy" "$d" && return 0; sleep 3; done; return 1; }