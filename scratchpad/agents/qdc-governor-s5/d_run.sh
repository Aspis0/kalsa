#!/bin/bash
# S5 QDC driver; app-data operations use run-as, while /data chmod is outside the app path.
set -u
export LC_ALL=C ANDROID_ADB_SERVER_PORT=6037 IME_SUSPEND=1
if [ "$#" -ne 3 ]; then
  echo "usage: /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/d_run.sh <job_id> <apk_path> <arm_order>" >&2
  exit 2
fi
JOB="$1"; APK="$2"; ARM_ORDER="$3"
case "$JOB" in ''|*[!A-Za-z0-9._-]*) echo "invalid job_id" >&2; exit 2;; esac
case "$APK" in /*) ;; *) echo "apk_path must be absolute" >&2; exit 2;; esac
[ "$ARM_ORDER" = ABABABAB ] || { echo "arm_order must be ABABABAB" >&2; exit 2; }
OUT="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5"
RAW="$OUT/raw/$JOB"; mkdir -p "$RAW"
ADB_LOG="$RAW/adb-exit.log"; DRIVER_LOG="$RAW/driver.log"; RESULTS="$RAW/results.tsv"; END_MARKER="$RAW/END.txt"; : > "$ADB_LOG"; : > "$DRIVER_LOG"
printf 'arm\tturn\tttft_ms\tdecode_tps\tengine_prefill\tengine_decode\tthermal_state\tskin_c_before\tskin_c_after\tfallback_count\tlmkd_count\tids_sha\toracle\n' > "$RESULTS"
PKG=com.kalsa.app
MODEL="/Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"; MODEL_SIZE=1593894944
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf
DEVICE_TMP=/data/local/tmp/kalsa-s5; MODEL_REMOTE="$DEVICE_TMP/$MODEL_FILE"
START_EPOCH=$(date +%s); DEADLINE_EPOCH=$((START_EPOCH + 2400)); END_WRITTEN=0
SER=""; HOLDER_PID=0; SCREEN_OFF_TIMEOUT=""; SCREEN_OFF_TIMEOUT_SAVED=0; IME_SAVED=""; IME_SUSPENDED=0
FIRST_SKIN_C=""; PREV_SKIN=""; PREV_TIME=0; THERMO_JSON=""; MEM_BEFORE_KB=""; MEM_AFTER_KB=""; APP_PID=""; ANCHOR_EPOCH=0; SEND_ANCHOR_EPOCH=0; ANCHOR_STAMP=""; A_IDS_FILE=""; A_IDS_VALID=0
log() { echo "[$(date +%H:%M:%S)] $*"; }
write_end() { [ "$END_WRITTEN" -eq 1 ] || { printf 'END reason=%s\n' "$1" > "$END_MARKER"; END_WRITTEN=1; }; }
deadline_check() { [ "$(date +%s)" -lt "$DEADLINE_EPOCH" ] || { log "DEADLINE_40_MIN"; write_end deadline_40_min; exit 124; }; }
adbT() {
  local seconds="$1" rc argline="" arg
  shift
  /usr/bin/perl -e 'alarm shift; exec @ARGV or exit 127' "$seconds" /opt/homebrew/bin/adb "$@"
  rc=$?
  for arg in "$@"; do printf -v argline '%s %q' "$argline" "$arg"; done
  printf 'rc=%s%s\n' "$rc" "$argline" >> "$ADB_LOG"
  return "$rc"
}
logcat_all() { adbT "$1" -s "$SER" logcat -v epoch -d -b all > "$2" 2>&1; }
wake_sequence() {
  adbT 60 -s "$SER" shell locksettings set-disabled true >> "$RAW/wake.log" 2>&1 || true
  adbT 60 -s "$SER" shell input keyevent KEYCODE_WAKEUP >> "$RAW/wake.log" 2>&1 || true
  adbT 60 -s "$SER" shell wm dismiss-keyguard >> "$RAW/wake.log" 2>&1 || true
  adbT 60 -s "$SER" shell svc power stayon true >> "$RAW/wake.log" 2>&1 || true
  adbT 60 -s "$SER" shell settings put system screen_off_timeout 1800000 >> "$RAW/wake.log" 2>&1 || true
}
device_wake() {
  if [ "$SCREEN_OFF_TIMEOUT_SAVED" -eq 0 ]; then
    SCREEN_OFF_TIMEOUT_SAVED=1
    SCREEN_OFF_TIMEOUT=$(adbT 60 -s "$SER" shell settings get system screen_off_timeout | tr -d '\r')
  fi
  wake_sequence
  adbT 60 -s "$SER" shell dumpsys power >> "$RAW/wake.log" 2>&1 || true
}
wake_state() { sed -n 's/.*mWakefulness=\([^, ]*\).*/\1/p' "$1" | head -1 | tr -d '\r'; }
ensure_awake() {
  local prefix="$1" first second
  adbT 60 -s "$SER" shell dumpsys power > "${prefix}_wake_before.txt" 2>&1 || return 1
  first=$(wake_state "${prefix}_wake_before.txt")
  if [ "${first:-missing}" != Awake ]; then wake_sequence; fi
  adbT 60 -s "$SER" shell dumpsys power > "${prefix}_wake_after.txt" 2>&1 || return 1
  second=$(wake_state "${prefix}_wake_after.txt")
  printf 'before=%s\nafter=%s\n' "${first:-missing}" "${second:-missing}" > "${prefix}_wakefulness.txt"
  [ "${second:-missing}" = Awake ] || return 1
}
restore_device() { [ -n "$SER" ] || return 0; adbT 60 -s "$SER" shell svc power stayon false >/dev/null 2>&1 || true; adbT 60 -s "$SER" shell locksettings set-disabled false >/dev/null 2>&1 || true; [ -n "$SCREEN_OFF_TIMEOUT" ] && adbT 60 -s "$SER" shell settings put system screen_off_timeout "$SCREEN_OFF_TIMEOUT" >/dev/null 2>&1 || true; }
restore_ime() { [ "$IME_SUSPENDED" -eq 1 ] || return 0; IME_SUSPENDED=0; adbT 60 -s "$SER" shell ime enable "$IME_SAVED" >/dev/null 2>&1 || true; adbT 60 -s "$SER" shell ime set "$IME_SAVED" >/dev/null 2>&1 || true; }
holder_loop() { while :; do adbT 60 -s "$SER" shell chmod 771 /data >> "$RAW/holder.log" 2>&1 || true; sleep 2; done; }
stop_holder() { [ "$HOLDER_PID" -ne 0 ] && { kill "$HOLDER_PID" 2>/dev/null || true; wait "$HOLDER_PID" 2>/dev/null || true; HOLDER_PID=0; }; }
cleanup() { local rc=$?; restore_ime; restore_device; stop_holder; [ -n "$SER" ] && adbT 120 -s "$SER" shell "am force-stop $PKG" >/dev/null 2>&1 || true; write_end "exit_$rc"; }
trap cleanup EXIT INT TERM
SER=$(adbT 60 devices | awk 'NR > 1 && $2 == "device" { print $1; exit }' | tr -d '\r')
[ -n "$SER" ] || { log "NO_DEVICE on 6037"; exit 2; }
adbT 60 -s "$SER" wait-for-device > "$RAW/wait_for_device.txt" 2>&1 || { log "WAIT_FOR_DEVICE_FAIL"; exit 2; }
{
  echo "serial=$SER"; echo "port=$ANDROID_ADB_SERVER_PORT"; echo "ro.soc.model"
  adbT 60 -s "$SER" shell getprop ro.soc.model
  echo "ro.product.model"; adbT 60 -s "$SER" shell getprop ro.product.model
  echo "ro.build.fingerprint"; adbT 60 -s "$SER" shell getprop ro.build.fingerprint
  echo "ro.build.type"; adbT 60 -s "$SER" shell getprop ro.build.type
  echo "ro.debuggable"; adbT 60 -s "$SER" shell getprop ro.debuggable
  echo "id"; adbT 60 -s "$SER" shell id
} > "$RAW/recon.txt" 2>&1
SOC=$(adbT 60 -s "$SER" shell getprop ro.soc.model | tr -d '\r')
case "$SOC" in
  SM8650|QRD8650) BOARD=QRD8650 ;;
  SM8750|QRD8750) BOARD=8-Elite ;;
  *) log "UNSUPPORTED_SOC=$SOC"; exit 6 ;;
esac
holder_loop & HOLDER_PID=$!; sleep 1
thermal_record() {
  local name="$1"; local file="$RAW/${name}_thermal.txt"; local gate="${file%.txt}_gate.txt"; local rc skin max_temp thermal_status
  adbT 90 -s "$SER" shell dumpsys thermalservice > "$file" 2>&1; rc=$?
  awk '/Current temperatures from HAL/{f=1} f{print} /Current cooling devices from HAL/{f=0}' "$file" > "$gate"
  grep 'Thermal Status:' "$file" | head -1 >> "$gate"
  max_temp=$(grep -o 'mValue=[0-9.]*' "$gate" | cut -d= -f2 | sort -n | tail -1)
  thermal_status=$(grep 'Thermal Status:' "$file" | head -1 | grep -o '[0-9]*' | head -1)
  printf 'max_hal_temp=%s status=%s\n' "$max_temp" "$thermal_status" >> "$gate"
  skin=$(sed -n 's/.*mValue=\([0-9][0-9.]*\), mType=3, mName=skin.*/\1/p' "$file" | head -1 | tr -d '\r')
  awk -v v="$skin" 'BEGIN { exit !(v ~ /^[0-9]+([.][0-9]+)?$/ && v < 42.0) }' >/dev/null 2>&1 || rc=1
  [ "$rc" -eq 0 ] || return 1
  printf '%s' "$skin"
}
make_thermo() {
  local skin="$1" now trend tenths
  now=$(date +%s)
  if [ "$PREV_TIME" -gt 0 ]; then
    trend=$(awk -v a="$skin" -v b="$PREV_SKIN" -v d="$((now-PREV_TIME))" 'BEGIN{if(d>0)printf "%.3f",(a-b)/(d/60);else print "0.000"}')
  else
    trend=0.000
  fi
  tenths=$(awk -v v="$skin" 'BEGIN{printf "%.0f",v*10}')
  THERMO_JSON=$(printf '{"batt_temp_tenths_c":%s,"batt_level_pct":100,"plugged":false,"sensor_valid":true,"t_idle_valid":true,"t_idle_c":%s,"trend_c_per_min":%s}' "$tenths" "$FIRST_SKIN_C" "$trend")
  PREV_SKIN="$skin"; PREV_TIME="$now"
}
model_setup() {
  local local_sha device_sha size rc
  [ -f "$MODEL" ] || { log "MODEL_MISSING=$MODEL"; return 1; }
  local_sha=$(/usr/bin/shasum -a 256 "$MODEL" | awk '{print $1}')
  size=$(wc -c < "$MODEL" | tr -d '[:space:]')
  if [ "$local_sha" != "$MODEL_SHA" ] || [ "$size" != "$MODEL_SIZE" ]; then
    log "LOCAL_MODEL_IDENTITY_FAIL sha=$local_sha size=$size"
    return 1
  fi
  adbT 60 -s "$SER" shell "mkdir -p $DEVICE_TMP" >/dev/null 2>&1 || return 1
  device_sha=$(adbT 300 -s "$SER" shell "sha256sum $MODEL_REMOTE 2>/dev/null" | awk '{print $1}' | tr -d '\r')
  if [ "$device_sha" != "$MODEL_SHA" ]; then
    adbT 600 -s "$SER" push "$MODEL" "$MODEL_REMOTE" > "$RAW/model_push.txt" 2>&1
    rc=$?; [ "$rc" -eq 0 ] || return 1
    device_sha=$(adbT 300 -s "$SER" shell "sha256sum $MODEL_REMOTE" | awk '{print $1}' | tr -d '\r')
  fi
  [ "$device_sha" = "$MODEL_SHA" ] || { log "DEVICE_MODEL_SHA_FAIL=$device_sha"; return 1; }
  adbT 60 -s "$SER" shell "chmod 644 $MODEL_REMOTE" > "$RAW/model_chmod.txt" 2>&1
}
copy_model() {
  local prefix="$1" stat_out size
  adbT 300 -s "$SER" shell "run-as $PKG sh -c 'mkdir -p files/models/$MODEL_DIR && cp $MODEL_REMOTE files/models/$MODEL_DIR/$MODEL_FILE'" > "${prefix}_model_copy.txt" 2>&1 || return 1
  stat_out=$(adbT 60 -s "$SER" shell "run-as $PKG stat -c %s files/models/$MODEL_DIR/$MODEL_FILE" 2>&1)
  printf '%s\n' "$stat_out" >> "${prefix}_model_copy.txt"
  size=$(printf '%s' "$stat_out" | tr -d '[:space:]')
  [ "$size" = "$MODEL_SIZE" ]
}
pull_rkstorage() {
  local dir="$1"
  adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage > "$dir/RKStorage" 2> "$dir/pull.err" || return 1
  if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage-wal" >/dev/null 2>&1; then adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage-wal > "$dir/RKStorage-wal" 2>> "$dir/pull.err" || return 1; fi
  if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage-shm" >/dev/null 2>&1; then adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage-shm > "$dir/RKStorage-shm" 2>> "$dir/pull.err" || return 1; fi
}
bootstrap_db() {
  local prefix="$1" i
  device_wake
  adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" > "${prefix}_bootstrap.txt" 2>&1 || true
  sleep 25
  adbT 60 -s "$SER" shell "am force-stop $PKG" >> "${prefix}_bootstrap.txt" 2>&1 || true
  for i in 1 2; do
    if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage" >/dev/null 2>&1; then return 0; fi
    if [ "$i" -eq 1 ]; then
      device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" >> "${prefix}_bootstrap.txt" 2>&1 || true
      sleep 25; adbT 60 -s "$SER" shell "am force-stop $PKG" >> "${prefix}_bootstrap.txt" 2>&1 || true
    fi
  done
  return 1
}
set_prefs() {
  local flag="$1" dir remote
  dir=$(mktemp -d /tmp/kalsa-s5-rkstorage.XXXXXX) || return 1
  pull_rkstorage "$dir" || { rm -rf "$dir"; return 1; }
  /usr/bin/sqlite3 -bail "$dir/RKStorage" "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR'),('kalsa.governor.enabled','$flag'),('kalsa.bench.thermo','$THERMO_JSON'),('kalsa.bench.sampling','greedy');" >/dev/null || { rm -rf "$dir"; return 1; }
  /usr/bin/sqlite3 -bail "$dir/RKStorage" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null || { rm -rf "$dir"; return 1; }
  remote="$DEVICE_TMP/rkstorage-$JOB-$$"
  if ! adbT 300 -s "$SER" push "$dir/RKStorage" "$remote" >/dev/null 2>&1 || ! adbT 120 -s "$SER" shell "run-as $PKG cp $remote databases/RKStorage" >/dev/null 2>&1 || ! adbT 60 -s "$SER" shell "run-as $PKG rm -f databases/RKStorage-wal databases/RKStorage-shm" >/dev/null 2>&1; then
    adbT 60 -s "$SER" shell "rm -f $remote" >/dev/null 2>&1 || true
    rm -rf "$dir"
    return 1
  fi
  adbT 60 -s "$SER" shell "rm -f $remote" >/dev/null 2>&1 || true
  rm -rf "$dir"
}
fresh_install() {
  local prefix="$1" uninstall_rc list_rc adb_list_rc package_count package_output rc flags
  adbT 120 -s "$SER" shell "pm uninstall $PKG" > "${prefix}_uninstall_old.txt" 2>&1
  uninstall_rc=$?
  package_output=$(adbT 60 -s "$SER" shell "pm list packages | grep -c com.kalsa.app; list_rc=\$?; printf 'list_rc=%s\\n' \"\$list_rc\"" 2> "${prefix}_package_check.txt")
  adb_list_rc=$?; printf '%s\n' "$package_output" > "${prefix}_package_count.txt"
  package_count=$(printf '%s\n' "$package_output" | sed -n '1p' | tr -d '\r[:space:]'); list_rc=$(printf '%s\n' "$package_output" | sed -n 's/.*list_rc=//p' | tr -d '\r[:space:]')
  printf 'uninstall_rc=%s package_count=%s list_rc=%s adb_list_rc=%s\n' "$uninstall_rc" "$package_count" "$list_rc" "$adb_list_rc" >> "${prefix}_uninstall_old.txt"
  [ "$uninstall_rc" -eq 0 ] && [ "$adb_list_rc" -eq 0 ] && [ "$list_rc" -eq 1 ] && [ "${package_count:-1}" = 0 ] || return 1
  /usr/bin/shasum -a 256 "$APK" > "${prefix}_apk_sha.txt" 2>&1
  adbT 300 -s "$SER" install -r "$APK" > "${prefix}_install.txt" 2>&1
  rc=$?; [ "$rc" -eq 0 ] || return 1
  adbT 60 -s "$SER" shell "pm dump $PKG" > "${prefix}_pm_dump.txt" 2>&1 || true
  adbT 60 -s "$SER" shell "dumpsys package $PKG | grep -i flags" > "${prefix}_flags.txt" 2>&1
  flags=$(cat "${prefix}_flags.txt")
  printf 'application-debuggable required; flags=%s\n' "$flags" >> "${prefix}_apk_sha.txt"
  printf '%s' "$flags" | grep -qi DEBUGGABLE
}
MODEL_LOAD_PATTERN='llama_model_loader: loaded meta data with .* from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf'; PREWARM_PATTERN='KALSA_PREWARM.*"op":"done"'
has_load_proof() { grep -E "$MODEL_LOAD_PATTERN" "$1" >/dev/null 2>&1 && grep -E "$PREWARM_PATTERN" "$1" >/dev/null 2>&1; }
count_after() { awk -v a="$ANCHOR_EPOCH" -v m="$1" '$1+0>=a&&index($0,m)>0{n++}END{print n+0}' "$2"; }
count_lmkd_after() { awk -v a="$ANCHOR_EPOCH" -v p="$APP_PID" '$1+0>=a&&$0~/(lmkd|am_kill|lowmemorykiller)/&&(index($0,"com.kalsa.app")>0||(p!=""&&index($0,p)>0)){n++}END{print n+0}' "$1"; }
last_json_after() { awk -v a="$ANCHOR_EPOCH" -v m="$1" '$1+0>=a&&index($0,m)>0{x=$0}END{sub(".*"m,"",x);sub(/^[[:space:]]+/,"",x);print x}' "$2"; }
json_field() { local json="$1"; local key="$2"; [ -n "$json" ] || return 0; printf '%s' "$json" | /usr/bin/perl -MJSON::PP -e '$k=shift;$t=do{local $/;<STDIN>};eval{$v=decode_json($t)->{$k};print defined($v)?$v:""}' "$key"; }
parse_tokens() { local json="$1"; local out="$2"; printf '%s' "$json" | /usr/bin/perl -MJSON::PP -e '$o=decode_json(do{local $/;<STDIN>});die unless ref($o->{ids}) eq "ARRAY"&&defined($o->{n})&&$o->{n}>=32&&@{$o->{ids}}>=32;for $i(0..31){$v=$o->{ids}[$i];die unless defined($v)&&"$v"=~/^-?[0-9]+$/;print "$v\n"}' > "$out" 2>/dev/null; }
telemetry_complete() {
  local j n
  j=$(last_json_after KALSA_TELEMETRY "$1"); n=$(json_field "$j" tokensPredicted)
  awk -v n="$n" 'BEGIN{exit !(n ~ /^[0-9]+([.][0-9]+)?$/&&n>=1)}' >/dev/null 2>&1
}
memory_before() { local prefix="$1"; local file="${prefix}_meminfo_before.txt"; adbT 60 -s "$SER" shell "cat /proc/meminfo | head -3" > "$file" 2>&1 || return 1; MEM_BEFORE_KB=$(sed -n 's/^MemAvailable:[[:space:]]*\([0-9][0-9]*\) kB.*/\1/p' "$file" | head -1 | tr -d '\r'); [ -n "$MEM_BEFORE_KB" ]; }
memory_after() { local prefix="$1"; local file="${prefix}_meminfo_after.txt"; adbT 60 -s "$SER" shell "cat /proc/meminfo | head -3" > "$file" 2>&1 || return 1; adbT 90 -s "$SER" shell "dumpsys meminfo $PKG | head -25" > "${prefix}_appmem_after.txt" 2>&1 || return 1; MEM_AFTER_KB=$(sed -n 's/^MemAvailable:[[:space:]]*\([0-9][0-9]*\) kB.*/\1/p' "$file" | head -1 | tr -d '\r'); [ -n "$MEM_BEFORE_KB" ] && [ -n "$MEM_AFTER_KB" ] || return 1; printf 'MEM before=%s after=%s\n' "$MEM_BEFORE_KB" "$MEM_AFTER_KB" | tee -a "$DRIVER_LOG"; }
lmkd_all_after() { local file="$1"; local out="$2"; awk -v a="$ANCHOR_EPOCH" '($1+0)>=a&&tolower($0)~/lmkd|lowmemorykiller/&&tolower($0)~/kill/{print}' "$file" > "$out"; }
poll_load() {
  local file="$1" elapsed=0
  : > "$file"
  while [ "$elapsed" -lt 300 ]; do
    deadline_check; logcat_all 60 "$file" || true
    has_load_proof "$file" && return 0
    sleep 5; elapsed=$((elapsed + 5))
  done
  logcat_all 60 "$file" || true; has_load_proof "$file"
}
poll_telemetry() {
  local file="$1" elapsed=0
  while [ "$elapsed" -lt 600 ]; do
    deadline_check; logcat_all 60 "$file" || true
    telemetry_complete "$file" && return 0
    sleep 5; elapsed=$((elapsed + 5))
  done
  logcat_all 60 "$file" || true; telemetry_complete "$file"
}
clear_anchor() {
  local prefix="$1"
  adbT 60 -s "$SER" logcat -b all -c > "${prefix}_clear.txt" 2>&1 || return 1
  adbT 60 -s "$SER" shell "date +%s" > "${prefix}_anchor_epoch.txt" 2>&1 || return 1
  adbT 60 -s "$SER" shell "date '+%m-%d %H:%M:%S.000'" > "${prefix}_anchor_stamp.txt" 2>&1 || return 1
  ANCHOR_EPOCH=$(cat "${prefix}_anchor_epoch.txt" | tr -d '\r[:space:]')
  ANCHOR_STAMP=$(cat "${prefix}_anchor_stamp.txt" | tr -d '\r')
  awk -v a="$ANCHOR_EPOCH" 'BEGIN{exit !(a ~ /^[0-9]+$/)}' >/dev/null 2>&1
}
dump_ui() {
  local out="$1"
  adbT 60 -s "$SER" shell "uiautomator dump $DEVICE_TMP/ui.xml >/dev/null 2>&1" || return 1
  adbT 60 -s "$SER" shell "cat $DEVICE_TMP/ui.xml" > "$out" 2>&1 || return 1
  tr -d '\r' < "$out" > "$out.tmp" && mv "$out.tmp" "$out"
  [ -s "$out" ]
}
bounds_edit() { tr '>' '\n' < "$1" | grep 'class="android.widget.EditText"' | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1; }
bounds_send() { tr '>' '\n' < "$1" | grep -E 'content-desc="Send"|text="Send"' | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1; }
tap_bounds() {
  local b="$1" x1 y1 x2 y2
  read -r x1 y1 x2 y2 <<< "$b"
  adbT 60 -s "$SER" shell input tap "$(((x1 + x2) / 2))" "$(((y1 + y2) / 2))"
}
PROMPT='Reply with one short sentence about mountains'
type_prompt() {
  local -a words; local word first=1
  read -r -a words <<< "$PROMPT"
  for word in "${words[@]}"; do
    [ "$first" -eq 1 ] || adbT 60 -s "$SER" shell input keyevent 62 || return 1
    adbT 60 -s "$SER" shell input text "$word" || return 1
    first=0
  done
}
ime_suspend() {
  [ "$IME_SUSPEND" = 1 ] && [ "$IME_SUSPENDED" -eq 0 ] || return 0
  IME_SAVED=$(adbT 60 -s "$SER" shell settings get secure default_input_method | tr -d '\r')
  [ -n "$IME_SAVED" ] && [ "$IME_SAVED" != null ] || return 0
  adbT 60 -s "$SER" shell "ime disable $IME_SAVED" >/dev/null 2>&1 && IME_SUSPENDED=1 || true
}
run_observation() {
  local arm="$1" turn="$2"; local prefix="$RAW/${BOARD}_${arm}_t${turn}"; local logcat="${prefix}_logcat_all.txt"; local flag skin_before=na skin_after=na thermo="" status=0 load_rc=1 telemetry_rc=1 edit_bounds send_bounds
  local telemetry governor bench ttft=na decode=na prefill=na decode_engine=na thermal=na commit_bytes=na commit_ms=na thermo_source=na fallback=0 lmkd=0 governor_count=0 ids_sha=na oracle=na n=na runtime_prereq=0; local ids_file="${prefix}_ids.txt"
  deadline_check; fresh_install "$prefix" || status=1; [ "$status" -eq 0 ] && copy_model "$prefix" || status=1; [ "$status" -eq 0 ] && bootstrap_db "$prefix" || status=1
  flag=0; [ "$arm" = B ] && flag=1
  if [ "$status" -eq 0 ]; then skin_before=$(thermal_record "$(basename "$prefix")_before") || { skin_before=na; status=1; }; [ "$status" -eq 0 ] && make_thermo "$skin_before"; thermo="$THERMO_JSON"; [ "$status" -eq 0 ] && set_prefs "$flag" || status=1; fi
  if [ "$status" -eq 0 ]; then
    memory_before "$prefix" || status=1; clear_anchor "$prefix" || status=1; device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" > "${prefix}_launch.txt" 2>&1 || status=1; APP_PID=$(adbT 60 -s "$SER" shell pidof "$PKG" | awk 'NR==1{print $1;exit}' | tr -d '\r')
    [ "$status" -eq 0 ] && poll_load "${prefix}_load.txt"; load_rc=$?; [ "$load_rc" -eq 0 ] || status=1
    [ "$load_rc" -eq 0 ] && memory_after "$prefix" || status=1
    if [ "$load_rc" -eq 0 ] && [ "$status" -eq 0 ]; then device_wake; ime_suspend; dump_ui "${prefix}_edit.xml" && edit_bounds=$(bounds_edit "${prefix}_edit.xml") || edit_bounds=""; [ -n "$edit_bounds" ] && tap_bounds "$edit_bounds" && type_prompt || status=1; fi
    if [ "$status" -eq 0 ]; then ensure_awake "$prefix" || status=1; fi
    if [ "$status" -eq 0 ]; then dump_ui "${prefix}_send.xml" && send_bounds=$(bounds_send "${prefix}_send.xml") || send_bounds=""; if [ -n "$send_bounds" ]; then adbT 60 -s "$SER" shell "date +%s" > "${prefix}_send_anchor_epoch.txt" 2>&1 && SEND_ANCHOR_EPOCH=$(cat "${prefix}_send_anchor_epoch.txt" | tr -d '\r[:space:]') && awk -v a="$SEND_ANCHOR_EPOCH" 'BEGIN{exit !(a ~ /^[0-9]+$/)}' >/dev/null 2>&1 || status=1; else status=1; fi; [ "$status" -eq 0 ] && tap_bounds "$send_bounds" || status=1; fi
    [ "$status" -eq 0 ] && poll_telemetry "$logcat"; telemetry_rc=$?; if [ "$telemetry_rc" -eq 0 ]; then sleep 2; logcat_all 60 "$logcat" || true; fi; [ -f "$logcat" ] || logcat_all 300 "$logcat" || true
  fi
  lmkd_all_after "$logcat" "${prefix}_lmkd_all.txt" || status=1; skin_after=$(thermal_record "$(basename "$prefix")_after") || { skin_after=na; status=1; }; grep -E 'KALSA_|llama_model_loader' "$logcat" > "${prefix}_filtered.txt" 2>/dev/null || true
  fallback=$(count_after 'KALSA_GOVERNOR_FALLBACK' "$logcat"); lmkd=$(count_lmkd_after "$logcat"); telemetry=$(last_json_after KALSA_TELEMETRY "$logcat"); governor=$(last_json_after 'KALSA_GOVERNOR ' "$logcat"); bench=$(last_json_after 'KALSA_BENCH_TOKENS ' "$logcat")
  ttft=$(json_field "$telemetry" promptMs); decode=$(json_field "$telemetry" predictedPerSecond); prefill=$(json_field "$governor" engine_prefill); decode_engine=$(json_field "$governor" engine_decode); thermal=$(json_field "$governor" thermal_state); commit_bytes=$(json_field "$governor" commit_bytes); commit_ms=$(json_field "$governor" commit_ms); thermo_source=$(json_field "$governor" thermo_source); governor_count=$(awk -v a="$SEND_ANCHOR_EPOCH" '$1+0>=a&&index($0,"KALSA_GOVERNOR ")>0{n++}END{print n+0}' "$logcat"); n=$(json_field "$bench" n)
  [ -n "$ttft" ] || ttft=na; [ -n "$decode" ] || decode=na; [ -n "$prefill" ] || prefill=na; [ -n "$decode_engine" ] || decode_engine=na; [ -n "$thermal" ] || thermal=na; [ -n "$commit_bytes" ] || commit_bytes=na; [ -n "$commit_ms" ] || commit_ms=na; [ -n "$thermo_source" ] || thermo_source=na; [ -n "$n" ] || n=na
  if [ -n "$bench" ] && parse_tokens "$bench" "$ids_file"; then ids_sha=$(/usr/bin/shasum -a 256 "$ids_file" | awk '{print $1}'); else printf 'VOID n=%s\n' "$n" > "$ids_file"; fi
  if [ "$arm" = A ]; then A_IDS_FILE="$ids_file"; [ "$ids_sha" = na ] && A_IDS_VALID=0 || A_IDS_VALID=1; else if [ "$ids_sha" = na ] || [ "$A_IDS_VALID" -ne 1 ]; then oracle=VOID; elif diff -q "$A_IDS_FILE" "$ids_file" >/dev/null 2>&1; then oracle=PASS; else oracle=FAIL; fi; fi
  if [ "$arm" = A ] && [ "$turn" = 1 ] && [ -z "$bench" ]; then runtime_prereq=1; printf 'PREREQUISITE OPEN: missing KALSA_BENCH_TOKENS after first turn; app sampling contract is absent.\n' > "$RAW/PREREQUISITE.txt"; fi
  if [ "$arm" = B ]; then [ "$fallback" -eq 0 ] || status=1; [ "$prefill" = GPU ] && [ "$decode_engine" = CPU ] || status=1; [ "$thermal" != na ] || status=1; [ "$governor_count" -eq 1 ] || status=1; [ "$thermo_source" = bench-skin ] || status=1; awk -v v="$commit_bytes" 'BEGIN{exit !(v ~ /^[0-9]+([.][0-9]+)?$/)}' >/dev/null 2>&1 || status=1; awk -v v="$commit_ms" 'BEGIN{exit !(v ~ /^[0-9]+([.][0-9]+)?$/)}' >/dev/null 2>&1 || status=1; fi
  [ "$lmkd" -eq 0 ] || status=1; printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$arm" "$turn" "$ttft" "$decode" "$prefill" "$decode_engine" "$thermal" "$skin_before" "$skin_after" "$fallback" "$lmkd" "$ids_sha" "$oracle" | tee -a "$RESULTS"; printf 'status=%s thermo=%s governor_count=%s commit_bytes=%s commit_ms=%s thermo_source=%s anchor_epoch=%s anchor_stamp=%s telemetry_rc=%s\n' "$status" "$thermo" "$governor_count" "$commit_bytes" "$commit_ms" "$thermo_source" "$ANCHOR_EPOCH" "$ANCHOR_STAMP" "$telemetry_rc" > "${prefix}_status.txt"
  adbT 60 -s "$SER" shell "am force-stop $PKG" > "${prefix}_force_stop.txt" 2>&1 || status=1; adbT 120 -s "$SER" shell "pm uninstall $PKG" > "${prefix}_uninstall.txt" 2>&1; [ "$?" -eq 0 ] || status=1
  [ "$runtime_prereq" -eq 0 ] || exit 3; return "$status"
}
FIRST_SKIN_C=$(thermal_record session_pre) || { log "NO_VALID_INITIAL_SKIN"; exit 6; }; PREV_SKIN="$FIRST_SKIN_C"; PREV_TIME=$(date +%s); model_setup || exit 5; FINAL_RC=0; A_TURN=0; B_TURN=0
for ((i=0; i<${#ARM_ORDER}; i++)); do deadline_check; arm="${ARM_ORDER:i:1}"; if [ "$arm" = A ]; then A_TURN=$((A_TURN+1)); turn="$A_TURN"; else B_TURN=$((B_TURN+1)); turn="$B_TURN"; fi; run_observation "$arm" "$turn" || { FINAL_RC=1; log "ABORT arm=$arm turn=$turn"; break; }; done
log "DONE board=$BOARD final_rc=$FINAL_RC results=$RESULTS"; exit "$FINAL_RC"
