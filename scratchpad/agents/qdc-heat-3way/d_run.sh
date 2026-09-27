#!/bin/bash
# d_run.sh — driver for ONE qdc-heat-3way session. One responsibility:
# orchestrate the session — args, device prep, safety gates, the ordered arm
# loop (proof-run load phase + measured turn), result rows, END marker,
# restore. Siblings: stop_lib.sh (stops+kill verify), battery_trust.sh,
# kit.sh (prompt verify + push+verify), arm.sh (one arm), sampler.sh (sampler
# lifecycle), restore.sh (undo), smp.sh (on-device sampler).
#
# Protocol: PREREG.md (pre-run amendments after audits f2ee97f4 and
# dd6bdb56). Order: even-length pairs from {CG, GC, NN} (default CGNNGC,
# palindromic — linear drift cancels, registered in PREREG); pair =
# ceil(turn/2); cooldown as a CAP only (no cool-start gate, start temps
# recorded, warm_start flagged).
set -euo pipefail
export LC_ALL=C

CELL="$(cd "$(dirname "$0")" && pwd)"
usage() { echo "usage: d_run.sh <job_id> [arm_order=even pairs from {CG,GC,NN}, default CGNNGC] [deadline_minutes 20..110]" >&2; }
[ "$#" -ge 1 ] && [ "$#" -le 3 ] || { usage; exit 2; }
JOB="$1"
ARM_ORDER="${2:-CGNNGC}"
DEADLINE_MINUTES="${3:-100}"
case "$JOB" in ''|*[!A-Za-z0-9._-]*) echo "invalid job_id" >&2; exit 2;; esac
case "$ARM_ORDER" in ''|*[!CGN]*) echo "arm_order must contain only C, G, N" >&2; exit 2;; esac
# A-13: pairs must be complete AND registered — an odd order (CGN) or an
# unregistered pair would emit half-pair labels (1 1 2) nothing checks.
validate_order() {
  local i p
  [ $(( ${#ARM_ORDER} % 2 )) -eq 0 ] || return 1
  for ((i = 0; i < ${#ARM_ORDER}; i += 2)); do
    p="${ARM_ORDER:i:2}"
    case "$p" in CG|GC|NN) ;; *) return 1 ;; esac
  done
  return 0
}
validate_order || { echo "arm_order must be even-length pairs from {CG, GC, NN} (registered pairs, e.g. CGNNGC)" >&2; exit 2; }
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
# shellcheck source=sampler.sh
source "$CELL/sampler.sh"

SER=""; SCREEN_OFF_TIMEOUT=""; STAYON=""; FIRST_SKIN_C=""
ARM_POLL_PID=0; CURRENT_CHILD_PID=0
END_WRITTEN=0; SIGNAL_NAME=""; CLEANED=0
COOLDOWN_SECONDS=0; WARM_START=0
# A7 gate: eval runs must be N-1 on every arm (first token comes from the
# prompt eval: -n 127 -> 126, -n 64 -> 63, device-confirmed). DECODE_N is
# arm.sh's own -n value — derived, never a second hardcoded number.
DECODE_EXPECT=$((DECODE_N - 1))

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$DRIVER_LOG"; }
write_end() { [ "$END_WRITTEN" -eq 1 ] || { printf 'END reason=%s\n' "$1" > "$END_MARKER"; END_WRITTEN=1; }; }
deadline_check() {
  [ "$(date +%s)" -lt "$DEADLINE_EPOCH" ] || { log "DEADLINE_${DEADLINE_MINUTES}_MIN"; write_end "deadline_${DEADLINE_MINUTES}_min"; exit 124; }
}
# Timeout wrapper copied from qdc-heat-per-backend/d_run.sh (its adbT): the
# perl alarm interrupts the wait immediately on INT/TERM/HUP, so on_signal does
# not sit behind an in-flight adb call. Killed-by-alarm rc is 142 (SIGALRM),
# a failed perl exec 127 — arm.sh treats >=124 as "remote process orphaned".
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
  # A11-round2: on_signal -> cleanup -> exit fires the EXIT trap again —
  # without this guard restore would run twice.
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
# kill_unverified = stop_lib could not observe the remote arm die (A-4):
# every end path turns it into a loud nonzero END instead of a silent pass.
kill_unverified_end() {
  [ -f "$RAW/kill_unverified" ] || return 1
  log "KILL_UNVERIFIED_END (remote llama-completion may still be running on the device)"
  write_end kill_unverified
  exit 3
}
finish_stop() {
  local reason=unknown
  if [ -f "$RAW/stop_request" ]; then reason=$(tr -d '\r\n' < "$RAW/stop_request"); fi
  log "SESSION_STOP reason=$reason"
  if [ -f "$RAW/kill_unverified" ]; then
    log "KILL_UNVERIFIED_END (remote llama-completion may still be running on the device)"
    write_end "stop_${reason}_kill_unverified"
    exit 3
  fi
  write_end "stop_$reason"
  exit 0
}
method_void_guard() {
  local t="$1" b="$2"
  [ "$ARM_STATUS" != OK ] || return 0
  log "STOP_METHOD_VOID turn=$t backend=$b reason=$ARM_VOID"
  write_end "method_void_$ARM_VOID"
  exit 0
}

# ---- session setup (pre-mutation: nothing is changed before the state file
# exists and the traps below are armed) ----
SER="${ADB_SERIAL:-$(adbT 60 devices | awk 'NR > 1 && $2 == "device" { print $1; exit }' | tr -d '\r' || true)}"
[ -n "$SER" ] || { log "NO_DEVICE port=$ADB_PORT"; exit 2; }
adbT 60 -s "$SER" wait-for-device > "$RAW/wait_for_device.txt" 2>&1 || { log "WAIT_FOR_DEVICE_FAIL"; exit 2; }
# A-6/A-8: an earlier run's .restore-state is CONSUMED here (restore first),
# never blindly deleted — after a SIGKILL the stale state is the only record
# of the pre-run values, and overwriting it with mutated values would strand
# the device at 1800000/3 on the next restore. Refuse to continue if that
# restore fails; only after success may this run write its own fresh state.
if [ -f "$CELL/.restore-state" ]; then
  log "PRIOR_RESTORE .restore-state from an earlier run"
  bash "$CELL/restore.sh" >> "$RAW/prior_restore.log" 2>&1 \
    || { log "PRIOR_RESTORE_FAIL (see prior_restore.log); refusing to continue over unrestored state"; exit 3; }
fi
prompt_verify || { log "PROMPT_IDENTITY_FAIL"; exit 6; }
SOC=$(adbT 30 -s "$SER" shell getprop ro.soc.model | tr -d '\r') || { log "ADB_FAIL soc_read"; exit 2; }
case "$SOC" in
  SM8550) BOARD=S23-v73 ;;
  *) log "UNSUPPORTED_SOC=$SOC (this kit ships only the v73 DSP skel)"; exit 6 ;;
esac
# A-7: default to null like STAYON — an empty read must not strand the
# restore in RESTORE_BAD_TIMEOUT with the phone left at 1800000.
SCREEN_OFF_TIMEOUT=$(adbT 30 -s "$SER" shell settings get system screen_off_timeout | tr -d '\r') || { log "ADB_FAIL timeout_get"; exit 2; }
[ -n "$SCREEN_OFF_TIMEOUT" ] || SCREEN_OFF_TIMEOUT=null
STAYON=$(adbT 30 -s "$SER" shell settings get global stay_on_while_plugged_in | tr -d '\r') || { log "ADB_FAIL stayon_get"; exit 2; }
[ -n "$STAYON" ] || STAYON=null
printf 'SER=%s\nSCREEN_OFF_TIMEOUT=%s\nSTAYON=%s\nJOB=%s\n' "$SER" "$SCREEN_OFF_TIMEOUT" "$STAYON" "$JOB" > "$CELL/.restore-state"
# Traps armed AFTER the state write and BEFORE the first mutation — so a
# failure between here and any device change is restored (A-5: HUP included;
# an SSH drop must not leave the phone at 1800000/3 without restore).
trap 'on_signal INT 2' INT
trap 'on_signal TERM 15' TERM
trap 'on_signal HUP 1' HUP
trap cleanup EXIT
DEADLINE_EPOCH=$(( $(date +%s) + DEADLINE_MINUTES * 60 ))
adbT 30 -s "$SER" shell input keyevent KEYCODE_WAKEUP >> "$RAW/setup.log" 2>&1 || true
adbT 30 -s "$SER" shell svc power stayon true >> "$RAW/setup.log" 2>&1 || true
adbT 30 -s "$SER" shell settings put system screen_off_timeout 1800000 >> "$RAW/setup.log" 2>&1 || true
log "SESSION job=$JOB board=$BOARD soc=$SOC serial=$SER order=$ARM_ORDER stayon_saved=$STAYON timeout_saved=$SCREEN_OFF_TIMEOUT"
kit_setup || { log "KIT_SETUP_FAIL"; exit 5; }
battery_trust_check || { log "BATTERY_TRUST_READ_FAIL"; exit 3; }
safety_gate setup || finish_stop
FIRST_SKIN_C="$LIVE_SKIN"
log "SETUP_DONE skin0=$FIRST_SKIN_C battery_untrusted=$BATTERY_UNTRUSTED"
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
  # Runs as a background subshell while the arm's adb shell blocks the parent:
  # its only channel back is $RAW/stop_request (written by request_stop).
  # Started BEFORE arm_load (A-3): the load/proof phase is the hottest window
  # (page-in, weight upload, OpenCL compile) and must be watched too.
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
  # A10: device logs are job-tagged — no other session's file can match this
  # pull even if the kit_setup sweep were bypassed.
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
  start_arm_poll                       # A-3: the load phase gets the poll too
  # Load phase = proof run (owner decision A-1/A-2): page-in/upload/compile
  # plus the -lv 5 proof log, with its own before (B_*)/after readings.
  arm_load "$backend" "$tag"
  if [ -f "$RAW/stop_request" ]; then
    stop_reason=$(tr -d '\r\n' < "$RAW/stop_request")
    write_row "$PAIR" "$backend" "$TURN" VOID "stop_$stop_reason" "$WARM_START" "$COOLDOWN_SECONDS" na na \
      "$ARM_LOAD_WALL_S" "$B_SKIN" na "$PAGEIN_COLD" "$B_SKIN" na "$B_BATT" na "$B_LVL" "$B_PLUG" "$B_TH" na na na na na
    finish_stop
  fi
  if [ "$ARM_LOAD_RC" -ne 0 ]; then
    write_row "$PAIR" "$backend" "$TURN" VOID load_fail "$WARM_START" "$COOLDOWN_SECONDS" na na \
      "$ARM_LOAD_WALL_S" "$B_SKIN" na "$PAGEIN_COLD" "$B_SKIN" na "$B_BATT" na "$B_LVL" "$B_PLUG" "$B_TH" na na na na na
    log "ARM_LOAD_FAIL turn=$TURN rc=$ARM_LOAD_RC"
    stop_arm_poll
    kill_unverified_end || true      # a runaway orphan must not be followed by another arm
    continue
  fi
  live_readings || true
  LOAD_SKIN_A=$LIVE_SKIN
  hard_stops || finish_stop   # the load phase heats the board too
  log "LOAD_PHASE turn=$TURN wall_s=$ARM_LOAD_WALL_S skin $B_SKIN->$LOAD_SKIN_A pagein_cold=$PAGEIN_COLD"
  # Proof gates BEFORE the measured turn: a void proof must not pay for (or
  # heat with) the big run. Thresholds as audited, on the -lv 5 proof log.
  arm_parse_proof "$tag" "$backend"
  if [ "$ARM_STATUS" != OK ]; then
    write_row "$PAIR" "$backend" "$TURN" "$ARM_STATUS" "$ARM_VOID" "$WARM_START" "$COOLDOWN_SECONDS" na na \
      "$ARM_LOAD_WALL_S" "$B_SKIN" "$LOAD_SKIN_A" "$PAGEIN_COLD" "$B_SKIN" na "$B_BATT" na "$B_LVL" "$B_PLUG" "$B_TH" na na na na "$ARM_PROOF"
    log "PROOF_VOID turn=$TURN backend=$backend reason=$ARM_VOID proof=$ARM_PROOF fp_proof=$ARM_PROOF_FP"
    method_void_guard "$TURN" "$backend"
  fi
  sampler_pause                        # A-11: no 1 Hz load inside the measured window
  arm_run "$backend" "$tag"
  sampler_resume
  stop_arm_poll
  if [ -f "$RAW/stop_request" ]; then
    stop_reason=$(tr -d '\r\n' < "$RAW/stop_request")
    write_row "$PAIR" "$backend" "$TURN" VOID "stop_$stop_reason" "$WARM_START" "$COOLDOWN_SECONDS" na "$ARM_WALL_S" \
      "$ARM_LOAD_WALL_S" "$B_SKIN" "$LOAD_SKIN_A" "$PAGEIN_COLD" "$B_SKIN" na "$B_BATT" na "$B_LVL" "$B_PLUG" "$B_TH" na na na na "$ARM_PROOF"
    finish_stop
  fi
  if [ "$TAIL_S" -gt 0 ]; then sleep "$TAIL_S"; fi
  live_readings || true   # empty readings fail closed in the hard_stops below
  A_SKIN=$LIVE_SKIN; A_BATT=$LIVE_BATT_TEMP_TENTHS
  arm_parse_turn "$tag"
  if [ "$ARM_STATUS" = OK ]; then
    if [ -z "$PROMPT_N_REF" ]; then
      PROMPT_N_REF=$ARM_PROMPT_N
    elif [ "$ARM_PROMPT_N" != "$PROMPT_N_REF" ]; then
      ARM_STATUS=VOID; ARM_VOID=prompt_mismatch
    fi
  fi
  # A7 equal-decode gate (qdc-heat-per-backend 851b053d): exactly DECODE_N-1
  # eval runs on every arm (-n 64 -> 63 confirmed on device,
  # s23-cli-diag-20260926) — else void the row AND stop after it.
  decode_stop=0
  if [ "$ARM_STATUS" = OK ] && [ "$ARM_RUNS" -ne "$DECODE_EXPECT" ]; then
    ARM_STATUS=VOID; ARM_VOID=decode_len; decode_stop=1
  fi
  write_row "$PAIR" "$backend" "$TURN" "$ARM_STATUS" "$ARM_VOID" "$WARM_START" "$COOLDOWN_SECONDS" "$TAIL_S" "$ARM_WALL_S" \
    "$ARM_LOAD_WALL_S" "$B_SKIN" "$LOAD_SKIN_A" "$PAGEIN_COLD" "$B_SKIN" "$A_SKIN" "$B_BATT" "$A_BATT" "$B_LVL" "$B_PLUG" "$B_TH" \
    "$ARM_PROMPT_N" "$ARM_PREFILL_MS" "$ARM_RUNS" "$ARM_DECODE_TPS" "$ARM_PROOF"
  log "ARM_END turn=$TURN status=$ARM_STATUS void=$ARM_VOID prefill_ms=$ARM_PREFILL_MS inload_ms=$ARM_INLOAD_MS fp_turn=$ARM_TURN_FP proof=$ARM_PROOF"
  if [ "$decode_stop" -eq 1 ]; then
    log "STOP_UNEQUAL_DECODE got=$ARM_RUNS want=$DECODE_EXPECT n=$DECODE_N"
    write_end stop_unequal_decode
    exit 0
  fi
  hard_stops || finish_stop
  method_void_guard "$TURN" "$backend"
done

# ---- finish ----
stop_sampler
adbT 120 -s "$SER" pull "$HEAT_TMP/samples.txt" "$RAW/samples.txt" >> "$RAW/setup.log" 2>&1 || log "SAMPLES_PULL_FAIL"
ok_rows=$(awk -F'\t' 'NR>1 && $4=="OK"' "$RESULTS" | wc -l | tr -d '[:space:]')
all_rows=$(awk 'NR>1' "$RESULTS" | wc -l | tr -d '[:space:]')
log "DONE order=$ARM_ORDER rows=$all_rows ok=$ok_rows results=$RESULTS"
printf 'end_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RAW/session.env"
kill_unverified_end || true
write_end exit_0
exit 0
