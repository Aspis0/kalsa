#!/usr/bin/env bash
# HARNESS_FINDINGS §7.29 protocol, re-run on an APK that carries the merge.
#
# Question: after `tryLoadEngineSession` populates native KV, does the static
# prefix prewarm still `seq_rm` over it? §7.29 measured the restore alone on an
# APK that predates the prewarm. This script measures restore + prewarm
# together, which is the shipping path.
#
# Shape, per cycle: force-stop -> relaunch -> wait Ready -> background/
# foreground bounce (rp_fg_bounce; FG_BOUNCE=0 skips it) -> one continuation
# turn -> read `n_past` (KALSA_KVDIAG), `promptMs` (KALSA_TELEMETRY) and the
# prewarm's own verdict (KALSA_PREWARM).
#
# Everything runs in ONE invocation with keep-awake armed at the top, because
# a detached phone loses the wake-lock between scripts. Every adb call takes
# `</dev/null` — a caller's stdin gets eaten otherwise and the loop hangs.
#
#   ANDROID_SERIAL=<serial> scripts/device-restore-protocol.sh [cycles]
set -uo pipefail

_RP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=device-share-send.sh
source "$_RP_DIR/device-share-send.sh"

CYCLES="${1:-4}"
OUT="${OUT:-device-restore-out}"
ACTIVITY="${ACTIVITY:-com.kalsa.app/.MainActivity}"
REPLY_TIMEOUT="${REPLY_TIMEOUT:-600}"
READY_TIMEOUT="${READY_TIMEOUT:-240}"
FG_BOUNCE="${FG_BOUNCE:-1}"
FG_BOUNCE_SECONDS="${FG_BOUNCE_SECONDS:-20}"
# Generous because `done` follows a WHOLE prefill: ~40s measured on the S23
# for the standard prefix, 2-3x that on the Jelly with a big one. Kicks that
# take the restore path settle in seconds, so the timeout costs nothing
# unless the prewarm is genuinely still running. 120 ~ 3x the slowest known
# prefill, well under READY_TIMEOUT's scale.
FG_SETTLE_TIMEOUT_SECONDS="${FG_SETTLE_TIMEOUT_SECONDS:-120}"

MESSAGES=(
  "In una riga: qual e la capitale del Portogallo?"
  "In una riga: e quella della Norvegia?"
  "In una riga: e quella della Grecia?"
  "In una riga: e quella della Finlandia?"
  "In una riga: e quella dell Islanda?"
  "In una riga: e quella dell Irlanda?"
)

rp_wait_ready() {
  local t=0 ui
  while [ "$t" -lt "$READY_TIMEOUT" ]; do
    if ui=$(device_dump_ui_retry); then
      device_ui_has_any "$ui" "${_SHARE_READY_LABELS[@]}" && { log "ready after ${t}s"; return 0; }
    fi
    sleep 5
    t=$((t + 5))
  done
  log "never reported Ready after ${READY_TIMEOUT}s"
  return 1
}

rp_wait_reply() {
  local prev="$1" t=0 count
  while [ "$t" -lt "$REPLY_TIMEOUT" ]; do
    count=$(device_history_assistant_count)
    case "$count" in ''|*[!0-9]*) count=-1 ;; esac
    if [ "$count" -gt "$prev" ]; then
      log "reply persisted after ${t}s (assistants ${prev}->${count})"
      return 0
    fi
    sleep 5
    t=$((t + 5))
  done
  log "no reply within ${REPLY_TIMEOUT}s"
  return 1
}

rp_state() {
  log "state: level=$(device_battery_level) temp_deci=$(device_battery_temp_deci) thermal=$(device_thermal_status)"
}

# Owner stop rules for an unplugged S23, enforced between cycles instead of
# only logged: battery >= 44.0 C or thermal status >= 3 ends the run. A run
# that cooks the phone is not evidence, and rp_state alone never stopped one.
RP_TEMP_STOP_DECI="${RP_TEMP_STOP_DECI:-440}"
RP_THERMAL_STOP="${RP_THERMAL_STOP:-3}"

rp_should_stop() {
  local temp thermal
  temp=$(device_battery_temp_deci)
  thermal=$(device_thermal_status)
  case "$temp" in ''|*[!0-9-]*) temp=0 ;; esac
  case "$thermal" in ''|*[!0-9-]*) thermal=0 ;; esac
  if [ "$temp" -ge "$RP_TEMP_STOP_DECI" ]; then
    log "STOP: battery ${temp} deci-C >= ${RP_TEMP_STOP_DECI} (owner rule)"
    return 0
  fi
  if [ "$thermal" -ge "$RP_THERMAL_STOP" ]; then
    log "STOP: thermal status ${thermal} >= ${RP_THERMAL_STOP} (owner rule)"
    return 0
  fi
  return 1
}

# The foreground re-kick (AppShell onAppState "active") is the only caller of
# queueStaticPrefixPrewarm that fires on a foreground transition, and `am start`
# alone never reaches it: the app was never backgrounded. Bounce to home and
# back so the run measures the path a real user takes.
# Wait until THIS cycle's kick resolves, watching this cycle's own region of
# the capture file the main `adb logcat` is already writing — no second
# logcat client, so no interleaving and no lost lines. The region starts at
# the last `fg_kick cycle=$i` line: the next marker (fg_settled) has not been
# written yet, so everything after it is this kick's own evidence, and the
# file only ever grows by appends. A TERMINAL line is `{"op":"done"}`,
# `{"op":"restore"` (either outcome — a restore has a verdict) or any
# `{"op":"skip"`; `{"op":"start"` does NOT count — it logs at queue time and
# is exactly the line a working-but-slow prefill has not produced yet.
# On timeout, return 1 and let rp_fg_bounce emit fg_settled anyway: the
# verdict will honestly say no_work, and the log line says the wait expired,
# which reads differently from "the kick never fired".
# NEVER RUN AGAINST A REAL PHONE YET: authored offline. The first device run
# must confirm the marker-find and the tail-window polling against real
# logcat interleaving and write latency.
rp_fg_wait_settled() {
  local i="$1" waited=0 line_from=""
  while [ "$waited" -lt "$FG_SETTLE_TIMEOUT_SECONDS" ]; do
    line_from=$(grep -n "fg_kick cycle=$i" "$OUT/logcat.txt" 2>/dev/null | tail -1 | cut -d: -f1)
    [ -n "$line_from" ] && break
    sleep 1
    waited=$((waited + 1))
  done
  if [ -z "$line_from" ]; then
    log "cycle $i: fg_kick marker never reached the capture"
    return 1
  fi
  while [ "$waited" -lt "$FG_SETTLE_TIMEOUT_SECONDS" ]; do
    if tail -n +"$line_from" "$OUT/logcat.txt" 2>/dev/null | grep -Eq '"op":"(done|restore|skip)"'; then
      log "cycle $i: kick settled after ${waited}s"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  log "cycle $i: kick did not settle within ${FG_SETTLE_TIMEOUT_SECONDS}s — fg_settled goes out anyway; the verdict will say no_work"
  return 1
}

rp_fg_bounce() {
  local i="$1"
  adb shell log -p i -t KALSA_RP_MARK "fg_bounce_home cycle=$i" </dev/null >/dev/null 2>&1
  adb shell am start -a android.intent.action.MAIN -c android.intent.category.HOME </dev/null >/dev/null 2>&1
  sleep "$FG_BOUNCE_SECONDS"
  # Before, not after, the relaunch: the verdict classifies what FOLLOWS the
  # marker, and a prewarm logging between the two lines would be lost.
  adb shell log -p i -t KALSA_RP_MARK "fg_kick cycle=$i" </dev/null >/dev/null 2>&1
  adb shell am start -n "$ACTIVITY" </dev/null >/dev/null 2>&1
  # The window closes on the kick's OUTCOME, not on a timer: `done` lands
  # after a whole prefill — tens of seconds on the S23, more on the Jelly —
  # so the fixed sleep this replaced classified a working prewarm as no_work:
  # a false FAIL on exactly the case the run wants to see succeed. fg_settled
  # is still the last line emitted, BEFORE the send produces prewarm lines of
  # its own.
  rp_fg_wait_settled "$i"
  adb shell log -p i -t KALSA_RP_MARK "fg_settled cycle=$i" </dev/null >/dev/null 2>&1
}

# FG_BOUNCE accepts only 0 or 1: "true"/"yes" read as on but would switch the
# measurement off in silence, and a silent off is worse than a hard error.
# FG_BOUNCE_SECONDS must be a positive integer: `sleep abc` fails in ~0s and
# the re-kick never gets its window — a typo must not become a false FAIL.
rp_validate_bounce_flags() {
  case "$FG_BOUNCE" in
    0|1) ;;
    *) die "FG_BOUNCE must be 0 or 1, got '$FG_BOUNCE'" ;;
  esac
  case "$FG_BOUNCE_SECONDS" in
    ''|*[!0-9]*|0)
      die "FG_BOUNCE_SECONDS must be a positive integer, got '$FG_BOUNCE_SECONDS'" ;;
  esac
  case "$FG_SETTLE_TIMEOUT_SECONDS" in
    ''|*[!0-9]*|0)
      die "FG_SETTLE_TIMEOUT_SECONDS must be a positive integer, got '$FG_SETTLE_TIMEOUT_SECONDS'" ;;
  esac
}

# The fg bounce's whole evidence chain hangs on `adb shell log` reaching
# logcat: if the marker never lands (toybox stripped, adb hiccup), every kick
# window is empty and the verdict prints "not exercised" — a green-looking
# run that measured nothing, indistinguishable from FG_BOUNCE=0. Probe once
# before the first cycle, not per cycle: the failure mode is "the command is
# missing / cannot write", which does not change mid-run.
# NEVER RUN AGAINST A REAL PHONE YET: authored offline. The first device run
# must confirm the readback really sees the marker (quoting, buffering).
rp_marker_probe() {
  local nonce="probe=$$-$(date +%s)"
  adb shell log -p i -t KALSA_RP_MARK "$nonce" </dev/null >/dev/null 2>&1
  sleep 2
  if ! adb logcat -d -s KALSA_RP_MARK </dev/null 2>/dev/null | grep -q "$nonce"; then
    log "marker probe FAILED: wrote '$nonce', never read it back"
    return 1
  fi
  log "marker probe ok ($nonce)"
}

rp_main() {
  local attached picked i prev
  mkdir -p "$OUT"
  attached=$(adb devices 2>/dev/null | awk '$2=="device" {print $1}')
  picked=$(device_pick_serial "${ANDROID_SERIAL:-}" "$attached") \
    || die "need ANDROID_SERIAL (attached: $(printf '%s' "$attached" | tr '\n' ' '))"
  export ANDROID_SERIAL="$picked"
  BENCH_TARGET=device
  log "serial=$ANDROID_SERIAL cycles=$CYCLES"

  rp_validate_bounce_flags
  if [ "$FG_BOUNCE" = "1" ]; then
    rp_marker_probe || die "KALSA_RP_MARK markers do not reach logcat: without them every kick window is empty, FG_REKICK prints 'not exercised', and the run only looks green"
  fi

  device_keepawake_begin
  rp_state

  adb logcat -c </dev/null >/dev/null 2>&1 || true
  adb logcat -v time </dev/null > "$OUT/logcat.txt" 2>&1 &
  local logcat_pid=$!
  trap 'kill '"$logcat_pid"' 2>/dev/null || true; device_termux_wakelock_restore; _device_session_restore' EXIT

  for i in $(seq 1 "$CYCLES"); do
    if rp_should_stop; then
      log "ending run before cycle $i — device is over an owner stop threshold"
      break
    fi
    log "=== cycle $i/$CYCLES ==="
    # Marker into the device's own log stream (not appended to the capture
    # file): logcat is writing that same file in the background, so ordering
    # against it would otherwise be a race.
    adb shell log -p i -t KALSA_RP_MARK "cycle=$i" </dev/null >/dev/null 2>&1
    adb shell am force-stop com.kalsa.app </dev/null >/dev/null 2>&1
    sleep 5
    adb shell am start -n "$ACTIVITY" </dev/null >/dev/null 2>&1
    rp_wait_ready || { log "cycle $i: no Ready, aborting cycle"; continue; }
    # Between Ready and the first send: the KV holds no chat yet, so the
    # re-kick must produce a real prewarm, not a kv_holds_chat skip.
    if [ "$FG_BOUNCE" = "1" ]; then rp_fg_bounce "$i"; fi
    rp_state
    prev=$(device_history_assistant_count)
    case "$prev" in ''|*[!0-9]*) prev=0 ;; esac
    if ! device_share_send "${MESSAGES[$(( (i - 1) % ${#MESSAGES[@]} ))]}"; then
      log "cycle $i: send failed"
      continue
    fi
    rp_wait_reply "$prev" || log "cycle $i: reply timeout"
    rp_state
    sleep 5
  done

  sleep 5
  kill "$logcat_pid" 2>/dev/null || true
  # KALSA_KVPREFIX is the verdict: `n_common == embd` means the live cache was
  # reused whole, which on a hybrid is the only outcome that avoids a full
  # re-prefill (llama-memory-recurrent.cpp:194 / rn-completion.cpp:620-640).
  grep -E "KALSA_RP_MARK|KALSA_KVPREFIX|KALSA_KVREUSE|KALSA_KVDIAG|KALSA_KVRESUME|KALSA_PREWARM|KALSA_SESSION|KALSA_WINDOW_SLIDE|KALSA_TELEMETRY|restored state checkpoint|no usable state checkpoint|reusing [0-9]+/" \
    "$OUT/logcat.txt" > "$OUT/evidence.txt" || true
  log "evidence: $OUT/evidence.txt ($(wc -l < "$OUT/evidence.txt" | tr -d ' ') lines)"

  # State the verdict instead of leaving it in 2000 lines of logcat.
  node "$_RP_DIR/restoreVerdict.mjs" "$OUT/evidence.txt" | tee "$OUT/VERDICT.txt"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  rp_main "$@"
fi
