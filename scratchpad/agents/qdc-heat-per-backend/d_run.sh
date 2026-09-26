#!/bin/bash
set -u
ADB_PORT="${ADB_PORT:-6037}"; case "$ADB_PORT" in 5037|6037|6039) ;; *) echo "ADB_PORT must be 5037, 6037, or 6039" >&2; exit 2;; esac
export LC_ALL=C ANDROID_ADB_SERVER_PORT="$ADB_PORT"
# QDC heat run: per-backend prefill heat (CPU vs GPU) on the shipped app path.
# usage: d_run.sh <job_id> <apk_path> <arm_order> [deadline_minutes]
#   arm_order: C/G sequence, e.g. CGGCGC = pair1 C->G, pair2 G->C, pair3 C->G.
# env: TYPE_LADDER (default "200 100"), TYPE_CHUNK_PAUSE_S (default 0), DEADLINE via argv.
usage() { echo "usage: d_run.sh <job_id> <apk_path> <arm_order> [deadline_minutes]" >&2; }
validate_deadline_minutes() {
  local value="$1"
  case "$value" in ''|*[!0-9]*) return 1;; esac
  [ "$value" -ge 20 ] && [ "$value" -le 110 ]
}
if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then usage; exit 2; fi
JOB="$1"; APK="$2"; ARM_ORDER="$3"
DEADLINE_MINUTES=72; [ "$#" -eq 4 ] && DEADLINE_MINUTES="$4"
validate_deadline_minutes "$DEADLINE_MINUTES" || { echo "deadline_minutes must be an integer from 20 to 110" >&2; usage; exit 2; }
case "$JOB" in ''|*[!A-Za-z0-9._-]*) echo "invalid job_id" >&2; exit 2;; esac
case "$APK" in /*) ;; *) echo "apk_path must be absolute" >&2; exit 2;; esac
case "$ARM_ORDER" in *[!CG]*) echo "arm_order must contain only C and G" >&2; exit 2;; esac
[ -n "$ARM_ORDER" ] || { echo "arm_order empty" >&2; exit 2; }
# PAIR_START lets a later session continue the pair sequence (owner
# 2026-09-26: two QRD8650 sessions, session 2 runs PAIR_START=3).
PAIR_START="${PAIR_START:-1}"
case "$PAIR_START" in ''|*[!0-9]*) echo "PAIR_START must be an integer >= 1" >&2; exit 2;; esac
[ "$PAIR_START" -ge 1 ] || { echo "PAIR_START must be an integer >= 1" >&2; exit 2; }

PROMPT_FILE=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-heat-per-backend/PROMPT.txt
PROMPT_META=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-heat-per-backend/PROMPT.meta
PROMPT_SHA=$(awk '{print $1}' "$PROMPT_META")
PROMPT_BYTES=$(awk '{print $2}' "$PROMPT_META")
PROMPT_TEXT=""; PROMPT_EXPECTED_CHARS=0
load_prompt() {
  local text local_sha size
  [ -f "$PROMPT_FILE" ] || return 1
  local_sha=$(/usr/bin/shasum -a 256 "$PROMPT_FILE" | awk '{print $1}')
  size=$(wc -c < "$PROMPT_FILE" | tr -d '[:space:]')
  [ "$local_sha" = "$PROMPT_SHA" ] && [ "$size" = "$PROMPT_BYTES" ] || return 1
  text=$(tr '\n' ' ' < "$PROMPT_FILE") || return 1
  PROMPT_EXPECTED_CHARS=$(printf '%s' "$text" | wc -m | tr -d '[:space:]')
  # F9: PROMPT_TEXT is exactly what reaches the composer (newline-turned
  # trailing space stripped); variant_tokens must count this same text.
  PROMPT_TEXT="${text% }"
  [ -n "$PROMPT_TEXT" ] && [ "$PROMPT_EXPECTED_CHARS" -eq "$PROMPT_BYTES" ]
}
# prompt-<n>.txt names carry token counts measured with the Qwen tokenizer;
# this counts the exact bytes that will be typed (stdin) against $MODEL, so the
# nearest-to-1024 choice stays honest for any tokenizer. Falls back to the
# label when llama-tokenize is absent on the driver host.
variant_tokens() {
  local count
  command -v llama-tokenize >/dev/null 2>&1 || return 1
  count=$(llama-tokenize -m "$MODEL" --stdin --show-count 2>/dev/null | sed -n 's/.*tokens: \([0-9][0-9]*\).*/\1/p')
  [ -n "$count" ] && printf '%s' "$count"
}
load_prompt || { echo "PROMPT_IDENTITY_FAIL" >&2; exit 6; }

OUT="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-heat-per-backend"
RAW="$OUT/raw/$JOB"; mkdir -p "$RAW"
ADB_LOG="$RAW/adb-exit.log"; DRIVER_LOG="$RAW/driver.log"; RESULTS="$RAW/results.tsv"; END_MARKER="$RAW/END.txt"
: > "$ADB_LOG"; : > "$DRIVER_LOG"
printf 'pair\tarm\tturn\tstatus\tvoid_reason\twarm_start\tcooldown_s\tsettle_s\tskin_before\tskin_after\tbatt_temp_before\tbatt_temp_after\tbatt_level\tplugged\tprefill_ms\tengine_prefill\tengine_decode\troute_requested\troute_push\troute_mismatch\tchunks_sum\tchunks_str\tprompt_n\ttokens_predicted\tdecode_tps\tthermal_state\tfailed\tfallback_count\ttool_calls\tlmkd_count\n' > "$RESULTS"
PKG=com.kalsa.app
# Shipping default: the catalog file LFM2.5-2.6B-QAD-Q4_0.gguf (coordinator
# decision 2026-09-25: we measure the shipped config; ModelRegistry.ts:278-279).
# The entry declares no mmproj, so the governor stays eligible on this build.
# Qwen3.5-4B stays reachable via env (MODEL/MODEL_DIR/MODEL_FILE/MMPROJ); its
# identity constants key off MODEL_FILE, so this is enough:
#   MODEL_DIR=qwen3.5-4b MODEL_FILE=Qwen3.5-4B-Q4_K_M.gguf MMPROJ=/Users/marco/kalsa-qdc/models/mmproj-F16.gguf
MODEL_DIR="${MODEL_DIR:-lfm2.5-2.6b}"
MODEL_FILE="${MODEL_FILE:-LFM2.5-2.6B-QAD-Q4_0.gguf}"
case "$MODEL_FILE" in
  Qwen3.5-4B-Q4_K_M.gguf)
    MODEL="${MODEL:-/Users/marco/kalsa-qdc/models/$MODEL_FILE}"
    MODEL_SIZE="${MODEL_SIZE:-2834975040}"
    MODEL_SHA="${MODEL_SHA:-3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630}"
    MMPROJ="${MMPROJ-/Users/marco/kalsa-qdc/models/mmproj-F16.gguf}" ;;
  *)
    MODEL="${MODEL:-/Users/marco/kalsa-models/mac/$MODEL_FILE}"
    MODEL_SIZE="${MODEL_SIZE:-1593894944}"
    MODEL_SHA="${MODEL_SHA:-a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03}" ;;
esac
# Empty MMPROJ (the LFM default) skips every mmproj copy/size check in mmproj_setup.
MMPROJ="${MMPROJ:-}"; MMPROJ_FILE="${MMPROJ_FILE:-mmproj-F16.gguf}"; MMPROJ_SIZE="${MMPROJ_SIZE:-672423616}"
DEVICE_TMP=/data/local/tmp/kalsa-heat; MODEL_REMOTE="$DEVICE_TMP/$MODEL_FILE"
HEAT_TMP="$DEVICE_TMP/heat"
TYPE_LADDER="${TYPE_LADDER:-"200 100"}"
START_EPOCH=$(date +%s); DEADLINE_EPOCH=$((START_EPOCH + DEADLINE_MINUTES * 60)); END_WRITTEN=0
SER=""; HOLDER_PID=0; SCREEN_OFF_TIMEOUT=""; SCREEN_OFF_TIMEOUT_SAVED=0
FIRST_SKIN_C=""; PREV_SKIN=""; PREV_TIME=0; THERMO_JSON=""; APP_PID=""; ANCHOR_EPOCH=0; SEND_ANCHOR_EPOCH=0; ANCHOR_STAMP=""
TYPE_PROMPT_CALLS=0; TYPE_LADDER_STATE=""; COOL_TARGET_C=37.0; COOL_POLL_S=15; COOL_MAX_S=720
SETTLE_TARGET_C=37.0; SETTLE_MAX_S=240; COOLDOWN_SECONDS=na; SETTLE_SECONDS=na
TURN_WALL_CAP_S="${TURN_WALL_CAP_S:-900}"; TURN_START_EPOCH=""
SAMPLER_PID=0
DRIVER_PHASE="${DRIVER_PHASE:-arms}"
source /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-heat-per-backend/parse.sh
source /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-heat-per-backend/safety.sh
source /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-heat-per-backend/forced_decode.sh
source /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-heat-per-backend/battery_trust.sh
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$DRIVER_LOG"; }
write_end() { [ "$END_WRITTEN" -eq 1 ] || { printf 'END reason=%s\n' "$1" > "$END_MARKER"; END_WRITTEN=1; }; }
deadline_check() { [ "$(date +%s)" -lt "$DEADLINE_EPOCH" ] || { log "DEADLINE_${DEADLINE_MINUTES}_MIN"; write_end "deadline_${DEADLINE_MINUTES}_min"; exit 124; }; }
ADB_BIN="${ADB_BIN:-/opt/homebrew/bin/adb}"
adbT() {
  local seconds="$1" rc argline="" arg
  shift
  # Background + wait: an arriving INT/TERM interrupts wait immediately, so
  # on_signal runs without waiting out the perl alarm (2026-09-26: TERM used
  # to sit until the in-flight adb call returned). Background children get
  # stdin from /dev/null; adb reads none here. Non-signal semantics unchanged
  # (wait returns the child's status, signal death still 128+n).
  /usr/bin/perl -e 'alarm shift; exec @ARGV or exit 127' "$seconds" "$ADB_BIN" "$@" &
  CURRENT_CHILD_PID=$!
  wait "$CURRENT_CHILD_PID"
  rc=$?
  CURRENT_CHILD_PID=0
  for arg in "$@"; do printf -v argline '%s %q' "$argline" "$arg"; done
  printf 'rc=%s%s\n' "$rc" "$argline" >> "$ADB_LOG"
  return "$rc"
}
power_capture() {
  local file="$1"
  local attempt rc has_wakefulness
  : > "${file}.log"
  for attempt in 1 2 3; do
    adbT 60 -s "$SER" shell dumpsys power > "$file" 2>&1
    rc=$?
    has_wakefulness=0
    grep -q 'mWakefulness=' "$file" && has_wakefulness=1
    printf 'attempt=%s rc=%s has_wakefulness=%s\n' "$attempt" "$rc" "$has_wakefulness" >> "${file}.log"
    if [ "$has_wakefulness" -eq 1 ]; then return 0; fi
    case "$rc" in 124|255) ;; *) return 1 ;; esac
  done
  return 1
}
wake_tap() {
  local wake_log="$1"
  local bounds tap x y rc
  bounds="${LAST_EDIT_BOUNDS:-}"
  tap=$(printf '%s\n' "$bounds" | awk 'NF==4&&$1~/^[0-9]+$/&&$2~/^[0-9]+$/&&$3~/^[0-9]+$/&&$4~/^[0-9]+$/{printf "%d %d",($1+$3)/2,($2+$4)/2}')
  if [ -n "$tap" ]; then
    read -r x y <<< "$tap"
  else
    x=540; y=2047
  fi
  adbT 60 -s "$SER" shell input tap "$x" "$y" >> "$wake_log" 2>&1
  rc=$?
  printf 'wake_tap=%s,%s rc=%s\n' "$x" "$y" "$rc" >> "$wake_log"
  return "$rc"
}
wake_sequence() {
  local wake_log="${1:-$RAW/wake.log}"
  local check_file="$wake_log.power"
  local tap_rc check_rc
  adbT 60 -s "$SER" shell locksettings set-disabled true >> "$wake_log" 2>&1 || true
  adbT 60 -s "$SER" shell input keyevent KEYCODE_WAKEUP >> "$wake_log" 2>&1 || true
  adbT 60 -s "$SER" shell wm dismiss-keyguard >> "$wake_log" 2>&1 || true
  sleep 1
  wake_tap "$wake_log"; tap_rc=$?
  adbT 60 -s "$SER" shell svc power stayon true >> "$wake_log" 2>&1 || true
  adbT 60 -s "$SER" shell settings put system screen_off_timeout 1800000 >> "$wake_log" 2>&1 || true
  adbT 60 -s "$SER" shell dumpsys power > "$check_file" 2>&1
  check_rc=$?
  [ "$check_rc" -eq 0 ] && grep -q 'mWakefulness=Awake' "$check_file" || return 1
  [ "$tap_rc" -eq 0 ] || return 1
  return 0
}
device_wake() {
  if [ "$SCREEN_OFF_TIMEOUT_SAVED" -eq 0 ]; then
    SCREEN_OFF_TIMEOUT_SAVED=1
    SCREEN_OFF_TIMEOUT=$(adbT 60 -s "$SER" shell settings get system screen_off_timeout | tr -d '\r')
  fi
  wake_sequence "$RAW/wake.log"
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
restore_device() { [ -n "$SER" ] || return 0; adbT 60 -s "$SER" shell svc power stayon false >/dev/null 2>&1 || true; adbT 60 -s "$SER" shell locksettings set-disabled false >/dev/null 2>&1 || true; if [ "$SCREEN_OFF_TIMEOUT" = null ]; then adbT 60 -s "$SER" shell settings delete system screen_off_timeout >/dev/null 2>&1 || true; elif [ -n "$SCREEN_OFF_TIMEOUT" ]; then adbT 60 -s "$SER" shell settings put system screen_off_timeout "$SCREEN_OFF_TIMEOUT" >/dev/null 2>&1 || true; fi; }
holder_loop() { while :; do [ "${ALLOW_RUN_AS_WITHOUT_CHMOD:-0}" = "1" ] || adbT 60 -s "$SER" shell chmod 771 /data >> "$RAW/holder.log" 2>&1 || true; sleep 2; done; }
stop_holder() { [ "$HOLDER_PID" -ne 0 ] && { kill "$HOLDER_PID" 2>/dev/null || true; wait "$HOLDER_PID" 2>/dev/null || true; HOLDER_PID=0; }; }
stop_sampler() {
  [ "${SKIP_SAMPLER:-0}" = "1" ] && return 0
  [ -n "$SER" ] || return 0
  # Every exit path stops the device-side sampler, including one orphaned by
  # an earlier invocation (SAMPLER_PID=0 here); ensure_sampler relaunches it.
  adbT 30 -s "$SER" shell "touch $HEAT_TMP/stop" >/dev/null 2>&1 || true
  [ "$SAMPLER_PID" -ne 0 ] || return 0
  sleep 3
  kill "$SAMPLER_PID" 2>/dev/null || true
  wait "$SAMPLER_PID" 2>/dev/null || true
  SAMPLER_PID=0
}
CURRENT_CHILD_PID=0
SIGNAL_NAME=""
cleanup() {
  local rc=$?
  restore_device
  stop_holder
  stop_sampler
  if [ -n "$SIGNAL_NAME" ]; then write_end "signal_$SIGNAL_NAME"; else write_end "exit_$rc"; fi
}
# INT/TERM end the session through the same cleanup path, then exit (the old
# shared EXIT/INT/TERM trap ran cleanup and RESUMED: the operator needed
# kill -9 and END still said exit_0). Worst-case delivery is the current bare
# sleep: 5 s poll quantum, 15 s cooldown/settle poll, 60 s post-turn tail;
# every adbT is interrupted at once via the wait above.
on_signal() {
  SIGNAL_NAME="$1"
  if [ "$CURRENT_CHILD_PID" -ne 0 ]; then
    kill "$CURRENT_CHILD_PID" 2>/dev/null || true
    wait "$CURRENT_CHILD_PID" 2>/dev/null || true
    CURRENT_CHILD_PID=0
  fi
  cleanup
  exit "$(( 128 + $2 ))"
}
trap 'on_signal INT 2' INT
trap 'on_signal TERM 15' TERM
trap cleanup EXIT
SER="${ADB_SERIAL:-$(adbT 60 devices | awk 'NR > 1 && $2 == "device" { print $1; exit }' | tr -d '\r')}"
[ -n "$SER" ] || { log "NO_DEVICE on $ADB_PORT"; exit 2; }
adbT 60 devices | awk -v serial="$SER" 'NR > 1 && $1 == serial && $2 == "device" { found=1 } END { exit !found }' || { log "DEVICE_NOT_ATTACHED serial=$SER port=$ADB_PORT"; exit 2; }
adbT 60 -s "$SER" wait-for-device > "$RAW/wait_for_device.txt" 2>&1 || { log "WAIT_FOR_DEVICE_FAIL"; exit 2; }
{
  echo "serial=$SER"; echo "port=$ANDROID_ADB_SERVER_PORT"
  for p in ro.soc.model ro.product.name ro.product.model ro.build.fingerprint ro.build.type ro.debuggable persist.sys.locale; do
    echo "$p"; adbT 60 -s "$SER" shell getprop "$p"
  done
  echo "MemTotal"; adbT 60 -s "$SER" shell "cat /proc/meminfo | grep '^MemTotal:'"
  echo "id"; adbT 60 -s "$SER" shell id
  echo "screen_off_timeout"; adbT 60 -s "$SER" shell settings get system screen_off_timeout
} > "$RAW/recon.txt" 2>&1
SOC=$(adbT 60 -s "$SER" shell getprop ro.soc.model | tr -d '\r')
PRODUCT_NAME=$(adbT 60 -s "$SER" shell getprop ro.product.name | tr -d '\r')
case "$SOC" in
  SM8550) BOARD=8-Gen-2 ;;
  SM8650|QRD8650) BOARD=8-Gen-3 ;;
  SM8750|QRD8750) BOARD=8-Elite ;;
  SM7675|QRD7675) BOARD=7-Gen-3 ;;
  *) log "UNSUPPORTED_SOC=$SOC"; exit 6 ;;
esac
printf 'device_tag=%s\n' "$BOARD" >> "$RAW/recon.txt"
configure_screen || { log "SCREEN_SETUP_FAIL"; exit 2; }
# restore.sh (abnormal-end recovery) needs the pre-run timeout and serial even
# if this process is SIGKILLed before cleanup can run.
printf 'SER=%s\nSCREEN_OFF_TIMEOUT=%s\n' "$SER" "$SCREEN_OFF_TIMEOUT" > "$OUT/.restore-state"

launch_sampler() {
  [ "${SKIP_SAMPLER:-0}" = "1" ] && { log "sampler_skipped (SKIP_SAMPLER=1)"; return 0; }
  "$ADB_BIN" -s "$SER" shell "sh $HEAT_TMP/smp.sh" >> "$RAW/sampler.log" 2>&1 &
  SAMPLER_PID=$!
  sleep 2
}

ensure_sampler() {
  [ "${SKIP_SAMPLER:-0}" = "1" ] && return 0
  # The sampler usually survives from the setup invocation as an orphaned adb
  # child; verify by growth, relaunch if the file is not advancing.
  local s1 s2
  s1=$(adbT 30 -s "$SER" shell "wc -c < $HEAT_TMP/samples.txt 2>/dev/null" | tr -d '\r[:space:]')
  sleep 4
  s2=$(adbT 30 -s "$SER" shell "wc -c < $HEAT_TMP/samples.txt 2>/dev/null" | tr -d '\r[:space:]')
  printf 'ensure_sampler bytes=%s->%s\n' "${s1:-na}" "${s2:-na}" >> "$RAW/setup.log"
  [ -n "${s1:-}" ] && [ -n "${s2:-}" ] && [ "$s2" -gt "$s1" ] 2>/dev/null && return 0
  adbT 30 -s "$SER" shell "rm -f $HEAT_TMP/stop" >> "$RAW/setup.log" 2>&1 || true
  launch_sampler
}

if [ "$DRIVER_PHASE" = "setup" ] || [ "$DRIVER_PHASE" = "full" ]; then
  # ---- one-time setup: install, DB, prefs, model, sampler ----
  # "full" keeps running into the arms in the SAME invocation: the screen
  # timeout set by configure_screen stays 1800000 for the whole session and
  # is restored only by cleanup at the end (doze trap).
  holder_loop & HOLDER_PID=$!; sleep 1
  fresh_install "$RAW/setup" || { log "INSTALL_FAIL"; exit 3; }
  bootstrap_db "$RAW/setup" || { log "BOOTSTRAP_FAIL"; exit 3; }
  FIRST_SKIN_C=$(thermal_record session_pre) || { log "NO_VALID_INITIAL_SKIN"; exit 6; }
  PREV_SKIN="$FIRST_SKIN_C"; PREV_TIME=$(date +%s)
  # Both before the first safety_gate: forced ids must exist before the first
  # set_prefs writes them, and the trust verdict before the first hard_stops.
  forced_ids_build || { log "FORCED_DECODE_FAIL"; write_end "forced_decode"; exit 6; }
  battery_trust_check
  safety_gate setup
  model_setup || { log "MODEL_SETUP_FAIL"; exit 5; }
  if [ "${SKIP_SAMPLER:-0}" != "1" ]; then
    adbT 30 -s "$SER" shell "mkdir -p $HEAT_TMP && rm -f $HEAT_TMP/stop" >> "$RAW/setup.log" 2>&1
    adbT 60 -s "$SER" push "$OUT/smp.sh" "$HEAT_TMP/smp.sh" >> "$RAW/setup.log" 2>&1
    adbT 30 -s "$SER" shell "chmod 644 $HEAT_TMP/smp.sh" >> "$RAW/setup.log" 2>&1
  fi
  launch_sampler
  log "SETUP_DONE board=$BOARD sampler_pid=$SAMPLER_PID skin0=$FIRST_SKIN_C"
  if [ "$DRIVER_PHASE" = "setup" ]; then
    log "PHASE_SETUP_COMPLETE"
    log "LOAD_PROOF_DEFERRED (the setup phase sends no turn, so no loader line exists yet)"
    exit 0
  fi
  # ---- one-per-board calibration + tools-off probe (owner protocol item 3) ----
  # A short READY turn measures the template overhead N0; the filler variant
  # whose tokens+N0 lands nearest 1024 becomes the measured prompt. The same
  # window doubles as the tools-off probe (any KALSA_TOOLCALL aborts).
  CAL_OUT="$RAW/calibration.txt"
  device_wake || true
  # Anchor BEFORE the app start: poll_load must only accept lines from this
  # launch, but clearing after app_foreground would erase the eager load's
  # loader line — the one line the proof needs.
  clear_anchor "$RAW/calib" || { log "CALIB_CLEAR_FAIL"; exit 3; }
  app_foreground "$RAW/calib" || { log "CALIB_FOREGROUND_FAIL"; exit 3; }
  safety_gate calib
  # Load proof MUST run before calibrate_turn: the engine eager-loads at app
  # start, so the loader line exists in the logcat buffer only until
  # clear_anchor wipes it (device evidence: s23-heat-cpu-vs-gpu-v2/raw/
  # arm-stream-logcat.txt — launch -> engine.eagerInit -> llama_model_loader
  # within 1 s). Aborts setup unless the opened GGUF is $MODEL_DIR/$MODEL_FILE.
  poll_load "$RAW/calib_load.txt" || { log "LOAD_PROOF_FAIL expected=$MODEL_DIR/$MODEL_FILE"; write_end "load_proof"; exit 3; }
  log "LOAD_PROOF $(grep -o 'llama_model_loader: loaded meta data with .* from [^ ]*' "$RAW/calib_load.txt" | tail -1)"
  calibrate_turn "$RAW/calib_cpu" cpu | tee "$CAL_OUT" | tee -a "$DRIVER_LOG"
  N0=$(sed -n 's/.*chunks_sum=\([0-9][0-9]*\).*/\1/p' "$CAL_OUT" | tail -1)
  CAL_TOOLS=$(sed -n 's/.*tool_calls=\([0-9][0-9]*\).*/\1/p' "$CAL_OUT" | tail -1)
  if [ -z "$N0" ] || [ "$N0" -le 0 ] 2>/dev/null; then
    log "CALIB_FAIL no N0"; write_end "calib_fail"; exit 3
  fi
  if [ -n "$CAL_TOOLS" ] && [ "$CAL_TOOLS" -gt 0 ] 2>/dev/null; then
    log "TOOLS_NOT_OFF tool_calls=$CAL_TOOLS"; write_end "tools_not_off"; exit 3
  fi
  PROMPT_VARIANTS="${PROMPT_VARIANTS:-727 786 841 1010}"
  BEST=""; BEST_TOK=0; BEST_D=99999
  for v in $PROMPT_VARIANTS; do
    vf="$OUT/prompt-$v.txt"
    [ -f "$vf" ] || continue
    vtext=$(tr '\n' ' ' < "$vf"); vtext=${vtext% }
    tok=$(printf '%s' "$vtext" | variant_tokens); tok=${tok:-$v}
    d=$(awk -v a="$tok" -v n="$N0" 'BEGIN{d=a+n-1024; if(d<0)d=-d; print d}')
    if awk -v d="$BEST_D" -v x="$d" 'BEGIN{exit !(x<d)}'; then BEST_D=$d; BEST=$v; BEST_TOK=$tok; fi
  done
  [ -n "$BEST" ] || { log "CALIB_VARIANT_FAIL N0=$N0"; write_end "calib_variant"; exit 3; }
  CAL_TOTAL=$((BEST_TOK + N0))
  [ "$CAL_TOTAL" -ge 973 ] && [ "$CAL_TOTAL" -le 1075 ] || { log "CALIB_BAND_FAIL total=$CAL_TOTAL N0=$N0 tokens=$BEST_TOK band=[973,1075]"; write_end "calib_band"; exit 3; }
  # Arm identity follows the chosen variant: PROMPT.txt/PROMPT.meta are
  # re-pinned to it so DRIVER_PHASE=arms invocations send and verify this text.
  cp "$OUT/prompt-$BEST.txt" "$PROMPT_FILE"
  PROMPT_SHA=$(/usr/bin/shasum -a 256 "$PROMPT_FILE" | awk '{print $1}')
  PROMPT_BYTES=$(wc -c < "$PROMPT_FILE" | tr -d '[:space:]')
  printf '%s %s\n' "$PROMPT_SHA" "$PROMPT_BYTES" > "$PROMPT_META"
  # F3: reload through the same loader a DRIVER_PHASE=arms invocation will
  # use, so this session's arms and any later one send one identical text.
  load_prompt || { log "PROMPT_PIN_FAIL variant=$BEST"; write_end "prompt_pin"; exit 6; }
  log "CALIB_DONE N0=$N0 variant=$BEST tokens=$BEST_TOK total_estimate=$CAL_TOTAL chars=${#PROMPT_TEXT} tools=$CAL_TOOLS"
  # Equal-decode reference (coordinator 2026-09-26): with forced ids every arm must
  # report the calibration turn's tokensPredicted (127 for 128 forced ids on
  # QRD8650, raw/sa851338); run_arm stops the session on any other value.
  if [ "${FORCED_DECODE_N:-0}" -ge 1 ] 2>/dev/null; then
    DECODE_LEN_REF=$(json_field "$(last_json_after KALSA_TELEMETRY "$RAW/calib_cpu_logcat_all.txt")" tokensPredicted)
    case "$DECODE_LEN_REF" in ''|*[!0-9]*) log "DECODE_LEN_REF_FAIL value=$DECODE_LEN_REF"; write_end "decode_len_ref"; exit 6;; esac
    printf '%s\n' "$DECODE_LEN_REF" > "$RAW/decode_len_ref.txt"
    log "DECODE_LEN_REF=$DECODE_LEN_REF forced_n=$FORCED_DECODE_N"
  fi
else
  holder_loop & HOLDER_PID=$!; sleep 1
  ensure_sampler || { log "SAMPLER_DEAD"; exit 4; }
  battery_trust_load
  DECODE_LEN_REF=$(cat "$RAW/decode_len_ref.txt" 2>/dev/null)
fi

# ---- arms ----
TURN=0; FINAL_RC=0
for ((i=0; i<${#ARM_ORDER}; i++)); do
  deadline_check
  a="${ARM_ORDER:i:1}"
  case "$a" in
    C) BACKEND=cpu ;;
    G) BACKEND=gpu ;;
  esac
  TURN=$((TURN+1))
  # pair = ceil(turn/2) + (PAIR_START - 1): every consecutive pair of turns
  # is one pair (1,1,2,2,...), offset so a later session continues it.
  PAIR=$((PAIR_START + (TURN + 1) / 2 - 1))
  run_arm "$BACKEND" "$PAIR" "$TURN" || { FINAL_RC=1; log "ABORT arm=$a pair=$PAIR turn=$TURN"; break; }
done
stop_sampler
if [ "${SKIP_SAMPLER:-0}" != "1" ]; then adbT 120 -s "$SER" pull "$HEAT_TMP/samples.txt" "$RAW/samples.txt" >> "$RAW/setup.log" 2>&1 || true; fi
log "DONE board=$BOARD final_rc=$FINAL_RC results=$RESULTS"
exit "$FINAL_RC"
