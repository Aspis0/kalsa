#!/usr/bin/env bash
# d_run.sh — session driver for the DSpark S23 arms (A / B4 / B8 / C4 / C8,
# matched-N method). One responsibility: orchestration — device prep, stale
# state repair, push+sha, battery trust, safety gates, cooldown, proof pass,
# measured arms, kill+verify on every abnormal end, results validity, restore.
# Stop logic is SOURCED from ../qdc-heat-3way/stop_lib.sh (being fixed in
# parallel by another agent: never copied, never edited; no new function is
# requested from it — see REPORT.md); battery trust SOURCED from
# ../qdc-heat-3way/battery_trust.sh; restore is this cell's standalone
# restore.sh (must work after a SIGKILL of this driver). Audit: AUDIT-dd6bdb56.md.
# All functions are defined BEFORE the first command of the session setup.
set -euo pipefail
export LC_ALL=C

CELL="$(cd "$(dirname "$0")" && pwd)"
usage() { echo "usage: d_run.sh <job_id> [deadline_minutes 20..110]" >&2; }
[ "$#" -ge 1 ] && [ "$#" -le 2 ] || { usage; exit 2; }
JOB="$1"
case "$JOB" in ''|*[!A-Za-z0-9._-]*) echo "invalid job_id" >&2; exit 2 ;; esac

ADB_BIN="${ADB_BIN:-/opt/homebrew/bin/adb}"
ADB_PORT="${ADB_PORT:-5037}"
export ADB_BIN ADB_PORT ANDROID_ADB_SERVER_PORT="$ADB_PORT"
# audit4 N-B4: restore.sh refuses these ports too — validating here means a
# bad port dies before the device is ever touched (mirrors cell A).
case "$ADB_PORT" in 5037|6037|6039) ;; *) echo "ADB_PORT must be 5037, 6037, or 6039" >&2; exit 2 ;; esac

DEADLINE_MINUTES="${2:-60}"
if [ -z "${DEADLINE_S:-}" ]; then
  case "$DEADLINE_MINUTES" in ''|*[!0-9]*) echo "deadline_minutes must be an integer 20..110" >&2; exit 2 ;; esac
  if [ "$DEADLINE_MINUTES" -lt 20 ] || [ "$DEADLINE_MINUTES" -gt 110 ]; then
    echo "deadline_minutes must be 20..110" >&2; exit 2
  fi
fi
# DEADLINE_S (seconds) overrides the minutes form — a dry-run hook, gated on
# the FAKE's capability marker, not on an adb path string (audit4 N-B1: any
# other real adb path slipped through the old predicate).
if [ -n "${DEADLINE_S:-}" ] && [ -z "${FAKE_ADB_STATE:-}" ]; then
  echo "DEADLINE_S is dry-run-only (refusing without FAKE_ADB_STATE)" >&2
  exit 2
fi
DEADLINE_S="${DEADLINE_S:-$((DEADLINE_MINUTES * 60))}"
case "$DEADLINE_S" in ''|*[!0-9]*) echo "invalid DEADLINE_S" >&2; exit 2 ;; esac
DEADLINE_EPOCH=$(( $(date +%s) + DEADLINE_S ))   # audit2 NEW-8: session deadline

# Tunables (env-overridable; the dry-run lowers every wait).
POLL_S="${POLL_S:-15}"
ARM_TIMEOUT_S="${ARM_TIMEOUT_S:-900}"
TAIL_S="${TAIL_S:-10}"
MATCH_MAX="${MATCH_MAX:-4}"   # audit B-6: overshoot is content-dependent, allow >= 4
COOL_TARGET_C="${COOL_TARGET_C:-37.0}"
COOL_POLL_S="${COOL_POLL_S:-15}"
COOL_MAX_S="${COOL_MAX_S:-720}"

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
rm -f "$RAW/stop_request" "$END_MARKER" "$RAW/KILL_VERIFY_FAIL" "$RAW/PGREP_SELFTEST_FAIL"
: > "$ADB_LOG"; : > "$DRIVER_LOG"
printf 'job=%s port=%s match_max=%s cool_target=%s\nstart_utc=%s\n' \
  "$JOB" "$ADB_PORT" "$MATCH_MAX" "$COOL_TARGET_C" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RAW/session.env"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$DRIVER_LOG"; }

# Timeout wrapper (stop_lib's adbT contract): perl alarm interrupts on INT/TERM;
# rc >= 124 means the remote process may be orphaned (kill_spec_verified runs).
# stdin from /dev/null for EVERY adb call (audit6): adb forwards its stdin to
# the remote shell, and a TTY there lets an interactive binary wait forever
# (proven on the S23: cell A's completion turn hung to its 900 s timeout).
# This covers every remote binary of this driver — including the strings
# sourced from stop_lib/battery_trust — without editing them; restore.sh
# calls adb directly and redirects its own stdin.
adbT() {
  local seconds="$1" rc argline="" arg
  shift
  /usr/bin/perl -e 'alarm shift; exec @ARGV or exit 127' "$seconds" "$ADB_BIN" "$@" < /dev/null &
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
# shellcheck source=../qdc-heat-3way/battery_trust.sh
source "$CELL/../qdc-heat-3way/battery_trust.sh"
# shellcheck source=arm.sh
source "$CELL/arm.sh"

SER=""; SCREEN_OFF_TIMEOUT=""; STAYON=""
ARM_POLL_PID=0; CURRENT_CHILD_PID=0; END_WRITTEN=0; CLEANED=0; SIGNAL_NAME=""
KILL_NEEDED=0   # 1 => abnormal end: kill the binary and VERIFY it is gone
KILL_FAILED=0   # 1 => a kill could not be verified -> END gets a suffix (N-B3)
KILL_ATTEMPTED=0 # first attempt owns the verdict; cleanup does not repeat it
DRIVER_PID=$$   # the poll subshell exits when this parent is gone (SIGKILL)
FINALIZED=0     # results.tsv `final` column written? (audit2 NEW-3)
COOLDOWN_SECONDS=0; WARM_START=0

write_end() { [ "$END_WRITTEN" -eq 1 ] || { printf 'END reason=%s\n' "$1" > "$END_MARKER"; END_WRITTEN=1; }; }

deadline_check() {  # audit2 NEW-8: up to 30 device runs, bound the session
  if [ "$(date +%s)" -ge "$DEADLINE_EPOCH" ]; then
    log "DEADLINE_MET budget_s=$DEADLINE_S"
    write_end deadline
    exit 124
  fi
}

# pgrep self-test (audit2 NEW-5 + owner mandate): BEFORE touching anything,
# prove `pgrep -f` FINDS a process we started and can clean it up; abort the
# session if it fails. If stop_lib.sh grows its own self-test (the parallel
# agent), adopt it by name — ours is only defined when the library has none.
if declare -F stop_lib_pgrep_selftest >/dev/null 2>&1; then
  pgrep_selftest() { stop_lib_pgrep_selftest; }
elif declare -F pgrep_selftest >/dev/null 2>&1; then
  :  # the sourced implementation wins
else
  pgrep_selftest() {
    local out=""
    # The probe cmdline is assembled at runtime: nothing in THIS command line
    # contains the literal the pgrep pattern searches for, so the wrapper
    # sh -c can never self-match (the bracket trick is not enough here — the
    # literal also appears in the spawn line itself).
    out=$(adbT 30 -s "$SER" shell 'q="sleep 12"; q="$q""345"; "$q" & sleep 1; if pgrep -f "$q" >/dev/null 2>&1; then echo PGREP_SELFTEST=FOUND; else echo PGREP_SELFTEST=MISS; fi; pkill -f "$q" >/dev/null 2>&1 || true; sleep 1; if pgrep -f "$q" >/dev/null 2>&1; then echo PGREP_SELFCLEAN=STILL; else echo PGREP_SELFCLEAN=GONE; fi' 2>/dev/null | tr -d '\r') || out=""
    case "$out" in
      *PGREP_SELFTEST=FOUND*PGREP_SELFCLEAN=GONE*) log "PGREP_SELFTEST ok (pgrep -f found and cleaned our probe process)"; return 0 ;;
      *)
        log "PGREP_SELFTEST_FAIL out=[$(printf '%s' "$out" | tr '\n' '|')]"
        printf 'PGREP_SELFTEST_FAIL out=%s\n' "$(printf '%s' "$out" | tr '\n' '|')" >> "$RAW/PGREP_SELFTEST_FAIL"
        return 1 ;;
    esac
  }
fi

# kill_spec_verified <reason> — the ONLY kill path for this cell's binary, and
# it verifies: pkill, then pgrep until gone (3 tries, 1 s apart). A surviving
# process is written to $RAW/KILL_VERIFY_FAIL (loud) — never a silent kill.
kill_spec_verified() {
  local reason=$1 out="" verdict="" probe="" i=0
  [ -n "$SER" ] || return 0
  KILL_ATTEMPTED=1
  out=$(adbT 15 -s "$SER" shell "pkill -f 'llama-speculative-simpl[e]'" 2>&1) || true
  printf 'reason=%s pkill_out=%s\n' "$reason" "$out" >> "$RAW/kill.log"
  # audit2 NEW-5 + audit4 item-3: health-probe pgrep first — a pgrep whose -f
  # silently fails (busybox-style rc 1) would make GONE a lie, AND a plain
  # literal here would match this very command's `sh -c` cmdline (proven on
  # the S23 tonight), giving a false RC=0; the bracketed pattern leaves no
  # plain literal in this string, so only a real victim can match.
  probe=$(adbT 15 -s "$SER" shell "pgrep -f zzz_no_such_proc_zz[z] >/dev/null 2>&1; echo PROBE=\$?" 2>/dev/null | tr -d '\r' | tail -1) || probe=""
  if [ "$probe" != "PROBE=1" ]; then
    KILL_FAILED=1
    log "KILL_VERIFY reason=$reason result=pgrep_broken probe=${probe:-empty}"
    printf 'KILL_VERIFY_FAIL reason=%s result=pgrep_broken probe=%s\n' "$reason" "${probe:-empty}" >> "$RAW/KILL_VERIFY_FAIL"
    return 1
  fi
  while [ "$i" -lt 3 ]; do
    # one word back: GONE (rc 1 from pgrep), ALIVE (pids match), or
    # PGREP_BROKEN (tool missing/broken — NEVER treated as gone, that would
    # be a silent false kill on a toybox without pgrep -f).
    verdict=$(adbT 15 -s "$SER" shell "if pgrep -f 'llama-speculative-simpl[e]' >/dev/null 2>&1; then echo ALIVE; elif [ \$? -eq 1 ]; then echo GONE; else echo PGREP_BROKEN; fi" 2>/dev/null | tr -d '\r' | tail -1) || verdict=""
    case "$verdict" in
      GONE) log "KILL_VERIFY reason=$reason result=gone attempt=$((i + 1))"; return 0 ;;
      PGREP_BROKEN) break ;;
      *) : ;;   # ALIVE or empty (adb blip): retry
    esac
    sleep 1
    i=$((i + 1))
  done
  if [ "$verdict" = "PGREP_BROKEN" ]; then
    KILL_FAILED=1
    log "KILL_VERIFY reason=$reason result=pgrep_broken — cannot verify, assuming ALIVE"
    printf 'KILL_VERIFY_FAIL reason=%s result=pgrep_broken\n' "$reason" >> "$RAW/KILL_VERIFY_FAIL"
    return 1
  fi
  KILL_FAILED=1
  log "KILL_VERIFY reason=$reason result=ALIVE"
  printf 'KILL_VERIFY_FAIL reason=%s result=ALIVE\n' "$reason" >> "$RAW/KILL_VERIFY_FAIL"
  return 1
}

stop_arm_poll() {
  [ "$ARM_POLL_PID" -ne 0 ] || return 0
  kill "$ARM_POLL_PID" 2>/dev/null || true
  wait "$ARM_POLL_PID" 2>/dev/null || true
  ARM_POLL_PID=0
  return 0
}

arm_poll_loop() {
  # Background subshell while an adb shell blocks the parent; the channel back
  # is stop_lib's $RAW/stop_request. On a stop it kills OUR binary and verifies
  # (stop_lib's request_stop only pkills llama-completion). The trap kills the
  # subshell's own in-flight adb child (audit B-10): no orphaned adb client.
  trap 'if [ -n "${CURRENT_CHILD_PID:-}" ] && [ "$CURRENT_CHILD_PID" -ne 0 ]; then kill "$CURRENT_CHILD_PID" 2>/dev/null || true; fi; exit 0' TERM INT HUP
  while :; do
    sleep "$POLL_S"
    # parent liveness (audit2 NEW-2): a SIGKILLed driver must not leave the
    # binary running unsupervised — this poll kills+verifies before exiting.
    if ! kill -0 "$DRIVER_PID" 2>/dev/null; then
      kill_spec_verified "parent_gone" || true
      exit 0
    fi
    live_readings || true
    hard_stops && continue
    kill_spec_verified "poll_stop" || true
    exit 0
  done
}
start_arm_poll() { arm_poll_loop & ARM_POLL_PID=$!; }

cleanup() {
  local rc=$? endr=""
  [ "$CLEANED" -eq 0 ] || return 0
  CLEANED=1
  stop_arm_poll
  # Audit B-1: EVERY abnormal exit kills the binary and verifies the kill.
  # KILL_ATTEMPTED: stop/timeout paths already produced their verdict (and
  # its reason label) — repeating it would only duplicate the verdict lines.
  if [ -n "$SER" ] && [ "$KILL_ATTEMPTED" -eq 0 ]; then
    if [ "$rc" -ne 0 ] || [ -n "$SIGNAL_NAME" ] || [ "$KILL_NEEDED" -eq 1 ] || [ -f "$RAW/stop_request" ]; then
      kill_spec_verified "cleanup_rc${rc}_sig${SIGNAL_NAME:-none}" || true
    fi
  fi
  # Audit B-2: restore is delegated to standalone restore.sh (works after a
  # SIGKILL of this driver too, because this script never deletes the state).
  if [ -f "$CELL/.restore-state" ]; then
    bash "$CELL/restore.sh" >> "$RAW/restore.log" 2>&1 || log "RESTORE_FAIL (see restore.log)"
  fi
  # audit2 NEW-3: any exit that owns a results file leaves it at 18 columns
  # (rows were born with `final=pending`; only SIGKILL can keep `pending`).
  if [ "$FINALIZED" -eq 0 ]; then finalize_results void "" || true; fi
  # audit4 N-B3: END may predate the kill verdict (deadline, match_void, stop)
  # — rewrite it with the suffix so END.txt alone shows the failed kill.
  if [ "$KILL_FAILED" -eq 1 ] && [ -f "$END_MARKER" ]; then
    endr=$(sed -n 's/^END reason=//p' "$END_MARKER" | tail -1)
    case "$endr" in ''|*_kill_unverified) ;; *) printf 'END reason=%s_kill_unverified\n' "$endr" > "$END_MARKER" ;; esac
  fi
  if [ -n "$SIGNAL_NAME" ]; then endr="signal_$SIGNAL_NAME"; else endr="exit_$rc"; fi
  [ "$KILL_FAILED" -eq 0 ] || endr="${endr}_kill_unverified"
  write_end "$endr"
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
trap 'on_signal HUP 1' HUP     # audit B-9
trap cleanup EXIT

finish_stop() {
  local reason=unknown endr="stop_unknown"
  if [ -f "$RAW/stop_request" ]; then reason=$(tr -d '\r\n' < "$RAW/stop_request"); endr="stop_$reason"; fi
  # NOTE (audit2 NEW-6): the sourced stop_lib also logs `KILL_VERIFIED ctx=…`
  # when IT pkills `llama-completion` — a binary this cell never runs. Our
  # verdict for OUR binary is always the `KILL_VERIFY reason=…` line below;
  # rename/pattern change requested from the library's owner (REPORT.md).
  kill_spec_verified "stop_$reason" || true
  # audit4 N-B3: an unverifiable kill must be visible to an END.txt reader.
  [ "$KILL_FAILED" -eq 0 ] || endr="${endr}_kill_unverified"
  log "SESSION_STOP reason=$reason kill_failed=$KILL_FAILED"
  write_end "$endr"
  exit 0
}

prompt_verify() {
  local sha bytes
  [ -f "$PROMPT_FILE" ] || return 1
  sha=$(/usr/bin/shasum -a 256 "$PROMPT_FILE" | awk '{print $1}')
  bytes=$(wc -c < "$PROMPT_FILE" | tr -d '[:space:]')
  [ "$sha" = "$PROMPT_SHA" ] && [ "$bytes" = "$PROMPT_BYTES" ]
}

# ensure_file <local> <remote> <want_sha>: push only if the on-device sha
# mismatches, then re-verify — never trust an unverified copy.
ensure_file() {
  local local=$1 remote=$2 want=$3 got=""
  got=$(adbT 60 -s "$SER" shell "sha256sum $remote 2>/dev/null" 2>/dev/null | tr -d '\r' | awk '{print $1}') || got=""
  if [ "$got" = "$want" ]; then log "PUSH_SKIP $remote sha_ok"; return 0; fi
  adbT 900 -s "$SER" push "$local" "$remote" >> "$RAW/push.log" 2>&1 || { log "PUSH_FAIL $remote"; return 1; }
  got=$(adbT 60 -s "$SER" shell "sha256sum $remote" 2>/dev/null | tr -d '\r' | awk '{print $1}') || got=""
  [ "$got" = "$want" ] || { log "SHA_MISMATCH $remote got=$got want=$want"; return 1; }
  log "PUSH_OK $remote"
}

# cooldown_wait <label>: gate + skin <= COOL_TARGET_C before every device run
# (audit B-4: adjustment rows must not be systematically hotter than probes).
cooldown_wait() {
  local label=$1 elapsed=0
  COOLDOWN_SECONDS=0; WARM_START=0
  while :; do
    # audit3 B-N1: checked on EVERY iteration — a cold board can spin here for
    # COOL_MAX_S=720 and the budget must bite inside that wait, not once before it.
    deadline_check
    live_readings || true
    hard_stops || finish_stop
    if awk -v s="$LIVE_SKIN" -v t="$COOL_TARGET_C" 'BEGIN{exit !(s+0 <= t+0)}'; then
      COOLDOWN_SECONDS=$elapsed
      return 0
    fi
    if [ "$elapsed" -ge "$COOL_MAX_S" ]; then
      COOLDOWN_SECONDS=$elapsed; WARM_START=1
      log "COOLDOWN_CAP label=$label skin=$LIVE_SKIN waited_s=$elapsed (running warm, flagged)"
      return 0
    fi
    sleep "$COOL_POLL_S"
    elapsed=$((elapsed + COOL_POLL_S))
  done
}

# finalize_results <matched|void> [tags]: SET the 18th column (`final`) in
# place — never append (audit2 NEW-3: header and rows are born at 18 columns,
# so early exits keep a stable schema; only a SIGKILL can leave `pending`).
#   proof rows (attempt 0)                   -> proof
#   OK + tag in the matched list             -> matched (the measurement rows)
#   OK + not the final tag                   -> superseded (early attempts)
#   VOID rows                                -> void; in a void session every
#                                               OK row -> void_match
finalize_results() {
  local mode=$1 tags="${2:-}" tmp="$RESULTS.tmp"
  [ -f "$RESULTS" ] || { FINALIZED=1; return 0; }   # nothing to finalize
  # audit3 B-N2: FINALIZED is set only after awk+mv really rewrote the file —
  # a failed rewrite keeps the flag 0 so the attempt is never reported done.
  if awk -F'\t' -v OFS='\t' -v mode="$mode" -v tags="$tags" '
    NR == 1 { if (NF < 18) $(NF + 1) = "final"; else $18 = "final"; print; next }
    {
      f = "void"
      if ($14 != "OK") f = "void"
      else if ($3 == 0) f = "proof"
      else if (mode == "matched" && index(" " tags " ", " " $1 " ") > 0) f = "matched"
      else if (mode == "matched") f = "superseded"
      else f = "void_match"
      if (NF < 18) $(NF + 1) = f; else $18 = f
      print
    }' "$RESULTS" > "$tmp" && mv "$tmp" "$RESULTS"; then
    FINALIZED=1
  else
    rm -f "$tmp" 2>/dev/null || true
  fi
  return 0
}

# 18 columns from creation: `final` is born as `pending` at row time and
# REWRITTEN in place by finalize_results (audit2 NEW-3).
write_row() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" pending >> "$RESULTS"; }

run_proof() {   # <arm> <index>: short -lv 5 run -> backend proof (never timed)
  local arm=$1 i=$2 tag="$1-p"
  local b_skin a_skin=""
  deadline_check
  cooldown_wait "$tag"
  b_skin=$LIVE_SKIN
  start_arm_poll
  arm_run "$tag" "$arm" "$PROOF_N" proof
  stop_arm_poll
  if [ -f "$RAW/stop_request" ]; then
    write_row "$tag" "$arm" 0 "$PROOF_N" na na na na na "$COOLDOWN_SECONDS" "$WARM_START" "$b_skin" na VOID "stop_$(tr -d '\r\n' < "$RAW/stop_request")" na "$ARM_WALL_S"
    finish_stop
  fi
  if [ "$ARM_RC" -ge 124 ]; then
    kill_spec_verified "timeout_$tag" || true
    write_row "$tag" "$arm" 0 "$PROOF_N" na na na na na "$COOLDOWN_SECONDS" "$WARM_START" "$b_skin" na VOID timeout "$ARM_RC" "$ARM_WALL_S"
    log "PROOF_TIMEOUT arm=$arm rc=$ARM_RC"
    DEAD[$i]=1
    safety_gate "post_$tag" || finish_stop
  else
    arm_parse_proof "$tag" "$arm"
    safety_gate "post_$tag" || finish_stop
    a_skin=$LIVE_SKIN
    write_row "$tag" "$arm" 0 "$PROOF_N" na na na na na "$COOLDOWN_SECONDS" "$WARM_START" "$b_skin" "$a_skin" "$ARM_STATUS" "$ARM_VOID" "$ARM_PROOF" "$ARM_WALL_S"
    log "PROOF_DONE arm=$arm status=$ARM_STATUS void=$ARM_VOID proof=$ARM_PROOF"
    if [ "$ARM_STATUS" != OK ]; then DEAD[$i]=1; fi
  fi
  return 0
}

run_measure() { # <arm> <tag> <limit> <attempt_no> <index>: the timed turn
  local arm=$1 tag=$2 limit=$3 attempt_no=$4 i=$5
  local b_skin a_skin="" parsed=""
  deadline_check
  cooldown_wait "$tag"
  b_skin=$LIVE_SKIN
  start_arm_poll
  arm_run "$tag" "$arm" "$limit" measure
  stop_arm_poll
  if [ -f "$RAW/stop_request" ]; then
    write_row "$tag" "$arm" "$attempt_no" "$limit" na na na na na "$COOLDOWN_SECONDS" "$WARM_START" "$b_skin" na VOID "stop_$(tr -d '\r\n' < "$RAW/stop_request")" na "$ARM_WALL_S"
    finish_stop
  fi
  if [ "$ARM_RC" -ge 124 ]; then
    kill_spec_verified "timeout_$tag" || true
    write_row "$tag" "$arm" "$attempt_no" "$limit" na na na na na "$COOLDOWN_SECONDS" "$WARM_START" "$b_skin" na VOID timeout "$ARM_RC" "$ARM_WALL_S"
    log "ARM_TIMEOUT tag=$tag rc=$ARM_RC"
    # previous OK N (if any) stays: the match loop retries this arm next round
  else
    arm_parse_measure "$tag" "$arm" "$limit"
    if [ "$TAIL_S" -gt 0 ]; then sleep "$TAIL_S"; fi
    safety_gate "post_$tag" || finish_stop
    a_skin=$LIVE_SKIN
    write_row "$tag" "$arm" "$attempt_no" "$limit" "$ARM_N" "$ARM_OVER" "$ARM_DRAFTED" \
      "$ARM_ACCEPT" "$ARM_TPS" "$COOLDOWN_SECONDS" "$WARM_START" "$b_skin" "$a_skin" \
      "$ARM_STATUS" "$ARM_VOID" "$ARM_PROOF" "$ARM_WALL_S"
    log "ARM_DONE tag=$tag limit=$limit n=$ARM_N status=$ARM_STATUS void=$ARM_VOID accept=$ARM_ACCEPT tps=$ARM_TPS"
    if [ "$ARM_STATUS" = OK ]; then parsed=$ARM_N; LAST_OK_TAG[$i]=$tag; fi
    N_OF[$i]=$parsed
  fi
  return 0
}

match_state() {  # sets N_STAR, N_OK, ALL_EQ (0/1)
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

# ---- session setup ----
SER="${ADB_SERIAL:-}"
if [ -z "$SER" ]; then
  SER=$(adbT 60 devices | awk 'NR > 1 && $2 == "device" { print $1; exit }' | tr -d '\r') || SER=""
fi
[ -n "$SER" ] || { log "NO_DEVICE port=$ADB_PORT"; exit 2; }
adbT 60 -s "$SER" wait-for-device > "$RAW/wait_for_device.txt" 2>&1 || { log "ADB_FAIL at wait-for-device"; exit 2; }
# audit2 NEW-5 + owner mandate: pgrep must PROVE itself (find + clean a
# process we started) before this session touches anything — abort on failure.
if ! pgrep_selftest; then log "PGREP_SELFTEST_ABORT"; exit 4; fi
# Audit B-2: a stale .restore-state means a previous run died before restore —
# repair it FIRST (restore.sh removes it on success); never overwrite it.
if [ -f "$CELL/.restore-state" ]; then
  log "STALE_RESTORE state_present (repairing before this run)"
  bash "$CELL/restore.sh" >> "$RAW/stale_restore.log" 2>&1 || log "STALE_RESTORE_FAIL (see stale_restore.log)"
  if [ -f "$CELL/.restore-state" ]; then log "STALE_RESTORE_STILL_PRESENT refusing to overwrite"; exit 7; fi
fi
SOC=$(adbT 30 -s "$SER" shell getprop ro.soc.model | tr -d '\r') || SOC=""
[ -n "$SOC" ] || { log "ADB_FAIL at getprop_soc"; exit 2; }
case "$SOC" in
  SM8550) BOARD=S23 ;;
  *) log "UNSUPPORTED_SOC=$SOC (S23/SM8550 only)"; exit 6 ;;
esac
# Save screen state BEFORE the first mutation (its presence authorizes restore).
SCREEN_OFF_TIMEOUT=$(adbT 30 -s "$SER" shell settings get system screen_off_timeout | tr -d '\r') || SCREEN_OFF_TIMEOUT=""
STAYON=$(adbT 30 -s "$SER" shell settings get global stay_on_while_plugged_in | tr -d '\r') || STAYON=""
[ -n "$SCREEN_OFF_TIMEOUT" ] || SCREEN_OFF_TIMEOUT=null   # no empty value in state (A-7 pattern)
[ -n "$STAYON" ] || STAYON=null
printf 'SER=%s\nSCREEN_OFF_TIMEOUT=%s\nSTAYON=%s\nJOB=%s\n' \
  "$SER" "$SCREEN_OFF_TIMEOUT" "$STAYON" "$JOB" > "$CELL/.restore-state"
adbT 30 -s "$SER" shell input keyevent KEYCODE_WAKEUP >> "$RAW/setup.log" 2>&1 || { log "ADB_FAIL at wakeup"; exit 2; }
adbT 30 -s "$SER" shell svc power stayon true >> "$RAW/setup.log" 2>&1 || { log "ADB_FAIL at stayon"; exit 2; }
adbT 30 -s "$SER" shell settings put system screen_off_timeout 1800000 >> "$RAW/setup.log" 2>&1 || { log "ADB_FAIL at screen_timeout"; exit 2; }
log "SESSION job=$JOB board=$BOARD soc=$SOC serial=$SER timeout_saved=$SCREEN_OFF_TIMEOUT stayon_saved=$STAYON"
prompt_verify || { log "PROMPT_IDENTITY_FAIL"; exit 6; }
safety_gate before_setup || finish_stop
battery_trust_check || { log "BATTERY_TRUST_READ_FAIL"; exit 3; }   # audit B-8
kit_local_sha=$(shasum -a 256 "$KIT_TGZ" | awk '{print $1}') || kit_local_sha=""
[ "$kit_local_sha" = "$KIT_SHA" ] || { log "KIT_SHA_FAIL local=$kit_local_sha"; exit 5; }
# Audit B-7: the multi-GB push runs UNDER the poll, and the gate repeats right
# after it — no unsupervised window between the pre-push gate and the unpack.
start_arm_poll
ensure_file "$KIT_TGZ" "$D/kit.tgz" "$KIT_SHA" || exit 5
ensure_file "$MODEL" "$D/ship.gguf" "$MODEL_SHA" || exit 5
ensure_file "$DRAFT" "$D/draft.gguf" "$DRAFT_SHA" || exit 5
ensure_file "$PROMPT_FILE" "$D/prompt.txt" "$PROMPT_SHA" || exit 6
stop_arm_poll
if [ -f "$RAW/stop_request" ]; then finish_stop; fi
safety_gate after_push || finish_stop
# audit2 NEW-4: unpack + sums also run under the poll (up to ~2 min of writes)
start_arm_poll
adbT 120 -s "$SER" shell "cd $D && tar -xzf kit.tgz" >> "$RAW/setup.log" 2>&1 || { stop_arm_poll; log "KIT_UNPACK_FAIL"; exit 5; }
adbT 60 -s "$SER" shell "cd $D && sha256sum -c SHA256SUMS" >> "$RAW/setup.log" 2>&1 || { stop_arm_poll; log "KIT_SUMS_FAIL"; exit 5; }
stop_arm_poll
if [ -f "$RAW/stop_request" ]; then finish_stop; fi
log "KIT_AND_MODELS_VERIFIED"
safety_gate setup || finish_stop
log "SETUP_DONE skin=$LIVE_SKIN thermal=$LIVE_THERMAL_STATUS batt_temp=$LIVE_BATT_TEMP_TENTHS level=$LIVE_BATT_LEVEL plugged=$LIVE_PLUGGED untrusted=$BATTERY_UNTRUSTED"

# 18 columns from creation: `final` starts as `pending`, finalize_results
# rewrites it in place (audit2 NEW-3 — stable schema on every exit path).
printf 'tag\tarm\tattempt\tlimit\tn_predict\tover\tn_drafted\taccept\ttps\tcooldown_s\twarm_start\tskin_before\tskin_after\tstatus\tvoid\tproof\twall_s\tfinal\n' > "$RESULTS"

# ---- passes: proofs (5) -> probes (5) -> matched-N adjustments ----
ARMS=(A B4 B8 C4 C8)
N_OF=("" "" "" "" "")
LIMIT_OF=(127 127 127 127 127)
LAST_OK_TAG=("" "" "" "" "")
DEAD=(0 0 0 0 0)

i=0
for arm in "${ARMS[@]}"; do
  run_proof "$arm" "$i"
  i=$((i + 1))
done

i=0
for arm in "${ARMS[@]}"; do
  if [ "${DEAD[$i]}" -eq 0 ]; then
    run_measure "$arm" "$arm" "${LIMIT_OF[$i]}" 1 "$i"
  fi
  i=$((i + 1))
done

match_state
k=0
while [ "$ALL_EQ" -eq 0 ] && [ "$k" -lt "$MATCH_MAX" ]; do
  deadline_check
  k=$((k + 1))
  j=0
  for arm in "${ARMS[@]}"; do
    cur=${N_OF[$j]}
    if [ "${DEAD[$j]}" -eq 0 ] && [ -n "$cur" ] && [ "$cur" -lt "$N_STAR" ]; then
      LIMIT_OF[$j]=$(( LIMIT_OF[$j] + N_STAR - cur ))
      run_measure "$arm" "${arm}-m${k}" "${LIMIT_OF[$j]}" "$((k + 1))" "$j"
    fi
    j=$((j + 1))
  done
  match_state
done

if [ "$ALL_EQ" -eq 1 ]; then
  matched_tags=""
  for j in 0 1 2 3 4; do matched_tags="$matched_tags ${LAST_OK_TAG[$j]}"; done
  safety_gate post_session || finish_stop
  finalize_results matched "$matched_tags"
  log "MATCH ok n=$N_STAR arms=${#ARMS[@]} (final=matched rows are the measurement)"
  log "SESSION_DONE"
  write_end exit_0
  exit 0
fi
# Audit B-3: a void session is NEVER recorded as success: END=match_void and
# exit 3 (stricter than the audit's suggested exit 0); every OK measure row
# carries final=void_match.
finalize_results void ""
KILL_NEEDED=1
log "MATCH void n_star=${N_STAR:-na} after $k adjustment round(s) — session data VOID"
write_end match_void
exit 3
