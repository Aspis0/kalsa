#!/bin/bash
# Cell #61 QDC headless APK smoke. Usage: ./d_run.sh <job_tag>
# ci-lib.sh is not sourced: its device helpers use bare, uncapped adb and its
# device install_and_sideload path refuses the required model sideload. This
# keeps the same one-turn adb/UI/DB primitives under adbT. S3 uses the ci-lib
# fallback: pull RKStorage (+ WAL/SHM) through run-as, edit with Mac sqlite3,
# then push RKStorage back through run-as.
set -u
JOB="${1:?usage: d_run.sh <job_tag>}"
DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-apk-smoke-61"; RAW="$DIR/raw"; STEPS="$RAW/steps_$JOB.txt"
mkdir -p "$RAW"; : > "$STEPS"
export ANDROID_ADB_SERVER_PORT=6037 IME_SUSPEND=1
PKG=com.kalsa.app
APK_A="$HOME/kalsa-qdc/apk/apk-A-c513f00/app-release.apk"; APK_A_SHA=e0d56a398bbd1cb102dbab635272b7b88c43b22e6cd8896538c313603b774403
APK_B="$HOME/kalsa-qdc/apk/apk-B-09bdfe9/kalsa-apk-arm64-v8a-09bdfe949403db7cd793da9471c5a78c50d62966/app-release.apk"; APK_B_SHA=1e2709e57561e97149664ea30588b7df9141c25a6813642cdda1c3ddf9d7f86d
MODEL="$HOME/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"; MODEL_SIZE=1593894944; MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf; D=/data/local/tmp/kalsa61; GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"
log() { echo "[$(date +%H:%M:%S)] $*"; }
adbT() {
  local seconds="$1"
  shift
  perl -e 'alarm shift; exec @ARGV or exit 127' "$seconds" adb "$@"
}
step() { local label="$1" name="$2" status="$3" detail="${4//$'\n'/ }"; printf 'STEP %s %s %s %s\n' "$label" "$name" "$status" "$detail" >> "$STEPS"; log "STEP $label $name $status $detail"; }
skip_steps() { local label="$1" detail="$2" name; for name in S2 S3 S4 S5; do step "$label" "$name" fail "$detail"; done; }
verify_local_sha() { local path="$1" expected="$2" actual; actual=$(shasum -a 256 "$path" 2>/dev/null | awk '{print $1}'); if [ "$actual" != "$expected" ]; then log "LOCAL_SHA_MISMATCH $path got=$actual"; return 1; fi; log "local sha verified: $path"; }

SER=$(adbT 60 devices | awk 'NR>1 && $2=="device"{print $1; exit}')
[ -n "$SER" ] || { log "NO_DEVICE on 6037"; exit 2; }; log "device=$SER job=$JOB"
{
  echo "serial=$SER"; echo "port=$ANDROID_ADB_SERVER_PORT"
  echo "getprop ro.soc.model"; adbT 60 -s "$SER" shell getprop ro.soc.model
  echo "getprop ro.product.model"; adbT 60 -s "$SER" shell getprop ro.product.model
  echo "getprop ro.build.fingerprint"; adbT 60 -s "$SER" shell getprop ro.build.fingerprint
  echo "id"; adbT 60 -s "$SER" shell id; echo "adb root (record only)"
  if adbT 60 -s "$SER" root; then echo "adb_root=success"; else echo "adb_root=failed"; fi
} > "$RAW/recon_$JOB.txt" 2>&1
adbT 60 -s "$SER" wait-for-device >/dev/null 2>&1 || true
verify_local_sha "$APK_A" "$APK_A_SHA" || exit 5; verify_local_sha "$APK_B" "$APK_B_SHA" || exit 5; verify_local_sha "$MODEL" "$MODEL_SHA" || exit 5
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
thermal_record() {
  local prefix="$1" phase="$2" out="${prefix}_thermal_${phase}.txt" status="${prefix}_thermal_${phase}.status" gate_rc; : > "$out"
  if [ -x "$GATE" ]; then
    # Record only: thermal_gate.sh's PASS/FAIL is ignored; cap its whole process.
    perl -e 'alarm shift; exec @ARGV or exit 127' 90 "$GATE" "$SER" "$out" > "$status" 2>&1; gate_rc=$?; cat "$status" >> "$out"; echo "thermal_recorder_rc=$gate_rc" >> "$out"
  else echo "thermal recorder missing: $GATE" >> "$out"; fi; return 0
}
logcat_all() { local cap="$1" dest="$2"; adbT "$cap" -s "$SER" logcat -d -b all > "$dest" 2>&1; }
has_load() { awk '/KALSA_SESSION/ && /"op":"load"/ && /"ok":true/ {found=1} END {exit (found ? 0 : 1)}' "$1"; }
poll_load() {
  local dest="$1" elapsed=0; while [ "$elapsed" -lt 300 ]; do logcat_all 60 "$dest" || true; has_load "$dest" && return 0; sleep 5; elapsed=$((elapsed + 5)); done; logcat_all 60 "$dest" || true; has_load "$dest"
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

IME_SAVED=""; IME_SUSPENDED=0
restore_ime() { [ "$IME_SUSPENDED" -eq 1 ] || return 0; IME_SUSPENDED=0; adbT 60 -s "$SER" shell "ime enable $IME_SAVED" >/dev/null 2>&1 || true; adbT 60 -s "$SER" shell "ime set $IME_SAVED" >/dev/null 2>&1 || true; log "ime restored: $IME_SAVED"; }
trap restore_ime EXIT
ime_suspend() { [ "$IME_SUSPEND" = 1 ] && [ "$IME_SUSPENDED" -eq 0 ] || return 0; IME_SAVED=$(adbT 60 -s "$SER" shell settings get secure default_input_method 2>/dev/null | tr -d '\r'); case "$IME_SAVED" in ''|null) log "ime default unavailable; continuing"; return 0;; esac; if adbT 60 -s "$SER" shell "ime disable $IME_SAVED" >/dev/null 2>&1; then IME_SUSPENDED=1; log "ime suspended: $IME_SAVED"; else log "ime suspend failed; continuing best effort"; fi; }

pull_rkstorage() {
  local dir="$1" have_wal=0 have_shm=0
  local -a files=(RKStorage)
  if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage-wal" >/dev/null 2>&1; then
    have_wal=1; files+=(RKStorage-wal)
  fi
  if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage-shm" >/dev/null 2>&1; then
    have_shm=1; files+=(RKStorage-shm)
  fi
  if adbT 300 -s "$SER" exec-out run-as "$PKG" tar cf - -C databases "${files[@]}" \
    > "$dir/rkstorage.tar" 2> "$dir/pull.err"; then
    tar xf "$dir/rkstorage.tar" -C "$dir" 2>/dev/null && [ -f "$dir/RKStorage" ] && return 0
  fi
  rm -f "$dir/RKStorage" "$dir/RKStorage-wal" "$dir/RKStorage-shm"
  adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage \
    > "$dir/RKStorage" 2> "$dir/pull.err" || return 1
  [ "$have_wal" -eq 0 ] || adbT 120 -s "$SER" exec-out run-as "$PKG" \
    cat databases/RKStorage-wal > "$dir/RKStorage-wal" 2> "$dir/pull.err" || return 1
  [ "$have_shm" -eq 0 ] || adbT 120 -s "$SER" exec-out run-as "$PKG" \
    cat databases/RKStorage-shm > "$dir/RKStorage-shm" 2> "$dir/pull.err" || return 1
}
set_model_pref() {
  local dbdir remote
  dbdir=$(mktemp -d "${TMPDIR:-/tmp}/kalsa61-rkstorage.XXXXXX") || return 1
  echo "sql_path=host sqlite3 on pulled RKStorage; push through run-as"
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
  local prefix="$1" rc=0 pid
  logcat_all 300 "${prefix}_logcat_all.txt" || rc=1
  grep -E 'KALSA_SESSION|KALSA_TELEMETRY' "${prefix}_logcat_all.txt" > \
    "${prefix}_session_telemetry.txt" 2>/dev/null || true
  grep -F 'kalsa-native-patches' "${prefix}_logcat_all.txt" > \
    "${prefix}_native_banner.txt" 2>/dev/null || true
  pid=$(adbT 60 -s "$SER" shell "pidof $PKG" | awk 'NR==1{print $1; exit}' | tr -d '\r')
  if [ -n "$pid" ]; then
    # Equivalent evidence: run-as $PKG cat /proc/$(pidof $PKG)/maps | grep librnllama
    adbT 120 -s "$SER" shell "run-as $PKG cat /proc/$pid/maps" > \
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
  local label="$1" apk="$2" apk_sha="$3" prefix="$RAW/${1}_$JOB"
  local rc pm_rc copy_rc size first_rc force_rc sql_rc clear_rc launch_rc load_rc
  local s5_rc=1 evidence_rc arm_rc=0 s5_detail="" edit_bounds send_bounds
  log "=== APK $label ==="
  adbT 300 -s "$SER" install -r "$apk" > "${prefix}_s1_install.txt" 2>&1
  rc=$?
  adbT 60 -s "$SER" shell "pm dump $PKG" > "${prefix}_s1_pm_dump.txt" 2>&1
  pm_rc=$?
  if [ "$rc" -ne 0 ]; then
    step "$label" S1 fail "adb install rc=$rc pm_dump_rc=$pm_rc"; skip_steps "$label" "skipped after S1"; finish_apk "$label" "$prefix"
    return 1
  fi
  step "$label" S1 ok "install_rc=0 pm_dump_rc=$pm_rc sha=$apk_sha"

  # S2: the preregistered run-as copy and exact completeness check.
  adbT 300 -s "$SER" shell "run-as $PKG sh -c 'mkdir -p files/models/$MODEL_DIR && cp $D/$MODEL_FILE files/models/$MODEL_DIR/$MODEL_FILE'" > \
    "${prefix}_s2_copy.txt" 2>&1
  copy_rc=$?
  size=""
  if [ "$copy_rc" -eq 0 ]; then
    size=$(adbT 60 -s "$SER" shell "run-as $PKG sh -c 'wc -c < files/models/$MODEL_DIR/$MODEL_FILE'" |
      tr -d '[:space:]')
  fi
  if [ "$copy_rc" -ne 0 ] || [ "$size" != "$MODEL_SIZE" ]; then
    step "$label" S2 fail "METHOD-VOID run-as copy_rc=$copy_rc size=$size expected=$MODEL_SIZE"; skip_steps "$label" "METHOD-VOID skipped after S2"; finish_apk "$label" "$prefix"
    return 1
  fi
  step "$label" S2 ok "run-as copy size=$size"

  # S3 first-launch DB creation, then the host-sqlite3 model selection write.
  adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" > "${prefix}_s3_first_launch.txt" 2>&1
  first_rc=$?
  sleep 25
  adbT 60 -s "$SER" shell "am force-stop $PKG" >> "${prefix}_s3_first_launch.txt" 2>&1
  force_rc=$?
  set_model_pref > "${prefix}_s3_sql.txt" 2>&1
  sql_rc=$?
  if [ "$first_rc" -eq 0 ] && [ "$force_rc" -eq 0 ] && [ "$sql_rc" -eq 0 ]; then
    step "$label" S3 ok "first_launch=0 force_stop=0 sql=host-sqlite3"
  else
    step "$label" S3 fail "first_launch=$first_rc force_stop=$force_rc sql=$sql_rc"
    arm_rc=1
  fi

  thermal_record "$prefix" pre_s4
  adbT 60 -s "$SER" logcat -c > "${prefix}_s4_clear.txt" 2>&1
  clear_rc=$?
  adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" > "${prefix}_s4_launch.txt" 2>&1
  launch_rc=$?
  load_rc=1
  if [ "$clear_rc" -eq 0 ] && [ "$launch_rc" -eq 0 ]; then
    poll_load "${prefix}_s4_logcat.txt"; load_rc=$?
  else
    : > "${prefix}_s4_logcat.txt"
  fi
  if [ "$load_rc" -eq 0 ]; then step "$label" S4 ok "KALSA_SESSION load ok"; else step "$label" S4 fail "clear=$clear_rc launch=$launch_rc load_timeout_or_missing"; arm_rc=1; fi

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
run_apk A "$APK_A" "$APK_A_SHA"; rc=$?; [ "$rc" -eq 0 ] || FINAL_RC=1
run_apk B "$APK_B" "$APK_B_SHA"; rc=$?; [ "$rc" -eq 0 ] || FINAL_RC=1
log "DONE FINAL_RC=$FINAL_RC — raw/ populated. Remember: End Session in the portal."
exit "$FINAL_RC"
