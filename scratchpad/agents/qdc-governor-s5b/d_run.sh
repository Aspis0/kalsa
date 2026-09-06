#!/bin/bash
set -u
export LC_ALL=C ANDROID_ADB_SERVER_PORT=6037 IME_SUSPEND=1
usage() { echo "usage: /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5b/d_run.sh <job_id> <apk_path> <arm_order> [deadline_minutes]" >&2; }
validate_deadline_minutes() {
  local value="$1"
  case "$value" in ''|*[!0-9]*) return 1;; esac
  [ "$value" -ge 20 ] && [ "$value" -le 110 ]
}
if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  usage
  exit 2
fi
JOB="$1"; APK="$2"; ARM_ORDER="$3"
ORACLE_MODE="${ORACLE_MODE:-}"
DEADLINE_MINUTES=40; [ "$#" -eq 4 ] && DEADLINE_MINUTES="$4"
validate_deadline_minutes "$DEADLINE_MINUTES" || { echo "deadline_minutes must be an integer from 20 to 110" >&2; usage; exit 2; }
case "$JOB" in ''|*[!A-Za-z0-9._-]*) echo "invalid job_id" >&2; exit 2;; esac
case "$APK" in /*) ;; *) echo "apk_path must be absolute" >&2; exit 2;; esac
[ "$ARM_ORDER" = ABABAB ] || [ "$ARM_ORDER" = ABABABAB ] || { echo "arm_order must be ABABAB or ABABABAB" >&2; exit 2; }
PROMPT_FILE=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5b/PROMPT.txt; PROMPT_SHA=9109f58516104950079a4a4ecbcd46b557b598741227e893c275bece27079ea6; PROMPT_BYTES=5142; PROMPT_INPUT=""; PROMPT_TEXT=""; PROMPT_EXPECTED_CHARS=0
load_prompt() {
  local text
  local local_sha
  local size
  [ -f "$PROMPT_FILE" ] || return 1
  local_sha=$(/usr/bin/shasum -a 256 "$PROMPT_FILE" | awk '{print $1}')
  size=$(wc -c < "$PROMPT_FILE" | tr -d '[:space:]')
  [ "$local_sha" = "$PROMPT_SHA" ] && [ "$size" = "$PROMPT_BYTES" ] || return 1
  text=$(tr '\n' ' ' < "$PROMPT_FILE") || return 1
  PROMPT_TEXT="$text"
  PROMPT_EXPECTED_CHARS=$(printf '%s' "$text" | wc -m | tr -d '[:space:]')
  PROMPT_INPUT=$(printf '%s' "$text" | sed 's/ /%s/g')
  [ -n "$PROMPT_INPUT" ] && [ "$PROMPT_EXPECTED_CHARS" -eq "$PROMPT_BYTES" ]
}
load_prompt || { echo "PROMPT_IDENTITY_FAIL" >&2; exit 6; }
OUT="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5b"
ORACLE_HELPER="$OUT/oracle_logit.py"
RAW="$OUT/raw/$JOB"; mkdir -p "$RAW"
ADB_LOG="$RAW/adb-exit.log"; DRIVER_LOG="$RAW/driver.log"; RESULTS="$RAW/results.tsv"; END_MARKER="$RAW/END.txt"; : > "$ADB_LOG"; : > "$DRIVER_LOG"
printf 'arm\tturn\tttft_ms\tprefill_ms\tprefill_chunks\tnew_tokens_a\tnew_tokens_b\tdecode_tps\tengine_prefill\tengine_decode\tthermal_state\tskin_c_before\tskin_c_after\tfallback_count\tlmkd_count\tids_sha\toracle\toracle_logit\toracle_rule\n' > "$RESULTS"
PKG=com.kalsa.app
MODEL="/Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"; MODEL_SIZE=1593894944
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf
DEVICE_TMP=/data/local/tmp/kalsa-s5; MODEL_REMOTE="$DEVICE_TMP/$MODEL_FILE"
START_EPOCH=$(date +%s); DEADLINE_EPOCH=$((START_EPOCH + DEADLINE_MINUTES * 60)); END_WRITTEN=0
SER=""; HOLDER_PID=0; SCREEN_OFF_TIMEOUT=""; SCREEN_OFF_TIMEOUT_SAVED=0; IME_SAVED=""; IME_SUSPENDED=0
FIRST_SKIN_C=""; PREV_SKIN=""; PREV_TIME=0; THERMO_JSON=""; MEM_BEFORE_KB=""; MEM_AFTER_KB=""; APP_PID=""; ANCHOR_EPOCH=0; SEND_ANCHOR_EPOCH=0; ANCHOR_STAMP=""; A_IDS_FILE=""; A_IDS_VALID=0; A_PROBS_FILE=""; TYPE_PROMPT_CALLS=0; TYPE_COUNTS=""; COOL_TARGET_C=37.0; COOL_POLL_S=15; COOL_MAX_S=900; COOLDOWN_SECONDS=na; LOGCAT_RC=na; LOGCAT_RETRIES=0; LAST_EDIT_BOUNDS=""; POWER_CHECK_CONTEXT=""; WAKE_SEQUENCE_TRANSPORT=0
source /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5b/parse.sh
log() { echo "[$(date +%H:%M:%S)] $*"; }
gpu_fit_ram_gate() {
  local device_tag="$1"
  local memtotal_kb="$2"
  case "$memtotal_kb" in ''|*[!0-9]*) return 0;; esac
  if [ "$memtotal_kb" -le 8388608 ]; then
    log "GPU_FIT_RAM memtotal_kb=$memtotal_kb"
    return 2
  fi
}
write_end() { [ "$END_WRITTEN" -eq 1 ] || { printf 'END reason=%s\n' "$1" > "$END_MARKER"; END_WRITTEN=1; }; }
deadline_check() { [ "$(date +%s)" -lt "$DEADLINE_EPOCH" ] || { log "DEADLINE_${DEADLINE_MINUTES}_MIN"; write_end "deadline_${DEADLINE_MINUTES}_min"; exit 124; }; }
adbT() {
  local seconds="$1" rc argline="" arg
  shift
  /usr/bin/perl -e 'alarm shift; exec @ARGV or exit 127' "$seconds" /opt/homebrew/bin/adb "$@"
  rc=$?
  for arg in "$@"; do printf -v argline '%s %q' "$argline" "$arg"; done
  printf 'rc=%s%s\n' "$rc" "$argline" >> "$ADB_LOG"
  return "$rc"
}
power_capture() {
  local file="$1"
  local attempt rc has_wakefulness all_transport=1
  POWER_CAPTURE_TRANSPORT=0
  : > "${file}.log"
  for attempt in 1 2 3; do
    adbT 60 -s "$SER" shell dumpsys power > "$file" 2>&1
    rc=$?
    has_wakefulness=0
    grep -q 'mWakefulness=' "$file" && has_wakefulness=1
    printf 'attempt=%s rc=%s has_wakefulness=%s\n' "$attempt" "$rc" "$has_wakefulness" >> "${file}.log"
    if [ "$has_wakefulness" -eq 1 ]; then
      return 0
    fi
    case "$rc" in 124|255) ;; *) all_transport=0 ;; esac
  done
  [ "$all_transport" -eq 1 ] && POWER_CAPTURE_TRANSPORT=1
  return 1
}
wake_tap() {
  local wake_log="$1"
  local bounds tap x y source rc
  bounds="${LAST_EDIT_BOUNDS:-}"
  tap=$(printf '%s\n' "$bounds" | awk 'NF==4&&$1~/^[0-9]+$/&&$2~/^[0-9]+$/&&$3~/^[0-9]+$/&&$4~/^[0-9]+$/{printf "%d %d",($1+$3)/2,($2+$4)/2}')
  if [ -n "$tap" ]; then
    read -r x y <<< "$tap"
    source=bounds
  else
    x=540; y=2047; source=fallback
  fi
  adbT 60 -s "$SER" shell input tap "$x" "$y" >> "$wake_log" 2>&1
  rc=$?
  printf 'wake_tap=%s,%s source=%s rc=%s\n' "$x" "$y" "$source" "$rc" >> "$wake_log"
  case "$rc" in 124|255) WAKE_SEQUENCE_TRANSPORT=1 ;; esac
  return "$rc"
}
wake_sequence() {
  local wake_log
  local check_file rc tap_rc check_rc
  wake_log="${1:-$RAW/wake.log}"
  check_file="${wake_log}.power"
  WAKE_SEQUENCE_TRANSPORT=0
  adbT 60 -s "$SER" shell locksettings set-disabled true >> "$wake_log" 2>&1; rc=$?; case "$rc" in 124|255) WAKE_SEQUENCE_TRANSPORT=1 ;; esac
  adbT 60 -s "$SER" shell input keyevent KEYCODE_WAKEUP >> "$wake_log" 2>&1; rc=$?; case "$rc" in 124|255) WAKE_SEQUENCE_TRANSPORT=1 ;; esac
  adbT 60 -s "$SER" shell wm dismiss-keyguard >> "$wake_log" 2>&1; rc=$?; case "$rc" in 124|255) WAKE_SEQUENCE_TRANSPORT=1 ;; esac
  sleep 1
  wake_tap "$wake_log"; tap_rc=$?
  adbT 60 -s "$SER" shell svc power stayon true >> "$wake_log" 2>&1; rc=$?; case "$rc" in 124|255) WAKE_SEQUENCE_TRANSPORT=1 ;; esac
  adbT 60 -s "$SER" shell settings put system screen_off_timeout 1800000 >> "$wake_log" 2>&1; rc=$?; case "$rc" in 124|255) WAKE_SEQUENCE_TRANSPORT=1 ;; esac
  POWER_CHECK_CONTEXT=wake
  adbT 60 -s "$SER" shell dumpsys power > "$check_file" 2>&1
  check_rc=$?
  POWER_CHECK_CONTEXT=""
  cat "$check_file" >> "$wake_log"
  printf 'wake_recheck_rc=%s\n' "$check_rc" >> "$wake_log"
  [ "$tap_rc" -eq 0 ] && [ "$check_rc" -eq 0 ] && grep -q 'mWakefulness=Awake' "$check_file" || return 1
  [ "$WAKE_SEQUENCE_TRANSPORT" -eq 0 ]
}
device_wake() {
  if [ "$SCREEN_OFF_TIMEOUT_SAVED" -eq 0 ]; then
    SCREEN_OFF_TIMEOUT_SAVED=1
    SCREEN_OFF_TIMEOUT=$(adbT 60 -s "$SER" shell settings get system screen_off_timeout | tr -d '\r')
  fi
  wake_sequence "$RAW/wake.log" || return 1
  adbT 60 -s "$SER" shell dumpsys power >> "$RAW/wake.log" 2>&1 || return 1
}
wake_state() { sed -n 's/.*mWakefulness=\([^, ]*\).*/\1/p' "$1" | head -1 | tr -d '\r'; }
ensure_awake() {
  local prefix="$1" first second
  adbT 60 -s "$SER" shell dumpsys power > "${prefix}_wake_before.txt" 2>&1 || return 1
  first=$(wake_state "${prefix}_wake_before.txt")
  if [ "${first:-missing}" != Awake ]; then wake_sequence "${prefix}_wake.log" || return 1; fi
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
  echo "ro.product.name"; adbT 60 -s "$SER" shell getprop ro.product.name
  echo "ro.product.model"; adbT 60 -s "$SER" shell getprop ro.product.model
  echo "ro.build.fingerprint"; adbT 60 -s "$SER" shell getprop ro.build.fingerprint
  echo "ro.build.type"; adbT 60 -s "$SER" shell getprop ro.build.type
  echo "ro.debuggable"; adbT 60 -s "$SER" shell getprop ro.debuggable
  echo "MemTotal"; adbT 60 -s "$SER" shell "cat /proc/meminfo | grep '^MemTotal:'"
  echo "id"; adbT 60 -s "$SER" shell id
} > "$RAW/recon.txt" 2>&1
configure_screen || { log "SCREEN_SETUP_FAIL"; exit 2; }
SOC=$(adbT 60 -s "$SER" shell getprop ro.soc.model | tr -d '\r')
PRODUCT_NAME=$(adbT 60 -s "$SER" shell getprop ro.product.name | tr -d '\r')
case "$SOC" in
  SM8650|QRD8650|SM7675|QRD7675|SM8550|QRD8550|SM8635|QRD8635|SM8750|QRD8750) ;;
  *) log "UNSUPPORTED_SOC=$SOC"; exit 6 ;;
esac
BOARD=$(device_tag "$PRODUCT_NAME" "$SOC") || { log "DEVICE_TAG_FAIL product=$PRODUCT_NAME soc=$SOC"; exit 6; }
printf 'device_tag=%s\n' "$BOARD" >> "$RAW/recon.txt"
MEMTOTAL_KB=$(sed -n 's/^MemTotal:[[:space:]]*\([0-9][0-9]*\) kB.*/\1/p' "$RAW/recon.txt" | head -1 | tr -d '\r')
printf 'memtotal_kb=%s\n' "${MEMTOTAL_KB:-missing}" >> "$RAW/recon.txt"
gpu_fit_ram_gate "$BOARD" "$MEMTOTAL_KB" || exit $?
holder_loop & HOLDER_PID=$!; sleep 1
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
bootstrap_db() {
  local prefix="$1" i
  device_wake
  adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" > "${prefix}_bootstrap.txt" 2>&1 || true
  sleep 25
  adbT 60 -s "$SER" shell "am force-stop $PKG" >> "${prefix}_bootstrap.txt" 2>&1 || true
  for i in 1 2; do
    local check_out="${prefix}_bootstrap.runas"
    run_as_retry shell "${prefix}_bootstrap.txt" "$check_out" 60 "test -f databases/RKStorage"; local run_rc=$?; rm -f "$check_out"
    if [ "$run_rc" -eq 0 ]; then return 0; fi
    if [ "$i" -eq 1 ]; then
      device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" >> "${prefix}_bootstrap.txt" 2>&1 || true
      sleep 25; adbT 60 -s "$SER" shell "am force-stop $PKG" >> "${prefix}_bootstrap.txt" 2>&1 || true
    fi
  done
  return 1
}
ids_to_json() {
  local file="$1"
  awk 'BEGIN { printf "["; sep=""; valid=1 } { value=$0; gsub(/[[:space:]]/, "", value); if (value !~ /^-?[0-9]+$/) { valid=0; next } printf "%s%s", sep, value; sep=","; count++ } END { if (!valid || count != 32) exit 1; printf "]" }' "$file"
}
set_prefs() {
  local flag="$1"
  local governor_force=0
  local oracle_mode="${ORACLE_MODE:-}" force_ids="" prefs_sql
  local dir remote run_rc
  local step_file="${RAW}/set_prefs_${flag}.txt"
  [ "$#" -ge 2 ] && step_file="$2_set_prefs.txt"
  [ "$flag" -eq 1 ] && governor_force=1
  prefs_sql="INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR'),('kalsa.governor.enabled','$flag'),('kalsa.bench.governor_force','$governor_force'),('kalsa.bench.thermo','$THERMO_JSON'),('kalsa.bench.sampling','greedy'),('kalsa.web.enabled','false'),('kalsa.bench.toolchoice','none'),('kalsa.tools.device','false'),('kalsa.tools.calendar','false')"
  if [ "$oracle_mode" = logit ]; then
    prefs_sql="$prefs_sql,('kalsa.bench.probs','1')"
    if [ "$flag" -eq 1 ] && [ "${A_IDS_VALID:-0}" -eq 1 ] && [ -r "${A_IDS_FILE:-}" ]; then
      force_ids=$(ids_to_json "$A_IDS_FILE") || force_ids=""
      [ -n "$force_ids" ] && prefs_sql="$prefs_sql,('kalsa.bench.force_ids','$force_ids')"
    fi
    if [ "$flag" -eq 1 ] && [ -z "$force_ids" ]; then
      prefs_sql="DELETE FROM catalystLocalStorage WHERE key='kalsa.bench.force_ids'; $prefs_sql"
    fi
  fi
  prefs_sql="$prefs_sql;"
  dir=$(mktemp -d /tmp/kalsa-s5-rkstorage.XXXXXX) || return 1
  : > "$step_file"
  pull_rkstorage "$dir" || { rm -rf "$dir"; return 1; }
  /usr/bin/sqlite3 -bail "$dir/RKStorage" "$prefs_sql" >/dev/null || { rm -rf "$dir"; return 1; }
  /usr/bin/sqlite3 -bail "$dir/RKStorage" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null || { rm -rf "$dir"; return 1; }
  remote="$DEVICE_TMP/rkstorage-$JOB-$$"
  adbT 300 -s "$SER" push "$dir/RKStorage" "$remote" >> "$step_file" 2>&1; run_rc=$?
  if [ "$run_rc" -eq 0 ]; then
    run_as_retry shell "$step_file" "${step_file}.copy" 120 "cp $remote databases/RKStorage"; run_rc=$?; cat "${step_file}.copy" >> "$step_file"; rm -f "${step_file}.copy"
  fi
  if [ "$run_rc" -eq 0 ]; then
    run_as_retry shell "$step_file" "${step_file}.remove" 60 "rm -f databases/RKStorage-wal databases/RKStorage-shm"; run_rc=$?; cat "${step_file}.remove" >> "$step_file"; rm -f "${step_file}.remove"
  fi
  if [ "$run_rc" -ne 0 ]; then
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
  # Clean state = adb ok AND zero installed copies; uninstall_rc is 1 on a fresh board (nothing to delete) and grep -c exits 1 on zero matches.
  [ "$adb_list_rc" -eq 0 ] && [ "${package_count:-1}" = 0 ] || return 1
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
memory_before() { local prefix="$1"; local file="${prefix}_meminfo_before.txt"; adbT 60 -s "$SER" shell "cat /proc/meminfo | head -3" > "$file" 2>&1 || return 1; MEM_BEFORE_KB=$(sed -n 's/^MemAvailable:[[:space:]]*\([0-9][0-9]*\) kB.*/\1/p' "$file" | head -1 | tr -d '\r'); [ -n "$MEM_BEFORE_KB" ]; }
memory_after() { local prefix="$1"; local file="${prefix}_meminfo_after.txt"; adbT 60 -s "$SER" shell "cat /proc/meminfo | head -3" > "$file" 2>&1 || return 1; adbT 90 -s "$SER" shell "dumpsys meminfo $PKG | head -25" > "${prefix}_appmem_after.txt" 2>&1 || return 1; MEM_AFTER_KB=$(sed -n 's/^MemAvailable:[[:space:]]*\([0-9][0-9]*\) kB.*/\1/p' "$file" | head -1 | tr -d '\r'); [ -n "$MEM_BEFORE_KB" ] && [ -n "$MEM_AFTER_KB" ] || return 1; printf 'MEM before=%s after=%s\n' "$MEM_BEFORE_KB" "$MEM_AFTER_KB" | tee -a "$DRIVER_LOG"; }
poll_load() {
  local file="$1"
  local elapsed=0
  local wake_file="${file%_load.txt}_load_wakes.txt"
  local power_file power_rc current_wake wake_rc wakes=0
  : > "$file"
  : > "$wake_file"
  while [ "$elapsed" -lt 300 ]; do
    deadline_check
    power_file="${wake_file}.power"
    POWER_CHECK_CONTEXT=load
    power_capture "$power_file"
    power_rc=$?
    POWER_CHECK_CONTEXT=""
    [ "$power_rc" -eq 0 ] || return 1
    current_wake=$(wake_state "$power_file")
    if [ "${current_wake:-missing}" != Awake ]; then
      wakes=$((wakes + 1))
      printf 'iteration=%s wake_before=%s\n' "$((elapsed / 5 + 1))" "${current_wake:-missing}" >> "$wake_file"
      wake_sequence "$wake_file" || { printf 'rewakes=%s\n' "$wakes" >> "$wake_file"; return 1; }
    fi
    printf 'rewakes=%s\n' "$wakes" >> "$wake_file"
    logcat_all 60 "$file" || true
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
ime_suspend() {
  [ "$IME_SUSPEND" = 1 ] && [ "$IME_SUSPENDED" -eq 0 ] || return 0
  IME_SAVED=$(adbT 60 -s "$SER" shell settings get secure default_input_method | tr -d '\r')
  [ -n "$IME_SAVED" ] && [ "$IME_SAVED" != null ] || return 0
  adbT 60 -s "$SER" shell "ime disable $IME_SAVED" >/dev/null 2>&1 && IME_SUSPENDED=1 || true
}
run_observation() {
  local arm="$1"
  local turn="$2"
  local prefix="$RAW/${BOARD}_${arm}_t${turn}"
  local logcat="${prefix}_logcat_all.txt"
  LAST_EDIT_BOUNDS=""
  local flag skin_before=na skin_after=na thermo="" status=0 load_rc=1 telemetry_rc=1 ui_rc=0 row_void=0 cooldown_rc=0 cooldown_s=na
  local telemetry governor bench reuse_line ttft=na prefill_ms=na prefill_chunks=na new_tokens_a=na new_tokens_b=na decode=na prefill=na decode_engine=na thermal=na commit_bytes=na commit_ms=na thermo_source=na fallback=0 lmkd=0 governor_count=0 ids_sha=na oracle=na oracle_logit=na oracle_rule=na n=na runtime_prereq=0
  local structured_calls=0 tool_calls=0 void_reason=na
  local a_reused a_total probs_file="${prefix}_probs.jsonl" oracle_result="" oracle_mode=na
  local ids_file="${prefix}_ids.txt"
  SEND_ANCHOR_EPOCH=0; LOGCAT_RC=na; LOGCAT_RETRIES=0
  deadline_check; fresh_install "$prefix" || status=1; [ "$status" -eq 0 ] && copy_model "$prefix" || status=1; [ "$status" -eq 0 ] && bootstrap_db "$prefix" || status=1
  if [ "$status" -eq 0 ]; then
    COOL_TARGET_C=$(cool_target_for_arm "$arm") || status=1
    if [ "$status" -eq 0 ]; then
      cooldown_to_target "$prefix"; cooldown_rc=$?; cooldown_s="$COOLDOWN_SECONDS"
      if [ "$cooldown_rc" -eq 2 ]; then row_void=1; void_reason=hot; elif [ "$cooldown_rc" -ne 0 ]; then status=1; void_reason=thermal; fi
    fi
  fi
  flag=0; [ "$arm" = B ] && flag=1
  if [ "$status" -eq 0 ] && [ "$row_void" -eq 0 ]; then
    skin_before=$(thermal_record "$(basename "$prefix")_before") || { skin_before=na; void_reason=thermal; status=1; }
    if [ "$status" -eq 0 ] && [ "$arm" = A ] && awk -v v="$skin_before" -v target="$COOL_TARGET_C" 'BEGIN { exit !(v > target) }' >/dev/null 2>&1; then row_void=1; void_reason=hot; fi
    if [ "$status" -eq 0 ] && [ "$row_void" -eq 0 ]; then make_thermo "$skin_before"; thermo="$THERMO_JSON"; set_prefs "$flag" "$prefix" || status=1; fi
  fi
  if [ "$status" -eq 0 ] && [ "$row_void" -eq 0 ]; then
    memory_before "$prefix" || status=1; clear_anchor "$prefix" || status=1; device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" > "${prefix}_launch.txt" 2>&1 || status=1; APP_PID=$(adbT 60 -s "$SER" shell pidof "$PKG" | awk 'NR==1{print $1;exit}' | tr -d '\r')
    [ "$status" -eq 0 ] && poll_load "${prefix}_load.txt"; load_rc=$?; [ "$load_rc" -eq 0 ] || status=1
    [ "$load_rc" -eq 0 ] && memory_after "$prefix" || status=1
    if [ "$load_rc" -eq 0 ] && [ "$status" -eq 0 ]; then device_wake; ime_suspend; ui_send "$prefix" "$turn"; ui_rc=$?; if [ "$ui_rc" -eq 2 ]; then row_void=1; elif [ "$ui_rc" -ne 0 ]; then status=1; fi; fi
    [ "$status" -eq 0 ] && [ "$row_void" -eq 0 ] && poll_telemetry "$logcat"; telemetry_rc=$?; if [ "$telemetry_rc" -eq 0 ]; then sleep 2; logcat_all 120 "$logcat" || true; fi; [ -f "$logcat" ] || logcat_all 120 "$logcat" || true
  fi
  [ -f "$logcat" ] || : > "$logcat"; lmkd_all_after "$logcat" "${prefix}_lmkd_all.txt" || status=1; skin_after=$(thermal_record "$(basename "$prefix")_after") || { skin_after=na; void_reason=thermal; status=1; }; grep -E 'KALSA_|llama_model_loader|reusing [0-9]+/[0-9]+' "$logcat" > "${prefix}_filtered.txt" 2>/dev/null || true
  if [ "$ORACLE_MODE" = logit ]; then extract_probs_after "$logcat" "$probs_file"; fi
  fallback=$(count_after 'KALSA_GOVERNOR_FALLBACK' "$logcat"); lmkd=$(count_lmkd_after "$logcat"); telemetry=$(last_json_after KALSA_TELEMETRY "$logcat"); governor=$(last_json_after 'KALSA_GOVERNOR ' "$logcat"); bench=$(last_json_after 'KALSA_BENCH_TOKENS ' "$logcat"); tool_call=$(last_json_after 'KALSA_TOOLCALL ' "$logcat"); structured_calls=$(json_field "$tool_call" structuredCalls); [ -n "$structured_calls" ] || structured_calls=0; case "$structured_calls" in ''|*[!0-9]*) structured_calls=0;; esac; if [ "$structured_calls" -gt 0 ]; then tool_calls="$structured_calls"; void_reason=toolcall; row_void=1; fi
  ttft=$(json_field "$telemetry" promptMs); prefill_ms=$(json_field "$governor" prefill_ms); prefill_chunks=$(json_field "$governor" prefill_chunks); decode=$(json_field "$telemetry" predictedPerSecond); prefill=$(json_field "$governor" engine_prefill); decode_engine=$(json_field "$governor" engine_decode); thermal=$(json_field "$governor" thermal_state); commit_bytes=$(json_field "$governor" commit_bytes); commit_ms=$(json_field "$governor" commit_ms); thermo_source=$(json_field "$governor" thermo_source); governor_count=$(awk -v a="$SEND_ANCHOR_EPOCH" '$1+0>=a&&index($0,"KALSA_GOVERNOR ")>0{n++}END{print n+0}' "$logcat"); n=$(json_field "$bench" n)
  [ -n "$ttft" ] || ttft=na; [ -n "$prefill_ms" ] || prefill_ms=na; [ -n "$prefill_chunks" ] || prefill_chunks=na; [ -n "$decode" ] || decode=na; [ -n "$prefill" ] || prefill=na; [ -n "$decode_engine" ] || decode_engine=na; [ -n "$thermal" ] || thermal=na; [ -n "$commit_bytes" ] || commit_bytes=na; [ -n "$commit_ms" ] || commit_ms=na; [ -n "$thermo_source" ] || thermo_source=na; [ -n "$n" ] || n=na
  if [ "$arm" = B ] && [ "$row_void" -eq 0 ] && { [ "${fallback:-0}" -gt 0 ] || [ -z "$governor" ]; }; then
    row_void=1
    void_reason=governor_fallback
  fi
  reuse_line=$(last_reuse_after "$logcat"); a_reused=$(printf '%s' "$reuse_line" | sed -n 's/.*reusing \([0-9][0-9]*\)\/\([0-9][0-9]*\).*/\1/p'); a_total=$(printf '%s' "$reuse_line" | sed -n 's/.*reusing \([0-9][0-9]*\)\/\([0-9][0-9]*\).*/\2/p')
  if [ "$arm" = A ]; then [ -n "${a_reused:-}" ] && [ -n "${a_total:-}" ] && new_tokens_a=$((a_total - a_reused)); else new_tokens_b=$(chunk_sum "$prefill_chunks" 2>/dev/null || printf 'na'); fi
  if [ "$arm" = A ]; then awk -v n="$new_tokens_a" 'BEGIN{exit !(n ~ /^[0-9]+$/&&n>=938*0.9&&n<=938*1.1)}' >/dev/null 2>&1 || row_void=1; else awk -v n="$new_tokens_b" 'BEGIN{exit !(n ~ /^[0-9]+$/&&n>=938*0.9&&n<=938*1.1)}' >/dev/null 2>&1 || row_void=1; fi
  if [ -n "$bench" ] && parse_tokens "$bench" "$ids_file"; then ids_sha=$(/usr/bin/shasum -a 256 "$ids_file" | awk '{print $1}'); else printf 'VOID n=%s\n' "$n" > "$ids_file"; fi
  if [ "$row_void" -eq 1 ]; then ids_sha=na; printf 'VOID n=%s\n' "$n" > "$ids_file"; fi
  if [ "$arm" = A ]; then
    A_IDS_FILE="$ids_file"
    [ "$ids_sha" = na ] && A_IDS_VALID=0 || A_IDS_VALID=1
    [ "$ORACLE_MODE" = logit ] && A_PROBS_FILE="$probs_file"
  else
    if [ "$ids_sha" = na ] || [ "$A_IDS_VALID" -ne 1 ]; then oracle=VOID; elif diff -q "$A_IDS_FILE" "$ids_file" >/dev/null 2>&1; then oracle=PASS; else oracle=FAIL; fi
    if [ "$ORACLE_MODE" = logit ]; then
      [ "$A_IDS_VALID" -eq 1 ] && oracle_mode=TF || oracle_mode=G
      if [ "$row_void" -eq 0 ] && [ -s "${A_PROBS_FILE:-}" ] && [ -s "$probs_file" ]; then
        oracle_result=$(oracle_logit_eval "$A_PROBS_FILE" "$probs_file" "$oracle_mode")
        oracle_logit=$(printf '%s\n' "$oracle_result" | sed -n 's/.*oracle=\([^ ]*\).*/\1/p')
        oracle_rule=$(printf '%s\n' "$oracle_result" | sed -n 's/.*rule=\([^ ]*\).*/\1/p')
      else
        oracle_logit=DESCRIPTIVE; oracle_rule=R4
      fi
      [ -n "$oracle_logit" ] || oracle_logit=DESCRIPTIVE
      [ -n "$oracle_rule" ] || oracle_rule=R4
    fi
  fi
  if [ "$ORACLE_MODE" = logit ] && [ "$arm" = A ]; then oracle_mode=TF; fi
  if [ "$row_void" -eq 0 ] && [ "$arm" = A ] && [ "$turn" = 1 ] && [ "$telemetry_rc" -eq 0 ] && [ -z "$bench" ]; then runtime_prereq=1; printf 'PREREQUISITE OPEN: missing KALSA_BENCH_TOKENS after first turn; app sampling contract is absent.\n' > "$RAW/PREREQUISITE.txt"; fi
  if [ "$arm" = B ] && [ "$row_void" -eq 0 ]; then [ "${fallback:-0}" -eq 0 ] || status=1; [ "$decode_engine" = CPU ] || status=1; if [ "$thermal" = FAST ] && [ "$prefill" != GPU ]; then status=1; fi; [ "$thermal" != na ] || status=1; [ "${governor_count:-0}" -eq 1 ] || status=1; [ "$thermo_source" = bench-skin ] || status=1; awk -v v="$commit_bytes" 'BEGIN{exit !(v ~ /^[0-9]+([.][0-9]+)?$/)}' >/dev/null 2>&1 || status=1; awk -v v="$commit_ms" 'BEGIN{exit !(v ~ /^[0-9]+([.][0-9]+)?$/)}' >/dev/null 2>&1 || status=1; fi
  [ "${lmkd:-0}" -eq 0 ] || status=1; printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$arm" "$turn" "$ttft" "$prefill_ms" "$prefill_chunks" "$new_tokens_a" "$new_tokens_b" "$decode" "$prefill" "$decode_engine" "$thermal" "$skin_before" "$skin_after" "$fallback" "$lmkd" "$ids_sha" "$oracle" "$oracle_logit" "$oracle_rule" | tee -a "$RESULTS"; printf 'status=%s row_void=%s cooldown_s=%s cool_target_c=%s thermo=%s governor_count=%s commit_bytes=%s commit_ms=%s thermo_source=%s oracle_mode=%s anchor_epoch=%s anchor_stamp=%s telemetry_rc=%s new_tokens_a=%s new_tokens_b=%s structuredCalls=%s tool_calls=%s void_reason=%s logcat_rc=%s logcat_retries=%s\n' "$status" "$row_void" "$cooldown_s" "$COOL_TARGET_C" "$thermo" "$governor_count" "$commit_bytes" "$commit_ms" "$thermo_source" "$oracle_mode" "$ANCHOR_EPOCH" "$ANCHOR_STAMP" "$telemetry_rc" "$new_tokens_a" "$new_tokens_b" "$structured_calls" "$tool_calls" "$void_reason" "$LOGCAT_RC" "$LOGCAT_RETRIES" > "${prefix}_status.txt"
  adbT 60 -s "$SER" shell "am force-stop $PKG" > "${prefix}_force_stop.txt" 2>&1 || status=1; adbT 120 -s "$SER" shell "pm uninstall $PKG" > "${prefix}_uninstall.txt" 2>&1; [ "$?" -eq 0 ] || status=1
  [ "$runtime_prereq" -eq 0 ] || exit 3; return "$status"
}
FIRST_SKIN_C=$(thermal_record session_pre) || { log "NO_VALID_INITIAL_SKIN void_reason=thermal"; exit 6; }; PREV_SKIN="$FIRST_SKIN_C"; PREV_TIME=$(date +%s); model_setup || exit 5; FINAL_RC=0; A_TURN=0; B_TURN=0
for ((i=0; i<${#ARM_ORDER}; i++)); do deadline_check; arm="${ARM_ORDER:i:1}"; if [ "$arm" = A ]; then A_TURN=$((A_TURN+1)); turn="$A_TURN"; else B_TURN=$((B_TURN+1)); turn="$B_TURN"; fi; run_observation "$arm" "$turn" || { FINAL_RC=1; log "ABORT arm=$arm turn=$turn"; break; }; done
log "DONE board=$BOARD final_rc=$FINAL_RC results=$RESULTS"; exit "$FINAL_RC"
