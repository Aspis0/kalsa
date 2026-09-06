#!/bin/bash
set -u
CELL=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5b
DRIVER="$CELL/d_run.sh"
RAW_LOG=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803287/QRD8650_A_t1_logcat_all.txt
TMP=$(/usr/bin/mktemp -d /tmp/kalsa-s5-dryrun.XXXXXX)
THERMAL_INPUT="$TMP/thermal.txt"; THERMAL_READY="$TMP/thermal-ready.txt"; THERMAL_HOT="$TMP/thermal-hot.txt"; THERMAL_VERY_HOT="$TMP/thermal-very-hot.txt"; THERMAL_HOT_AFTER="$TMP/thermal-hot-after.txt"; THERMAL_MISSING="$TMP/thermal-missing.txt"; THERMAL_COUNTER="$TMP/thermal-count"; LOGCAT_MODE=normal; LOGCAT_CALLS=0; DUMP_FAILS=0; DUMP_AOD_FAILS=0; LOAD_LOGCAT_CALLS=0; LOAD_DOZE_REMAINING=0; POWER_CHECK_CONTEXT=""; POWER_MODE=normal; POWER_CALLS=0; COMPOSER_MODE=legacy; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; SEND_TAPS=0; WAKE_MODE=normal; WAKE_AWAKE=1; RUNAS_FAIL_ONCE=0; RUNAS_CALLS=0; TYPE_VERIFY_ACTIVE=0; TYPE_VERIFY_ATTEMPT=0; TYPE_VERIFY_CHUNK=0; TYPE_VERIFY_EXPECTED_LEN=0; FIRST_LOSS_USED=0; MID_MISMATCH_USED=0; ALWAYS_MISMATCH=0
LIB="$TMP/driver-functions.sh"; RESULTS_LOG="$TMP/results.tsv"; STUB_LOG="$TMP/adb-stub.log"; TOOL_LOG="$TMP/tool-log.txt"
trap '[ "${BASHPID:-}" = "$$" ] && /bin/rm -rf "$TMP"' EXIT
/usr/bin/printf '%s\n' 'Cached temperatures:' '    Temperature{mValue=31.4, mType=3, mName=skin, mStatus=0}' 'Current temperatures from HAL:' '    Temperature{mValue=37.25, mType=3, mName=skin, mStatus=0}' 'Current cooling devices from HAL:' > "$THERMAL_INPUT"
/usr/bin/printf '%s\n' 'Cached temperatures:' '    Temperature{mValue=31.4, mType=3, mName=skin, mStatus=0}' 'Current temperatures from HAL:' '    Temperature{mValue=35.5, mType=3, mName=skin, mStatus=0}' 'Current cooling devices from HAL:' > "$THERMAL_READY"
/usr/bin/printf '%s\n' 'Cached temperatures:' '    Temperature{mValue=31.4, mType=3, mName=skin, mStatus=0}' 'Current temperatures from HAL:' '    Temperature{mValue=37.5, mType=3, mName=skin, mStatus=0}' 'Current cooling devices from HAL:' > "$THERMAL_HOT"
/usr/bin/printf '%s\n' 'Cached temperatures:' '    Temperature{mValue=31.4, mType=3, mName=skin, mStatus=0}' 'Current temperatures from HAL:' '    Temperature{mValue=39.5, mType=3, mName=skin, mStatus=0}' 'Current cooling devices from HAL:' > "$THERMAL_VERY_HOT"
/usr/bin/printf '%s\n' 'Cached temperatures:' '    Temperature{mValue=31.4, mType=3, mName=skin, mStatus=0}' 'Current temperatures from HAL:' '    Temperature{mValue=42.5, mType=3, mName=skin, mStatus=0}' 'Current cooling devices from HAL:' > "$THERMAL_HOT_AFTER"
/usr/bin/printf '%s\n' 'Cached temperatures:' '    Temperature{mValue=31.4, mType=3, mName=skin, mStatus=0}' 'Current temperatures from HAL:' '    Temperature{mValue=37.25, mType=3, mName=cpu, mStatus=0}' 'Current cooling devices from HAL:' > "$THERMAL_MISSING"
/usr/bin/printf '0\n' > "$THERMAL_COUNTER"
/usr/bin/printf '%s\n' \
  '1000 1 1 I ReactNativeJS: llama_model_loader: loaded meta data with 42 tensors from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf' \
  '1000 1 1 I ReactNativeJS: KALSA_PREWARM {"op":"done"}' \
  '1001 1 1 I llama: reusing 0/938' \
  '1001 1 1 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"3","tokensPredicted":1,"promptMs":1,"predictedPerSecond":1}' \
  '1001 1 1 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"3","structuredCalls":1}' > "$TOOL_LOG"
extract() {
  local wanted="$1"
  /usr/bin/awk -v wanted="$wanted" '$0 ~ ("^" wanted "\\(\\) \\{"){on=1;print;if($0~/;[[:space:]]*}$/)on=0;next} on{print;if($0~/^}$/)on=0}' "$DRIVER"
}
for fn in log gpu_fit_ram_gate write_end deadline_check validate_deadline_minutes adbT power_capture logcat_all wake_tap wake_sequence device_wake wake_state ensure_awake restore_device restore_ime holder_loop stop_holder cleanup thermal_record make_thermo model_setup copy_model pull_rkstorage bootstrap_db ids_to_json set_prefs fresh_install has_load_proof count_after count_lmkd_after last_json_after json_field parse_tokens telemetry_complete memory_before memory_after lmkd_all_after poll_load poll_telemetry clear_anchor dump_ui bounds_edit bounds_send tap_bounds load_prompt type_prompt ime_suspend app_foreground run_observation; do extract "$fn" >> "$LIB"; done
source "$LIB"
source "$CELL/parse.sh"

PKG=com.kalsa.app; SER=dryrun; BOARD=QRD8650; DEVICE_TMP=/data/local/tmp/kalsa-s5
RAW="$TMP/observations"; /bin/mkdir -p "$RAW"
ADB_LOG="$TMP/adb-exit.log"; DRIVER_LOG="$TMP/driver.log"; END_MARKER="$TMP/END.txt"; RESULTS="$TMP/observations.tsv"
: > "$ADB_LOG"; : > "$DRIVER_LOG"; : > "$RESULTS"
JOB=dryrun; ARM_ORDER=ABABABAB; APK="$CELL/dryrun.sh"; MODEL="$CELL/dryrun.sh"; MODEL_SIZE=$(wc -c < "$MODEL" | tr -d '[:space:]'); MODEL_SHA=$(/usr/bin/shasum -a 256 "$MODEL" | awk '{print $1}')
MODEL_DIR=lfm2.5-2.6b; MODEL_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf; MODEL_REMOTE="$DEVICE_TMP/$MODEL_FILE"
DEADLINE_EPOCH=2147483647; DEADLINE_MINUTES=40; END_WRITTEN=0; HOLDER_PID=0; SCREEN_OFF_TIMEOUT=60000; SCREEN_OFF_TIMEOUT_SAVED=0; IME_SUSPEND=1; IME_SAVED=com.stub/.Ime; IME_SUSPENDED=0; UI_DUMP_COUNT=0; INPUT_TEXT_COUNT=0; VOID_MODE=0; TOOL_MODE=0; ORACLE_MODE=""; ORACLE_HELPER="$CELL/oracle_logit.py"; THERMAL_MODE=initial; COOL_TARGET_C=37.0; COOL_POLL_S=15; COOL_MAX_S=900; COOLDOWN_SECONDS=na; LOGCAT_RC=na; LOGCAT_RETRIES=0; TYPE_PROMPT_CALLS=0; TYPE_COUNTS=""; CHUNK_CALLS=0; CHUNK_BAD=0; CHUNK_UNQUOTED=0; LAST_EDIT_BOUNDS=""; WAKE_SEQUENCE_TRANSPORT=0
FIRST_SKIN_C=39.291; PREV_SKIN=39.291; PREV_TIME=0; THERMO_JSON=""; MEM_BEFORE_KB=""; MEM_AFTER_KB=""; APP_PID=4242; ANCHOR_EPOCH=1000; SEND_ANCHOR_EPOCH=1000; ANCHOR_STAMP=dryrun; A_IDS_FILE=""; A_IDS_VALID=0; A_PROBS_FILE=""
MODEL_LOAD_PATTERN='llama_model_loader: loaded meta data with .* from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf'; PREWARM_PATTERN='KALSA_PREWARM.*"op":"done"'; PROMPT_FILE="$CELL/PROMPT.txt"; PROMPT_SHA=9109f58516104950079a4a4ecbcd46b557b598741227e893c275bece27079ea6; PROMPT_BYTES=5142; PROMPT_INPUT=""; PROMPT_TEXT=""; PROMPT_EXPECTED_CHARS=0
sleep() { /bin/sleep 0.01; }
adbT() {
  local joined="$*"
  local chunk_cmd="" chunk_text="" chunk_chars=0
  local push_file=""
  local thermal_calls
  printf '%s\n' "$joined" >> "$STUB_LOG"
  if [[ "$joined" == *"dumpsys thermalservice"* ]]; then thermal_calls=$(tr -d '[:space:]' < "$THERMAL_COUNTER"); thermal_calls=$((thermal_calls + 1)); printf '%s\n' "$thermal_calls" > "$THERMAL_COUNTER"; case "$THERMAL_MODE" in initial) /bin/cat "$THERMAL_INPUT";; ready) /bin/cat "$THERMAL_READY";; cool) [ "$thermal_calls" -eq 1 ] && /bin/cat "$THERMAL_VERY_HOT" || /bin/cat "$THERMAL_READY";; never) /bin/cat "$THERMAL_VERY_HOT";; afterhot) [ "$thermal_calls" -eq 3 ] && /bin/cat "$THERMAL_HOT_AFTER" || /bin/cat "$THERMAL_READY";; missing) /bin/cat "$THERMAL_MISSING";; esac
  elif [[ "$joined" == *"cat /proc/meminfo"* ]]; then printf 'MemTotal: 8000000 kB\nMemFree: 1000000 kB\nMemAvailable: 2345678 kB\n'
  elif [[ "$joined" == *"dumpsys meminfo"* ]]; then printf 'Applications Memory Usage (in Kilobytes):\nUptime: 1000 Realtime: 1000\n** MEMINFO in pid 4242 [com.kalsa.app] **\nNative Heap 123456\nTOTAL 234567\n'
  elif [[ "$joined" == *"logcat -b all -c"* ]]; then :
  elif [[ "$joined" == *"logcat -v epoch -d -b all"* ]]; then LOGCAT_CALLS=$((LOGCAT_CALLS + 1)); case "$LOGCAT_MODE" in fail) printf 'stub logcat failure\n'; return 7;; newer) printf '1001 new\n';; truncated) printf '1002 truncated';; older) printf '1000 older complete\n';; load-wake) LOAD_LOGCAT_CALLS=$((LOAD_LOGCAT_CALLS + 1)); if [ "$LOAD_LOGCAT_CALLS" -ge 3 ]; then /bin/cat "$RAW_LOG"; else printf '1000 no-proof\n'; fi;; *) if [ "$TOOL_MODE" -eq 1 ]; then /bin/cat "$TOOL_LOG"; else /bin/cat "$RAW_LOG"; fi;; esac
  elif [[ "$joined" == *"uiautomator dump"* ]]; then
    if [ "$DUMP_FAILS" -gt 0 ]; then DUMP_FAILS=$((DUMP_FAILS - 1)); printf 'ERROR: could not get idle state\n' >&2; return 1; fi
  elif [[ "$joined" == *"date '+%m-%d"* ]]; then printf '09-04 12:00:00.000\n'
  elif [[ "$joined" == *"date +%s"* ]]; then printf '1000\n'
  elif [[ "$joined" == *"pm list packages"* ]]; then printf '0\nlist_rc=1\n'
  elif [[ "$joined" == *"dumpsys power"* ]]; then
    POWER_CALLS=$((POWER_CALLS + 1))
    if [ "$POWER_MODE" = rc255_good ]; then printf 'mWakefulness=Awake\n'; return 255; fi
    if [ "$POWER_MODE" = no_wake ]; then printf 'power dump without wakefulness\n'; return 1; fi
    if [ "$WAKE_MODE" = doze_load ] && [ "$POWER_CHECK_CONTEXT" = load ] && [ "$LOAD_DOZE_REMAINING" -gt 0 ]; then LOAD_DOZE_REMAINING=$((LOAD_DOZE_REMAINING - 1)); printf 'mWakefulness=Dozing\n'; elif [ "$WAKE_MODE" = doze_once ] && [ "$WAKE_AWAKE" -eq 0 ]; then printf 'mWakefulness=Dozing\n'; else printf 'mWakefulness=Awake\n'; fi
  elif [[ "$joined" == *"dumpsys activity activities"* ]]; then printf '    topResumedActivity=ActivityRecord{abc123 u0 com.kalsa.app/.MainActivity t13}\n'
  elif [[ "$joined" == *"dumpsys package"* || "$joined" == *"pm dump"* ]]; then printf 'Package [com.kalsa.app] flags=[ DEBUGGABLE ]\n'
  elif [[ "$joined" == *"pidof"* ]]; then printf '4242\n'
  elif [[ "$joined" == *"sha256sum"* ]]; then printf '%s  %s\n' "$MODEL_SHA" "$MODEL_REMOTE"
  elif [[ "$joined" == *"stat -c %s"* ]]; then printf '%s\n' "$MODEL_SIZE"
  elif [[ "$joined" == *"push"* && "$joined" == *"/RKStorage"* ]]; then push_file=$(printf '%s' "$joined" | sed -n 's/.*push \([^ ]*\/RKStorage\) .*/\1/p'); [ -f "$push_file" ] && /bin/cp "$push_file" "$TMP/pushed-rkstorage"
  elif [[ "$joined" == *"exec-out run-as com.kalsa.app cat databases/RKStorage"* && "$joined" != *"-wal"* && "$joined" != *"-shm"* ]]; then RUNAS_CALLS=$((RUNAS_CALLS + 1)); if [ "$RUNAS_FAIL_ONCE" -eq 1 ] && [ "$RUNAS_CALLS" -eq 1 ]; then printf 'run-as: /data readable or writable by others: 40777\n' >&2; return 1; fi; /usr/bin/sqlite3 "$TMP/RKStorage" .dump | /usr/bin/sqlite3 :memory: >/dev/null 2>&1 || true; /bin/cat "$TMP/RKStorage"
  elif [[ "$joined" == *"run-as com.kalsa.app"* ]]; then RUNAS_CALLS=$((RUNAS_CALLS + 1)); if [ "$RUNAS_FAIL_ONCE" -eq 1 ] && [ "$RUNAS_CALLS" -eq 1 ]; then printf 'run-as: /data readable or writable by others: 40777\n' >&2; return 1; fi
  elif [[ "$joined" == *"KEYCODE_WAKEUP"* ]]; then WAKE_AWAKE=1
  elif [[ "$joined" == *"am start -n"* ]]; then COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen
  elif [[ "$joined" == *"input keycombination"* ]]; then COMPOSER_STAGE=cleared
  elif [[ "$joined" == *"input text"* ]]; then
    INPUT_TEXT_COUNT=$((INPUT_TEXT_COUNT + 1))
    chunk_cmd=$(printf '%s' "$joined" | sed -n "s/.*input text '\\(.*\\)'$/\\1/p")
    if [ -z "$chunk_cmd" ]; then
      CHUNK_UNQUOTED=$((CHUNK_UNQUOTED + 1))
    else
      CHUNK_CALLS=$((CHUNK_CALLS + 1))
      chunk_text=$(printf '%s' "$chunk_cmd" | sed 's/%s/ /g')
      chunk_chars=$(printf '%s' "$chunk_text" | wc -m | tr -d '[:space:]')
      [ "$chunk_chars" -le 200 ] || CHUNK_BAD=$((CHUNK_BAD + 1))
    fi
  elif [[ "$joined" == *"input tap 150 50"* ]]; then
    SEND_TAPS=$((SEND_TAPS + 1))
  elif [[ "$joined" == *"input tap 50 50"* ]]; then
    COMPOSER_FOCUSED=1; COMPOSER_STAGE=typing
  elif [[ "$joined" == *"input tap"* ]]; then
    :
  elif [[ "$joined" == *"cat $DEVICE_TMP/ui.xml"* ]]; then
    if [ "$DUMP_AOD_FAILS" -gt 0 ]; then
      DUMP_AOD_FAILS=$((DUMP_AOD_FAILS - 1))
      printf '<hierarchy package="com.android.systemui"><node class="android.widget.TextView" text="12:00"/></hierarchy>\n'
    else
    UI_DUMP_COUNT=$((UI_DUMP_COUNT + 1))
    if [ "${TYPE_VERIFY_ACTIVE:-0}" -eq 1 ]; then
      expected="${PROMPT_TEXT:0:${TYPE_VERIFY_EXPECTED_LEN}}"
      if [ "$COMPOSER_MODE" = first_loss ] && [ "$TYPE_VERIFY_ATTEMPT" -eq 1 ] && [ "$TYPE_VERIFY_CHUNK" -eq 1 ] && [ "$FIRST_LOSS_USED" -eq 0 ]; then
        expected="${PROMPT_TEXT:1:$((TYPE_VERIFY_EXPECTED_LEN - 1))}"; FIRST_LOSS_USED=1
      elif [ "$COMPOSER_MODE" = mid_mismatch ] && [ "$TYPE_VERIFY_ATTEMPT" -eq 1 ] && [ "$TYPE_VERIFY_CHUNK" -eq 3 ] && [ "$MID_MISMATCH_USED" -eq 0 ]; then
        expected="${PROMPT_TEXT:0:$((TYPE_VERIFY_EXPECTED_LEN - 1))}X"; MID_MISMATCH_USED=1
      elif [ "$COMPOSER_MODE" = always_mismatch ]; then
        expected="${PROMPT_TEXT:0:$((TYPE_VERIFY_EXPECTED_LEN - 1))}X"
      fi
      printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="%s" hint="Ask a question…" bounds="[0,0][100,100]"/></hierarchy>\n' "$expected"
    elif [ "$COMPOSER_FOCUSED" -eq 0 ]; then
      if [ "$COMPOSER_MODE" = hint_text ]; then
        printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="Ask a question…" bounds="[0,0][100,100]"/></hierarchy>\n'
      else
        printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="Ask a question…" hint="Ask a question…" bounds="[0,0][100,100]"/></hierarchy>\n'
      fi
    elif [ "$COMPOSER_STAGE" = typing ]; then
      if [ "$VOID_MODE" -eq 1 ]; then
        printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="%s" hint="Ask a question…" bounds="[0,0][100,100]"/><node content-desc="Send" bounds="[100,0][200,100]"/></hierarchy>\n' "$PROMPT_TEXT"; COMPOSER_STAGE=complete
      elif [ "$COMPOSER_MODE" = exact ]; then
        printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="%s" hint="Ask a question…" bounds="[0,0][100,100]"/></hierarchy>\n' "${PROMPT_TEXT:0:5141}"; COMPOSER_STAGE=short
      elif [ "$COMPOSER_MODE" = legacy ] || [ "$COMPOSER_MODE" = hint_text ]; then
        printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="%s" hint="Ask a question…" bounds="[0,0][100,100]"/></hierarchy>\n' "${PROMPT_TEXT:0:100}"; COMPOSER_STAGE=short
      elif [ "$COMPOSER_MODE" = exact_fail ]; then
        printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="%s" hint="Ask a question…" bounds="[0,0][100,100]"/></hierarchy>\n' "${PROMPT_TEXT:0:5141}"; COMPOSER_STAGE=short
      else
        printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="%s" hint="Ask a question…" bounds="[0,0][100,100]"/><node content-desc="Send" bounds="[100,0][200,100]"/></hierarchy>\n' "$PROMPT_TEXT"; COMPOSER_STAGE=complete
      fi
    elif [ "$COMPOSER_STAGE" = cleared ]; then
      if [ "$COMPOSER_MODE" = hint_text ]; then
        printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="Ask a question…" bounds="[0,0][100,100]"/></hierarchy>\n'
      else
        printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="Ask a question…" hint="Ask a question…" bounds="[0,0][100,100]"/></hierarchy>\n'
      fi
      COMPOSER_STAGE=cleared_seen
    elif [ "$COMPOSER_MODE" = exact_fail ]; then
      printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="%s" hint="Ask a question…" bounds="[0,0][100,100]"/></hierarchy>\n' "${PROMPT_TEXT:0:5141}"
    elif [ "$COMPOSER_STAGE" = cleared_seen ]; then
      printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="%s" hint="Ask a question…" bounds="[0,0][100,100]"/></hierarchy>\n' "$PROMPT_TEXT"; COMPOSER_STAGE=send_retry
    elif [ "$COMPOSER_STAGE" = send_retry ]; then
      printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="%s" hint="Ask a question…" bounds="[0,0][100,100]"/><node content-desc="Send" bounds="[100,0][200,100]"/></hierarchy>\n' "$PROMPT_TEXT"; COMPOSER_STAGE=complete
    else
      printf '<hierarchy package="com.kalsa.app"><node class="android.widget.EditText" text="%s" hint="Ask a question…" bounds="[0,0][100,100]"/><node content-desc="Send" bounds="[100,0][200,100]"/></hierarchy>\n' "$PROMPT_TEXT"
    fi
    fi
  elif [[ "$joined" == *"settings get system screen_off_timeout"* ]]; then printf '60000\n'
  elif [[ "$joined" == *"settings get secure default_input_method"* ]]; then printf 'com.stub/.Ime\n'
  fi
}
adbT 60 -s "$SER" shell dumpsys power > "$TMP/power.txt"
record() {
  local name="$1"; local fn="$2"; shift 2
  ("$fn" "$@" >/dev/null 2>&1); local rc=$?
  printf '%s\t%s\n' "$name" "$rc" | tee -a "$RESULTS_LOG"
}
assert_governor_force() {
  local board="$1"
  local flag="$2"
  local expected="$3"
  BOARD="$board"
  set_prefs "$flag" "$TMP/prefs-$board-$flag" || exit 1
  /usr/bin/sqlite3 "$TMP/pushed-rkstorage" .dump | grep -Fq "'kalsa.governor.enabled','$flag'" || exit 1
  /usr/bin/sqlite3 "$TMP/pushed-rkstorage" .dump | grep -Fq "'kalsa.bench.governor_force','$expected'" || exit 1
}

record log log dryrun
record adbT adbT 1 shell echo dryrun
record write_end write_end dryrun
record deadline_check deadline_check
validate_deadline_minutes 10 && exit 1 || :; validate_deadline_minutes 200 && exit 1 || :; validate_deadline_minutes 85 || exit 1; [ "$COOL_TARGET_C" = 37.0 ] && [ "$COOL_MAX_S" -eq 900 ] || exit 1; [ "$(cool_target_for_arm A)" = 38.5 ] && [ "$(cool_target_for_arm B)" = 37.0 ] || exit 1
[ "$(device_tag pineapple SM8650)" = 8-Gen-3 ] && [ "$(device_tag pineapple SM7675)" = 7p-Gen-3 ] && [ "$(device_tag kalama SM8550)" = 8-Gen-2 ] && [ "$(device_tag pineapple SM8635)" = 8s-Gen-3 ] && [ "$(device_tag sun SM8750)" = 8-Elite ] && [ "$(device_tag 'raw board' SM0000)" = raw-board ] || exit 1
printf '1788626897.832 precise complete\n' > "$TMP/precision.log"; [ "$(last_epoch "$TMP/precision.log")" = 1788626897.832 ] || { echo "epoch precision assertion failed" >&2; exit 1; }
printf '1000 existing-long-line\n' > "$TMP/atomic.log"; [ "$(wc -c < "$TMP/atomic.log")" -gt "$(printf '1001 new\n' | wc -c)" ] || exit 1; LOGCAT_MODE=newer; LOGCAT_CALLS=0; logcat_all 120 "$TMP/atomic.log" >/dev/null 2>&1; [ "$?" -eq 0 ] && [ "$(cat "$TMP/atomic.log")" = '1001 new' ] && [ "$LOGCAT_CALLS" -eq 1 ] || exit 1
LOGCAT_MODE=truncated; LOGCAT_CALLS=0; logcat_all 120 "$TMP/atomic.log" >/dev/null 2>&1; [ "$?" -ne 0 ] && [ "$(cat "$TMP/atomic.log")" = '1001 new' ] && [ "$LOGCAT_CALLS" -eq 3 ] && grep -q 'complete=0' "$TMP/atomic.log.failures" || exit 1
LOGCAT_MODE=older; LOGCAT_CALLS=0; logcat_all 120 "$TMP/atomic.log" >/dev/null 2>&1; [ "$?" -ne 0 ] && [ "$(cat "$TMP/atomic.log")" = '1001 new' ] && [ "$LOGCAT_CALLS" -eq 3 ] && grep -q 'tmp_epoch=1000' "$TMP/atomic.log.failures" || exit 1
LOGCAT_MODE=fail; LOGCAT_CALLS=0; logcat_all 120 "$TMP/atomic.log" >/dev/null 2>&1; [ "$?" -ne 0 ] && [ "$(cat "$TMP/atomic.log")" = '1001 new' ] && [ "$LOGCAT_CALLS" -eq 3 ] && [ "$LOGCAT_RC" -eq 7 ] && [ "$LOGCAT_RETRIES" -eq 3 ] && grep -q 'rc=7' "$TMP/atomic.log.failures" || exit 1; LOGCAT_MODE=normal
record logcat_all logcat_all 60 "$TMP/logcat.txt"
THERMAL_MODE=missing; /usr/bin/printf '0\n' > "$THERMAL_COUNTER"; THERMAL_SKIN=$(thermal_record missing_sensor); THERMAL_RC=$?; [ "$THERMAL_RC" -ne 0 ] && [ -z "$THERMAL_SKIN" ] && grep -q 'void_reason=thermal' "$RAW/missing_sensor_thermal_gate.txt" || { echo "missing skin was not a thermal failure" >&2; exit 1; }; THERMAL_MODE=initial; /usr/bin/printf '0\n' > "$THERMAL_COUNTER"
record wake_sequence wake_sequence
record device_wake device_wake
record wake_state wake_state "$TMP/power.txt"
record ensure_awake ensure_awake "$TMP/awake"
POWER_MODE=rc255_good; POWER_RC=0; power_capture "$TMP/power-rc255.txt" || POWER_RC=$?; [ "$POWER_RC" -eq 0 ] && grep -q 'attempt=1 rc=255 has_wakefulness=1' "$TMP/power-rc255.txt.log" || exit 1
POWER_MODE=no_wake; POWER_RC=0; power_capture "$TMP/power-no-wake.txt" || POWER_RC=$?; [ "$POWER_RC" -ne 0 ] && [ "$(grep -c '^attempt=' "$TMP/power-no-wake.txt.log")" -eq 3 ] || exit 1; POWER_MODE=normal
printf 'serial=dryrun\n' > "$RAW/recon.txt"; record configure_screen configure_screen; grep -q 'screen_off_timeout_previous=60000' "$RAW/recon.txt" || exit 1
record restore_device restore_device
record restore_ime restore_ime
/bin/sleep 30 & HOLDER_PID=$!; stop_holder >/dev/null 2>&1; printf 'stop_holder\t%s\n' "$?" | tee -a "$RESULTS_LOG"
THERMAL_SKIN=$(thermal_record session_pre); THERMAL_RC=$?
printf 'thermal_record\t%s skin=%s\n' "$THERMAL_RC" "$THERMAL_SKIN" | tee -a "$RESULTS_LOG"
[ "$THERMAL_RC" -eq 0 ] && [ "$THERMAL_SKIN" = 37.25 ] || { echo "thermal fixture assertion failed: expected HAL skin 37.25, got $THERMAL_SKIN" >&2; exit 1; }
THERMAL_MODE=ready; /usr/bin/printf '0\n' > "$THERMAL_COUNTER"
record make_thermo make_thermo 39.291
record model_setup model_setup
record copy_model copy_model "$TMP/copy"
RUNAS_FAIL_ONCE=1; RUNAS_CALLS=0; record copy_model_retry copy_model "$TMP/copy-once"; grep -q 'readable or writable by others: 40777' "$TMP/copy-once_model_copy.txt" && grep -q 'run_as_attempt=2' "$TMP/copy-once_model_copy.txt" || exit 1; RUNAS_FAIL_ONCE=0
/bin/mkdir -p "$TMP/rk"; /usr/bin/sqlite3 "$TMP/RKStorage" 'CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY,value TEXT);'; record pull_rkstorage pull_rkstorage "$TMP/rk"
record bootstrap_db bootstrap_db "$TMP/bootstrap"
record set_prefs set_prefs 0
for pref in kalsa.web.enabled kalsa.tools.device kalsa.tools.calendar; do /usr/bin/sqlite3 "$TMP/pushed-rkstorage" .dump | grep -Fq "'$pref','false'" || { echo "tool preference missing: $pref" >&2; exit 1; }; done
ORACLE_MODE=logit; A_IDS_FILE="$TMP/oracle-a-ids"; awk 'BEGIN { for (i=1; i<=32; i++) print i }' > "$A_IDS_FILE"; A_IDS_VALID=1; set_prefs 0 "$TMP/oracle-a" || exit 1; /usr/bin/sqlite3 "$TMP/pushed-rkstorage" .dump | grep -Fq "'kalsa.bench.probs','1'" || exit 1; ! /usr/bin/sqlite3 "$TMP/pushed-rkstorage" .dump | grep -Fq 'kalsa.bench.force_ids' || exit 1; set_prefs 1 "$TMP/oracle-b" || exit 1; /usr/bin/sqlite3 "$TMP/pushed-rkstorage" .dump | grep -Fq "'kalsa.bench.probs','1'" || exit 1; /usr/bin/sqlite3 "$TMP/pushed-rkstorage" .dump | grep -Fq "'kalsa.bench.force_ids','[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]'" || exit 1
ORACLE_MODE=""; A_IDS_FILE=""; A_IDS_VALID=0; set_prefs 0 "$TMP/oracle-off" || exit 1; ! /usr/bin/sqlite3 "$TMP/pushed-rkstorage" .dump | grep -Fq 'kalsa.bench.probs' || exit 1; ! /usr/bin/sqlite3 "$TMP/pushed-rkstorage" .dump | grep -Fq 'kalsa.bench.force_ids' || exit 1
for board in 8-Gen-3 7p-Gen-3 8s-Gen-3 8-Gen-2 8-Elite; do assert_governor_force "$board" 0 0; done
for board in 8-Gen-3 7p-Gen-3 8s-Gen-3 8-Gen-2 8-Elite; do assert_governor_force "$board" 1 1; done
BOARD=QRD8650
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
record type_prompt type_prompt "$TMP/type"
[ "$(type_cap_for_chunk 200)" = 400 ] && [ "$(type_cap_for_chunk 100)" = 700 ] || exit 1
record ime_suspend ime_suspend
DUMP_AOD_RAW="$TMP/aod-retry"; /bin/mkdir -p "$DUMP_AOD_RAW"; RAW="$DUMP_AOD_RAW"; COMPOSER_MODE=normal; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; UI_DUMP_COUNT=0; SEND_TAPS=0; DUMP_AOD_FAILS=1; AOD_RC=0; ui_send "$RAW/aod" 2 || AOD_RC=$?; [ "$AOD_RC" -eq 0 ] || exit 1; grep -q 'aod' "$RAW/aod_edit.xml.dump.log" || exit 1
DUMP_LOAD_FILE="$TMP/poll-wake_load.txt"; LOAD_LOGCAT_CALLS=0; LOAD_DOZE_REMAINING=2; WAKE_MODE=doze_load; LOGCAT_MODE=load-wake; LAST_EDIT_BOUNDS=""; record poll_load poll_load "$DUMP_LOAD_FILE"; grep -q 'rewakes=2' "$TMP/poll-wake_load_wakes.txt" || exit 1; WAKE_MODE=normal; LOGCAT_MODE=normal; LOAD_LOGCAT_CALLS=0; LOAD_DOZE_REMAINING=0
DUMP_RETRY_RAW="$TMP/dump-retry"; /bin/mkdir -p "$DUMP_RETRY_RAW"; RAW="$DUMP_RETRY_RAW"; COMPOSER_MODE=normal; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; UI_DUMP_COUNT=0; SEND_TAPS=0; DUMP_FAILS=2; DUMP_RETRY_RC=0; ui_send "$RAW/retry" 2 || DUMP_RETRY_RC=$?; [ "$DUMP_RETRY_RC" -eq 0 ] || exit 1; grep -q 'attempt=3 .*rc=0' "$RAW/retry_edit.xml.dump.log" || exit 1
 DUMP_RUN_RAW="$TMP/dump-run"; /bin/mkdir -p "$DUMP_RUN_RAW"; RAW="$DUMP_RUN_RAW"; RESULTS="$DUMP_RUN_RAW/results.tsv"; printf 'arm\tturn\tttft_ms\tprefill_ms\tprefill_chunks\tnew_tokens_a\tnew_tokens_b\tdecode_tps\tengine_prefill\tengine_decode\tthermal_state\tskin_c_before\tskin_c_after\tfallback_count\tlmkd_count\tids_sha\toracle\toracle_logit\toracle_rule\n' > "$RESULTS"; THERMAL_MODE=ready; COMPOSER_MODE=normal; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; UI_DUMP_COUNT=0; DUMP_FAILS=5; DUMP_VOID_RC=0; run_observation A 9 || DUMP_VOID_RC=$?; [ "$DUMP_VOID_RC" -eq 0 ] || exit 1; grep -q 'status=0 row_void=1' "$RAW/QRD8650_A_t9_status.txt" || exit 1; grep -q 'dump_fail stage=edit' "$RAW/QRD8650_A_t9_ui_attempts.txt" || exit 1; DUMP_FAILS=0; run_observation A 10 || exit 1; awk -F '\t' '$1=="A"&&$2==10{ok=1} END{exit !ok}' "$RESULTS" || exit 1
RAW="$TMP/observations"; RESULTS="$TMP/observations.tsv"; THERMAL_MODE=ready; /usr/bin/printf '0\n' > "$THERMAL_COUNTER"; COMPOSER_MODE=legacy; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; UI_DUMP_COUNT=0; SEND_TAPS=0; DUMP_FAILS=0; INPUT_TEXT_COUNT=0; TYPE_PROMPT_CALLS=0; TYPE_COUNTS=""; CHUNK_CALLS=0; CHUNK_BAD=0; CHUNK_UNQUOTED=0; VOID_MODE=0; LAST_EDIT_BOUNDS=""
run_observation A 1; RUN_RC=$?; printf 'run_observation\t%s\n' "$RUN_RC" | tee -a "$RESULTS_LOG"; [ "$RUN_RC" -eq 0 ] || exit 1; awk -F '\t' '$1=="A"&&$2==1&&$17=="na"&&$18=="na"&&$19=="na"{ok=1} END{exit !ok}' "$RESULTS" || exit 1; [ "$INPUT_TEXT_COUNT" -eq 52 ] || { echo "A1 chunk input count unexpected: $INPUT_TEXT_COUNT" >&2; exit 1; }; [ "$TYPE_PROMPT_CALLS" -eq 2 ] || { echo "A1 type_prompt call count unexpected: $TYPE_PROMPT_CALLS" >&2; exit 1; }; [ "$TYPE_COUNTS" = "26,26," ] || { echo "A1 chunk counts unexpected: $TYPE_COUNTS" >&2; exit 1; }; [ "$CHUNK_CALLS" -eq 52 ] || { echo "A1 chunk validation count unexpected: $CHUNK_CALLS" >&2; exit 1; }; [ "$CHUNK_BAD" -eq 0 ] && [ "$CHUNK_UNQUOTED" -eq 0 ] || { echo "A1 chunk validation failed bad=$CHUNK_BAD unquoted=$CHUNK_UNQUOTED" >&2; exit 1; }; grep -q 'attempt=initial actual=100' "$RAW/QRD8650_A_t1_composer_len.txt" || { echo "short composer was not detected" >&2; exit 1; }; grep -q 'attempt=cleared actual=0.*hint_len=' "$RAW/QRD8650_A_t1_composer_len.txt" || { echo "hint-aware clear fixture was not observed" >&2; exit 1; }; grep -q 'attempt=retype actual=5142' "$RAW/QRD8650_A_t1_composer_len.txt" || { echo "composer retype did not pass" >&2; exit 1; }; grep -q 'attempt=2' "$RAW/QRD8650_A_t1_ui_attempts.txt" || { echo "ui_send retry was not exercised" >&2; exit 1; }; grep -q 'wait_s=0 skin=35.5 target_c=38.5' "$RAW/QRD8650_A_t1_cooldown.txt" || exit 1; grep -q 'cool_target_c=38.5' "$RAW/QRD8650_A_t1_status.txt" || exit 1
FINAL_RC=0; VOID_MODE=1; run_observation B 1; B_RC=$?; printf 'run_observation_B_VOID\t%s\n' "$B_RC" | tee -a "$RESULTS_LOG"; [ "$B_RC" -eq 0 ] || exit 1; awk -F '\t' '$1=="B"&&$2==1&&$16=="na"&&$17=="VOID"{ok=1} END{exit !ok}' "$RESULTS" || exit 1; grep -q 'status=0 row_void=1' "$RAW/QRD8650_B_t1_status.txt" || exit 1; grep -q 'wait_s=0 skin=35.5 target_c=37.0' "$RAW/QRD8650_B_t1_cooldown.txt" || exit 1; grep -q 'cool_target_c=37.0' "$RAW/QRD8650_B_t1_status.txt" || exit 1; [ "$FINAL_RC" -eq 0 ] || exit 1
VOID_MODE=0; run_observation A 2; A2_RC=$?; printf 'run_observation_A2_after_VOID\t%s\n' "$A2_RC" | tee -a "$RESULTS_LOG"; [ "$A2_RC" -eq 0 ] || exit 1; awk -F '\t' '$1=="A"&&$2==2{ok=1} END{exit !ok}' "$RESULTS" || exit 1; [ "$FINAL_RC" -eq 0 ] || exit 1; [ "$INPUT_TEXT_COUNT" -eq 130 ] || { echo "final chunk input count unexpected: $INPUT_TEXT_COUNT" >&2; exit 1; }; [ "$TYPE_PROMPT_CALLS" -eq 5 ] || { echo "final type_prompt call count unexpected: $TYPE_PROMPT_CALLS" >&2; exit 1; }; [ "$TYPE_COUNTS" = "26,26,26,26,26," ] || { echo "final chunk counts unexpected: $TYPE_COUNTS" >&2; exit 1; }; [ "$CHUNK_CALLS" -eq 130 ] || { echo "final chunk validation count unexpected: $CHUNK_CALLS" >&2; exit 1; }; [ "$CHUNK_BAD" -eq 0 ] && [ "$CHUNK_UNQUOTED" -eq 0 ] || { echo "final chunk validation failed bad=$CHUNK_BAD unquoted=$CHUNK_UNQUOTED" >&2; exit 1; }
# An exact 5,141-character first dump must retype once and then send only at 5,142.
EXACT_RAW="$TMP/exact-observations"; /bin/mkdir -p "$EXACT_RAW"; RAW="$EXACT_RAW"; COMPOSER_MODE=exact; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; VOID_MODE=0; UI_DUMP_COUNT=0; SEND_TAPS=0; void_reason=na; EXACT_RC=0; ui_send "$RAW/exact" 2 || EXACT_RC=$?; [ "$EXACT_RC" -eq 0 ] || exit 1; grep -q 'attempt=initial actual=5141' "$RAW/exact_composer_len.txt" || exit 1; grep -q 'attempt=retype actual=5142' "$RAW/exact_composer_len.txt" || exit 1; [ "$SEND_TAPS" -gt 0 ] || exit 1
# Under the old >=90% gate, this second 5,141-character dump would have sent; exact mode must VOID composer before any tap.
COMPOSER_MODE=exact_fail; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; UI_DUMP_COUNT=0; SEND_TAPS=0; void_reason=na; EXACT_FAIL_RC=0; ui_send "$RAW/exact-fail" 2 || EXACT_FAIL_RC=$?; [ "$EXACT_FAIL_RC" -eq 2 ] && [ "$void_reason" = composer ] && [ "$SEND_TAPS" -eq 0 ] || exit 1; grep -q 'attempt=retype actual=5141' "$RAW/exact-fail_composer_len.txt" || exit 1
HINT_RAW="$TMP/hint-observations"; /bin/mkdir -p "$HINT_RAW"; RAW="$HINT_RAW"; COMPOSER_MODE=hint_text; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; UI_DUMP_COUNT=0; SEND_TAPS=0; void_reason=na; HINT_RC=0; ui_send "$RAW/hint" 2 || HINT_RC=$?; [ "$HINT_RC" -eq 0 ] || exit 1; grep -q 'attempt=cleared actual=0.*hint_len=0.*empty_text_len=' "$RAW/hint_composer_len.txt" || exit 1; grep -q 'attempt=retype actual=5142' "$RAW/hint_composer_len.txt" || exit 1; [ "$SEND_TAPS" -gt 0 ] || exit 1
FIRST_RAW="$TMP/first-loss"; /bin/mkdir -p "$FIRST_RAW"; RAW="$FIRST_RAW"; COMPOSER_MODE=first_loss; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; FIRST_LOSS_USED=0; UI_DUMP_COUNT=0; SEND_TAPS=0; void_reason=na; FIRST_RC=0; ui_send "$RAW/first" 2 || FIRST_RC=$?; [ "$FIRST_RC" -eq 0 ] || exit 1; grep -q 'chunk=1 .*result=mismatch' "$RAW/first_typing_chunks.txt" && grep -q 'chunk=1 .*result=exact' "$RAW/first_typing_chunks.txt" || exit 1
MID_RAW="$TMP/mid-mismatch"; /bin/mkdir -p "$MID_RAW"; RAW="$MID_RAW"; COMPOSER_MODE=mid_mismatch; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; MID_MISMATCH_USED=0; UI_DUMP_COUNT=0; SEND_TAPS=0; void_reason=na; MID_RC=0; ui_send "$RAW/mid" 2 || MID_RC=$?; [ "$MID_RC" -eq 0 ] || exit 1; grep -q 'attempt=1 chunk_size=200 .*rc=1' "$RAW/mid_type_prompt.txt" && grep -q 'attempt=2 chunk_size=100 .*rc=0' "$RAW/mid_type_prompt.txt" || exit 1
FAIL_RAW="$TMP/three-fail"; /bin/mkdir -p "$FAIL_RAW"; RAW="$FAIL_RAW"; COMPOSER_MODE=always_mismatch; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; ALWAYS_MISMATCH=1; UI_DUMP_COUNT=0; SEND_TAPS=0; void_reason=na; FAIL_RC=0; ui_send "$RAW/fail" 2 || FAIL_RC=$?; [ "$FAIL_RC" -eq 2 ] && [ "$void_reason" = composer ] && [ "$SEND_TAPS" -eq 0 ] || exit 1; grep -q 'attempt=1 chunk_size=200 .*rc=1' "$RAW/fail_type_prompt.txt" && grep -q 'attempt=2 chunk_size=100 .*rc=1' "$RAW/fail_type_prompt.txt" || exit 1
CONT_RAW="$TMP/after-three-fail"; /bin/mkdir -p "$CONT_RAW"; RAW="$CONT_RAW"; RESULTS="$CONT_RAW/results.tsv"; printf 'arm\tturn\tttft_ms\tprefill_ms\tprefill_chunks\tnew_tokens_a\tnew_tokens_b\tdecode_tps\tengine_prefill\tengine_decode\tthermal_state\tskin_c_before\tskin_c_after\tfallback_count\tlmkd_count\tids_sha\toracle\toracle_logit\toracle_rule\n' > "$RESULTS"; COMPOSER_MODE=normal; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; ALWAYS_MISMATCH=0; UI_DUMP_COUNT=0; run_observation A 8; CONT_RC=$?; [ "$CONT_RC" -eq 0 ] || exit 1
WAKE_MODE=doze_once; WAKE_AWAKE=0; /bin/rm -f "$TMP/type-wake_ui_attempts.txt"; type_prompt "$TMP/type-wake" || exit 1; grep -q 'typing_chunk=1 wake_before=Dozing wake_after=Awake' "$TMP/type-wake_ui_attempts.txt" || exit 1; WAKE_MODE=normal; WAKE_AWAKE=1
# Under the old if [ "$arm" = A ] && [ "$turn" = 1 ] && [ "$telemetry_rc" -eq 0 ] && [ -z "$bench" ] condition without a row_void guard, the TOOL_RC=0 assertion below fails (A1 exits 3).
TOOL_RAW="$TMP/tool-observations"; TOOL_RESULTS="$TMP/tool-results.tsv"; /bin/mkdir -p "$TOOL_RAW"; printf 'arm\tturn\tttft_ms\tprefill_ms\tprefill_chunks\tnew_tokens_a\tnew_tokens_b\tdecode_tps\tengine_prefill\tengine_decode\tthermal_state\tskin_c_before\tskin_c_after\tfallback_count\tlmkd_count\tids_sha\toracle\toracle_logit\toracle_rule\n' > "$TOOL_RESULTS"; RAW="$TOOL_RAW"; RESULTS="$TOOL_RESULTS"; A_IDS_FILE=""; A_IDS_VALID=0; UI_DUMP_COUNT=0; TOOL_MODE=1; run_observation A 1; TOOL_RC=$?; printf 'run_observation_TOOLCALL_VOID\t%s\n' "$TOOL_RC" | tee -a "$RESULTS_LOG"; [ "$TOOL_RC" -eq 0 ] || exit 1; awk -F '\t' '$1=="A"&&$2==1&&$16=="na"&&$17=="na"{ok=1} END{exit !ok}' "$RESULTS" || exit 1; grep -q 'status=0 row_void=1.*structuredCalls=1 tool_calls=1.*void_reason=toolcall' "$RAW/QRD8650_A_t1_status.txt" || exit 1; [ ! -e "$RAW/PREREQUISITE.txt" ] || exit 1; TOOL_MODE=0; run_observation A 2; CONTINUE_RC=$?; printf 'run_observation_after_TOOLCALL_VOID\t%s\n' "$CONTINUE_RC" | tee -a "$RESULTS_LOG"; [ "$CONTINUE_RC" -eq 0 ] || exit 1; awk -F '\t' '$1=="A"&&$2==2{ok=1} END{exit !ok}' "$RESULTS" || exit 1
THERMAL_MODE=cool; /usr/bin/printf '0\n' > "$THERMAL_COUNTER"; run_observation A 3; COOL_RC=$?; [ "$COOL_RC" -eq 0 ] || exit 1; grep -q 'wait_s=0 skin=39.5 target_c=38.5' "$RAW/QRD8650_A_t3_cooldown.txt" || exit 1; grep -q 'wait_s=15 skin=35.5' "$RAW/QRD8650_A_t3_cooldown.txt" || exit 1; grep -q 'status=0 .*cooldown_s=15' "$RAW/QRD8650_A_t3_status.txt" || exit 1
THERMAL_MODE=never; /usr/bin/printf '0\n' > "$THERMAL_COUNTER"; run_observation A 4; HOT_RC=$?; [ "$HOT_RC" -eq 0 ] || exit 1; awk -F '\t' '$1=="A"&&$2==4&&$16=="na"&&$17=="na"{ok=1} END{exit !ok}' "$RESULTS" || exit 1; grep -q 'wait_s=900 skin=39.5 target_c=38.5' "$RAW/QRD8650_A_t4_cooldown.txt" || exit 1; grep -q 'status=0 row_void=1 cooldown_s=900.*cool_target_c=38.5.*void_reason=hot' "$RAW/QRD8650_A_t4_status.txt" || exit 1
THERMAL_MODE=ready; /usr/bin/printf '0\n' > "$THERMAL_COUNTER"; run_observation A 5; READY_RC=$?; [ "$READY_RC" -eq 0 ] || exit 1; awk -F '\t' '$1=="A"&&$2==5{ok=1} END{exit !ok}' "$RESULTS" || exit 1
THERMAL_MODE=afterhot; /usr/bin/printf '0\n' > "$THERMAL_COUNTER"; run_observation A 6; AFTER_RC=$?; [ "$AFTER_RC" -eq 0 ] || exit 1; awk -F '\t' '$1=="A"&&$2==6&&$13=="42.5"{ok=1} END{exit !ok}' "$RESULTS" || exit 1; grep -q 'status=0 .*cooldown_s=0' "$RAW/QRD8650_A_t6_status.txt" || exit 1
THERMAL_MODE=missing; /usr/bin/printf '0\n' > "$THERMAL_COUNTER"; MISSING_RUN_RC=0; run_observation A 7 || MISSING_RUN_RC=$?; [ "$MISSING_RUN_RC" -ne 0 ] && grep -q 'status=1 .*void_reason=thermal' "$RAW/QRD8650_A_t7_status.txt" && grep -q 'void_reason=thermal' "$RAW/QRD8650_A_t7_cooldown_thermal_gate.txt" || exit 1; THERMAL_MODE=initial; /usr/bin/printf '0\n' > "$THERMAL_COUNTER"
COMPOSER_VOID_RAW="$TMP/composer-void"; /bin/mkdir -p "$COMPOSER_VOID_RAW"; RAW="$COMPOSER_VOID_RAW"; RESULTS="$COMPOSER_VOID_RAW/results.tsv"; printf 'arm\tturn\tttft_ms\tprefill_ms\tprefill_chunks\tnew_tokens_a\tnew_tokens_b\tdecode_tps\tengine_prefill\tengine_decode\tthermal_state\tskin_c_before\tskin_c_after\tfallback_count\tlmkd_count\tids_sha\toracle\toracle_logit\toracle_rule\n' > "$RESULTS"; THERMAL_MODE=ready; COMPOSER_MODE=normal; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; DUMP_FAILS=5; VOID_MODE=0
[ ! -e "$RAW/QRD8650_B_t3_logcat_all.txt" ] || exit 1
COMPOSER_VOID_RC=0; run_observation B 3 || COMPOSER_VOID_RC=$?; [ "$COMPOSER_VOID_RC" -eq 0 ] && grep -q 'status=0 row_void=1.*void_reason=composer' "$RAW/QRD8650_B_t3_status.txt" || exit 1; DUMP_FAILS=0
RAM_LOG="$TMP/ram-gate.log"; RAM_RC=0; (gpu_fit_ram_gate 8-Gen-3 7864320) > "$RAM_LOG" 2>&1 || RAM_RC=$?; [ "$RAM_RC" -eq 2 ] && grep -q 'GPU_FIT_RAM memtotal_kb=7864320' "$RAM_LOG" || exit 1
RAM_RC=0; (gpu_fit_ram_gate 8-Gen-3 12582912) > "$RAM_LOG" 2>&1 || RAM_RC=$?; [ "$RAM_RC" -eq 0 ] || exit 1
RAM_RC=0; (gpu_fit_ram_gate 7p-Gen-3 7864320) > "$RAM_LOG" 2>&1 || RAM_RC=$?; [ "$RAM_RC" -eq 2 ] && grep -q 'GPU_FIT_RAM memtotal_kb=7864320' "$RAM_LOG" || exit 1
ROW_RAW="$TMP/governor-rows"; /bin/mkdir -p "$ROW_RAW"; ROW_LOGCAT_FILE="$TMP/row-logcat.txt"; ROW_IDS='[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]'; RAW="$ROW_RAW"; RESULTS="$ROW_RAW/results.tsv"; printf 'arm\tturn\tttft_ms\tprefill_ms\tprefill_chunks\tnew_tokens_a\tnew_tokens_b\tdecode_tps\tengine_prefill\tengine_decode\tthermal_state\tskin_c_before\tskin_c_after\tfallback_count\tlmkd_count\tids_sha\toracle\toracle_logit\toracle_rule\n' > "$RESULTS"; THERMAL_MODE=ready; COMPOSER_MODE=normal; COMPOSER_FOCUSED=0; COMPOSER_STAGE=screen; VOID_MODE=0; TOOL_MODE=0; BOARD=QRD8650
/usr/bin/printf '%s\n' '1000 1 1 I ReactNativeJS: llama_model_loader: loaded meta data with 42 tensors from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf' '1000 1 1 I ReactNativeJS: KALSA_PREWARM {"op":"done"}' '1001 1 1 I llama: reusing 0/938' "1001 1 1 I ReactNativeJS: KALSA_TELEMETRY {\"tokensPredicted\":1,\"promptMs\":1,\"predictedPerSecond\":1}" "1001 1 1 I ReactNativeJS: KALSA_BENCH_TOKENS {\"n\":938,\"ids\":$ROW_IDS}" '1001 1 1 I ReactNativeJS: KALSA_GOVERNOR_FALLBACK reason=cpu' '1001 1 1 I ReactNativeJS: KALSA_GOVERNOR {"prefill_chunks":938,"engine_prefill":"GPU","engine_decode":"CPU","thermal_state":"FAST","commit_bytes":1,"commit_ms":1,"thermo_source":"bench-skin"}' > "$ROW_LOGCAT_FILE"; RAW_LOG="$ROW_LOGCAT_FILE"; ROW_RC=0; run_observation B 1 || ROW_RC=$?; [ "$ROW_RC" -eq 0 ] && grep -q 'status=0 row_void=1.*void_reason=governor_fallback' "$ROW_RAW/QRD8650_B_t1_status.txt" || exit 1
/usr/bin/printf '%s\n' '1000 1 1 I ReactNativeJS: llama_model_loader: loaded meta data with 42 tensors from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf' '1000 1 1 I ReactNativeJS: KALSA_PREWARM {"op":"done"}' "1001 1 1 I ReactNativeJS: KALSA_TELEMETRY {\"tokensPredicted\":1,\"promptMs\":1,\"predictedPerSecond\":1}" "1001 1 1 I ReactNativeJS: KALSA_BENCH_TOKENS {\"n\":938,\"ids\":$ROW_IDS}" > "$ROW_LOGCAT_FILE"; ROW_RC=0; run_observation B 2 || ROW_RC=$?; [ "$ROW_RC" -eq 0 ] && grep -q 'status=0 row_void=1.*void_reason=governor_fallback' "$ROW_RAW/QRD8650_B_t2_status.txt" || exit 1
/usr/bin/printf '%s\n' '1000 1 1 I ReactNativeJS: llama_model_loader: loaded meta data with 42 tensors from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf' '1000 1 1 I ReactNativeJS: KALSA_PREWARM {"op":"done"}' '1001 1 1 I llama: reusing 0/938' "1001 1 1 I ReactNativeJS: KALSA_TELEMETRY {\"tokensPredicted\":1,\"promptMs\":1,\"predictedPerSecond\":1}" "1001 1 1 I ReactNativeJS: KALSA_BENCH_TOKENS {\"n\":938,\"ids\":$ROW_IDS}" > "$ROW_LOGCAT_FILE"; ROW_RC=0; run_observation A 1 || ROW_RC=$?; [ "$ROW_RC" -eq 0 ] && grep -q 'status=0 row_void=0' "$ROW_RAW/QRD8650_A_t1_status.txt" && ! grep -q 'void_reason=governor_fallback' "$ROW_RAW/QRD8650_A_t1_status.txt" || exit 1
ORACLE_TOP='[[1,0.0000],[2,-0.0513],[3,-1.0000],[4,-2.0000],[5,-3.0000]]'; ORACLE_SWAP='[[2,0.0000],[1,-0.0513],[3,-1.0000],[4,-2.0000],[5,-3.0000]]'; ORACLE_DRIFT='[[1,-0.1500],[2,-0.0513],[3,-1.0000],[4,-2.0000],[5,-3.0000]]'; ORACLE_NEAR='[[1,-0.0101],[2,-0.0202],[3,-1.0000],[4,-2.0000],[5,-3.0000]]'; ORACLE_NEAR_SWAP='[[2,-0.0101],[1,-0.0202],[3,-1.0000],[4,-2.0000],[5,-3.0000]]'; ORACLE_BAD='[[3,0.0000],[2,-0.0202],[1,-1.0000],[4,-2.0000],[5,-3.0000]]'
ORACLE_A="$TMP/oracle-a.jsonl"; ORACLE_B="$TMP/oracle-b.jsonl"; printf '{"step":0,"forced":false,"tok":1,"top":%s}\n' "$ORACLE_TOP" > "$ORACLE_A"; cp "$ORACLE_A" "$ORACLE_B"; ORACLE_OUT=$(python3 "$ORACLE_HELPER" "$ORACLE_A" "$ORACLE_B" G 0.03 0.02 0.10); case "$ORACLE_OUT" in oracle=PASS\ rule=none\ steps=1*) ;; *) exit 1;; esac
printf '{"step":0,"forced":false,"tok":1,"top":%s}\n' "$ORACLE_SWAP" > "$ORACLE_B"; ORACLE_OUT=$(python3 "$ORACLE_HELPER" "$ORACLE_A" "$ORACLE_B" G 0.03 0.02 0.10); case "$ORACLE_OUT" in oracle=FAIL\ rule=R1*) ;; *) exit 1;; esac
printf '{"step":0,"forced":false,"tok":1,"top":%s}\n' "$ORACLE_DRIFT" > "$ORACLE_B"; ORACLE_OUT=$(python3 "$ORACLE_HELPER" "$ORACLE_A" "$ORACLE_B" G 0.03 0.02 0.10); case "$ORACLE_OUT" in oracle=FAIL\ rule=R2*) ;; *) exit 1;; esac
printf '{"step":0,"forced":false,"tok":1,"top":%s}\n' "$ORACLE_NEAR" > "$ORACLE_A"; printf '{"step":0,"forced":false,"tok":2,"top":%s}\n' "$ORACLE_NEAR_SWAP" > "$ORACLE_B"; ORACLE_OUT=$(python3 "$ORACLE_HELPER" "$ORACLE_A" "$ORACLE_B" G 0.03 0.02 0.10); case "$ORACLE_OUT" in oracle=PASS\ rule=none\ steps=0*divergences=1*) ;; *) exit 1;; esac
printf '%s\n' "{\"step\":1,\"forced\":false,\"tok\":1,\"top\":$ORACLE_NEAR}" >> "$ORACLE_A"; printf '%s\n' "{\"step\":1,\"forced\":false,\"tok\":3,\"top\":$ORACLE_BAD}" >> "$ORACLE_B"; ORACLE_OUT=$(python3 "$ORACLE_HELPER" "$ORACLE_A" "$ORACLE_B" G 0.03 0.02 0.10); case "$ORACLE_OUT" in oracle=FAIL\ rule=R3*) ;; *) exit 1;; esac
printf '{"step":0,"forced":true,"tok":2,"top":%s}\n' "$ORACLE_TOP" > "$ORACLE_B"; printf '{"step":0,"forced":false,"tok":1,"top":%s}\n' "$ORACLE_TOP" > "$ORACLE_A"; ORACLE_OUT=$(python3 "$ORACLE_HELPER" "$ORACLE_A" "$ORACLE_B" TF 0.03 0.02 0.10); case "$ORACLE_OUT" in oracle=DESCRIPTIVE\ rule=R4*) ;; *) exit 1;; esac
ORACLE_HIGH='[[10,0.0000],[20,-0.5108],[30,-1.0000],[40,-2.0000],[50,-3.0000]]'; ORACLE_HIGH_SWAP='[[20,0.0000],[10,-0.5108],[30,-1.0000],[40,-2.0000],[50,-3.0000]]'; printf '%s\n' "{\"step\":0,\"forced\":true,\"tok\":10,\"top\":$ORACLE_HIGH}" > "$ORACLE_A"; printf '%s\n' "{\"step\":0,\"forced\":true,\"tok\":20,\"top\":$ORACLE_HIGH_SWAP}" > "$ORACLE_B"; ORACLE_OUT=$(python3 "$ORACLE_HELPER" "$ORACLE_A" "$ORACLE_B" TF 0.03 0.02 0.10); printf 'oracle_tf_wrong_prefix %s\n' "$ORACLE_OUT"; case "$ORACLE_OUT" in oracle=FAIL\ rule=R1\ steps=1*) ;; *) exit 1;; esac
printf '%s\n' "{\"step\":0,\"forced\":false,\"tok\":10,\"top\":$ORACLE_HIGH}" > "$ORACLE_A"; printf '%s\n' "{\"step\":0,\"forced\":false,\"tok\":20,\"top\":$ORACLE_HIGH_SWAP}" > "$ORACLE_B"; ORACLE_OUT=$(python3 "$ORACLE_HELPER" "$ORACLE_A" "$ORACLE_B" G 0.03 0.02 0.10); printf 'oracle_g_high_margin %s\n' "$ORACLE_OUT"; case "$ORACLE_OUT" in oracle=FAIL\ rule=R1*) ;; *) exit 1;; esac
ORACLE_MODE=""; : > "$ORACLE_A"; : > "$ORACLE_B"; for oracle_step in 0 1 2 3 4 5; do printf '%s\n' "{\"step\":$oracle_step,\"forced\":true,\"tok\":1,\"top\":$ORACLE_TOP}" >> "$ORACLE_A"; oracle_b_tok=1; [ "$oracle_step" -eq 5 ] && oracle_b_tok=2; printf '%s\n' "{\"step\":$oracle_step,\"forced\":true,\"tok\":$oracle_b_tok,\"top\":$ORACLE_TOP}" >> "$ORACLE_B"; done; ORACLE_OUT=$(python3 "$ORACLE_HELPER" "$ORACLE_A" "$ORACLE_B" TF 0.03 0.02 0.10); printf 'oracle_tf_late_tok %s\n' "$ORACLE_OUT"; case "$ORACLE_OUT" in oracle=DESCRIPTIVE\ rule=R4\ steps=6*) ;; *) exit 1;; esac
ORACLE_MODE=""; : > "$ORACLE_A"; : > "$ORACLE_B"; for oracle_step in 0 1 2 3; do printf '%s\n' "{\"step\":$oracle_step,\"forced\":true,\"tok\":1,\"top\":$ORACLE_TOP}" >> "$ORACLE_A"; oracle_top="$ORACLE_TOP"; oracle_forced=true; [ "$oracle_step" -eq 3 ] && oracle_top="$ORACLE_DRIFT" && oracle_forced=false; printf '%s\n' "{\"step\":$oracle_step,\"forced\":$oracle_forced,\"tok\":1,\"top\":$oracle_top}" >> "$ORACLE_B"; done; ORACLE_OUT=$(python3 "$ORACLE_HELPER" "$ORACLE_A" "$ORACLE_B" TF 0.03 0.02 0.10); printf 'oracle_tf_unforced_drift %s\n' "$ORACLE_OUT"; case "$ORACLE_OUT" in oracle=FAIL\ rule=R2\ steps=4*) ;; *) exit 1;; esac
ORACLE_MODE=""; set_prefs 0 "$TMP/oracle-columns" || exit 1; if /usr/bin/sqlite3 "$TMP/pushed-rkstorage" .dump | grep -Fq 'kalsa.bench.probs'; then exit 1; fi; if /usr/bin/sqlite3 "$TMP/pushed-rkstorage" .dump | grep -Fq 'kalsa.bench.force_ids'; then exit 1; fi
holder_loop & HOLDER_TEST_PID=$!; /bin/sleep 0.1; kill "$HOLDER_TEST_PID" 2>/dev/null || true; wait "$HOLDER_TEST_PID" 2>/dev/null; printf 'holder_loop\t%s\n' "$?" | tee -a "$RESULTS_LOG"
END_WRITTEN=0
record cleanup cleanup
printf 'RESULTS=%s\n' "$RESULTS_LOG"
