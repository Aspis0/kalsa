#!/bin/bash
# d_run.sh — driver for ONE qdc-heat-3way session. One responsibility:
# orchestrate the session — args, device prep, safety gates, the ordered arm
# loop (load phase + measured turn), result rows, END marker, restore.
# Siblings: stop_lib.sh (stop logic), battery_trust.sh (battery verdict),
# kit.sh (push+verify), arm.sh (one arm), restore.sh (undo), smp.sh (sampler).
#
# Protocol: PREREG.md (amended after audit f2ee97f4, still pre-run). Order
# CGNNGC (palindromic: linear drift cancels — registered in PREREG), pair =
# ceil(turn/2); cooldown as a CAP only (owner decision: no cool-start gate,
# start temps recorded, warm_start flagged).
set -euo pipefail
export LC_ALL=C

CELL="$(cd "$(dirname "$0")" && pwd)"
usage() { echo "usage: d_run.sh <job_id> [arm_order=C/G/N letters, default CGNNGC] [deadline_minutes 20..110]" >&2; }
[ "$#" -ge 1 ] && [ "$#" -le 3 ] || { usage; exit 2; }
JOB="$1"
ARM_ORDER="${2:-CGNNGC}"
DEADLINE_MINUTES="${3:-100}"
case "$JOB" in ''|*[!A-Za-z0-9._-]*) echo "invalid job_id" >&2; exit 2;; esac
case "$ARM_ORDER" in ''|*[!CGN]*) echo "arm_order must contain only C, G, N" >&2; exit 2;; esac
case "$DEADLINE_MINUTES" in ''|*[!0-9]*) echo "deadline_minutes must be an integer 20..110" >&2; exit 2;; esac
[ "$DEADLINE_MINUTES" -ge 20 ] && [ "$DEADLINE_MINUTES" -le 110 ] || { echo "deadline_minutes must be an integer 20..110" >&2; exit 2; }
ADB_PORT="${ADB_PORT:-5037}"
case "$ADB_PORT" in 5037|6037|6039) ;; *) echo "ADB_PORT must be 5037, 6037, or 6039" >&2; exit 2;; esac
ADB_BIN="${ADB_BIN:-/opt/homebrew/bin/adb}"
export ADB_BIN ADB_PORT ANDROID_ADB_SERVER_PORT="$ADB_PORT"

# Tunables (env-overridable; the dry-run lowers every wait).
COOL_TARGET_C="${COOL_TARGET_C:-37.0}"
COOL_POLL_S="${COOL_POLL_S:-15}"
COOL_MAX_S="${COOL_MAX_S:-720}"
TAIL_S="${TAIL_S:-60}"
POLL_S="${POLL_S:-15}"
ARM_TIMEOUT_S="${ARM_TIMEOUT_S:-900}"
SAMPLER_WAIT_S="${SAMPLER_WAIT_S:-2}"

D=/data/local/tmp/heat3way
HEAT_TMP=$D/heat
KIT_TGZ="$HOME/kalsa-qdc/npu-step0-v73/npu-kit-f25f0c1c5.tgz"
MODEL="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-newapk/raw/host-materials/LFM2.5-2.6B-QAD-Q4_0.gguf"
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
PROMPT_FILE="$CELL/PROMPT.txt"
PROMPT_META="$CELL/PROMPT.meta"
PROMPT_SHA=$(awk '{print $1}' "$PROMPT_META")
PROMPT_BYTES=$(awk '{print $2}' "$PROMPT_META")
DECODE_EXPECT=127          # A7: equal-decode gate value (-n 127 --ignore-eos)
PROMPT_N_REF=""

RAW="$CELL/raw/$JOB"
mkdir -p "$RAW"
RESULTS="$RAW/results.tsv"; END_MARKER="$RAW/END.txt"
DRIVER_LOG="$RAW/driver.log"; ADB_LOG="$RAW/adb-exit.log"
# A2: a stale stop_request or END.txt from an earlier run of this job id must
# not survive into this session — a stale stop_request would void the first
# arm, a stale END would outlive a crash and misreport the outcome.
rm -f "$RAW/stop_request" "$END_MARKER"
: > "$ADB_LOG"; : > "$DRIVER_LOG"
printf 'job=%s order=%s deadline_min=%s port=%s\nstart_utc=%s\n' \
  "$JOB" "$ARM_ORDER" "$DEADLINE_MINUTES" "$ADB_PORT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RAW/session.env"

# shellcheck source=stop_lib.sh
source "$CELL/stop_lib.sh"
# shellcheck source=battery_trust.sh
source "$CELL/battery_trust.sh"
# shellcheck source=kit.sh
source "$CELL/kit.sh"
# shellcheck source=arm.sh
source "$CELL/arm.sh"

SER=""; SCREEN_OFF_TIMEOUT=""; STAYON=""; FIRST_SKIN_C=""
SAMPLER_PID=0; ARM_POLL_PID=0; CURRENT_CHILD_PID=0
END_WRITTEN=0; SIGNAL_NAME=""; CLEANED=0
COOLDOWN_SECONDS=0; WARM_START=0

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$DRIVER_LOG"; }
write_end() { [ "$END_WRITTEN" -eq 1 ] || { printf 'END reason=%s\n' "$1" > "$END_MARKER"; END_WRITTEN=1; }; }
deadline_check() {
  [ "$(date +%s)" -lt "$DEADLINE_EPOCH" ] || { log "DEADLINE_${DEADLINE_MINUTES}_MIN"; write_end "deadline_${DEADLINE_MINUTES}_min"; exit 124; }
}
# Timeout wrapper copied from qdc-heat-per-backend/d_run.sh (its adbT): the
# perl alarm interrupts the wait immediately on INT/TERM, so on_signal does not
# sit behind an in-flight adb call. Killed-by-alarm rc is 142 (SIGALRM), a
# failed perl exec 127 — arm.sh treats >=124 as "remote process orphaned".
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
stop_sampler() {
  [ -n "$SER" ] || return 0
  adbT 30 -s "$SER" shell "touch $HEAT_TMP/stop" >/dev/null 2>&1 || true
  if [ "$SAMPLER_PID" -ne 0 ]; then
    kill "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
    SAMPLER_PID=0
  fi
  return 0
}
# Defined before cleanup: an early exit must be able to kill the poll too.
stop_arm_poll() {
  [ "$ARM_POLL_PID" -ne 0 ] || return 0
  kill "$ARM_POLL_PID" 2>/dev/null || true
  wait "$ARM_POLL_PID" 2>/dev/null || true
  ARM_POLL_PID=0
  return 0
}
cleanup() {
  local rc=$?
  # A11: on_signal -> cleanup -> exit fires the EXIT trap again — without
  # this guard restore would run twice (and the second time against state the
  # first restore already consumed).
  [ "$CLEANED" -eq 0 ] || return 0
  CLEANED=1
  stop_arm_poll
  stop_sampler
  if [ -n "$SER" ]; then
    bash "$CELL/restore.sh" >> "$RAW/restore_run.log" 2>&1 || log "RESTORE_FAIL (see restore.sh output)"
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
DEADLINE_EPOCH=$(( $(date +%s) + DEADLINE_MINUTES * 60 ))

finish_stop() {
  local reason=unknown
  if [ -f "$RAW/stop_request" ]; then reason=$(tr -d '\r\n' < "$RAW/stop_request"); fi
  log "SESSION_STOP reason=$reason"
  write_end "stop_$reason"
  exit 0
}

# The arm reads THE verified prompt as a file (-f $D/prompt.txt); this only
# pins the local copy to PROMPT.meta, kit.sh pins the pushed copy to the same
# sha. No prompt text travels through the shell, so no quoting check is needed.
prompt_verify() {
  local sha bytes
  [ -f "$PROMPT_FILE" ] || return 1
  sha=$(/usr/bin/shasum -a 256 "$PROMPT_FILE" | awk '{print $1}')
  bytes=$(wc -c < "$PROMPT_FILE" | tr -d '[:space:]')
  [ "$sha" = "$PROMPT_SHA" ] || return 1
  [ "$bytes" = "$PROMPT_BYTES" ] || return 1
  return 0
}

# ---- session setup ----
SER="${ADB_SERIAL:-$(adbT 60 devices | awk 'NR > 1 && $2 == "device" { print $1; exit }' | tr -d '\r')}"
[ -n "$SER" ] || { log "NO_DEVICE port=$ADB_PORT"; exit 2; }
adbT 60 -s "$SER" wait-for-device > "$RAW/wait_for_device.txt" 2>&1 || { log "WAIT_FOR_DEVICE_FAIL"; exit 2; }
# Drop any stale .restore-state from an earlier session BEFORE this run may
# fail again after arming the trap: restore.sh must never restore a guessed
# value this run did not write (its presence is what authorizes the restore).
rm -f "$CELL/.restore-state"
SOC=$(adbT 30 -s "$SER" shell getprop ro.soc.model | tr -d '\r')
case "$SOC" in
  SM8550) BOARD=S23-v73 ;;
  *) log "UNSUPPORTED_SOC=$SOC (this kit ships only the v73 DSP skel)"; exit 6 ;;
esac
# .restore-state BEFORE the first mutation: restore.sh only restores settings
# when this exists (its presence means something was actually changed).
SCREEN_OFF_TIMEOUT=$(adbT 30 -s "$SER" shell settings get system screen_off_timeout | tr -d '\r')
STAYON=$(adbT 30 -s "$SER" shell settings get global stay_on_while_plugged_in | tr -d '\r')
[ -n "$STAYON" ] || STAYON=null
printf 'SER=%s\nSCREEN_OFF_TIMEOUT=%s\nSTAYON=%s\nJOB=%s\n' "$SER" "$SCREEN_OFF_TIMEOUT" "$STAYON" "$JOB" > "$CELL/.restore-state"
adbT 30 -s "$SER" shell input keyevent KEYCODE_WAKEUP >> "$RAW/setup.log" 2>&1 || true
adbT 30 -s "$SER" shell svc power stayon true >> "$RAW/setup.log" 2>&1 || true
adbT 30 -s "$SER" shell settings put system screen_off_timeout 1800000 >> "$RAW/setup.log" 2>&1 || true
log "SESSION job=$JOB board=$BOARD soc=$SOC serial=$SER order=$ARM_ORDER stayon_saved=$STAYON timeout_saved=$SCREEN_OFF_TIMEOUT"
prompt_verify || { log "PROMPT_IDENTITY_FAIL"; exit 6; }
kit_setup || { log "KIT_SETUP_FAIL"; exit 5; }
battery_trust_check || { log "BATTERY_TRUST_READ_FAIL"; exit 3; }
safety_gate setup || finish_stop
FIRST_SKIN_C="$LIVE_SKIN"
log "SETUP_DONE skin0=$FIRST_SKIN_C battery_untrusted=$BATTERY_UNTRUSTED"

launch_sampler() {
  "$ADB_BIN" -s "$SER" shell "sh $HEAT_TMP/smp.sh" >> "$RAW/sampler.log" 2>&1 &
  SAMPLER_PID=$!
  if [ "$SAMPLER_WAIT_S" -gt 0 ]; then sleep "$SAMPLER_WAIT_S"; fi
  log "SAMPLER_LAUNCHED pid=$SAMPLER_PID"
}
launch_sampler

# ---- per-arm waits and background safety poll ----
cooldown_wait() {
  local elapsed=0
  COOLDOWN_SECONDS=0; WARM_START=0
  while :; do
    deadline_check   # A12: the cap can add 720 s — the deadline must bite inside the wait
    live_readings
    if ! hard_stops; then return 2; fi
    if awk -v s="$LIVE_SKIN" -v t="$COOL_TARGET_C" 'BEGIN{exit !(s+0 <= t+0)}'; then
      COOLDOWN_SECONDS=$elapsed; return 0
    fi
    if [ "$elapsed" -ge "$COOL_MAX_S" ]; then
      COOLDOWN_SECONDS=$elapsed; WARM_START=1
      log "COOLDOWN_CAP skin=$LIVE_SKIN waited_s=$elapsed (run anyway, warm_start=1)"
      return 0
    fi
    sleep "$COOL_POLL_S"
    elapsed=$((elapsed + COOL_POLL_S))
  done
}
arm_poll_loop() {
  # Runs as a background subshell while the arm's adb shell blocks the
  # parent: its only channel back is $RAW/stop_request (written by
  # request_stop), which the parent checks right after the arm returns.
  while :; do
    sleep "$POLL_S"
    # `|| true` on the read: with -e active in this subshell an adb blip
    # would silently kill the poll; immune, the empty readings flow into
    # hard_stops' fail-closed missing_* stop instead.
    live_readings || true
    hard_stops && continue
    exit 0
  done
}
start_arm_poll() { arm_poll_loop & ARM_POLL_PID=$!; }

write_row() {
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" >> "$RESULTS"
}
printf 'pair\tbackend\tturn\tstatus\tvoid_reason\twarm_start\tcooldown_s\ttail_s\twall_s\tload_wall_s\tload_skin_before\tload_skin_after\tpagein_cold\tskin_before\tskin_after\tbatt_temp_before\tbatt_temp_after\tbatt_level\tplugged\tthermal_status\tprompt_n\tprefill_ms\tdecode_runs\tdecode_tps\tproof\n' > "$RESULTS"

# ---- arms ----
TURN=0
for ((i=0; i<${#ARM_ORDER}; i++)); do
  deadline_check
  letter="${ARM_ORDER:i:1}"
  case "$letter" in C) backend=cpu ;; G) backend=gpu ;; N) backend=npu ;; esac
  TURN=$((TURN + 1))
  PAIR=$(( (TURN + 1) / 2 ))
  # A10: device logs are tagged with this job's id — no other session's file
  # can match this pull even if the kit_setup sweep above were bypassed.
  tag="${JOB}-t${TURN}${backend}"
  PAGEIN_COLD=0
  if [ "$TURN" -eq 1 ]; then PAGEIN_COLD=1; fi
  log "ARM_START turn=$TURN backend=$backend pair=$PAIR tag=$tag"
  cd_rc=0
  cooldown_wait || cd_rc=$?
  [ "$cd_rc" -ne 2 ] || finish_stop
  # The cooldown loop's last live_readings IS this arm's pre-load snapshot.
  B_SKIN=$LIVE_SKIN; B_BATT=$LIVE_BATT_TEMP_TENTHS; B_LVL=$LIVE_BATT_LEVEL
  B_PLUG=$LIVE_PLUGGED; B_TH=$LIVE_THERMAL_STATUS
  # A8 load phase: page-in / weight upload / OpenCL compile happen here, with
  # their own before (B_*)/after readings, outside the measured turn.
  arm_load "$backend" "$tag"
  if [ "$ARM_LOAD_RC" -ne 0 ]; then
    write_row "$PAIR" "$backend" "$TURN" VOID load_fail "$WARM_START" "$COOLDOWN_SECONDS" na na \
      "$ARM_LOAD_WALL_S" "$B_SKIN" na "$PAGEIN_COLD" "$B_SKIN" na "$B_BATT" na "$B_LVL" "$B_PLUG" "$B_TH" na na na na na
    log "ARM_LOAD_FAIL turn=$TURN rc=$ARM_LOAD_RC"
    continue
  fi
  live_readings || true
  LOAD_SKIN_A=$LIVE_SKIN
  hard_stops || finish_stop   # the load phase heats the board too
  log "LOAD_PHASE turn=$TURN wall_s=$ARM_LOAD_WALL_S skin $B_SKIN->$LOAD_SKIN_A pagein_cold=$PAGEIN_COLD"
  start_arm_poll
  arm_run "$backend" "$tag"
  stop_arm_poll
  if [ -f "$RAW/stop_request" ]; then
    stop_reason=$(tr -d '\r\n' < "$RAW/stop_request")
    write_row "$PAIR" "$backend" "$TURN" VOID "stop_$stop_reason" "$WARM_START" "$COOLDOWN_SECONDS" na "$ARM_WALL_S" \
      "$ARM_LOAD_WALL_S" "$B_SKIN" "$LOAD_SKIN_A" "$PAGEIN_COLD" "$B_SKIN" na "$B_BATT" na "$B_LVL" "$B_PLUG" "$B_TH" na na na na na
    finish_stop
  fi
  if [ "$TAIL_S" -gt 0 ]; then sleep "$TAIL_S"; fi
  live_readings || true   # empty readings fail closed in the hard_stops below
  A_SKIN=$LIVE_SKIN; A_BATT=$LIVE_BATT_TEMP_TENTHS
  arm_parse "$tag" "$backend"
  if [ "$ARM_STATUS" = OK ]; then
    if [ -z "$PROMPT_N_REF" ]; then
      PROMPT_N_REF=$ARM_PROMPT_N
    elif [ "$ARM_PROMPT_N" != "$PROMPT_N_REF" ]; then
      ARM_STATUS=VOID; ARM_VOID=prompt_mismatch
    fi
  fi
  # A7 equal-decode gate (qdc-heat-per-backend 851b053d): 127 on every arm,
  # else the row is void AND the session stops after it.
  decode_stop=0
  if [ "$ARM_STATUS" = OK ] && [ "$ARM_RUNS" -ne "$DECODE_EXPECT" ]; then
    ARM_STATUS=VOID; ARM_VOID=decode_len; decode_stop=1
  fi
  write_row "$PAIR" "$backend" "$TURN" "$ARM_STATUS" "$ARM_VOID" "$WARM_START" "$COOLDOWN_SECONDS" "$TAIL_S" "$ARM_WALL_S" \
    "$ARM_LOAD_WALL_S" "$B_SKIN" "$LOAD_SKIN_A" "$PAGEIN_COLD" "$B_SKIN" "$A_SKIN" "$B_BATT" "$A_BATT" "$B_LVL" "$B_PLUG" "$B_TH" \
    "$ARM_PROMPT_N" "$ARM_PREFILL_MS" "$ARM_RUNS" "$ARM_DECODE_TPS" "$ARM_PROOF"
  log "ARM_END turn=$TURN status=$ARM_STATUS void=$ARM_VOID prefill_ms=$ARM_PREFILL_MS inload_ms=$ARM_INLOAD_MS proof=$ARM_PROOF"
  if [ "$decode_stop" -eq 1 ]; then
    log "STOP_UNEQUAL_DECODE got=$ARM_RUNS want=$DECODE_EXPECT"
    write_end stop_unequal_decode
    exit 0
  fi
  hard_stops || finish_stop
done

# ---- finish ----
stop_sampler
adbT 120 -s "$SER" pull "$HEAT_TMP/samples.txt" "$RAW/samples.txt" >> "$RAW/setup.log" 2>&1 || log "SAMPLES_PULL_FAIL"
ok_rows=$(awk -F'\t' 'NR>1 && $4=="OK"' "$RESULTS" | wc -l | tr -d '[:space:]')
all_rows=$(awk 'NR>1' "$RESULTS" | wc -l | tr -d '[:space:]')
log "DONE order=$ARM_ORDER rows=$all_rows ok=$ok_rows results=$RESULTS"
printf 'end_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RAW/session.env"
write_end exit_0
exit 0
