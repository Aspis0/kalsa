# DIFF — Cell #61 → #63 `d_run.sh`

Unified diff with one rationale per hunk. Context is reduced to keep the review focused.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -1,11 +1,10 @@
 #!/bin/bash
-# Cell #61 QDC headless APK smoke. Usage: ./d_run.sh <job_tag>
+# Cell #63 QDC headless APK smoke. Usage: ./d_run.sh <job_tag>
 # ci-lib.sh is not sourced: its device helpers use bare, uncapped adb and its
 # device install_and_sideload path refuses the required model sideload. This
-# keeps the same one-turn adb/UI/DB primitives under adbT. S3 uses the ci-lib
-# fallback: pull RKStorage (+ WAL/SHM) with root adb pull, edit with Mac sqlite3,
-# then push to D and root-copy RKStorage back with ownership/SELinux restore.
+# keeps the same one-turn adb/UI/DB primitives under adbT, with run-as for every
+# operation that reads or writes the app sandbox.
 set -u
 JOB="${1:?usage: d_run.sh <job_tag>}"
-DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-apk-smoke-61"; RAW="$DIR/raw"; STEPS="$RAW/steps_$JOB.txt"
+DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-apk-smoke-63"; RAW="$DIR/raw"; STEPS="$RAW/steps_$JOB.txt"
 mkdir -p "$RAW"; : > "$STEPS"
```

Hunk 1 rationale: Renames the driver and output directory while preserving the #61 wrapper shape.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -13,6 +12,6 @@
 PKG=com.kalsa.app
-APK_A="$HOME/kalsa-qdc/apk/apk-A-c513f00/app-release.apk"; APK_A_SHA=e0d56a398bbd1cb102dbab635272b7b88c43b22e6cd8896538c313603b774403
-APK_B="$HOME/kalsa-qdc/apk/apk-B-09bdfe9/kalsa-apk-arm64-v8a-09bdfe949403db7cd793da9471c5a78c50d62966/app-release.apk"; APK_B_SHA=1e2709e57561e97149664ea30588b7df9141c25a6813642cdda1c3ddf9d7f86d
+APK_A="$HOME/kalsa-qdc/apk/apk-A-debug-c513f00/app-release.apk"
+APK_B="$HOME/kalsa-qdc/apk/apk-B-debug-09bdfe9/app-release.apk"
 MODEL="$HOME/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"; MODEL_SIZE=1593894944; MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
-MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf; D=/data/local/tmp/kalsa61; GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"; SCREEN_OFF_TIMEOUT=""; SCREEN_OFF_TIMEOUT_SAVED=0; WAKEFULNESS=unknown
+MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf; D=/data/local/tmp/kalsa63; GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"; SCREEN_OFF_TIMEOUT=""; SCREEN_OFF_TIMEOUT_SAVED=0; WAKEFULNESS=unknown
 log() { echo "[$(date +%H:%M:%S)] $*"; }
```

Hunk 2 rationale: Selects the two debug APK paths and the new /data/local/tmp/kalsa63 staging area.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -37,2 +36,7 @@
 
+for apk in "$APK_A" "$APK_B"; do
+  [ -f "$apk" ] || { log "APK_MISSING path=$apk"; exit 4; }
+done
+[ -f "$MODEL" ] || { log "MODEL_MISSING path=$MODEL"; exit 5; }
+
 SER=$(adbT 60 devices | awk 'NR>1 && $2=="device"{print $1; exit}')
```

Hunk 3 rationale: Fails locally before device discovery when either debug APK or the model is unavailable.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -52,4 +56,6 @@
   echo "getprop ro.build.fingerprint"; adbT 60 -s "$SER" shell getprop ro.build.fingerprint
-  echo "id"; adbT 60 -s "$SER" shell id; echo "adb root (record only)"
-  if adbT 60 -s "$SER" root; then echo "adb_root=success"; else echo "adb_root=failed"; fi
+  echo "getprop ro.build.type"; adbT 60 -s "$SER" shell getprop ro.build.type
+  echo "getprop ro.debuggable"; adbT 60 -s "$SER" shell getprop ro.debuggable
+  echo "id"; adbT 60 -s "$SER" shell id
+  echo "root escalation: not attempted; run-as path is the test"
 } > "$RAW/recon_$JOB.txt" 2>&1
```

Hunk 4 rationale: Records build type, debuggable property, and id without escalating, then hashes only the known model.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -57,3 +63,3 @@
 device_wake
-verify_local_sha "$APK_A" "$APK_A_SHA" || exit 5; verify_local_sha "$APK_B" "$APK_B_SHA" || exit 5; verify_local_sha "$MODEL" "$MODEL_SHA" || exit 5
+verify_local_sha "$MODEL" "$MODEL_SHA" || exit 5
 LOCAL_MODEL_SIZE=$(wc -c < "$MODEL" 2>/dev/null | tr -d '[:space:]'); [ "$LOCAL_MODEL_SIZE" = "$MODEL_SIZE" ] || { log "LOCAL_MODEL_SIZE_MISMATCH got=$LOCAL_MODEL_SIZE"; exit 5; }
```

Hunk 5 rationale: Stops expecting unavailable debug-artifact hashes and retains the known model SHA check.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -73,2 +79,4 @@
 fi
+adbT 60 -s "$SER" shell "chmod 644 $MODEL_REMOTE" > "$RAW/model_chmod_$JOB.txt" 2>&1; rc=$?
+[ "$rc" -eq 0 ] || { log "MODEL_CHMOD_FAIL rc=$rc"; exit 5; }
 thermal_record() {
```

Hunk 6 rationale: Applies the required 0644 mode to the temporary model before run-as reads it.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -82,5 +90,8 @@
 logcat_all() { local cap="$1" dest="$2"; adbT "$cap" -s "$SER" logcat -d -b all > "$dest" 2>&1; }
-has_load() { awk '/KALSA_SESSION/ && /"op":"load"/ && /"ok":true/ {found=1} END {exit (found ? 0 : 1)}' "$1"; }
+MODEL_LOAD_PATTERN='llama_model_loader: loaded meta data with .* from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf'
+PREWARM_DONE_PATTERN='KALSA_PREWARM.*"op":"done"'
+has_load_proof() { grep -E "$MODEL_LOAD_PATTERN" "$1" >/dev/null 2>&1 && grep -E "$PREWARM_DONE_PATTERN" "$1" >/dev/null 2>&1; }
+write_load_proof() { local source="$1" dest="$2"; grep -E "$MODEL_LOAD_PATTERN|$PREWARM_DONE_PATTERN" "$source" > "$dest" 2>/dev/null || true; }
 poll_load() {
-  local dest="$1" elapsed=0; while [ "$elapsed" -lt 300 ]; do logcat_all 60 "$dest" || true; has_load "$dest" && return 0; sleep 5; elapsed=$((elapsed + 5)); done; logcat_all 60 "$dest" || true; has_load "$dest"
+  local dest="$1" elapsed=0; while [ "$elapsed" -lt 300 ]; do logcat_all 60 "$dest" || true; has_load_proof "$dest" && return 0; sleep 5; elapsed=$((elapsed + 5)); done; logcat_all 60 "$dest" || true; has_load_proof "$dest"
 }
```

Hunk 7 rationale: Requires the raw-derived loader and prewarm-done markers instead of KV restore.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -110,11 +121,11 @@
   local dir="$1"
-  adbT 300 -s "$SER" pull "/data/data/$PKG/databases/RKStorage" "$dir/RKStorage" \
-    > "$dir/pull.err" 2>&1 || return 1
-  if adbT 60 -s "$SER" shell "test -f /data/data/$PKG/databases/RKStorage-wal" >/dev/null 2>&1; then
-    adbT 300 -s "$SER" pull "/data/data/$PKG/databases/RKStorage-wal" "$dir/RKStorage-wal" \
-      >> "$dir/pull.err" 2>&1 || return 1
+  adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage > "$dir/RKStorage" \
+    2> "$dir/pull.err" || return 1
+  if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage-wal" >/dev/null 2>&1; then
+    adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage-wal > "$dir/RKStorage-wal" \
+      2>> "$dir/pull.err" || return 1
   fi
-  if adbT 60 -s "$SER" shell "test -f /data/data/$PKG/databases/RKStorage-shm" >/dev/null 2>&1; then
-    adbT 300 -s "$SER" pull "/data/data/$PKG/databases/RKStorage-shm" "$dir/RKStorage-shm" \
-      >> "$dir/pull.err" 2>&1 || return 1
+  if adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage-shm" >/dev/null 2>&1; then
+    adbT 300 -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage-shm > "$dir/RKStorage-shm" \
+      2>> "$dir/pull.err" || return 1
   fi
```

Hunk 8 rationale: Pulls RKStorage and optional WAL/SHM with exec-out run-as cat.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -124,3 +135,3 @@
   dbdir=$(mktemp -d "${TMPDIR:-/tmp}/kalsa61-rkstorage.XXXXXX") || return 1
-  echo "sql_path=host sqlite3 on pulled RKStorage; adb push then root cp/chown/restorecon"
+  echo "sql_path=host sqlite3 on run-as-pulled RKStorage; adb push then run-as cp/rm"
   pull_rkstorage "$dbdir" || { rm -rf "$dbdir"; return 1; }
```

Hunk 9 rationale: Documents the host-sqlite3 plus run-as database path.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -134,3 +145,4 @@
   if ! adbT 300 -s "$SER" push "$dbdir/RKStorage" "$remote" >/dev/null 2>&1 ||
-    ! adbT 120 -s "$SER" shell "cp $remote /data/data/$PKG/databases/RKStorage && chown $APP_UID:$APP_UID /data/data/$PKG/databases/RKStorage && restorecon -RF /data/data/$PKG/databases/RKStorage; rc=\$?; rm -f /data/data/$PKG/databases/RKStorage-wal /data/data/$PKG/databases/RKStorage-shm; exit \$rc" >/dev/null 2>&1; then
+    ! adbT 120 -s "$SER" shell "run-as $PKG cp $remote databases/RKStorage" >/dev/null 2>&1 ||
+    ! adbT 60 -s "$SER" shell "run-as $PKG rm -f databases/RKStorage-wal databases/RKStorage-shm" >/dev/null 2>&1; then
     adbT 60 -s "$SER" shell "rm -f $remote" >/dev/null 2>&1 || true
```

Hunk 10 rationale: Replaces root database restoration with run-as cp/rm after the host WAL checkpoint.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -145,7 +157,11 @@
 capture_evidence() {
-  local prefix="$1" rc=0 pid
+  local prefix="$1" rc=0 pid dbdir
   logcat_all 300 "${prefix}_logcat_all.txt" || rc=1
-  adbT 300 -s "$SER" pull "/data/data/$PKG/databases/RKStorage" "${prefix}_chat_RKStorage.db" > "${prefix}_chat_RKStorage.pull.txt" 2>&1 || rc=1
+  dbdir="${prefix}_chat_RKStorage"; mkdir -p "$dbdir"
+  pull_rkstorage "$dbdir" || rc=1
+  adbT 60 -s "$SER" shell "run-as $PKG ls -la files/models/$MODEL_DIR" > "${prefix}_model_ls.txt" 2>&1 || rc=1
   grep -E 'KALSA_SESSION|KALSA_TELEMETRY' "${prefix}_logcat_all.txt" > \
     "${prefix}_session_telemetry.txt" 2>/dev/null || true
+  grep -E "$MODEL_LOAD_PATTERN|$PREWARM_DONE_PATTERN" "${prefix}_logcat_all.txt" > \
+    "${prefix}_s4_proof.txt" 2>/dev/null || true
   grep -F 'kalsa-native-patches' "${prefix}_logcat_all.txt" > \
```

Hunk 11 rationale: Captures RKStorage, model listing, and S4 proof evidence through run-as-aware helpers.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -154,4 +170,3 @@
   if [ -n "$pid" ]; then
-    # Equivalent evidence: cat /proc/$(pidof $PKG)/maps | grep librnllama as root.
-    adbT 120 -s "$SER" shell "cat /proc/$pid/maps" > \
+    adbT 120 -s "$SER" exec-out run-as "$PKG" cat "/proc/$pid/maps" > \
       "${prefix}_maps.txt" 2>&1 || rc=1
```

Hunk 12 rationale: Reads process maps through run-as rather than a privileged shell read.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -178,37 +193,55 @@
 run_apk() {
-  local label="$1" apk="$2" apk_sha="$3" prefix="$RAW/${1}_$JOB"
-  local rc pm_rc copy_rc size first_rc force_rc sql_rc clear_rc launch_rc load_rc APP_UID=""
-  local s5_rc=1 evidence_rc arm_rc=0 s5_detail="" edit_bounds send_bounds s3_detail="" db_retry=0 retry_launch_rc=0 retry_force_rc=0
+  local label="$1" apk="$2" prefix="$RAW/${1}_$JOB"
+  local apk_sha rc pm_rc flags_rc copy_rc stat_rc size stat_output first_rc force_rc sql_rc clear_rc launch_rc load_rc
+  local s5_rc=1 evidence_rc arm_rc=0 s5_detail="" s2_detail="" edit_bounds send_bounds s3_detail="" db_retry=0 retry_launch_rc=0 retry_force_rc=0
   log "=== APK $label ==="
+  apk_sha=$(shasum -a 256 "$apk" | awk '{print $1}')
   adbT 300 -s "$SER" install -r "$apk" > "${prefix}_s1_install.txt" 2>&1
   rc=$?
-  APP_UID=$(adbT 60 -s "$SER" shell "stat -c %u /data/data/$PKG" | tr -d '\r')
-  case "$APP_UID" in
-    ''|*[!0-9]*) APP_UID=$(adbT 60 -s "$SER" shell "dumpsys package $PKG" | grep -o 'userId=[0-9]*' | sed -n '1s/userId=//p' | tr -d '\r');;
-  esac
   adbT 60 -s "$SER" shell "pm dump $PKG" > "${prefix}_s1_pm_dump.txt" 2>&1
   pm_rc=$?
-  case "$APP_UID" in ''|*[!0-9]*)
-    step "$label" S1 fail "APP_UID unavailable"; skip_steps "$label" "skipped after S1"; finish_apk "$label" "$prefix"
-    return 1;;
-  esac
   if [ "$rc" -ne 0 ]; then
-    step "$label" S1 fail "adb install rc=$rc pm_dump_rc=$pm_rc"; skip_steps "$label" "skipped after S1"; finish_apk "$label" "$prefix"
+    step "$label" S1 fail "adb install rc=$rc pm_dump_rc=$pm_rc sha=$apk_sha"
+    step "$label" S0 fail "METHOD-VOID skipped after S1"
+    skip_steps "$label" "skipped after S1"
+    finish_apk "$label" "$prefix"
     return 1
   fi
-  step "$label" S1 ok "install_rc=0 pm_dump_rc=$pm_rc app_uid=$APP_UID sha=$apk_sha"
-  # S2: root copy, ownership/SELinux repair, and exact completeness check.
-  adbT 300 -s "$SER" shell "mkdir -p /data/data/$PKG/files/models/$MODEL_DIR && cp $D/$MODEL_FILE /data/data/$PKG/files/models/$MODEL_DIR/$MODEL_FILE && chown -R $APP_UID:$APP_UID /data/data/$PKG/files && restorecon -RF /data/data/$PKG/files" > \
+  step "$label" S1 ok "install_rc=0 pm_dump_rc=$pm_rc sha=$apk_sha"
+  # S0: the flag must be proven on the installed package before using run-as.
+  adbT 60 -s "$SER" shell "dumpsys package $PKG | grep -i flags" > "${prefix}_s0_flags.txt" 2>&1
+  flags_rc=$?
+  if [ "$flags_rc" -eq 0 ] && grep -qi DEBUGGABLE "${prefix}_s0_flags.txt"; then
+    step "$label" S0 ok "DEBUGGABLE flag proven flags_rc=$flags_rc"
+  else
+    step "$label" S0 fail "METHOD-VOID DEBUGGABLE absent flags_rc=$flags_rc"
+    skip_steps "$label" "METHOD-VOID skipped after S0"
+    finish_apk "$label" "$prefix"
+    return 1
+  fi
+  # S2: run-as copy, and exact completeness check through run-as.
+  adbT 300 -s "$SER" shell "run-as $PKG sh -c 'mkdir -p files/models/$MODEL_DIR && cp $D/$MODEL_FILE files/models/$MODEL_DIR/$MODEL_FILE'" > \
     "${prefix}_s2_copy.txt" 2>&1
   copy_rc=$?
+  stat_rc=1
+  stat_output=""
   size=""
   if [ "$copy_rc" -eq 0 ]; then
-    size=$(adbT 60 -s "$SER" shell "stat -c %s /data/data/$PKG/files/models/$MODEL_DIR/$MODEL_FILE" |
-      tr -d '[:space:]')
+    stat_output=$(adbT 60 -s "$SER" shell "run-as $PKG stat -c %s files/models/$MODEL_DIR/$MODEL_FILE" 2>&1)
+    stat_rc=$?
+    printf '%s\n' "$stat_output" >> "${prefix}_s2_copy.txt"
+    size=$(printf '%s\n' "$stat_output" | tr -d '[:space:]')
   fi
-  if [ "$copy_rc" -ne 0 ] || [ "$size" != "$MODEL_SIZE" ]; then
-    step "$label" S2 fail "METHOD-VOID sideload=root copy_rc=$copy_rc size=$size expected=$MODEL_SIZE"; skip_steps "$label" "METHOD-VOID skipped after S2"; finish_apk "$label" "$prefix"
+  if [ "$copy_rc" -ne 0 ] || [ "$stat_rc" -ne 0 ] || [ "$size" != "$MODEL_SIZE" ]; then
+    if grep -Eiq 'run-as:.*(not debuggable|uid)|package not debuggable' "${prefix}_s2_copy.txt"; then
+      s2_detail="G2 RUN_AS_REFUSED"
+    else
+      s2_detail="run-as copy failed"
+    fi
+    step "$label" S2 fail "$s2_detail copy_rc=$copy_rc stat_rc=$stat_rc size=$size expected=$MODEL_SIZE"
+    skip_steps "$label" "skipped after S2 ($s2_detail)"
+    finish_apk "$label" "$prefix"
     return 1
   fi
-  step "$label" S2 ok "sideload=root size=$size"
+  step "$label" S2 ok "sideload=run-as size=$size"
   # S3 first-launch DB creation, then the host-sqlite3 model selection write.
```

Hunk 13 rationale: Adds S0 flag gating and performs model copy/stat through run-as, with explicit G2 refusal capture.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -219,3 +252,3 @@
   force_rc=$?
-  if ! adbT 60 -s "$SER" shell "test -f /data/data/$PKG/databases/RKStorage" >/dev/null 2>&1; then
+  if ! adbT 60 -s "$SER" shell "run-as $PKG test -f databases/RKStorage" >/dev/null 2>&1; then
     db_retry=1; device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" >> "${prefix}_s3_first_launch.txt" 2>&1; retry_launch_rc=$?; sleep 25
```

Hunk 14 rationale: Makes the RKStorage existence/retry check use run-as.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -239,3 +272,4 @@
   fi
-  if [ "$load_rc" -eq 0 ]; then step "$label" S4 ok "KALSA_SESSION load ok wake=$WAKEFULNESS"; else step "$label" S4 fail "clear=$clear_rc launch=$launch_rc load_timeout_or_missing wake=$WAKEFULNESS"; arm_rc=1; fi
+  write_load_proof "${prefix}_s4_logcat.txt" "${prefix}_s4_proof.txt"
+  if [ "$load_rc" -eq 0 ]; then step "$label" S4 ok "llama_model_loader + KALSA_PREWARM done wake=$WAKEFULNESS"; else step "$label" S4 fail "clear=$clear_rc launch=$launch_rc load_or_prewarm_timeout wake=$WAKEFULNESS"; arm_rc=1; fi
   # S5 tap/type/send: IME-suspended, live uiautomator bounds, space-safe input.
```

Hunk 15 rationale: Records and reports the combined loader-plus-prewarm S4 proof.

```diff
--- scratchpad/agents/qdc-apk-smoke-61/d_run.sh
+++ scratchpad/agents/qdc-apk-smoke-63/d_run.sh
@@ -263,4 +297,4 @@
 FINAL_RC=0
-run_apk A "$APK_A" "$APK_A_SHA"; rc=$?; [ "$rc" -eq 0 ] || FINAL_RC=1
-run_apk B "$APK_B" "$APK_B_SHA"; rc=$?; [ "$rc" -eq 0 ] || FINAL_RC=1
+run_apk A "$APK_A"; rc=$?; [ "$rc" -eq 0 ] || FINAL_RC=1
+run_apk B "$APK_B"; rc=$?; [ "$rc" -eq 0 ] || FINAL_RC=1
 log "DONE FINAL_RC=$FINAL_RC — raw/ populated. Remember: End Session in the portal."
```

Hunk 16 rationale: Invokes each arm with its debug APK path and no obsolete release hash argument.


