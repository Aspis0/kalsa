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
RP_WATCHDOG_INTERVAL_SECONDS="${RP_WATCHDOG_INTERVAL_SECONDS:-10}"
RP_TEMP_WARN_DECI=400
RP_WATCHDOG_SENTINEL="$OUT/.thermal-watchdog.stop"
RP_WATCHDOG_MAX_FILE="$OUT/.thermal-watchdog.max"
RP_WATCHDOG_PID=""
RP_WATCHDOG_STOP_LOGGED=0
RP_WARNED=0

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
    rp_watchdog_stop_requested && return 2
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
    rp_watchdog_stop_requested && return 2
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

# Owner stop rules for an unplugged S23, enforced between cycles and by the
# watchdog: battery >= 44.0 C or thermal status >= 3 ends the run. A run that
# cooks the phone is not evidence, and rp_state alone never stopped one.
# Thermal stop: 44.0 C, settled by the owner on 2026-09-17. The 25/08/2026
# mandate wrote KILL at 43.0 C; both numbers were put to the owner and 44.0 C
# governs. WARN stays at 40.0 C as the mandate asks. RP_TEMP_STOP_DECI is an
# owner decision — do not move it from inside a patch.
RP_TEMP_STOP_DECI="${RP_TEMP_STOP_DECI:-440}"
RP_THERMAL_STOP="${RP_THERMAL_STOP:-3}"

rp_should_stop() {
  local temp thermal
  temp=$(device_battery_temp_deci)
  thermal=$(device_thermal_status)
  case "$temp" in ''|*[!0-9-]*) temp=0 ;; esac
  case "$thermal" in ''|*[!0-9-]*) thermal=0 ;; esac
  RP_LAST_TEMP_DECI="$temp"
  RP_LAST_THERMAL="$thermal"
  if [ "$temp" -ge "$RP_TEMP_WARN_DECI" ] && [ "$RP_WARNED" -eq 0 ]; then
    log "WARN: battery ${temp} deci-C ($(rp_temp_celsius "$temp") C) >= ${RP_TEMP_WARN_DECI} deci-C"
    RP_WARNED=1
  fi
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

rp_temp_celsius() {
  local temp="$1"
  case "$temp" in
    ''|*[!0-9]*) printf '%s' unknown ;;
    *) printf '%s.%s' "$((temp / 10))" "$((temp % 10))" ;;
  esac
}

rp_watchdog_write_max() {
  local max_temp="${1:-unknown}" tmp="${RP_WATCHDOG_MAX_FILE}.$$"
  printf '%s\n' "$max_temp" > "$tmp" && mv -f "$tmp" "$RP_WATCHDOG_MAX_FILE"
}

rp_watchdog_write_sentinel() {
  local temp="$1" thermal="$2" max_temp="$3"
  local tmp="${RP_WATCHDOG_SENTINEL}.$$"
  printf 'temp_deci=%s thermal=%s max_temp_deci=%s\n' \
    "$temp" "$thermal" "$max_temp" > "$tmp" && mv -f "$tmp" "$RP_WATCHDOG_SENTINEL"
}

rp_watchdog_stop_requested() {
  local state max_temp
  [ -f "$RP_WATCHDOG_SENTINEL" ] || return 1
  if [ "$RP_WATCHDOG_STOP_LOGGED" -eq 0 ]; then
    state=$(tr -d '\r\n' < "$RP_WATCHDOG_SENTINEL" 2>/dev/null || true)
    max_temp=$(cat "$RP_WATCHDOG_MAX_FILE" 2>/dev/null || true)
    log "STOP: thermal watchdog sentinel (${state:-state unavailable}); max_temp_deci=${max_temp:-unknown}"
    RP_WATCHDOG_STOP_LOGGED=1
  fi
  return 0
}

rp_watchdog_report_max() {
  local max_temp
  max_temp=$(cat "$RP_WATCHDOG_MAX_FILE" 2>/dev/null || true)
  if [ -n "$max_temp" ] && [ "$max_temp" != "unknown" ]; then
    log "thermal watchdog: max battery temperature seen=${max_temp} deci-C ($(rp_temp_celsius "$max_temp") C)"
  else
    log "thermal watchdog: max battery temperature seen=unknown"
  fi
}

rp_watchdog_cleanup() {
  if [ -n "${RP_WATCHDOG_PID:-}" ]; then
    kill "$RP_WATCHDOG_PID" 2>/dev/null || true
    wait "$RP_WATCHDOG_PID" 2>/dev/null || true
    RP_WATCHDOG_PID=""
  fi
  rp_watchdog_report_max
}

# Exercised against a real phone 2026-09-18 (Jelly Star, 192.168.1.82:5555, on
# charge, idle): device_battery_temp_deci returned 260 = 26.0 C and thermal 0.
# Both directions were driven with that live reading — stop=440 kept going and
# wrote max=260, stop=200 fired, wrote the sentinel (temp_deci=260 thermal=0
# max_temp_deci=260) and rp_watchdog_stop_requested saw it. dumpsys cadence,
# sentinel visibility and cleanup all behaved. Still unproven: the loop under a
# real prefill's CPU load, and a temperature that actually climbs.
rp_watchdog_loop() {
  local parent_pid="$1" max_temp="" temp
  while kill -0 "$parent_pid" 2>/dev/null; do
    if rp_should_stop; then
      temp="$RP_LAST_TEMP_DECI"
      case "$temp" in
        ''|*[!0-9]*) ;;
        *)
          if [ -z "$max_temp" ] || [ "$temp" -gt "$max_temp" ]; then
            max_temp="$temp"
          fi
          ;;
      esac
      rp_watchdog_write_max "${max_temp:-unknown}"
      rp_watchdog_write_sentinel "$temp" "$RP_LAST_THERMAL" "${max_temp:-$temp}"
      return 0
    fi
    temp="$RP_LAST_TEMP_DECI"
    case "$temp" in
      ''|*[!0-9]*) ;;
      *)
        if [ -z "$max_temp" ] || [ "$temp" -gt "$max_temp" ]; then
          max_temp="$temp"
          rp_watchdog_write_max "$max_temp"
        fi
        ;;
    esac
    sleep "$RP_WATCHDOG_INTERVAL_SECONDS" &
    wait "$!" 2>/dev/null || true
  done
}

rp_watchdog_start() {
  rm -f "$RP_WATCHDOG_SENTINEL" "$RP_WATCHDOG_MAX_FILE" \
    "${RP_WATCHDOG_SENTINEL}.$$" "${RP_WATCHDOG_MAX_FILE}.$$"
  log "thermal watchdog: armed interval=${RP_WATCHDOG_INTERVAL_SECONDS}s warn=${RP_TEMP_WARN_DECI} deci-C stop=${RP_TEMP_STOP_DECI} deci-C thermal=${RP_THERMAL_STOP}"
  rp_watchdog_loop "$$" &
  RP_WATCHDOG_PID=$!
}

rp_sleep_watchdog() {
  local duration="$1" waited=0
  while [ "$waited" -lt "$duration" ]; do
    rp_watchdog_stop_requested && return 1
    sleep 1
    waited=$((waited + 1))
  done
  return 0
}

rp_abort_cycle_if_watchdog() {
  local i="$1"
  if rp_watchdog_stop_requested; then
    log "ending run during cycle $i — thermal watchdog stop"
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
# Exercised against a real phone 2026-09-18 (S23, 2 cycles). Cycle 1: the
# marker was found and the window closed on the real `{"op":"done"}` after
# 35s, sealing a 109.5s prefill inside it — the fixed sleep this replaced
# would have called that working prewarm no_work. Cycle 2: the budget
# expired and fg_settled went out anyway — CORRECTION (SIGPIPE, same day,
# numbers re-derived from the three 09-18 captures): "no terminal op
# arrived" was partly the old tail|grep -q shape lying, but not everywhere.
# The six kicks fall into three classes:
#   - 3 false negatives (093512 c2, 110132 c1, 110132 c2): the op was in
#     the capture 0.1-0.2 s after the marker (kv_holds_chat), yet the wait
#     burned its whole budget — every poll that saw the match died with 141.
#   - 1 true timeout (032436 c2): the op only landed at +151.6 s, past
#     expiry at +134.1 s. "did not settle" was correct there, and the awk
#     shape below says the same thing — the fix does not paper over a
#     genuine timeout.
#   - 2 correct detections (032436 c1: `{"op":"done"}` at +84.6 s — a
#     prewarm that really ran — settled at +85.3 s; 093512 c1 at +0.1 s,
#     settled 0.2 s): the first poll reached the match while only
#     sub-16 KB of logcat followed it, under the pipe capacity.
# Whether the old shape settled was decided by how much logcat accumulated
# after the op line before the first poll — not by anything the app did,
# and not by whether the app did work: 032436 c1's done proves it does.
rp_fg_wait_settled() {
  local i="$1" waited=0 line_from=""
  while [ "$waited" -lt "$FG_SETTLE_TIMEOUT_SECONDS" ]; do
    rp_watchdog_stop_requested && return 2
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
    rp_watchdog_stop_requested && return 2
    # grep -q on the consuming side of a pipe is a false-negative factory
    # under `set -uo pipefail`: grep exits at the first match, tail keeps
    # writing, the pipe fills, tail dies with SIGPIPE and the pipeline
    # returns 141 — the if takes the FALSE branch having found the line.
    # Measured on this host: exit flips 0 -> 141 between 8 KB and 16 KB
    # after the match (pipe capacity). In the 09-18 captures this decided
    # three kicks whose op line was already in the capture within 0.2 s of
    # the marker: their polls saw the match and died with 141 for the rest
    # of the budget. awk reads the file directly: one process, no pipe,
    # stops at the first matching line after the marker.
    if awk -v start="$line_from" '
      NR >= start && /"op":"(done|restore|skip)"/ { found = 1; exit }
      END { if (found) exit 0; exit 1 }
    ' "$OUT/logcat.txt" 2>/dev/null; then
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
  rp_sleep_watchdog "$FG_BOUNCE_SECONDS" || return 2
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
# Exercised against a real phone 2026-09-18 (Jelly Star): `adb shell log -p i
# -t KALSA_RP_MARK "probe=<nonce>"` was written and `adb logcat -d -s
# KALSA_RP_MARK` read it back on the first try — quoting and buffering hold.
rp_marker_probe() {
  local nonce="probe=$$-$(date +%s)" probe_dump=""
  adb shell log -p i -t KALSA_RP_MARK "$nonce" </dev/null >/dev/null 2>&1
  sleep 2
  # Same shape rule as rp_fg_wait_settled: grep -q downstream of a pipe
  # whose producer keeps writing (adb dumps the whole tagged buffer)
  # returns 141 once the bytes after the match exceed the pipe capacity,
  # and the probe would call a working marker channel broken. Read the
  # dump to completion, then match in-process.
  probe_dump=$(adb logcat -d -s KALSA_RP_MARK </dev/null 2>/dev/null || true)
  case "$probe_dump" in
    *"$nonce"*)
      log "marker probe ok ($nonce)"
      ;;
    *)
      log "marker probe FAILED: wrote '$nonce', never read it back"
      return 1
      ;;
  esac
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
  trap 'rp_watchdog_cleanup; kill '"$logcat_pid"' 2>/dev/null || true; device_termux_wakelock_restore; _device_session_restore' EXIT
  rp_watchdog_start

  for i in $(seq 1 "$CYCLES"); do
    if rp_watchdog_stop_requested || rp_should_stop; then
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
    if rp_abort_cycle_if_watchdog "$i"; then break; fi
    adb shell am start -n "$ACTIVITY" </dev/null >/dev/null 2>&1
    if ! rp_wait_ready; then
      if rp_abort_cycle_if_watchdog "$i"; then break; fi
      log "cycle $i: no Ready, aborting cycle"
      continue
    fi
    # Between Ready and the first send: the KV holds no chat yet, so the
    # re-kick must produce a real prewarm, not a kv_holds_chat skip.
    if [ "$FG_BOUNCE" = "1" ]; then rp_fg_bounce "$i"; fi
    if rp_abort_cycle_if_watchdog "$i"; then break; fi
    rp_state
    prev=$(device_history_assistant_count)
    case "$prev" in ''|*[!0-9]*) prev=0 ;; esac
    if ! device_share_send "${MESSAGES[$(( (i - 1) % ${#MESSAGES[@]} ))]}"; then
      log "cycle $i: send failed"
      if rp_abort_cycle_if_watchdog "$i"; then break; fi
      continue
    fi
    if ! rp_wait_reply "$prev"; then
      if rp_abort_cycle_if_watchdog "$i"; then break; fi
      log "cycle $i: reply timeout"
    fi
    rp_state
    sleep 5
  done

  sleep 5
  kill "$logcat_pid" 2>/dev/null || true
  # KALSA_KVPREFIX is the verdict: `n_common == embd` means the live cache was
  # reused whole, which on a hybrid is the only outcome that avoids a full
  # re-prefill (llama-memory-recurrent.cpp:194 / rn-completion.cpp:620-640).
  grep -E "KALSA_RP_MARK|KALSA_KVPREFIX|KALSA_KVREUSE|KALSA_KVDIAG|KALSA_KVRESUME|KALSA_KVDIVERGE|KALSA_PREWARM|KALSA_SESSION|KALSA_WINDOW_SLIDE|KALSA_TELEMETRY|restored state checkpoint|no usable state checkpoint|reusing [0-9]+/" \
    "$OUT/logcat.txt" > "$OUT/evidence.txt" || true
  log "evidence: $OUT/evidence.txt ($(wc -l < "$OUT/evidence.txt" | tr -d ' ') lines)"

  # State the verdict instead of leaving it in 2000 lines of logcat.
  node "$_RP_DIR/restoreVerdict.mjs" "$OUT/evidence.txt" | tee "$OUT/VERDICT.txt"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  rp_main "$@"
fi
