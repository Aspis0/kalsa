#!/bin/bash
# S5 QDC driver; no app-data operation uses root, and /data chmod is outside the app path.
set -u
export LC_ALL=C ANDROID_ADB_SERVER_PORT=6037 IME_SUSPEND=1
if [ "$#" -ne 3 ]; then
  echo "usage: /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/d_run.sh <job_id> <apk_path> <arm_order>" >&2
  exit 2
fi
JOB="$1"; APK="$2"; ARM_ORDER="$3"
case "$JOB" in ''|*[!A-Za-z0-9._-]*) echo "invalid job_id" >&2; exit 2;; esac
case "$APK" in /*) ;; *) echo "apk_path must be absolute" >&2; exit 2;; esac
case "$ARM_ORDER" in ABAB|ABABABAB) ORDER=ABABABAB;; *) echo "arm_order must be ABAB or ABABABAB" >&2; exit 2;; esac
OUT="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5"
RAW="$OUT/raw/$JOB"; mkdir -p "$RAW"
ADB_LOG="$RAW/adb-exit.log"; RESULTS="$RAW/results.tsv"; : > "$ADB_LOG"
printf 'arm\tturn\tttft_ms\tdecode_tps\tengine_prefill\tengine_decode\tthermal_state\tskin_c_before\tskin_c_after\tfallback_count\tlmkd_count\n' > "$RESULTS"
# No handled greedy key was found; hard stop until kalsa.bench.sampling and its
# verified token-ID artifact exist. Never guess a value here.
GREEDY_PREREQUISITE_VERIFIED=0
if [ "$GREEDY_PREREQUISITE_VERIFIED" -ne 1 ]; then
  printf '%s\n' 'PREREQUISITE OPEN: app must handle kalsa.bench.sampling in greedy mode and expose first-N token IDs; no device access performed.' | tee "$RAW/PREREQUISITE.txt"
  exit 3
fi
PKG=com.kalsa.app
MODEL="/Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"
MODEL_SIZE=1593894944
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf
DEVICE_TMP=/data/local/tmp/kalsa-s5
MODEL_REMOTE="$DEVICE_TMP/$MODEL_FILE"
SER=""; HOLDER_PID=0; SCREEN_OFF_TIMEOUT=""; SCREEN_OFF_TIMEOUT_SAVED=0
IME_SAVED=""; IME_SUSPENDED=0; FIRST_SKIN_C=""; PREV_SKIN=""; PREV_TIME=0; THERMO_JSON=""
log() { echo "[$(date +%H:%M:%S)] $*"; }
adbT() {
  local seconds="$1" rc argline; shift
  /usr/bin/perl -e 'alarm shift; exec @ARGV or exit 127' "$seconds" /opt/homebrew/bin/adb "$@"
  rc=$?; argline=""; for arg in "$@"; do printf -v argline '%s %q' "$argline" "$arg"; done
  printf 'rc=%s%s\n' "$rc" "$argline" >> "$ADB_LOG"; return "$rc"
}
logcat_all() { adbT "$1" -s "$SER" logcat -d -b all > "$2" 2>&1; }
device_wake() {
  local file="$RAW/wake.log"
  if [ "$SCREEN_OFF_TIMEOUT_SAVED" -eq 0 ]; then
    SCREEN_OFF_TIMEOUT_SAVED=1
    SCREEN_OFF_TIMEOUT=$(adbT 60 -s "$SER" shell settings get system screen_off_timeout | tr -d '\r')
  fi
  adbT 60 -s "$SER" shell locksettings set-disabled true >> "$file" 2>&1 || true
  adbT 60 -s "$SER" shell input keyevent KEYCODE_WAKEUP >> "$file" 2>&1 || true
  adbT 60 -s "$SER" shell wm dismiss-keyguard >> "$file" 2>&1 || true
  adbT 60 -s "$SER" shell svc power stayon true >> "$file" 2>&1 || true
  adbT 60 -s "$SER" shell settings put system screen_off_timeout 1800000 >> "$file" 2>&1 || true
  adbT 60 -s "$SER" shell dumpsys power >> "$file" 2>&1 || true
}
restore_device() {
  [ -n "$SER" ] || return 0
  adbT 60 -s "$SER" shell svc power stayon false >/dev/null 2>&1 || true
  adbT 60 -s "$SER" shell locksettings set-disabled false >/dev/null 2>&1 || true
  [ -n "$SCREEN_OFF_TIMEOUT" ] && adbT 60 -s "$SER" shell settings put system screen_off_timeout "$SCREEN_OFF_TIMEOUT" >/dev/null 2>&1 || true
}
holder_loop() {
  while :; do
    adbT 60 -s "$SER" shell chmod 771 /data >> "$RAW/holder.log" 2>&1 || true
    sleep 2
  done
}
stop_holder() {
  if [ "$HOLDER_PID" -ne 0 ]; then kill "$HOLDER_PID" 2>/dev/null || true; wait "$HOLDER_PID" 2>/dev/null || true; HOLDER_PID=0; fi
}
restore_ime() {
  [ "$IME_SUSPENDED" -eq 1 ] || return 0
  IME_SUSPENDED=0
  adbT 60 -s "$SER" shell ime enable "$IME_SAVED" >/dev/null 2>&1 || true
  adbT 60 -s "$SER" shell ime set "$IME_SAVED" >/dev/null 2>&1 || true
}
cleanup() { restore_ime; restore_device; stop_holder; [ -n "$SER" ] && adbT 120 -s "$SER" shell "am force-stop $PKG" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
SER=$(adbT 60 devices | awk 'NR > 1 && $2 == "device" { print $1; exit }' | tr -d '\r')
[ -n "$SER" ] || { log "NO_DEVICE on 6037"; exit 2; }
log "device=$SER job=$JOB order=$ORDER"
{
  echo "serial=$SER"; echo "port=$ANDROID_ADB_SERVER_PORT"
  echo "ro.soc.model"; adbT 60 -s "$SER" shell getprop ro.soc.model
  echo "ro.product.model"; adbT 60 -s "$SER" shell getprop ro.product.model
  echo "ro.build.fingerprint"; adbT 60 -s "$SER" shell getprop ro.build.fingerprint
  echo "ro.build.type"; adbT 60 -s "$SER" shell getprop ro.build.type
  echo "ro.debuggable"; adbT 60 -s "$SER" shell getprop ro.debuggable
  echo "id"; adbT 60 -s "$SER" shell id
} > "$RAW/recon.txt" 2>&1
SOC=$(adbT 60 -s "$SER" shell getprop ro.soc.model | tr -d '\r')
case "$SOC" in SM8650|QRD8650) BOARD=QRD8650;; SM8750|QRD8750) BOARD=8-Elite;; *) log "UNSUPPORTED_SOC=$SOC"; exit 6;; esac
holder_loop & HOLDER_PID=$!; sleep 1
thermal_record() {
  local name="$1" file="$RAW/${name}_thermal.txt" rc skin
  adbT 90 -s "$SER" shell dumpsys thermalservice > "$file" 2>&1; rc=$?
  local gate="${file%.txt}_gate.txt" max_temp thermal_status; awk '/Current temperatures from HAL/{f=1} f{print} /Current cooling devices from HAL/{f=0}' "$file" > "$gate"; grep 'Thermal Status:' "$file" | head -1 >> "$gate"; max_temp=$(grep -o 'mValue=[0-9.]*' "$gate" | cut -d= -f2 | sort -n | tail -1); thermal_status=$(grep 'Thermal Status:' "$file" | head -1 | grep -o '[0-9]*' | head -1); printf 'max_hal_temp=%s status=%s\n' "$max_temp" "$thermal_status" >> "$gate"
  skin=$(sed -n 's/.*mValue=\([0-9][0-9.]*\), mType=3, mName=skin.*/\1/p' "$file" | head -1 | tr -d '\r')
  awk -v v="$skin" 'BEGIN { exit !(v ~ /^[0-9]+([.][0-9]+)?$/) }' >/dev/null 2>&1 || rc=1
  awk -v v="$skin" 'BEGIN { exit !(v < 42.0) }' >/dev/null 2>&1 || rc=1
  [ "$rc" -eq 0 ] || return 1
  printf '%s' "$skin"
}
make_thermo() {
  local skin="$1" now trend tenths
  now=$(date +%s)
  if [ "$PREV_TIME" -gt 0 ]; then
    trend=$(awk -v a="$skin" -v b="$PREV_SKIN" -v d="$((now - PREV_TIME))" 'BEGIN { if (d > 0) printf "%.3f", (a-b)/(d/60); else print "0.000" }')
  else trend=0.000; fi
  tenths=$(awk -v v="$skin" 'BEGIN { printf "%.0f", v*10 }')
  THERMO_JSON=$(printf '{"batt_temp_tenths_c":%s,"batt_level_pct":100,"plugged":false,"sensor_valid":true,"t_idle_valid":true,"t_idle_c":%s,"trend_c_per_min":%s}' "$tenths" "$FIRST_SKIN_C" "$trend")
  PREV_SKIN="$skin"; PREV_TIME="$now"
}
model_setup() {
  local local_sha device_sha size rc
  [ -f "$MODEL" ] || { log "MODEL_MISSING=$MODEL"; return 1; }
  local_sha=$(/usr/bin/shasum -a 256 "$MODEL" | awk '{print $1}')
  size=$(wc -c < "$MODEL" | tr -d '[:space:]')
  [ "$local_sha" = "$MODEL_SHA" ] && [ "$size" = "$MODEL_SIZE" ] || { log "LOCAL_MODEL_IDENTITY_FAIL sha=$local_sha size=$size"; return 1; }
  adbT 60 -s "$SER" shell "mkdir -p $DEVICE_TMP" >/dev/null 2>&1 || return 1
  device_sha=$(adbT 300 -s "$SER" shell "sha256sum $MODEL_REMOTE 2>/dev/null" | awk '{print $1}' | tr -d '\r')
  if [ "$device_sha" != "$MODEL_SHA" ]; then
    adbT 3600 -s "$SER" push "$MODEL" "$MODEL_REMOTE" > "$RAW/model_push.txt" 2>&1; rc=$?
    [ "$rc" -eq 0 ] || { log "MODEL_PUSH_FAIL rc=$rc"; return 1; }
    device_sha=$(adbT 300 -s "$SER" shell "sha256sum $MODEL_REMOTE" | awk '{print $1}' | tr -d '\r')
  fi
  [ "$device_sha" = "$MODEL_SHA" ] || { log "DEVICE_MODEL_SHA_FAIL=$device_sha"; return 1; }
  adbT 60 -s "$SER" shell "chmod 644 $MODEL_REMOTE" > "$RAW/model_chmod.txt" 2>&1
}
copy_model() {
  local prefix="$1" stat_out size
  adbT 300 -s "$SER" shell "run-as $PKG sh -c 'mkdir -p files/models/$MODEL_DIR && cp $MODEL_REMOTE files/models/$MODEL_DIR/$MODEL_FILE'" > "${prefix}_model_copy.txt" 2>&1 || return 1
  stat_out=$(adbT 60 -s "$SER" shell "run-as $PKG stat -c %s files/models/$MODEL_DIR/$MODEL_FILE" 2>&1); printf '%s\n' "$stat_out" >> "${prefix}_model_copy.txt"
  size=$(printf '%s' "$stat_out" | tr -d '[:space:]'); [ "$size" = "$MODEL_SIZE" ]
}
pull_rkstorage() {
  local dir="$1"
  adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage > "$dir/RKStorage" 2> "$dir/pull.err" || return 1
  if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage-wal" >/dev/null 2>&1; then adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage-wal > "$dir/RKStorage-wal" 2>> "$dir/pull.err" || return 1; fi
  if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage-shm" >/dev/null 2>&1; then adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage-shm > "$dir/RKStorage-shm" 2>> "$dir/pull.err" || return 1; fi
}
bootstrap_db() {
  local prefix="$1" i
  device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" > "${prefix}_bootstrap.txt" 2>&1 || true
  sleep 25; adbT 60 -s "$SER" shell "am force-stop $PKG" >> "${prefix}_bootstrap.txt" 2>&1 || true
  for i in 1 2; do
    if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage" >/dev/null 2>&1; then return 0; fi
    [ "$i" -eq 2 ] || { device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" >> "${prefix}_bootstrap.txt" 2>&1 || true; sleep 25; adbT 60 -s "$SER" shell "am force-stop $PKG" >> "${prefix}_bootstrap.txt" 2>&1 || true; }
  done
  return 1
}
set_prefs() {
  local flag="$1" dir remote
  dir=$(mktemp -d /tmp/kalsa-s5-rkstorage.XXXXXX) || return 1
  pull_rkstorage "$dir" || { rm -rf "$dir"; return 1; }
  /usr/bin/sqlite3 -bail "$dir/RKStorage" "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR'),('kalsa.governor.enabled','$flag'),('kalsa.bench.thermo','$THERMO_JSON');" >/dev/null || { rm -rf "$dir"; return 1; }
  /usr/bin/sqlite3 -bail "$dir/RKStorage" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null || { rm -rf "$dir"; return 1; }
  remote="$DEVICE_TMP/rkstorage-$JOB-$$"
  if ! adbT 300 -s "$SER" push "$dir/RKStorage" "$remote" >/dev/null 2>&1 || ! adbT 120 -s "$SER" shell "run-as $PKG cp $remote databases/RKStorage" >/dev/null 2>&1 || ! adbT 60 -s "$SER" shell "run-as $PKG rm -f databases/RKStorage-wal databases/RKStorage-shm" >/dev/null 2>&1; then
    adbT 60 -s "$SER" shell "rm -f $remote" >/dev/null 2>&1 || true; rm -rf "$dir"; return 1
  fi
  adbT 60 -s "$SER" shell "rm -f $remote" >/dev/null 2>&1 || true; rm -rf "$dir"; return 0
}
fresh_install() {
  local prefix="$1" rc flags
  adbT 120 -s "$SER" shell "pm uninstall $PKG" > "${prefix}_uninstall_old.txt" 2>&1 || true
  /usr/bin/shasum -a 256 "$APK" > "${prefix}_apk_sha.txt" 2>&1
  adbT 300 -s "$SER" install -r "$APK" > "${prefix}_install.txt" 2>&1; rc=$?
  [ "$rc" -eq 0 ] || return 1
  adbT 60 -s "$SER" shell "pm dump $PKG" > "${prefix}_pm_dump.txt" 2>&1 || true
  adbT 60 -s "$SER" shell "dumpsys package $PKG | grep -i flags" > "${prefix}_flags.txt" 2>&1
  flags=$(cat "${prefix}_flags.txt")
  printf 'application-debuggable required; flags=%s\n' "$flags" >> "${prefix}_apk_sha.txt"
  printf '%s' "$flags" | grep -qi DEBUGGABLE
}
MODEL_LOAD_PATTERN='llama_model_loader: loaded meta data with .* from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf'
PREWARM_PATTERN='KALSA_PREWARM.*"op":"done"'
has_load_proof() { grep -E "$MODEL_LOAD_PATTERN" "$1" >/dev/null 2>&1 && grep -E "$PREWARM_PATTERN" "$1" >/dev/null 2>&1; }
poll_load() { local file="$1" elapsed=0; : > "$file"; while [ "$elapsed" -lt 300 ]; do logcat_all 60 "$file" || true; has_load_proof "$file" && return 0; sleep 5; elapsed=$((elapsed + 5)); done; logcat_all 60 "$file" || true; has_load_proof "$file"; }
poll_telemetry() { local file="$1" elapsed=0; while [ "$elapsed" -lt 600 ]; do logcat_all 60 "$file" || true; grep -E 'KALSA_TELEMETRY.*"tokensPredicted"[[:space:]]*:[[:space:]]*[1-9][0-9]*' "$file" >/dev/null 2>&1 && return 0; sleep 5; elapsed=$((elapsed + 5)); done; logcat_all 60 "$file" || true; grep -E 'KALSA_TELEMETRY.*"tokensPredicted"[[:space:]]*:[[:space:]]*[1-9][0-9]*' "$file" >/dev/null 2>&1; }
dump_ui() { local out="$1"; adbT 60 -s "$SER" shell "uiautomator dump $DEVICE_TMP/ui.xml >/dev/null 2>&1" || return 1; adbT 60 -s "$SER" shell "cat $DEVICE_TMP/ui.xml" > "$out" 2>&1 || return 1; tr -d '\r' < "$out" > "$out.tmp" && mv "$out.tmp" "$out"; [ -s "$out" ]; }
bounds_edit() { tr '>' '\n' < "$1" | grep 'class="android.widget.EditText"' | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1; }
bounds_send() { tr '>' '\n' < "$1" | grep -E 'content-desc="Send"|text="Send"' | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1; }
tap_bounds() { local b="$1" x1 y1 x2 y2; read -r x1 y1 x2 y2 <<< "$b"; adbT 60 -s "$SER" shell input tap "$(((x1+x2)/2))" "$(((y1+y2)/2))"; }
PROMPT='Reply with one short sentence about mountains'
type_prompt() { local -a words; local word first=1; read -r -a words <<< "$PROMPT"; for word in "${words[@]}"; do [ "$first" -eq 1 ] || adbT 60 -s "$SER" shell input keyevent 62 || return 1; adbT 60 -s "$SER" shell input text "$word" || return 1; first=0; done; }
ime_suspend() { [ "$IME_SUSPEND" = 1 ] && [ "$IME_SUSPENDED" -eq 0 ] || return 0; IME_SAVED=$(adbT 60 -s "$SER" shell settings get secure default_input_method | tr -d '\r'); [ -n "$IME_SAVED" ] && [ "$IME_SAVED" != null ] || return 0; adbT 60 -s "$SER" shell "ime disable $IME_SAVED" >/dev/null 2>&1 && IME_SUSPENDED=1 || true; }
last_json() { sed -n "s/.*$1 //p" "$2" | tail -1; }
json_field() { local json="$1" key="$2"; [ -n "$json" ] || return 0; printf '%s' "$json" | /usr/bin/perl -MJSON::PP -e '$k=shift; $t=do{local $/; <STDIN>}; eval{$v=decode_json($t)->{$k}; print defined($v)?$v:""}' "$key"; }
count_lines() { local n; n=$(grep -Eic "$1" "$2" 2>/dev/null || true); printf '%s' "${n:-0}"; }
run_observation() {
  local arm="$1" turn="$2" prefix="$RAW/${BOARD}_${arm}_t${turn}"
  local flag skin_before=na skin_after=na thermo="" logcat="${prefix}_logcat_all.txt"
  local status=0 load_rc=1 telemetry_rc=1 edit_bounds send_bounds
  local telemetry governor ttft=na decode=na prefill=na decode_engine=na thermal=na fallback=0 lmkd=0
  fresh_install "$prefix" || status=1
  [ "$status" -eq 0 ] && copy_model "$prefix" || status=1
  [ "$status" -eq 0 ] && bootstrap_db "$prefix" || status=1
  flag=0; [ "$arm" = B ] && flag=1
  if [ "$status" -eq 0 ]; then
    skin_before=$(thermal_record "$(basename "$prefix")_before") || { skin_before=na; status=1; }
    [ "$status" -eq 0 ] && make_thermo "$skin_before"
    thermo="$THERMO_JSON"
    [ "$status" -eq 0 ] && set_prefs "$flag" || status=1
  fi
  if [ "$status" -eq 0 ]; then
    adbT 60 -s "$SER" logcat -c > "${prefix}_clear.txt" 2>&1 || status=1
    device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" > "${prefix}_launch.txt" 2>&1 || status=1
    [ "$status" -eq 0 ] && poll_load "${prefix}_load.txt"; load_rc=$?
    [ "$load_rc" -eq 0 ] || status=1
    if [ "$load_rc" -eq 0 ]; then
      device_wake; ime_suspend
      dump_ui "${prefix}_edit.xml" && edit_bounds=$(bounds_edit "${prefix}_edit.xml") || edit_bounds=""
      [ -n "$edit_bounds" ] && tap_bounds "$edit_bounds" && type_prompt || status=1
      if [ "$status" -eq 0 ]; then
        dump_ui "${prefix}_send.xml" && send_bounds=$(bounds_send "${prefix}_send.xml") || send_bounds=""
        [ -n "$send_bounds" ] && tap_bounds "$send_bounds" || status=1
      fi
      [ "$status" -eq 0 ] && poll_telemetry "$logcat"; telemetry_rc=$?
      [ "$telemetry_rc" -eq 0 ] || status=1
    fi
    [ -f "$logcat" ] || logcat_all 300 "$logcat" || true
  fi
  skin_after=$(thermal_record "$(basename "$prefix")_after") || { skin_after=na; status=1; }
  grep -E 'KALSA_|llama_model_loader' "$logcat" > "${prefix}_filtered.txt" 2>/dev/null || true
  fallback=$(count_lines 'KALSA_GOVERNOR_FALLBACK' "$logcat"); lmkd=$(count_lines 'lmkd|am_kill|lowmemorykiller' "$logcat")
  telemetry=$(last_json KALSA_TELEMETRY "$logcat"); governor=$(last_json KALSA_GOVERNOR "$logcat")
  ttft=$(json_field "$telemetry" promptMs); decode=$(json_field "$telemetry" predictedPerSecond)
  prefill=$(json_field "$governor" engine_prefill); decode_engine=$(json_field "$governor" engine_decode); thermal=$(json_field "$governor" thermal_state)
  [ -n "$ttft" ] || ttft=na; [ -n "$decode" ] || decode=na; [ -n "$prefill" ] || prefill=na; [ -n "$decode_engine" ] || decode_engine=na; [ -n "$thermal" ] || thermal=na
  if [ "$arm" = B ]; then
    [ "$fallback" -eq 0 ] || status=1; [ "$prefill" = GPU ] && [ "$decode_engine" = CPU ] || status=1
    [ "$thermal" != na ] || status=1
  fi
  [ "$lmkd" -eq 0 ] || status=1
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$arm" "$turn" "${ttft:-na}" "${decode:-na}" "${prefill:-na}" "${decode_engine:-na}" "${thermal:-na}" "$skin_before" "$skin_after" "$fallback" "$lmkd" | tee -a "$RESULTS"
  printf 'status=%s thermo=%s\n' "$status" "$thermo" > "${prefix}_status.txt"
  adbT 60 -s "$SER" shell "am force-stop $PKG" > "${prefix}_force_stop.txt" 2>&1 || status=1
  adbT 120 -s "$SER" shell "pm uninstall $PKG" > "${prefix}_uninstall.txt" 2>&1 || status=1
  return "$status"
}
FIRST_SKIN_C=$(thermal_record session_pre) || { log "NO_VALID_INITIAL_SKIN"; exit 6; }
PREV_SKIN="$FIRST_SKIN_C"; PREV_TIME=$(date +%s)
model_setup || exit 5
FINAL_RC=0; A_TURN=0; B_TURN=0
for ((i=0; i<${#ORDER}; i++)); do
  arm="${ORDER:i:1}"
  if [ "$arm" = A ]; then A_TURN=$((A_TURN + 1)); turn="$A_TURN"; else B_TURN=$((B_TURN + 1)); turn="$B_TURN"; fi
  run_observation "$arm" "$turn" || { FINAL_RC=1; log "ABORT arm=$arm turn=$turn"; break; }
done
log "DONE board=$BOARD final_rc=$FINAL_RC results=$RESULTS"; exit "$FINAL_RC"
