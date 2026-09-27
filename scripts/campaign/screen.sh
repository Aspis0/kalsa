#!/usr/bin/env bash
# The screen-ON rule (owner, 2026-09-27): a turn counts only if the phone is
# Awake and Kalsa is the focused app BEFORE and AFTER it. A failing check
# invalidates the attempt (never counted), wakes the phone and redoes the
# whole turn; after CAMPAIGN_SCREEN_REDO_CAP attempts the run dies.
# The turn driver calls a campaign_screen_turn record for the redone turn by
# marking the invalid one recovery="screen-invalid" (verdict never counts it).

campaign_screen_verify() {
  local power focus
  # case/herestring, never `printf "$x" | grep -q`: under pipefail an
  # early-closing grep -q hands printf a SIGPIPE (141) on any dump larger
  # than the pipe buffer — the check would fail at random.
  power=$(adb shell dumpsys power </dev/null 2>/dev/null | tr -d '\r') || return 1
  case "$power" in
    *mWakefulness=Awake*) ;;
    *) return 1 ;;
  esac
  focus=$(adb shell dumpsys window </dev/null 2>/dev/null | tr -d '\r') || focus=""
  if ! grep -q 'mCurrentFocus=.*com.kalsa.app' <<<"$focus"; then
    focus=$(adb shell dumpsys activity activities </dev/null 2>/dev/null | tr -d '\r') || return 1
    grep -q 'topResumedActivity=.*com.kalsa.app' <<<"$focus" || return 1
  fi
  return 0
}

campaign_screen_wake() {
  # The keyguard makes WindowManager force a 5 s user-activity timeout
  # (mUserActivityTimeoutOverrideFromWindowManager=5000): the long timeout
  # alone is not enough, so the keyguard must go too.
  adb shell input keyevent KEYCODE_WAKEUP </dev/null >/dev/null 2>&1 || return 1
  adb shell wm dismiss-keyguard </dev/null >/dev/null 2>&1 || true
  # singleTask: the installed S23 app reports launchMode=2 in dumpsys
  # activity activities, so am start REUSES the running instance — it
  # foregrounds without restarting, mid-conversation included.
  adb shell am start -n "$PKG/.MainActivity" </dev/null >/dev/null 2>&1 || return 1
  local t=0 wait_s="${CAMPAIGN_SCREEN_WAKE_WAIT_S:-10}"
  case "$wait_s" in ''|*[!0-9]*|0) wait_s=10 ;; esac
  while [ "$t" -lt "$wait_s" ]; do
    campaign_screen_verify && return 0
    sleep 1
    t=$((t + 1))
  done
  return 1
}

# Wake-and-verify: a screen that answers the wake still passes; one that
# never answers keeps the loop red until the caller's cap.
campaign_screen_ensure() {
  campaign_screen_verify && return 0
  campaign_screen_wake
}

# Mark the last turn-i answer record as not counted (recovery=screen-invalid:
# verdict.mjs excludes it from "answered"). An event record or a mismatched
# last line is left alone — it never counted as an answer anyway.
campaign_invalidate_turn_record() {
  local jsonl="${1:?}" turn_i="${2:?}"
  [ -f "$jsonl" ] || return 0
  python3 - "$jsonl" "$turn_i" <<'PY'
import json, sys

path, turn = sys.argv[1], int(sys.argv[2])
try:
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
except OSError:
    raise SystemExit(0)
if not lines:
    raise SystemExit(0)
try:
    rec = json.loads(lines[-1])
except ValueError:
    raise SystemExit(0)
if (
    isinstance(rec, dict)
    and rec.get("i") == turn
    and "event" not in rec
    and not rec.get("recovery")
):
    rec["recovery"] = "screen-invalid"
    lines[-1] = json.dumps(rec, ensure_ascii=False)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
PY
}

# One turn under the screen rule. Args: <jsonl> <turn-index> <redo-cap> <turn-cmd...>.
# rc 0 = valid turn; rc 1 = cap reached (caller dies); rc 2 = the turn itself
# failed (caller keeps its own failure handling).
campaign_screen_turn() {
  local jsonl="${1:?}" turn_i="${2:?}" cap="${3:?}"
  shift 3
  local attempt=0
  while :; do
    if ! campaign_screen_ensure; then
      attempt=$((attempt + 1))
      log "SCREEN invalid before turn $turn_i — waking and retrying ($attempt/$cap)"
      if [ "$attempt" -gt "$cap" ]; then
        log "SCREEN REFUSED: not awake/focused after $cap attempts (turn $turn_i)"
        return 1
      fi
      continue
    fi
    "$@" || return 2
    if campaign_screen_verify; then
      return 0
    fi
    campaign_screen_wake || true
    campaign_invalidate_turn_record "$jsonl" "$turn_i"
    attempt=$((attempt + 1))
    log "SCREEN invalid after turn $turn_i — answer not counted, redoing ($attempt/$cap)"
    if [ "$attempt" -gt "$cap" ]; then
      log "SCREEN REFUSED: not awake/focused after $cap attempts (turn $turn_i)"
      return 1
    fi
  done
}

# Run start (owner rule): pin the screen timeout at max and take the
# keyguard down — with the keyguard showing, WindowManager forces a 5 s
# user-activity timeout (mUserActivityTimeoutOverrideFromWindowManager=5000),
# so the long timeout alone is not enough. NOT restored at exit (owner rule
# as of today): campaign_screen_finalize re-pins the max after the generic
# session restore writes the old value back — see its comment below.
campaign_screen_pin_timeout() {
  local saved
  saved=$(adb shell settings get system screen_off_timeout </dev/null 2>/dev/null | tr -d '\r') || saved=""
  printf '%s\n' "$saved" > "${OUT:?}/.screen-timeout-saved.txt"
  adb shell settings put system screen_off_timeout 2147483647 </dev/null >/dev/null 2>&1 ||
    { log "screen: could not set screen_off_timeout=2147483647"; return 1; }
  adb shell wm dismiss-keyguard </dev/null >/dev/null 2>&1 || true
  log "screen: timeout pinned to 2147483647 (saved: ${saved:-unreadable}), keyguard dismissed — no restore at exit"
  return 0
}

# The exit guarantee (owner rule): EVERY exit path — success, die, early
# die, signal — ends at timeout 2147483647, Awake, keyguard down, Kalsa in
# the foreground, and nothing ever DELETES the setting. keepawake's restore
# would delete it: its pure decision deletes when the saved value equals
# KA_SCREEN_TIMEOUT_MS (the S23 run saved 86400000 from a prior run and
# logged "deleted screen_off_timeout (leak: ...)"), so tell it the saved
# value IS the max — its decision becomes `put 2147483647`. Teardown also
# force-stops Kalsa (the S23 phone ended Dozing with the shade focused), so
# the wake + foreground runs AFTER the restore, never before.
campaign_screen_finalize() {
  _KA_SCREEN_TIMEOUT_SAVED=2147483647
  _device_session_restore || true
  if adb shell settings put system screen_off_timeout 2147483647 </dev/null >/dev/null 2>&1; then
    log "screen finalize: screen_off_timeout=2147483647"
  else
    log "screen finalize: WARNING could not set screen_off_timeout=2147483647"
  fi
  if campaign_screen_wake; then
    log "screen finalize: Awake + keyguard dismissed + Kalsa foreground"
  else
    log "screen finalize: WARNING not awake/focused at exit"
  fi
  local timeout
  timeout=$(adb shell settings get system screen_off_timeout </dev/null 2>/dev/null | tr -d '\r') || timeout=unreadable
  log "screen finalize: readback screen_off_timeout=${timeout:-unreadable}"
}
