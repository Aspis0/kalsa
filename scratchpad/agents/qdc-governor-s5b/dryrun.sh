#!/bin/bash
set -u
CELL=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5b
DRIVER="$CELL/d_run.sh"
RAW_LOG=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803287/QRD8650_A_t1_logcat_all.txt
TMP=$(/usr/bin/mktemp -d /tmp/kalsa-s5-dryrun.XXXXXX)
THERMAL_INPUT="$TMP/thermal.txt"
LIB="$TMP/driver-functions.sh"; RESULTS_LOG="$TMP/results.tsv"; STUB_LOG="$TMP/adb-stub.log"
trap '[ "${BASHPID:-}" = "$$" ] && /bin/rm -rf "$TMP"' EXIT
/usr/bin/printf '%s\n' 'Cached temperatures:' '    Temperature{mValue=31.4, mType=3, mName=skin, mStatus=0}' 'Current temperatures from HAL:' '    Temperature{mValue=37.25, mType=3, mName=skin, mStatus=0}' 'Current cooling devices from HAL:' > "$THERMAL_INPUT"
extract() {
  local wanted="$1"
  /usr/bin/awk -v wanted="$wanted" '$0 ~ ("^" wanted "\\(\\) \\{"){on=1;print;if($0~/;[[:space:]]*}$/)on=0;next} on{print;if($0~/^}$/)on=0}' "$DRIVER"
}
for fn in log write_end deadline_check adbT logcat_all wake_sequence device_wake wake_state ensure_awake restore_device restore_ime holder_loop stop_holder cleanup thermal_record make_thermo model_setup copy_model pull_rkstorage bootstrap_db set_prefs fresh_install has_load_proof count_after count_lmkd_after last_json_after json_field parse_tokens telemetry_complete memory_before memory_after lmkd_all_after poll_load poll_telemetry clear_anchor dump_ui bounds_edit bounds_send tap_bounds load_prompt type_prompt ime_suspend run_observation; do extract "$fn" >> "$LIB"; done
source "$LIB"
source "$CELL/parse.sh"

PKG=com.kalsa.app; SER=dryrun; BOARD=QRD8650; DEVICE_TMP=/data/local/tmp/kalsa-s5
RAW="$TMP/observations"; /bin/mkdir -p "$RAW"
ADB_LOG="$TMP/adb-exit.log"; DRIVER_LOG="$TMP/driver.log"; END_MARKER="$TMP/END.txt"; RESULTS="$TMP/observations.tsv"
: > "$ADB_LOG"; : > "$DRIVER_LOG"; : > "$RESULTS"
JOB=dryrun; ARM_ORDER=ABABABAB; APK="$CELL/dryrun.sh"; MODEL="$CELL/dryrun.sh"; MODEL_SIZE=$(wc -c < "$MODEL" | tr -d '[:space:]'); MODEL_SHA=$(/usr/bin/shasum -a 256 "$MODEL" | awk '{print $1}')
MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf; MODEL_REMOTE="$DEVICE_TMP/$MODEL_FILE"
DEADLINE_EPOCH=2147483647; END_WRITTEN=0; HOLDER_PID=0; SCREEN_OFF_TIMEOUT=60000; SCREEN_OFF_TIMEOUT_SAVED=0; IME_SUSPEND=1; IME_SAVED=com.stub/.Ime; IME_SUSPENDED=0; UI_DUMP_COUNT=0; INPUT_TEXT_COUNT=0; VOID_MODE=0
FIRST_SKIN_C=39.291; PREV_SKIN=39.291; PREV_TIME=0; THERMO_JSON=""; MEM_BEFORE_KB=""; MEM_AFTER_KB=""; APP_PID=4242; ANCHOR_EPOCH=1000; SEND_ANCHOR_EPOCH=1000; ANCHOR_STAMP=dryrun; A_IDS_FILE=""; A_IDS_VALID=0
MODEL_LOAD_PATTERN='llama_model_loader: loaded meta data with .* from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf'; PREWARM_PATTERN='KALSA_PREWARM.*"op":"done"'; PROMPT_FILE="$CELL/PROMPT.txt"; PROMPT_SHA=9109f58516104950079a4a4ecbcd46b557b598741227e893c275bece27079ea6; PROMPT_BYTES=5142; PROMPT_INPUT=""; PROMPT_TEXT=""; PROMPT_EXPECTED_CHARS=0
sleep() { /bin/sleep 0.01; }
adbT() {
  local joined="$*"
  printf '%s\n' "$joined" >> "$STUB_LOG"
  if [[ "$joined" == *"dumpsys thermalservice"* ]]; then /bin/cat "$THERMAL_INPUT"
  elif [[ "$joined" == *"cat /proc/meminfo"* ]]; then printf 'MemTotal: 8000000 kB\nMemFree: 1000000 kB\nMemAvailable: 2345678 kB\n'
  elif [[ "$joined" == *"dumpsys meminfo"* ]]; then printf 'Applications Memory Usage (in Kilobytes):\nUptime: 1000 Realtime: 1000\n** MEMINFO in pid 4242 [com.kalsa.app] **\nNative Heap 123456\nTOTAL 234567\n'
  elif [[ "$joined" == *"logcat -b all -c"* ]]; then :
  elif [[ "$joined" == *"logcat -v epoch -d -b all"* ]]; then /bin/cat "$RAW_LOG"
  elif [[ "$joined" == *"date '+%m-%d"* ]]; then printf '09-04 12:00:00.000\n'
  elif [[ "$joined" == *"date +%s"* ]]; then printf '1000\n'
  elif [[ "$joined" == *"pm list packages"* ]]; then printf '0\nlist_rc=1\n'
  elif [[ "$joined" == *"dumpsys power"* ]]; then printf 'mWakefulness=Awake\n'
  elif [[ "$joined" == *"dumpsys package"* || "$joined" == *"pm dump"* ]]; then printf 'Package [com.kalsa.app] flags=[ DEBUGGABLE ]\n'
  elif [[ "$joined" == *"pidof"* ]]; then printf '4242\n'
  elif [[ "$joined" == *"sha256sum"* ]]; then printf '%s  %s\n' "$MODEL_SHA" "$MODEL_REMOTE"
  elif [[ "$joined" == *"stat -c %s"* ]]; then printf '%s\n' "$MODEL_SIZE"
  elif [[ "$joined" == *"exec-out run-as com.kalsa.app cat databases/RKStorage"* && "$joined" != *"-wal"* && "$joined" != *"-shm"* ]]; then /usr/bin/sqlite3 "$TMP/RKStorage" .dump | /usr/bin/sqlite3 :memory: >/dev/null 2>&1 || true; /bin/cat "$TMP/RKStorage"
  elif [[ "$joined" == *"input text"* ]]; then INPUT_TEXT_COUNT=$((INPUT_TEXT_COUNT + 1))
  elif [[ "$joined" == *"cat $DEVICE_TMP/ui.xml"* ]]; then
    UI_DUMP_COUNT=$((UI_DUMP_COUNT + 1))
    if [ "$VOID_MODE" -eq 1 ] && [ "$UI_DUMP_COUNT" -eq 8 ]; then
      printf '<hierarchy><node class="android.widget.EditText" text="" bounds="[0,0][100,100]"/></hierarchy>\n'
    elif [ "$VOID_MODE" -eq 1 ] || [ "$UI_DUMP_COUNT" -eq 2 ]; then
      printf '<hierarchy><node class="android.widget.EditText" text="%s" bounds="[0,0][100,100]"/></hierarchy>\n' "${PROMPT_TEXT:0:100}"
    elif [ "$UI_DUMP_COUNT" -eq 3 ]; then
      printf '<hierarchy><node class="android.widget.EditText" text="" bounds="[0,0][100,100]"/></hierarchy>\n'
    elif [ "$UI_DUMP_COUNT" -eq 4 ]; then
      printf '<hierarchy><node class="android.widget.EditText" text="%s" bounds="[0,0][100,100]"/></hierarchy>\n' "$PROMPT_TEXT"
    else
      printf '<hierarchy><node class="android.widget.EditText" text="%s" bounds="[0,0][100,100]"/><node content-desc="Send" bounds="[100,0][200,100]"/></hierarchy>\n' "$PROMPT_TEXT"
    fi
  elif [[ "$joined" == *"settings get secure default_input_method"* ]]; then printf 'com.stub/.Ime\n'
  fi
}
adbT 60 -s "$SER" shell dumpsys power > "$TMP/power.txt"
record() {
  local name="$1"; local fn="$2"; shift 2
  ("$fn" "$@" >/dev/null 2>&1); local rc=$?
  printf '%s\t%s\n' "$name" "$rc" | tee -a "$RESULTS_LOG"
}

record log log dryrun
record adbT adbT 1 shell echo dryrun
record write_end write_end dryrun
record deadline_check deadline_check
record logcat_all logcat_all 60 "$TMP/logcat.txt"
record wake_sequence wake_sequence
record device_wake device_wake
record wake_state wake_state "$TMP/power.txt"
record ensure_awake ensure_awake "$TMP/awake"
record restore_device restore_device
record restore_ime restore_ime
/bin/sleep 30 & HOLDER_PID=$!; stop_holder >/dev/null 2>&1; printf 'stop_holder\t%s\n' "$?" | tee -a "$RESULTS_LOG"
THERMAL_SKIN=$(thermal_record session_pre); THERMAL_RC=$?
printf 'thermal_record\t%s skin=%s\n' "$THERMAL_RC" "$THERMAL_SKIN" | tee -a "$RESULTS_LOG"
[ "$THERMAL_RC" -eq 0 ] && [ "$THERMAL_SKIN" = 37.25 ] || { echo "thermal fixture assertion failed: expected HAL skin 37.25, got $THERMAL_SKIN" >&2; exit 1; }
record make_thermo make_thermo 39.291
record model_setup model_setup
record copy_model copy_model "$TMP/copy"
/bin/mkdir -p "$TMP/rk"; /usr/bin/sqlite3 "$TMP/RKStorage" 'CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY,value TEXT);'; record pull_rkstorage pull_rkstorage "$TMP/rk"
record bootstrap_db bootstrap_db "$TMP/bootstrap"
record set_prefs set_prefs 0
record fresh_install fresh_install "$TMP/install"
record has_load_proof has_load_proof "$RAW_LOG"
record count_after count_after KALSA_TELEMETRY "$RAW_LOG"
record count_lmkd_after count_lmkd_after "$RAW_LOG"
record last_json_after last_json_after KALSA_TELEMETRY "$RAW_LOG"
record json_field json_field '{"promptMs":1}' promptMs
record parse_tokens parse_tokens '{"n":32,"ids":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]}' "$TMP/ids.txt"
record telemetry_complete telemetry_complete "$RAW_LOG"
record memory_before memory_before "$TMP/memory"
MEM_BEFORE_KB=2345678
record memory_after memory_after "$TMP/memory"
record lmkd_all_after lmkd_all_after "$RAW_LOG" "$TMP/lmkd-all.txt"
record poll_load poll_load "$TMP/poll-load.txt"
record poll_telemetry poll_telemetry "$TMP/poll-telemetry.txt"
record clear_anchor clear_anchor "$TMP/anchor"
record dump_ui dump_ui "$TMP/ui.xml"
record bounds_edit bounds_edit "$TMP/ui.xml"
record bounds_send bounds_send "$TMP/ui.xml"
record tap_bounds tap_bounds '0 0 100 100'
load_prompt || exit 1; record load_prompt load_prompt
record type_prompt type_prompt
record ime_suspend ime_suspend
run_observation A 1; RUN_RC=$?; printf 'run_observation\t%s\n' "$RUN_RC" | tee -a "$RESULTS_LOG"; [ "$RUN_RC" -eq 0 ] || exit 1; [ "$INPUT_TEXT_COUNT" -eq 2 ] || { echo "ui_send retype count unexpected: $INPUT_TEXT_COUNT" >&2; exit 1; }; grep -q 'attempt=initial actual=100' "$RAW/QRD8650_A_t1_composer_len.txt" || { echo "short composer was not detected" >&2; exit 1; }; grep -q 'attempt=cleared actual=0' "$RAW/QRD8650_A_t1_composer_len.txt" || { echo "clear fixture was not observed" >&2; exit 1; }; grep -q 'attempt=retype actual=5142' "$RAW/QRD8650_A_t1_composer_len.txt" || { echo "composer retype did not pass" >&2; exit 1; }; grep -q 'attempt=2' "$RAW/QRD8650_A_t1_ui_attempts.txt" || { echo "ui_send retry was not exercised" >&2; exit 1; }
FINAL_RC=0; VOID_MODE=1; run_observation B 1; B_RC=$?; printf 'run_observation_B_VOID\t%s\n' "$B_RC" | tee -a "$RESULTS_LOG"; [ "$B_RC" -eq 0 ] || exit 1; awk -F '\t' '$1=="B"&&$2==1&&$16=="na"&&$17=="VOID"{ok=1} END{exit !ok}' "$RESULTS" || exit 1; grep -q 'status=0 row_void=1' "$RAW/QRD8650_B_t1_status.txt" || exit 1; [ "$FINAL_RC" -eq 0 ] || exit 1
VOID_MODE=0; run_observation A 2; A2_RC=$?; printf 'run_observation_A2_after_VOID\t%s\n' "$A2_RC" | tee -a "$RESULTS_LOG"; [ "$A2_RC" -eq 0 ] || exit 1; awk -F '\t' '$1=="A"&&$2==2{ok=1} END{exit !ok}' "$RESULTS" || exit 1; [ "$FINAL_RC" -eq 0 ] || exit 1
holder_loop & HOLDER_TEST_PID=$!; /bin/sleep 0.1; kill "$HOLDER_TEST_PID" 2>/dev/null || true; wait "$HOLDER_TEST_PID" 2>/dev/null; printf 'holder_loop\t%s\n' "$?" | tee -a "$RESULTS_LOG"
END_WRITTEN=0
record cleanup cleanup
printf 'RESULTS=%s\n' "$RESULTS_LOG"
