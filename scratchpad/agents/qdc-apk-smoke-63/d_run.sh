#!/bin/bash
# Cell #63 QDC headless APK smoke. Usage: ./d_run.sh <job_tag>
# ci-lib.sh is not sourced: its device helpers use bare, uncapped adb and its
# device install_and_sideload path refuses the required model sideload. This
# keeps the same one-turn adb/UI/DB primitives under adbT, with run-as for every
# operation that reads or writes the app sandbox.
set -u
JOB="${1:?usage: d_run.sh <job_tag>}"
DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-apk-smoke-63"; RAW="$DIR/raw"; STEPS="$RAW/steps_$JOB.txt"
mkdir -p "$RAW"; : > "$STEPS"
export ANDROID_ADB_SERVER_PORT=6037 IME_SUSPEND=1
PKG=com.kalsa.app
APK_A="$HOME/kalsa-qdc/apk/apk-A-debug-c513f00/app-release.apk"
APK_B="$HOME/kalsa-qdc/apk/apk-B-debug-09bdfe9/app-release.apk"
MODEL="$HOME/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"; MODEL_SIZE=1593894944; MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf; D=/data/local/tmp/kalsa63; GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"; SCREEN_OFF_TIMEOUT=""; SCREEN_OFF_TIMEOUT_SAVED=0; WAKEFULNESS=unknown
log() { echo "[$(date +%H:%M:%S)] $*"; }
adbT() {
  local seconds="$1"
  shift
  perl -e 'alarm shift; exec @ARGV or exit 127' "$seconds" adb "$@"
}
device_wake() {
  local wake_line
  if [ "$SCREEN_OFF_TIMEOUT_SAVED" -eq 0 ]; then SCREEN_OFF_TIMEOUT_SAVED=1; SCREEN_OFF_TIMEOUT=$(adbT 60 -s "$SER" shell "settings get system screen_off_timeout" | tr -d '\r'); fi
  { echo "saved_screen_off_timeout=$SCREEN_OFF_TIMEOUT"; adbT 60 -s "$SER" shell "input keyevent KEYCODE_WAKEUP" || true
    adbT 60 -s "$SER" shell "wm dismiss-keyguard" || true; adbT 60 -s "$SER" shell "svc power stayon true" || true
    adbT 60 -s "$SER" shell "settings put system screen_off_timeout 1800000" || true
    wake_line=$(adbT 60 -s "$SER" shell "dumpsys power | grep mWakefulness=" | tr -d '\r') || true; printf '%s\n' "$wake_line"
  } >> "$RAW/wake_$JOB.txt" 2>&1
  WAKEFULNESS=$(printf '%s\n' "$wake_line" | sed -n 's/.*mWakefulness=\([^, ]*\).*/\1/p' | sed -n '1p'); [ -n "$WAKEFULNESS" ] || WAKEFULNESS=unknown
}
step() { local label="$1" name="$2" status="$3" detail="${4//$'\n'/ }"; printf 'STEP %s %s %s %s\n' "$label" "$name" "$status" "$detail" >> "$STEPS"; log "STEP $label $name $status $detail"; }
skip_steps() { local label="$1" detail="$2" name; for name in S2 S3 S4 S5; do step "$label" "$name" fail "$detail"; done; }
verify_local_sha() { local path="$1" expected="$2" actual; actual=$(shasum -a 256 "$path" 2>/dev/null | awk '{print $1}'); if [ "$actual" != "$expected" ]; then log "LOCAL_SHA_MISMATCH $path got=$actual"; return 1; fi; log "local sha verified: $path"; }

for apk in "$APK_A" "$APK_B"; do
  [ -f "$apk" ] || { log "APK_MISSING path=$apk"; exit 4; }
done
[ -f "$MODEL" ] || { log "MODEL_MISSING path=$MODEL"; exit 5; }

SER=$(adbT 60 devices | awk 'NR>1 && $2=="device"{print $1; exit}')
[ -n "$SER" ] || { log "NO_DEVICE on 6037"; exit 2; }; log "device=$SER job=$JOB"
IME_SAVED=""; IME_SUSPENDED=0
restore_ime() { [ "$IME_SUSPENDED" -eq 1 ] || return 0; IME_SUSPENDED=0; adbT 60 -s "$SER" shell "ime enable $IME_SAVED" >/dev/null 2>&1 || true; adbT 60 -s "$SER" shell "ime set $IME_SAVED" >/dev/null 2>&1 || true; log "ime restored: $IME_SAVED"; }
device_wake_restore() {
  adbT 60 -s "$SER" shell "svc power stayon false" >/dev/null 2>&1 || true
  [ -n "$SCREEN_OFF_TIMEOUT" ] || return 0
  adbT 60 -s "$SER" shell "settings put system screen_off_timeout $SCREEN_OFF_TIMEOUT" >/dev/null 2>&1 || true
}
trap 'restore_ime; device_wake_restore' EXIT
{
  echo "serial=$SER"; echo "port=$ANDROID_ADB_SERVER_PORT"
  echo "getprop ro.soc.model"; adbT 60 -s "$SER" shell getprop ro.soc.model
  echo "getprop ro.product.model"; adbT 60 -s "$SER" shell getprop ro.product.model
  echo "getprop ro.build.fingerprint"; adbT 60 -s "$SER" shell getprop ro.build.fingerprint
  echo "getprop ro.build.type"; adbT 60 -s "$SER" shell getprop ro.build.type
  echo "getprop ro.debuggable"; adbT 60 -s "$SER" shell getprop ro.debuggable
  echo "id"; adbT 60 -s "$SER" shell id
  echo "root escalation: not attempted; run-as path is the test"
} > "$RAW/recon_$JOB.txt" 2>&1
adbT 60 -s "$SER" wait-for-device >/dev/null 2>&1 || true
device_wake
verify_local_sha "$MODEL" "$MODEL_SHA" || exit 5
LOCAL_MODEL_SIZE=$(wc -c < "$MODEL" 2>/dev/null | tr -d '[:space:]'); [ "$LOCAL_MODEL_SIZE" = "$MODEL_SIZE" ] || { log "LOCAL_MODEL_SIZE_MISMATCH got=$LOCAL_MODEL_SIZE"; exit 5; }
if ! adbT 60 -s "$SER" shell "mkdir -p $D"; then log "MKDIR_FAIL $D"; exit 5; fi
MODEL_REMOTE="$D/$MODEL_FILE"; DEVICE_MODEL_SHA=$(adbT 300 -s "$SER" shell "sha256sum $MODEL_REMOTE 2>/dev/null" | awk '{print $1}' | tr -d '\r')
if [ "$DEVICE_MODEL_SHA" = "$MODEL_SHA" ]; then
  log "model resume: device sha verified; skipping push"
else
  log "pushing model (cap 3600s)"; adbT 3600 -s "$SER" push "$MODEL" "$MODEL_REMOTE" > "$RAW/model_push_$JOB.txt" 2>&1; rc=$?
  [ "$rc" -eq 0 ] || { log "MODEL_PUSH_FAIL rc=$rc"; exit 5; }
  DEVICE_MODEL_SHA=$(adbT 300 -s "$SER" shell "sha256sum $MODEL_REMOTE" | awk '{print $1}' | tr -d '\r')
  [ "$DEVICE_MODEL_SHA" = "$MODEL_SHA" ] || {
    log "DEVICE_MODEL_SHA_MISMATCH got=$DEVICE_MODEL_SHA"
    exit 5
  }
  log "model push verified on device"
fi
adbT 60 -s "$SER" shell "chmod 644 $MODEL_REMOTE" > "$RAW/model_chmod_$JOB.txt" 2>&1; rc=$?
[ "$rc" -eq 0 ] || { log "MODEL_CHMOD_FAIL rc=$rc"; exit 5; }
thermal_record() {
  local prefix="$1" phase="$2" gate_rc
  local out="${prefix}_thermal_${phase}.txt" status="${prefix}_thermal_${phase}.status"; : > "$out"
  if [ -x "$GATE" ]; then
    # Record only: thermal_gate.sh's PASS/FAIL is ignored; cap its whole process.
    perl -e 'alarm shift; exec @ARGV or exit 127' 90 "$GATE" "$SER" "$out" > "$status" 2>&1; gate_rc=$?; cat "$status" >> "$out"; echo "thermal_recorder_rc=$gate_rc" >> "$out"
  else echo "thermal recorder missing: $GATE" >> "$out"; fi; return 0
}
logcat_all() { local cap="$1" dest="$2"; adbT "$cap" -s "$SER" logcat -d -b all > "$dest" 2>&1; }
MODEL_LOAD_PATTERN='llama_model_loader: loaded meta data with .* from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf'
PREWARM_DONE_PATTERN='KALSA_PREWARM.*"op":"done"'
has_load_proof() { grep -E "$MODEL_LOAD_PATTERN" "$1" >/dev/null 2>&1 && grep -E "$PREWARM_DONE_PATTERN" "$1" >/dev/null 2>&1; }
write_load_proof() { local source="$1" dest="$2"; grep -E "$MODEL_LOAD_PATTERN|$PREWARM_DONE_PATTERN" "$source" > "$dest" 2>/dev/null || true; }
poll_load() {
  local dest="$1" elapsed=0; while [ "$elapsed" -lt 300 ]; do logcat_all 60 "$dest" || true; has_load_proof "$dest" && return 0; sleep 5; elapsed=$((elapsed + 5)); done; logcat_all 60 "$dest" || true; has_load_proof "$dest"
}
poll_telemetry() {
  local dest="$1" elapsed=0; while [ "$elapsed" -lt 600 ]; do logcat_all 60 "$dest" || true; grep -E 'KALSA_TELEMETRY.*"tokensPredicted"[[:space:]]*:[[:space:]]*[1-9][0-9]*' "$dest" >/dev/null 2>&1 && return 0; sleep 5; elapsed=$((elapsed + 5)); done; logcat_all 60 "$dest" || true; grep -E 'KALSA_TELEMETRY.*"tokensPredicted"[[:space:]]*:[[:space:]]*[1-9][0-9]*' "$dest" >/dev/null 2>&1
}

dump_ui_to() { local dest="$1"; adbT 60 -s "$SER" shell "uiautomator dump $D/ui.xml >/dev/null 2>&1" || return 1; adbT 60 -s "$SER" shell "cat $D/ui.xml" > "$dest" 2>&1 || return 1; tr -d '\r' < "$dest" > "$dest.tmp" && mv "$dest.tmp" "$dest"; [ -s "$dest" ]; }
bounds_edit() {
  tr '>' '\n' < "$1" | grep 'class="android.widget.EditText"' |
    sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' |
    sed -n '1p'
}
bounds_node() {
  local needle="$1"
  tr '>' '\n' < "$2" | grep -E "content-desc=\"$needle\"|text=\"$needle\"" |
    sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' |
    sed -n '1p'
}
tap_bounds() { local bounds="$1" x1=0 y1=0 x2=0 y2=0; read -r x1 y1 x2 y2 <<< "$bounds"; adbT 60 -s "$SER" shell input tap "$(( (x1 + x2) / 2 ))" "$(( (y1 + y2) / 2 ))"; }
PROMPT='Reply with one short sentence about mountains'
type_prompt() { local -a words; local word first=1; read -r -a words <<< "$PROMPT"; for word in "${words[@]}"; do if [ "$first" -eq 0 ]; then adbT 60 -s "$SER" shell input keyevent 62 || return 1; fi; adbT 60 -s "$SER" shell input text "$word" || return 1; first=0; done; }

ime_suspend() { [ "$IME_SUSPEND" = 1 ] && [ "$IME_SUSPENDED" -eq 0 ] || return 0; IME_SAVED=$(adbT 60 -s "$SER" shell settings get secure default_input_method 2>/dev/null | tr -d '\r'); case "$IME_SAVED" in ''|null) log "ime default unavailable; continuing"; return 0;; esac; if adbT 60 -s "$SER" shell "ime disable $IME_SAVED" >/dev/null 2>&1; then IME_SUSPENDED=1; log "ime suspended: $IME_SAVED"; else log "ime suspend failed; continuing best effort"; fi; }

pull_rkstorage() {
  local dir="$1"
  adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage > "$dir/RKStorage" \
    2> "$dir/pull.err" || return 1
  if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage-wal" >/dev/null 2>&1; then
    adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage-wal > "$dir/RKStorage-wal" \
      2>> "$dir/pull.err" || return 1
  fi
  if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage-shm" >/dev/null 2>&1; then
    adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage-shm > "$dir/RKStorage-shm" \
      2>> "$dir/pull.err" || return 1
  fi
}
set_model_pref() {
  local dbdir remote
  dbdir=$(mktemp -d "${TMPDIR:-/tmp}/kalsa63-rkstorage.XXXXXX") || return 1
  echo "sql_path=host sqlite3 on run-as-pulled RKStorage; adb push then run-as cp/rm"
  pull_rkstorage "$dbdir" || { rm -rf "$dbdir"; return 1; }
  sqlite3 -bail "$dbdir/RKStorage" \
    "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR');" \
    >/dev/null || { rm -rf "$dbdir"; return 1; }
  sqlite3 -bail "$dbdir/RKStorage" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1 || {
    rm -rf "$dbdir"; return 1
  }
  remote="$D/rkstorage-$$"
  if ! adbT 300 -s "$SER" push "$dbdir/RKStorage" "$remote" >/dev/null 2>&1 ||
    ! adbT 120 -s "$SER" shell "run-as $PKG cp $remote databases/RKStorage" >/dev/null 2>&1 ||
    ! adbT 60 -s "$SER" shell "run-as $PKG rm -f databases/RKStorage-wal databases/RKStorage-shm" >/dev/null 2>&1; then
    adbT 60 -s "$SER" shell "rm -f $remote" >/dev/null 2>&1 || true
    rm -rf "$dbdir"
    return 1
  fi
  adbT 60 -s "$SER" shell "rm -f $remote" >/dev/null 2>&1 || true
  rm -rf "$dbdir"
  echo "SQL=INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR');"
}

capture_evidence() {
  local prefix="$1" rc=0 pid dbdir
  logcat_all 300 "${prefix}_logcat_all.txt" || rc=1
  dbdir="${prefix}_chat_RKStorage"; mkdir -p "$dbdir"
  pull_rkstorage "$dbdir" || rc=1
  adbT 60 -s "$SER" shell "run-as $PKG ls -la files/models/$MODEL_DIR" > "${prefix}_model_ls.txt" 2>&1 || rc=1
  grep -E 'KALSA_SESSION|KALSA_TELEMETRY' "${prefix}_logcat_all.txt" > \
    "${prefix}_session_telemetry.txt" 2>/dev/null || true
  grep -E "$MODEL_LOAD_PATTERN|$PREWARM_DONE_PATTERN" "${prefix}_logcat_all.txt" > \
    "${prefix}_s4_proof.txt" 2>/dev/null || true
  grep -F 'kalsa-native-patches' "${prefix}_logcat_all.txt" > \
    "${prefix}_native_banner.txt" 2>/dev/null || true
  pid=$(adbT 60 -s "$SER" shell "pidof $PKG" | awk 'NR==1{print $1; exit}' | tr -d '\r')
  if [ -n "$pid" ]; then
    adbT 120 -s "$SER" exec-out run-as "$PKG" cat "/proc/$pid/maps" > \
      "${prefix}_maps.txt" 2>&1 || rc=1
    grep -F librnllama "${prefix}_maps.txt" > "${prefix}_maps_librnllama.txt" 2>/dev/null || true
  else
    echo "pidof $PKG returned no pid" > "${prefix}_maps.txt"
    : > "${prefix}_maps_librnllama.txt"
  fi
  adbT 60 -s "$SER" exec-out screencap -p > "${prefix}.png" \
    2> "${prefix}_screencap.err" || rc=1
  dump_ui_to "${prefix}_ui.xml" || rc=1
  return "$rc"
}
finish_apk() {
  local label="$1" prefix="$2" evidence_rc uninstall_rc rc=0
  [ -f "${prefix}_thermal_pre_s4.txt" ] || thermal_record "$prefix" pre_s4; [ -f "${prefix}_thermal_post_s5.txt" ] || thermal_record "$prefix" post_s5
  capture_evidence "$prefix"; evidence_rc=$?
  if [ "$evidence_rc" -eq 0 ]; then step "$label" S6 ok "evidence captured"; else step "$label" S6 fail "evidence incomplete rc=$evidence_rc"; rc=1; fi
  adbT 120 -s "$SER" shell "pm uninstall $PKG" > "${prefix}_s7_uninstall.txt" 2>&1; uninstall_rc=$?
  if [ "$uninstall_rc" -eq 0 ]; then step "$label" S7 ok "uninstalled"; else step "$label" S7 fail "pm uninstall rc=$uninstall_rc"; rc=1; fi
  return "$rc"
}

run_apk() {
  local label="$1" apk="$2" prefix="$RAW/${1}_$JOB"
  local apk_sha rc pm_rc flags_rc copy_rc stat_rc size stat_output first_rc force_rc sql_rc clear_rc launch_rc load_rc
  local s5_rc=1 evidence_rc arm_rc=0 s5_detail="" s2_detail="" edit_bounds send_bounds s3_detail="" db_retry=0 retry_launch_rc=0 retry_force_rc=0
  log "=== APK $label ==="
  apk_sha=$(shasum -a 256 "$apk" | awk '{print $1}')
  adbT 300 -s "$SER" install -r "$apk" > "${prefix}_s1_install.txt" 2>&1
  rc=$?
  adbT 60 -s "$SER" shell "pm dump $PKG" > "${prefix}_s1_pm_dump.txt" 2>&1
  pm_rc=$?
  if [ "$rc" -ne 0 ]; then
    step "$label" S1 fail "adb install rc=$rc pm_dump_rc=$pm_rc sha=$apk_sha"
    step "$label" S0 fail "METHOD-VOID skipped after S1"
    skip_steps "$label" "skipped after S1"
    finish_apk "$label" "$prefix"
    return 1
  fi
  step "$label" S1 ok "install_rc=0 pm_dump_rc=$pm_rc sha=$apk_sha"
  # S0: the flag must be proven on the installed package before using run-as.
  adbT 60 -s "$SER" shell "dumpsys package $PKG | grep -i flags" > "${prefix}_s0_flags.txt" 2>&1
  flags_rc=$?
  if [ "$flags_rc" -eq 0 ] && grep -qi DEBUGGABLE "${prefix}_s0_flags.txt"; then
    step "$label" S0 ok "DEBUGGABLE flag proven flags_rc=$flags_rc"
  else
    step "$label" S0 fail "METHOD-VOID DEBUGGABLE absent flags_rc=$flags_rc"
    skip_steps "$label" "METHOD-VOID skipped after S0"
    finish_apk "$label" "$prefix"
    return 1
  fi
  # S2: run-as copy, and exact completeness check through run-as.
  adbT 300 -s "$SER" shell "run-as $PKG sh -c 'mkdir -p files/models/$MODEL_DIR && cp $D/$MODEL_FILE files/models/$MODEL_DIR/$MODEL_FILE'" > \
    "${prefix}_s2_copy.txt" 2>&1
  copy_rc=$?
  stat_rc=1
  stat_output=""
  size=""
  if [ "$copy_rc" -eq 0 ]; then
    stat_output=$(adbT 60 -s "$SER" shell "run-as $PKG stat -c %s files/models/$MODEL_DIR/$MODEL_FILE" 2>&1)
    stat_rc=$?
    printf '%s\n' "$stat_output" >> "${prefix}_s2_copy.txt"
    size=$(printf '%s\n' "$stat_output" | tr -d '[:space:]')
  fi
  if [ "$copy_rc" -ne 0 ] || [ "$stat_rc" -ne 0 ] || [ "$size" != "$MODEL_SIZE" ]; then
    if grep -Eiq 'run-as:.*(not debuggable|uid)|package not debuggable' "${prefix}_s2_copy.txt"; then
      s2_detail="G2 RUN_AS_REFUSED"
    else
      s2_detail="run-as copy failed"
    fi
    step "$label" S2 fail "$s2_detail copy_rc=$copy_rc stat_rc=$stat_rc size=$size expected=$MODEL_SIZE"
    skip_steps "$label" "skipped after S2 ($s2_detail)"
    finish_apk "$label" "$prefix"
    return 1
  fi
  step "$label" S2 ok "sideload=run-as size=$size"
  # S3 first-launch DB creation, then the host-sqlite3 model selection write.
  device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" > "${prefix}_s3_first_launch.txt" 2>&1
  first_rc=$?
  sleep 25
  adbT 60 -s "$SER" shell "am force-stop $PKG" >> "${prefix}_s3_first_launch.txt" 2>&1
  force_rc=$?
  if ! adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage" >/dev/null 2>&1; then
    db_retry=1; device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" >> "${prefix}_s3_first_launch.txt" 2>&1; retry_launch_rc=$?; sleep 25
    adbT 60 -s "$SER" shell "am force-stop $PKG" >> "${prefix}_s3_first_launch.txt" 2>&1; retry_force_rc=$?
    [ "$retry_launch_rc" -eq 0 ] || first_rc=$retry_launch_rc; [ "$retry_force_rc" -eq 0 ] || force_rc=$retry_force_rc
  fi
  set_model_pref > "${prefix}_s3_sql.txt" 2>&1
  sql_rc=$?
  s3_detail="first_launch=$first_rc force_stop=$force_rc sql=$sql_rc"; [ "$db_retry" -eq 1 ] && s3_detail="$s3_detail db_retry=1"
  if [ "$first_rc" -eq 0 ] && [ "$force_rc" -eq 0 ] && [ "$sql_rc" -eq 0 ]; then step "$label" S3 ok "$s3_detail"; else step "$label" S3 fail "$s3_detail"; arm_rc=1; fi
  thermal_record "$prefix" pre_s4
  adbT 60 -s "$SER" logcat -c > "${prefix}_s4_clear.txt" 2>&1
  clear_rc=$?
  device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" > "${prefix}_s4_launch.txt" 2>&1
  launch_rc=$?
  load_rc=1
  if [ "$clear_rc" -eq 0 ] && [ "$launch_rc" -eq 0 ]; then
    poll_load "${prefix}_s4_logcat.txt"; load_rc=$?
  else
    : > "${prefix}_s4_logcat.txt"
  fi
  write_load_proof "${prefix}_s4_logcat.txt" "${prefix}_s4_proof.txt"
  if [ "$load_rc" -eq 0 ]; then step "$label" S4 ok "llama_model_loader + KALSA_PREWARM done wake=$WAKEFULNESS"; else step "$label" S4 fail "clear=$clear_rc launch=$launch_rc load_or_prewarm_timeout wake=$WAKEFULNESS"; arm_rc=1; fi
  # S5 tap/type/send: IME-suspended, live uiautomator bounds, space-safe input.
  ime_suspend
  if dump_ui_to "${prefix}_s5_edit.xml"; then edit_bounds=$(bounds_edit "${prefix}_s5_edit.xml"); else edit_bounds=""; fi
  if [ -z "$edit_bounds" ]; then s5_detail="METHOD-VOID EditText not found"
  elif ! tap_bounds "$edit_bounds"; then s5_detail="METHOD-VOID EditText tap failed"
  elif ! type_prompt; then s5_detail="METHOD-VOID prompt typing failed"
  elif ! dump_ui_to "${prefix}_s5_send.xml"; then s5_detail="METHOD-VOID Send dump failed"
  else
    send_bounds=$(bounds_node Send "${prefix}_s5_send.xml")
    if [ -z "$send_bounds" ]; then s5_detail="METHOD-VOID Send node not found"
    elif ! tap_bounds "$send_bounds"; then s5_detail="METHOD-VOID Send tap failed"
    else
      poll_telemetry "${prefix}_s5_logcat.txt"; s5_rc=$?
      if [ "$s5_rc" -eq 0 ]; then s5_detail="KALSA_TELEMETRY tokensPredicted>0"; else s5_detail="telemetry timeout or missing"; fi
    fi
  fi
  thermal_record "$prefix" post_s5
  if [ "$s5_detail" = "KALSA_TELEMETRY tokensPredicted>0" ]; then step "$label" S5 ok "$s5_detail"; else step "$label" S5 fail "$s5_detail"; arm_rc=1; fi
  finish_apk "$label" "$prefix"; evidence_rc=$?; [ "$evidence_rc" -eq 0 ] || arm_rc=1
  return "$arm_rc"
}

FINAL_RC=0
run_apk A "$APK_A"; rc=$?; [ "$rc" -eq 0 ] || FINAL_RC=1
run_apk B "$APK_B"; rc=$?; [ "$rc" -eq 0 ] || FINAL_RC=1
log "DONE FINAL_RC=$FINAL_RC — raw/ populated. Remember: End Session in the portal."
exit "$FINAL_RC"
