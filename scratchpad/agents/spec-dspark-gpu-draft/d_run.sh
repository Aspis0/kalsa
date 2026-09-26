#!/usr/bin/env bash
# d_run.sh — session driver for the DSpark S23 arms (A / B4 / B8 / C4 / C8
# with the matched-N method). One responsibility: orchestration — device prep,
# push+sha verification, safety gates, the arm loop (mid-arm poll, timeout,
# orphan kill), results, restore. Stop logic is SOURCED from the heat cells'
# shared library (never copied, never edited); one arm + its parse live in
# arm.sh. Protocol and predictions: PLAN.md.
set -euo pipefail
export LC_ALL=C

CELL="$(cd "$(dirname "$0")" && pwd)"
usage() { echo "usage: d_run.sh <job_id>" >&2; }
[ "$#" -eq 1 ] || { usage; exit 2; }
JOB="$1"
case "$JOB" in ''|*[!A-Za-z0-9._-]*) echo "invalid job_id" >&2; exit 2 ;; esac

ADB_BIN="${ADB_BIN:-/opt/homebrew/bin/adb}"
ADB_PORT="${ADB_PORT:-5037}"
export ADB_BIN ADB_PORT ANDROID_ADB_SERVER_PORT="$ADB_PORT"

# Tunables (env-overridable; the dry-run lowers every wait).
POLL_S="${POLL_S:-15}"
ARM_TIMEOUT_S="${ARM_TIMEOUT_S:-900}"
TAIL_S="${TAIL_S:-10}"
MATCH_MAX="${MATCH_MAX:-2}"   # adjustment attempts per arm after the probe

D=/data/local/tmp/dspark-spec
KIT_TGZ=/Users/marco/kalsa-qdc/dspark-spec-v73/dspark-kit-f25f0c1c5.tgz
KIT_SHA=bd6be0a4808c35885318647fede6ef91dfa8f3fe4366a4a706f5110ae45447df
MODEL=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
DRAFT=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-DSpark-Q8_0.gguf
DRAFT_SHA=85a98fafdaf1328b6876fd1360d7ed69e74c6cefc14dd07fb6306e1940386c87
PROMPT_FILE="$CELL/PROMPT.txt"
PROMPT_SHA=$(awk '{print $1}' "$CELL/PROMPT.meta")
PROMPT_BYTES=$(awk '{print $2}' "$CELL/PROMPT.meta")

RAW="$CELL/raw/$JOB"
mkdir -p "$RAW"
RESULTS="$RAW/results.tsv"; END_MARKER="$RAW/END.txt"
DRIVER_LOG="$RAW/driver.log"; ADB_LOG="$RAW/adb-exit.log"
# A stale stop_request/END from an earlier run of this job must not survive.
rm -f "$RAW/stop_request" "$END_MARKER"
: > "$ADB_LOG"; : > "$DRIVER_LOG"
printf 'job=%s port=%s match_max=%s\nstart_utc=%s\n' \
  "$JOB" "$ADB_PORT" "$MATCH_MAX" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RAW/session.env"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$DRIVER_LOG"; }

# Timeout wrapper (adbT contract of stop_lib.sh): perl alarm interrupts the
# wait on INT/TERM; rc >= 124 means the remote process may be orphaned.
adbT() {
  local seconds="$1" rc argline="" arg
  shift
  /usr/bin/perl -e 'alarm shift; exec @ARGV or exit 127' "$seconds" "$ADB_BIN" "$@" &
  CURRENT_CHILD_PID=$!
  wait "$CURRENT_CHILD_PID"
  rc=$?
  CURRENT_CHILD_PID=0
  for arg in "$@"; do printf -v argline '%s %q' "$argline" "$arg"; done
  printf 'rc=%s%s\n' "$rc" "$argline" >> "$ADB_LOG"
  return "$rc"
}

# shellcheck source=../qdc-heat-3way/stop_lib.sh
source "$CELL/../qdc-heat-3way/stop_lib.sh"
# shellcheck source=arm.sh
source "$CELL/arm.sh"

SER=""; SCREEN_OFF_TIMEOUT=""; STAYON=""
ARM_POLL_PID=0; CURRENT_CHILD_PID=0; END_WRITTEN=0; CLEANED=0; SIGNAL_NAME=""
BATTERY_UNTRUSTED=0   # no battery-trust harness in this cell: dumpsys temp is the gate

write_end() { [ "$END_WRITTEN" -eq 1 ] || { printf 'END reason=%s\n' "$1" > "$END_MARKER"; END_WRITTEN=1; }; }

restore_screen() {
  [ -f "$CELL/.restore-state" ] || return 0
  local ser t s
  ser=$(sed -n 's/^SER=//p' "$CELL/.restore-state")
  t=$(sed -n 's/^SCREEN_OFF_TIMEOUT=//p' "$CELL/.restore-state")
  s=$(sed -n 's/^STAYON=//p' "$CELL/.restore-state")
  [ -n "$ser" ] || return 0
  if [ -n "$t" ] && [ "$t" != "null" ]; then
    adbT 30 -s "$ser" shell "settings put system screen_off_timeout $t" >/dev/null 2>&1 || true
  else
    adbT 30 -s "$ser" shell "settings delete system screen_off_timeout" >/dev/null 2>&1 || true
  fi
  if [ -n "$s" ] && [ "$s" != "null" ]; then
    adbT 30 -s "$ser" shell "settings put global stay_on_while_plugged_in $s" >/dev/null 2>&1 || true
  else
    adbT 30 -s "$ser" shell "settings delete global stay_on_while_plugged_in" >/dev/null 2>&1 || true
  fi
  rm -f "$CELL/.restore-state"
  log "SCREEN_RESTORED timeout=$t stayon=$s"
}

stop_arm_poll() {
  [ "$ARM_POLL_PID" -ne 0 ] || return 0
  kill "$ARM_POLL_PID" 2>/dev/null || true
  wait "$ARM_POLL_PID" 2>/dev/null || true
  ARM_POLL_PID=0
  return 0
}

cleanup() {
  local rc=$?
  [ "$CLEANED" -eq 0 ] || return 0
  CLEANED=1
  stop_arm_poll
  if [ -f "$CELL/.restore-state" ]; then
    restore_screen >> "$RAW/restore.log" 2>&1 || log "RESTORE_FAIL"
  fi
  if [ -n "$SIGNAL_NAME" ]; then write_end "signal_$SIGNAL_NAME"; else write_end "exit_$rc"; fi
}
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

finish_stop() {
  local reason=unknown
  [ -f "$RAW/stop_request" ] && reason=$(tr -d '\r\n' < "$RAW/stop_request")
  # stop_lib's request_stop only knows llama-completion: our binary needs its
  # own kill (bracketed pattern, audit A3 rule).
  adbT 15 -s "$SER" shell "pkill -f 'llama-speculative-simpl[e]'" >> "$RAW/kill.log" 2>&1 || true
  log "SESSION_STOP reason=$reason"
  write_end "stop_$reason"
  exit 0
}

prompt_verify() {
  local sha bytes
  [ -f "$PROMPT_FILE" ] || return 1
  sha=$(/usr/bin/shasum -a 256 "$PROMPT_FILE" | awk '{print $1}')
  bytes=$(wc -c < "$PROMPT_FILE" | tr -d '[:space:]')
  [ "$sha" = "$PROMPT_SHA" ] && [ "$bytes" = "$PROMPT_BYTES" ]
}

# ensure_file <local> <remote> <want_sha>: skip the push when the device copy
# already verifies, otherwise push and verify — never trust an unverified copy.
ensure_file() {
  local local=$1 remote=$2 want=$3 got=""
  got=$(adbT 60 -s "$SER" shell "sha256sum $remote 2>/dev/null" 2>/dev/null | tr -d '\r' | awk '{print $1}') || got=""
  if [ "$got" = "$want" ]; then log "PUSH_SKIP $remote sha_ok"; return 0; fi
  adbT 900 -s "$SER" push "$local" "$remote" >> "$RAW/push.log" 2>&1 || { log "PUSH_FAIL $remote"; return 1; }
  got=$(adbT 60 -s "$SER" shell "sha256sum $remote" 2>/dev/null | tr -d '\r' | awk '{print $1}') || got=""
  [ "$got" = "$want" ] || { log "SHA_MISMATCH $remote got=$got want=$want"; return 1; }
  log "PUSH_OK $remote"
}

# ---- session setup ----
SER="${ADB_SERIAL:-$(adbT 60 devices | awk 'NR > 1 && $2 == "device" { print $1; exit }' | tr -d '\r')}"
[ -n "$SER" ] || { log "NO_DEVICE port=$ADB_PORT"; exit 2; }
adbT 60 -s "$SER" wait-for-device > "$RAW/wait_for_device.txt" 2>&1 || { log "WAIT_FOR_DEVICE_FAIL"; exit 2; }
# Drop any stale .restore-state BEFORE this run may fail again after arming
# the trap: restore must never undo a value this run did not write.
rm -f "$CELL/.restore-state"
SOC=$(adbT 30 -s "$SER" shell getprop ro.soc.model | tr -d '\r')
case "$SOC" in
  SM8550) BOARD=S23 ;;
  *) log "UNSUPPORTED_SOC=$SOC (S23/SM8550 only)"; exit 6 ;;
esac
# Save screen state BEFORE the first mutation (its presence authorizes restore).
SCREEN_OFF_TIMEOUT=$(adbT 30 -s "$SER" shell settings get system screen_off_timeout | tr -d '\r')
STAYON=$(adbT 30 -s "$SER" shell settings get global stay_on_while_plugged_in | tr -d '\r')
[ -n "$STAYON" ] || STAYON=null
printf 'SER=%s\nSCREEN_OFF_TIMEOUT=%s\nSTAYON=%s\nJOB=%s\n' \
  "$SER" "$SCREEN_OFF_TIMEOUT" "$STAYON" "$JOB" > "$CELL/.restore-state"
adbT 30 -s "$SER" shell input keyevent KEYCODE_WAKEUP >> "$RAW/setup.log" 2>&1 || true
adbT 30 -s "$SER" shell svc power stayon true >> "$RAW/setup.log" 2>&1 || true
adbT 30 -s "$SER" shell settings put system screen_off_timeout 1800000 >> "$RAW/setup.log" 2>&1 || true
log "SESSION job=$JOB board=$BOARD soc=$SOC serial=$SER timeout_saved=$SCREEN_OFF_TIMEOUT stayon_saved=$STAYON"
prompt_verify || { log "PROMPT_IDENTITY_FAIL"; exit 6; }
# Gate BEFORE the multi-GB push: an already-hot phone never gets loaded.
safety_gate before_setup || finish_stop
kit_local_sha=$(shasum -a 256 "$KIT_TGZ" | awk '{print $1}')
[ "$kit_local_sha" = "$KIT_SHA" ] || { log "KIT_SHA_FAIL local=$kit_local_sha"; exit 5; }
ensure_file "$KIT_TGZ" "$D/kit.tgz" "$KIT_SHA" || exit 5
adbT 120 -s "$SER" shell "cd $D && tar -xzf kit.tgz" >> "$RAW/setup.log" 2>&1 || { log "KIT_UNPACK_FAIL"; exit 5; }
adbT 60 -s "$SER" shell "cd $D && sha256sum -c SHA256SUMS" >> "$RAW/setup.log" 2>&1 || { log "KIT_SUMS_FAIL"; exit 5; }
ensure_file "$MODEL" "$D/ship.gguf" "$MODEL_SHA" || exit 5
ensure_file "$DRAFT" "$D/draft.gguf" "$DRAFT_SHA" || exit 5
ensure_file "$PROMPT_FILE" "$D/prompt.txt" "$PROMPT_SHA" || exit 6
log "KIT_AND_MODELS_VERIFIED"
safety_gate setup || finish_stop
log "SETUP_DONE skin=$LIVE_SKIN thermal=$LIVE_THERMAL_STATUS batt_temp=$LIVE_BATT_TEMP_TENTHS level=$LIVE_BATT_LEVEL plugged=$LIVE_PLUGGED"

printf 'tag\tarm\tattempt\tlimit\tn_predict\tover\tn_drafted\taccept\ttps\tstatus\tvoid\tproof\twall_s\n' > "$RESULTS"
write_row() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" >> "$RESULTS"; }

# ---- arm execution ----
arm_poll_loop() {
  # Background subshell while the arm's adb shell blocks the parent; the only
  # channel back is stop_lib's $RAW/stop_request. On a stop it also kills OUR
  # binary (stop_lib only pkills llama-completion).
  while :; do
    sleep "$POLL_S"
    live_readings || true
    hard_stops && continue
    adbT 15 -s "$SER" shell "pkill -f 'llama-speculative-simpl[e]'" >> "$RAW/kill.log" 2>&1 || true
    exit 0
  done
}

run_arm() {  # <arm> <tag> <limit> <attempt_no>
  local arm=$1 tag=$2 limit=$3 attempt_no=$4
  PARSED_N=""
  safety_gate "pre_$tag" || finish_stop
  arm_poll_loop & ARM_POLL_PID=$!
  arm_run "$tag" "$arm" "$limit"
  stop_arm_poll
  if [ -f "$RAW/stop_request" ]; then
    write_row "$tag" "$arm" "$attempt_no" "$limit" na na na na na VOID "stop_$(tr -d '\r\n' < "$RAW/stop_request")" na "$ARM_WALL_S"
    finish_stop
  fi
  if [ "$ARM_RC" -ge 124 ]; then
    write_row "$tag" "$arm" "$attempt_no" "$limit" na na na na na VOID timeout "$ARM_RC" "$ARM_WALL_S"
    log "ARM_TIMEOUT tag=$tag rc=$ARM_RC"
    [ "$TAIL_S" -eq 0 ] || sleep "$TAIL_S"
    safety_gate "post_$tag" || finish_stop
    return 0
  fi
  arm_parse "$tag" "$arm" "$limit"
  write_row "$tag" "$arm" "$attempt_no" "$limit" "$ARM_N" "$ARM_OVER" "$ARM_DRAFTED" \
    "$ARM_ACCEPT" "$ARM_TPS" "$ARM_STATUS" "$ARM_VOID" "$ARM_PROOF" "$ARM_WALL_S"
  log "ARM_DONE tag=$tag limit=$limit n=$ARM_N status=$ARM_STATUS void=$ARM_VOID accept=$ARM_ACCEPT tps=$ARM_TPS proof=$ARM_PROOF"
  if [ "$ARM_STATUS" = OK ]; then PARSED_N=$ARM_N; fi
  [ "$TAIL_S" -eq 0 ] || sleep "$TAIL_S"
  safety_gate "post_$tag" || finish_stop
}

# ---- matched-N protocol (PLAN.md): probe all arms at -n 127, then raise the
# limit of every arm below the max until all five decode the SAME count.
# Parallel indexed arrays, index = arm position (the stock macOS bash 3.2 has
# no `declare -A`).
ARMS=(A B4 B8 C4 C8)
N_OF=("" "" "" "" "")
LIMIT_OF=(127 127 127 127 127)
i=0
for arm in "${ARMS[@]}"; do
  run_arm "$arm" "$arm" "${LIMIT_OF[$i]}" 1
  N_OF[$i]=$PARSED_N
  i=$((i + 1))
done

match_state() {  # sets N_STAR, N_OK (count of OK arms), ALL_EQ (0/1)
  N_STAR=0; N_OK=0; ALL_EQ=1
  local j cur
  for j in 0 1 2 3 4; do
    cur=${N_OF[$j]}
    [ -n "$cur" ] || { ALL_EQ=0; continue; }
    N_OK=$((N_OK + 1))
    [ "$cur" -le "$N_STAR" ] || N_STAR=$cur
  done
  if [ "$N_OK" -ne "${#ARMS[@]}" ]; then ALL_EQ=0; return 0; fi
  for j in 0 1 2 3 4; do
    [ "${N_OF[$j]}" -eq "$N_STAR" ] || { ALL_EQ=0; return 0; }
  done
  ALL_EQ=1
  return 0
}

match_state
k=0
while [ "$ALL_EQ" -eq 0 ] && [ "$k" -lt "$MATCH_MAX" ]; do
  k=$((k + 1))
  j=0
  for arm in "${ARMS[@]}"; do
    cur=${N_OF[$j]}
    if [ -n "$cur" ] && [ "$cur" -lt "$N_STAR" ]; then
      LIMIT_OF[$j]=$(( LIMIT_OF[$j] + N_STAR - cur ))
      run_arm "$arm" "${arm}-m${k}" "${LIMIT_OF[$j]}" "$((k + 1))"
      N_OF[$j]=$PARSED_N
    fi
    j=$((j + 1))
  done
  match_state
done

if [ "$ALL_EQ" -eq 1 ]; then
  log "MATCH ok n=$N_STAR arms=${#ARMS[@]}"
else
  log "MATCH void n_star=$N_STAR"
fi

safety_gate post_session || finish_stop
log "SESSION_DONE"
write_end exit_0
exit 0
