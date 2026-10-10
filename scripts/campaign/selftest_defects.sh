#!/usr/bin/env bash
# Host-only proofs for the three 2026-09-16 campaign-harness defects. A fake
# `adb` (selftest_fakedevice.sh) on PATH replays fixtures; no device is touched
# and no real logcat/turn timing is waited for.
#
#   bash scripts/campaign/selftest_defects.sh
#
# (a) a turn that keeps producing text but never emits KALSA_TELEMETRY is NOT
#     declared hang — one case per liveness signal (native lines, growing
#     reply, new assistant bubble) plus a frozen negative control that must
#     still be a hang;
# (b) a run whose completion signal never appears stops after turn 2, rc=4,
#     naming 'KALSA_TELEMETRY ';
# (c) every skip path in oneTurn.sh appends a RECOVERY-shaped record,
#     verified by reading the jsonl back.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# Reuse logcat's derived marker so fake-device fixtures cannot drift.
source "$HERE/logcat.sh"
source "$HERE/nativeLog.sh"
export CAMPAIGN_STARTUP_MARKER
CAMPAIGN_METRO_IN_FLIGHT_NEEDLE="$(sed -n '/POST_FIX_IN_FLIGHT_NEEDLE/{n;s/^[[:space:]]*"\([^"\\]*\)";[[:space:]]*$/\1/p;}' "$REPO/scripts/campaign/metroGate.mjs")"
if [ -z "$CAMPAIGN_METRO_IN_FLIGHT_NEEDLE" ]; then
  printf 'selftest_defects: gate in-flight needle is missing\n' >&2
  exit 1
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kalsa-defects.XXXXXX")"
ORIGINAL_PATH="$PATH"

# The one KALSA_TELEMETRY line the app emitted in 32,683 logcat lines on
# 2026-09-16 (out/t20c-gate-20260916/logcat.txt, 11:50:53.532).
TELEMETRY_LINE='-16 11:50:53.532 19312 19372 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"2","round":0,"tokensCached":2865,"tokensEvaluated":2662,"tokensPredicted":202,"draftTokens":0,"draftAccepted":0,"promptMs":8659.059,"predictedMs":21862.297,"predictedPerSecond":9.23965125896881,"contextFull":false,"interrupted":false,"prompt_n":282,"ciswireFlags":1}'

export FAKE_DEV="$WORK/device"
mkdir -p "$FAKE_DEV/fake" "$FAKE_DEV/databases" "$FAKE_DEV/data/local/tmp"
mkdir -p "$WORK/bin"
cp "$HERE/selftest_fakedevice.sh" "$WORK/bin/adb"
chmod +x "$WORK/bin/adb"
PATH="$WORK/bin:$PATH"
export PATH
if [ "$(command -v adb)" != "$WORK/bin/adb" ]; then
  printf 'selftest_defects: refusing to run because adb is not the fake at %s\n' "$WORK/bin/adb" >&2
  exit 1
fi

pass=0
fail=0
ok() { printf 'PASS: %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; fail=$((fail + 1)); }

# Screen-ON rule states (the fake answers wake for dozing, never for stuck).
screen_doze() { printf '%s\n' dozing > "$FAKE_DEV/fake/screen"; }
screen_unfocus() { printf '%s\n' other > "$FAKE_DEV/fake/focus"; }
screen_stuck() { printf '%s\n' stuck > "$FAKE_DEV/fake/screen"; }

cleanup() {
  pkill -f "$WORK" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  PATH="$ORIGINAL_PATH"
  export PATH
}
trap cleanup EXIT

# ── fake device fixtures ────────────────────────────────────────────────────
fake_reset() {
  local mode="$1" temp=350
  [ "$mode" = "hot" ] && temp=500
  case "$mode" in
    thermal-rise-fall|thermal-hard-abort|thermal-sustained-rise|thermal-unknown-power) temp=425 ;;
    thermal-giveup) temp=430 ;;
    thermal-status-abort) temp=420 ;;
  esac
  rm -rf "$FAKE_DEV/fake" "$FAKE_DEV/databases"
  mkdir -p "$FAKE_DEV/fake" "$FAKE_DEV/databases" "$FAKE_DEV/data/local/tmp"
  sqlite3 "$FAKE_DEV/databases/RKStorage" \
    'CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT);'
  printf '%s\n' "$mode" > "$FAKE_DEV/fake/mode"
  printf '%s' 4242 > "$FAKE_DEV/fake/pid"
  printf '%s' 4242 > "$FAKE_DEV/fake/pid_base"
  printf '%s\n' device > "$FAKE_DEV/fake/adb_state"
  printf '%s' 0 > "$FAKE_DEV/fake/turn"
  printf '%s' 0 > "$FAKE_DEV/fake/battery_reads"
  printf '%s\n' "$TELEMETRY_LINE" > "$FAKE_DEV/fake/telemetry.line"
  cat > "$FAKE_DEV/fake/battery.txt" <<EOF
  AC powered: false
  USB powered: false
  Wireless powered: false
  Dock powered: false
  status: 3
  level: 90
  temperature: $temp
EOF
  printf '%s\n' 'Thermal Status: 0' > "$FAKE_DEV/fake/thermalservice.txt"
  printf '%s\n' awake > "$FAKE_DEV/fake/screen"
  printf '%s\n' kalsa > "$FAKE_DEV/fake/focus"
  # S23 pre-run value: equal to ci-lib's KA ceiling, so keepawake's pure
  # restore decision takes its DELETE branch unless the harness overrides it.
  printf '%s\n' 86400000 > "$FAKE_DEV/fake/settings-timeout"
  # The NATIVE_VARIANT line is VERBATIM device evidence (S23 raw,
  # s23-governor-long-577867c0/campaign/logcat.txt): single-string emitters
  # log unquoted even on a debuggable APK.
  cat > "$FAKE_DEV/fake/stream.txt" <<'EOF'
09-16 12:00:00.000 4242 4243 I ReactNativeJS: KALSA_CTX_FLOOR n_ctx=8192
09-27 15:05:33.096 29885 29913 I ReactNativeJS: KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":{"prefill":99,"decode":0}}
09-16 12:00:00.020 4242 4243 I llama_context: n_ctx = 8192
EOF
  cat > "$FAKE_DEV/fake/ui.xml" <<'EOF'
<hierarchy>
<node class="android.widget.TextView" text="Pronto" bounds="[0,0][10,10]"/>
<node class="android.widget.EditText" text="Ask a question…" enabled="true" bounds="[0,100][900,200]"/>
<node class="android.widget.Button" text="Send" bounds="[900,2000][1000,2100]"/>
</hierarchy>
EOF
}

fake_force_stop_count() {
  if [ -f "$FAKE_DEV/fake/force-stops.log" ]; then
    wc -l < "$FAKE_DEV/fake/force-stops.log" | tr -d ' '
  else
    printf '0\n'
  fi
}

pidof_settled_case() {
  local out="$WORK/pidof-settled" dead transient garbage flap unknown live_then_empty live_after_probe garbage_after_probe
  local dead_reads transient_reads garbage_reads flap_reads garbage_log_lines status unknown_reads live_then_empty_reads live_after_probe_reads garbage_after_probe_reads
  mkdir -p "$out"
  fake_reset marker-turn1
  : > "$FAKE_DEV/fake/pid_dead_once"
  dead=$(PKG=com.kalsa.app bash -c 'log(){ :; }; sleep(){ :; }; source "$1/watchdog.sh"; campaign_pidof_settled' _ "$HERE")
  dead_reads=$(cat "$FAKE_DEV/fake/pidof_reads")
  fake_reset pid-blip
  transient=$(PKG=com.kalsa.app bash -c 'log(){ :; }; sleep(){ :; }; source "$1/watchdog.sh"; campaign_pidof_settled' _ "$HERE")
  transient_reads=$(cat "$FAKE_DEV/fake/pidof_reads")
  fake_reset pidof-garbage
  garbage=$(PKG=com.kalsa.app bash -c 'log(){ printf "%s\n" "$*" >> "$FAKE_DEV/fake/pidof-log"; }; sleep(){ :; }; source "$1/watchdog.sh"; campaign_pidof_settled' _ "$HERE" 2>"$out/garbage.stderr")
  garbage_reads=$(cat "$FAKE_DEV/fake/pidof_reads")
  garbage_log_lines=$(wc -l < "$FAKE_DEV/fake/pidof-log" | tr -d ' ')
  fake_reset pidof-flap
  flap=$(PKG=com.kalsa.app bash -c 'log(){ :; }; sleep(){ :; }; source "$1/watchdog.sh"; campaign_pidof_settled' _ "$HERE")
  flap_reads=$(cat "$FAKE_DEV/fake/pidof_reads")
  fake_reset pidof-transport-fail
  unknown=$(PKG=com.kalsa.app bash -c 'log(){ :; }; sleep(){ :; }; source "$1/watchdog.sh"; campaign_pidof_settled' _ "$HERE")
  unknown_reads=$(cat "$FAKE_DEV/fake/pidof_reads")
  fake_reset pidof-live-then-empty-probe-fail
  live_then_empty=$(PKG=com.kalsa.app bash -c 'log(){ :; }; sleep(){ :; }; source "$1/watchdog.sh"; campaign_pidof_settled' _ "$HERE")
  live_then_empty_reads=$(cat "$FAKE_DEV/fake/pidof_reads")
  fake_reset pidof-live-after-probe
  live_after_probe=$(PKG=com.kalsa.app bash -c 'log(){ :; }; sleep(){ :; }; source "$1/watchdog.sh"; campaign_pidof_settled' _ "$HERE")
  live_after_probe_reads=$(cat "$FAKE_DEV/fake/pidof_reads")
  fake_reset pidof-garbage-after-probe
  garbage_after_probe=$(PKG=com.kalsa.app bash -c 'log(){ :; }; sleep(){ :; }; source "$1/watchdog.sh"; campaign_pidof_settled' _ "$HERE" 2>"$out/post-probe-garbage.stderr")
  garbage_after_probe_reads=$(cat "$FAKE_DEV/fake/pidof_reads")
  fake_reset pidof-garbage
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    CAMPAIGN_TURN_TIMEOUT_MS=1 CAMPAIGN_TELEMETRY_GAP_MS=1 CAMPAIGN_POLL_MS=1
    log() { :; }
    sleep() { :; }
    source "$REPO/scripts/ci-lib.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/turn.sh"
    campaign_logcat_start "$out/garbage-logcat.txt"
    campaign_wait_turn 0 "$out/garbage-slice.txt" 0 || :
    printf '%s' "$CAMPAIGN_TURN_STATUS" > "$out/garbage-status.txt"
    campaign_logcat_stop
  ) > "$out/garbage-wait.log" 2>&1
  garbage_status=$(cat "$out/garbage-status.txt" 2>/dev/null || printf missing)
  fake_reset marker-turn1
  : > "$FAKE_DEV/fake/pid_dead_once"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/turn.sh"
    campaign_logcat_start "$out/logcat.txt"
    campaign_wait_turn 0 "$out/dead-slice.txt" 0
    printf '%s' "$CAMPAIGN_TURN_STATUS" > "$out/status.txt"
    campaign_logcat_stop
  ) > "$out/wait.log" 2>&1
  status=$(cat "$out/status.txt" 2>/dev/null || printf missing)
  if [ -z "$dead" ] && [ "$dead_reads" -eq 4 ] && [ "$transient" = 4242 ] \
    && [ "$transient_reads" -eq 3 ] && [ "$garbage" = unknown ] && [ "$garbage_reads" -eq 6 ] \
    && [ "$garbage_log_lines" -eq 1 ] \
    && [ "$flap" = 4242 ] && [ "$flap_reads" -eq 6 ] && [ "$garbage_status" != pid-death ] \
    && [ "$unknown" = unknown ] && [ "$unknown_reads" -eq 3 ] \
    && [ "$live_then_empty" = unknown ] && [ "$live_then_empty_reads" -eq 4 ] \
    && [ "$live_after_probe" = 4242 ] && [ "$live_after_probe_reads" -eq 4 ] \
    && [ "$garbage_after_probe" = unknown ] && [ "$garbage_after_probe_reads" -eq 4 ] \
    && [ "$status" = pid-death ]; then
    ok "pidof re-reads after a healthy probe and keeps failed or malformed reads unknown"
  else
    bad "pidof settle wrong (dead='${dead:-empty}'/$dead_reads transient=$transient/$transient_reads garbage=$garbage/$garbage_reads logs=$garbage_log_lines flap=$flap/$flap_reads unknown=$unknown/$unknown_reads live_then_empty=$live_then_empty/$live_then_empty_reads live_after_probe=$live_after_probe/$live_after_probe_reads garbage_after_probe=$garbage_after_probe/$garbage_after_probe_reads status=$garbage_status death=$status)"
  fi
}

abort_turn_allow_list_case() {
  local out="$WORK/abort-turn-allow-list" impl reason expected force_stops failed=0
  rm -rf "$out"; mkdir -p "$out"
  sed -n '/^campaign_abort_turn() {/,/^}/p' "$HERE/run-t20c.sh" > "$out/run-t20c-abort.sh"
  sed -n '/^campaign_abort_turn() {/,/^}/p' "$HERE/watchdog.sh" > "$out/watchdog-abort.sh"
  for impl in run-t20c-abort watchdog-abort; do
    for reason in adb-drop failed-missing-post-crash-resume-adb-drop thermal timeout; do
      expected=0
      [ "$reason" = timeout ] && expected=1
      fake_reset normal
      (
        export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
        export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
        source "$REPO/scripts/ci-lib.sh"
        source "$HERE/flags.sh"
        source "$out/$impl.sh"
        campaign_record_recovery() { :; }
        campaign_abort_turn "$reason"
      ) > "$out/$impl-$reason.log" 2>&1
      force_stops=$(fake_force_stop_count)
      if [ "$force_stops" -ne "$expected" ]; then
        bad "campaign_abort_turn ($impl) reason=$reason force_stops=$force_stops want $expected"
        failed=1
      fi
    done
  done
  [ "$failed" -eq 0 ] && ok "both campaign_abort_turn copies spare the app on adb-drop (bare and compound) and thermal"
}

adb_drop_flap_case() {
  local out="$WORK/adb-drop-flap" rc state_reads pid_reads force_stops status
  rm -rf "$out"; mkdir -p "$out"
  fake_reset state-flap
  sed -n '/^campaign_abort_turn() {/,/^}/p' "$HERE/run-t20c.sh" > "$out/abort-turn.sh"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    export CAMPAIGN_TURN_I=3 CAMPAIGN_ARM_ID= CAMPAIGN_VARIANT_ID= CAMPAIGN_CONV_ID=
    source "$REPO/scripts/ci-lib.sh"
    source "$HERE/flags.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    source "$HERE/oneTurn.sh"
    source "$out/abort-turn.sh"
    die() { printf 'DIE: %s\n' "$*" >&2; exit 7; }
    sleep() { :; }
    campaign_toolcall_quiet_ms() { printf '0\n'; }
    campaign_logcat_ensure() { :; }
    campaign_logcat_slice() { :; }
    campaign_logcat_on_reconnect() { :; }
    campaign_turn_tool_state() { printf 'none\n'; }
    campaign_restore_same_conv() { :; }
    campaign_wait_turn 0 "$out/slice.txt" 0 || :
    printf '%s\n' "$CAMPAIGN_TURN_STATUS" > "$out/status.txt"
    campaign_abort_turn "$CAMPAIGN_TURN_STATUS"
    campaign_recover_status "$CAMPAIGN_TURN_STATUS"
  ) > "$out/run.log" 2>&1
  rc=$?
  state_reads=$(cat "$FAKE_DEV/fake/state_reads" 2>/dev/null || printf 0)
  pid_reads=$(cat "$FAKE_DEV/fake/pidof_reads" 2>/dev/null || printf 0)
  force_stops=$(fake_force_stop_count)
  status=$(cat "$out/status.txt" 2>/dev/null || printf missing)
  if [ "$rc" -eq 0 ] && [ "$status" = adb-drop ] && [ "$state_reads" -eq 2 ] \
    && [ "$pid_reads" -eq 2 ] && [ "$force_stops" -eq 0 ]; then
    ok "adb-drop waits through a transport flap, rechecks PID, and never force-stops"
  else
    bad "adb-drop flap recovery wrong (rc=$rc status=$status state_reads=$state_reads pid_reads=$pid_reads force_stops=$force_stops)"
    tail -5 "$out/run.log" | sed 's/^/   | /'
  fi
}

adb_drop_verdict_case() {
  local out="$WORK/adb-drop-verdict" rc force_stops reads
  rm -rf "$out"; mkdir -p "$out"
  fake_reset pidof-transport-fail
  (
    export OUT="$out/unknown" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555 CAMPAIGN_TURN_I=3
    source "$REPO/scripts/ci-lib.sh"
    source "$HERE/flags.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/oneTurn.sh"
    die() { printf 'DIE: %s\n' "$*" >&2; exit 7; }
    campaign_logcat_on_reconnect() { :; }
    campaign_recover_pid_death() { : > "$out/unknown-pid-death-called"; }
    campaign_recover_status adb-drop
  ) > "$out/unknown.log" 2>&1
  rc=$?
  force_stops=$(fake_force_stop_count)
  if [ "$rc" -eq 7 ] && [ ! -e "$out/unknown-pid-death-called" ] \
    && [ "$force_stops" -eq 0 ] && grep -q 'process state stayed unknown.*without force-stop' "$out/unknown.log"; then
    ok "adb-drop with unknown PID aborts without entering pid-death recovery"
  else
    bad "adb-drop unknown verdict was not fail-closed (rc=$rc force_stops=$force_stops)"
    tail -5 "$out/unknown.log" | sed 's/^/   | /'
  fi

  fake_reset marker-turn1
  : > "$FAKE_DEV/fake/pid_dead_once"
  (
    export OUT="$out/dead" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555 CAMPAIGN_TURN_I=3
    source "$REPO/scripts/ci-lib.sh"
    source "$HERE/flags.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/oneTurn.sh"
    campaign_logcat_on_reconnect() { :; }
    campaign_recover_pid_death() { : > "$out/dead-pid-death-called"; }
    campaign_recover_status adb-drop
  ) > "$out/dead.log" 2>&1
  rc=$?
  reads=$(cat "$FAKE_DEV/fake/pidof_reads" 2>/dev/null || printf 0)
  force_stops=$(fake_force_stop_count)
  if [ "$rc" -eq 0 ] && [ -e "$out/dead-pid-death-called" ] \
    && [ "$reads" -eq 4 ] && [ "$force_stops" -eq 0 ]; then
    ok "adb-drop enters pid-death recovery only after a settled empty PID"
  else
    bad "adb-drop settled-death verdict wrong (rc=$rc reads=$reads force_stops=$force_stops)"
    tail -5 "$out/dead.log" | sed 's/^/   | /'
  fi
}

adb_drop_offline_case() {
  local out="$WORK/adb-drop-offline" rc force_stops connects
  rm -rf "$out"; mkdir -p "$out"
  fake_reset marker-turn1
  printf '%s\n' offline > "$FAKE_DEV/fake/adb_state"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555 CAMPAIGN_TURN_I=3
    source "$REPO/scripts/ci-lib.sh"
    source "$HERE/flags.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/oneTurn.sh"
    die() { printf 'DIE: %s\n' "$*" >&2; exit 7; }
    sleep() { :; }
    campaign_logcat_on_reconnect() { :; }
    campaign_recover_status adb-drop
  ) > "$out/run.log" 2>&1
  rc=$?
  force_stops=$(fake_force_stop_count)
  connects=$(grep -c '^connect fake:5555$' "$FAKE_DEV/fake/invocations.log" || true)
  if [ "$rc" -eq 7 ] && [ "$connects" -eq 5 ] && [ "$force_stops" -eq 0 ] \
    && grep -q 'device lost turn 3; aborting without force-stop' "$out/run.log"; then
    ok "adb-drop aborts after bounded reconnect failure without force-stop"
  else
    bad "adb-drop offline path did not abort safely (rc=$rc connects=$connects force_stops=$force_stops)"
    tail -5 "$out/run.log" | sed 's/^/   | /'
  fi
}

mdns_serial_case() {
  local out="$WORK/mdns-serial" rc ip_found service_found ip_reconnect service_reconnect
  rm -rf "$out"; mkdir -p "$out"
  fake_reset marker-turn1
  cat > "$FAKE_DEV/fake/mdns-services.txt" <<'EOF'
adb-OTHER-000._adb-tls-connect._tcp. 192.168.1.152:11111
adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp. 192.168.1.153:43089
EOF
  (
    export CAMPAIGN_SERIAL=192.168.1.152:5555 ANDROID_SERIAL=192.168.1.152:5555
    source "$HERE/recovery.sh"
    log() { :; }
    campaign_logcat_on_reconnect() { :; }
    ip_found=$(campaign_mdns_for_serial "$CAMPAIGN_SERIAL")
    CAMPAIGN_SERIAL=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
    ANDROID_SERIAL="$CAMPAIGN_SERIAL"
    service_found=$(campaign_mdns_for_serial "$CAMPAIGN_SERIAL")
    campaign_adb_state() { printf 'offline\n'; }
    campaign_connect() {
      printf '%s\n' "$1" >> "$out/connect.log"
      case "$1" in
        192.168.1.152:11111|192.168.1.153:43089) return 0 ;;
        *) return 1 ;;
      esac
    }
    CAMPAIGN_SERIAL=192.168.1.152:5555
    ANDROID_SERIAL="$CAMPAIGN_SERIAL"
    campaign_ensure_device || exit 3
    ip_reconnect=$(tail -1 "$out/connect.log")
    : > "$out/connect.log"
    CAMPAIGN_SERIAL=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
    ANDROID_SERIAL="$CAMPAIGN_SERIAL"
    campaign_ensure_device || exit 4
    service_reconnect=$(tail -1 "$out/connect.log")
    printf '%s\n' "$ip_found|$service_found|$ip_reconnect|$service_reconnect" > "$out/result.txt"
  ) > "$out/run.log" 2>&1
  rc=$?
  local result
  result=$(cat "$out/result.txt" 2>/dev/null || printf missing)
  if [ "$rc" -eq 0 ] \
    && [ "$result" = '192.168.1.152:11111|192.168.1.153:43089|192.168.1.152:11111|192.168.1.153:43089' ]; then
    ok "mDNS recovery resolves both configured IP and service-name serials"
  else
    bad "mDNS serial recovery wrong (rc=$rc result=$result)"
    tail -5 "$out/run.log" | sed 's/^/   | /'
  fi
}

unknown_turn_health_case() {
  local out="$WORK/unknown-turn-health" rc reads force_stops
  rm -rf "$out"; mkdir -p "$out"
  fake_reset pidof-transport-fail
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555 CAMPAIGN_TURN_I=5
    source "$REPO/scripts/ci-lib.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/turn.sh"
    die() { printf 'DIE: %s\n' "$*" >&2; exit 7; }
    sleep() { :; }
    campaign_logcat_ensure() { :; }
    campaign_logcat_slice() { :; }
    campaign_toolcall_quiet_ms() { printf '0\n'; }
    campaign_turn_tool_state() { printf 'none\n'; }
    campaign_wait_turn 0 "$out/slice.txt" 0
    rc=$?
    printf 'STATUS=%s\n' "$CAMPAIGN_TURN_STATUS"
    exit "$rc"
  ) > "$out/run.log" 2>&1
  rc=$?
  reads=$(cat "$FAKE_DEV/fake/pidof_reads" 2>/dev/null || printf 0)
  force_stops=$(fake_force_stop_count)
  if [ "$rc" -eq 1 ] && [ "$reads" -eq 15 ] && [ "$force_stops" -eq 0 ] \
    && grep -q '^STATUS=adb-drop$' "$out/run.log" \
    && grep -q 'unknown for 5 consecutive health rounds; reconnecting adb' "$out/run.log"; then
    ok "five unknown turn health rounds hand over to adb-drop recovery without force-stop"
  else
    bad "unknown turn health did not abort safely (rc=$rc pid_reads=$reads force_stops=$force_stops)"
    tail -5 "$out/run.log" | sed 's/^/   | /'
  fi
}

unknown_pid_callers_case() {
  local out="$WORK/unknown-pid-callers" rc force_stops
  rm -rf "$out"; mkdir -p "$out"
  fake_reset pidof-transport-fail
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/conversation.sh"
    source "$HERE/watchdog.sh"
    CAMPAIGN_LAUNCHED_PID=4242
    sleep() { :; }
    campaign_ensure_launch_pid
  ) > "$out/conversation-ensure.log" 2>&1
  rc=$?
  force_stops=$(fake_force_stop_count)
  if [ "$rc" -ne 0 ] && [ "$force_stops" -eq 0 ] \
    && grep -q 'process state stayed unknown.*without force-stop' "$out/conversation-ensure.log"; then
    ok "share preflight aborts on bounded unknown state without force-stop"
  else
    bad "share preflight acted on unknown state (rc=$rc force_stops=$force_stops)"
    tail -5 "$out/conversation-ensure.log" | sed 's/^/   | /'
  fi

  fake_reset pidof-transport-fail
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    sleep() { :; }
    campaign_launch() { :; }
    campaign_reinstall_r() { : > "$out/reinstalled"; }
    campaign_relaunch_or_reinstall
  ) > "$out/recovery-relaunch.log" 2>&1
  rc=$?
  force_stops=$(fake_force_stop_count)
  if [ "$rc" -ne 0 ] && [ "$force_stops" -eq 0 ] && [ ! -e "$out/reinstalled" ] \
    && grep -q 'process state stayed unknown.*without reinstall or force-stop' "$out/recovery-relaunch.log"; then
    ok "recovery aborts on bounded unknown state without reinstall or force-stop"
  else
    bad "recovery acted on unknown state (rc=$rc force_stops=$force_stops)"
    tail -5 "$out/recovery-relaunch.log" | sed 's/^/   | /'
  fi

  fake_reset pidof-transport-fail
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/conversation.sh"
    sleep() { :; }
    campaign_restore_same_conv
  ) > "$out/conversation-restore.log" 2>&1
  rc=$?
  force_stops=$(fake_force_stop_count)
  if [ "$rc" -ne 0 ] && [ "$force_stops" -eq 0 ] \
    && grep -q 'process state stayed unknown.*without force-stop' "$out/conversation-restore.log"; then
    ok "same-conversation recovery aborts on unknown state without force-stop"
  else
    bad "same-conversation recovery acted on unknown state (rc=$rc force_stops=$force_stops)"
    tail -5 "$out/conversation-restore.log" | sed 's/^/   | /'
  fi

  fake_reset pidof-transport-fail
  sed -n '/^campaign_restore_same_conv() {/,/^}/p' "$HERE/run-t20c.sh" > "$out/t20c-restore.sh"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    source "$REPO/scripts/ci-lib.sh"
    campaign_app_running() { return 2; }
    campaign_force_stop() { : > "$FAKE_DEV/fake/force-stops.log"; }
    campaign_write_flags() { :; }
    campaign_launch() { :; }
    campaign_wait_ready() { :; }
    source "$out/t20c-restore.sh"
    campaign_restore_same_conv
  ) > "$out/t20c-restore.log" 2>&1
  rc=$?
  force_stops=$(fake_force_stop_count)
  if [ "$rc" -ne 0 ] && [ "$force_stops" -eq 0 ] \
    && grep -q 'process state stayed unknown.*without force-stop' "$out/t20c-restore.log"; then
    ok "T20C thermal restore aborts on unknown state without force-stop"
  else
    bad "T20C thermal restore acted on unknown state (rc=$rc force_stops=$force_stops)"
    tail -5 "$out/t20c-restore.log" | sed 's/^/   | /'
  fi
}

sql_write_state_gate_case() {
  local out="$WORK/sql-state-gate" garbage_rc garbage_reads blank_rc blank_reads blip_rc reads settled_rc settled_reads settled_value after_blank_rc after_blank_reads
  mkdir -p "$out"
  fake_reset sql-read-garbage
  ( export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device; source "$REPO/scripts/ci-lib.sh"; die() { exit 9; }; sql_write "SELECT 1;" x y ) >"$out/garbage.log" 2>&1
  garbage_rc=$?
  garbage_reads=$(cat "$FAKE_DEV/fake/app-state-reads" 2>/dev/null || printf 0)
  fake_reset sql-read-blank
  ( export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device; source "$REPO/scripts/ci-lib.sh"; die() { exit 9; }; sql_write "SELECT 1;" x y ) >"$out/blank.log" 2>&1
  blank_rc=$?
  blank_reads=$(cat "$FAKE_DEV/fake/app-state-reads" 2>/dev/null || printf 0)
  fake_reset sql-read-blip
  ( export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device; source "$REPO/scripts/ci-lib.sh"; die() { exit 9; }; sql_write "SELECT 1;" x y ) >"$out/blip.log" 2>&1
  blip_rc=$?
  reads=$(cat "$FAKE_DEV/fake/app-state-reads" 2>/dev/null || printf 0)
  fake_reset sql-read-settled
  ( export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device; source "$REPO/scripts/ci-lib.sh"; die() { exit 9; }; sql_write "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('sql-settled-test','written');" sql-settled-test written ) >"$out/settled.log" 2>&1
  settled_rc=$?
  settled_reads=$(cat "$FAKE_DEV/fake/app-state-reads" 2>/dev/null || printf 0)
  settled_value=$(sqlite3 "$FAKE_DEV/databases/RKStorage" "SELECT value FROM catalystLocalStorage WHERE key='sql-settled-test';")
  fake_reset sql-after-write-blank
  ( export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device; source "$REPO/scripts/ci-lib.sh"; die() { exit 9; }; sql_write "SELECT 1;" x y ) >"$out/after-blank.log" 2>&1
  after_blank_rc=$?
  after_blank_reads=$(cat "$FAKE_DEV/fake/app-state-reads" 2>/dev/null || printf 0)
  if [ "$garbage_rc" -eq 9 ] && [ "$garbage_reads" -eq 3 ] \
    && [ "$blank_rc" -eq 9 ] && [ "$blank_reads" -eq 3 ] \
    && [ "$blip_rc" -eq 9 ] && [ "$reads" -eq 2 ] && [ "$settled_rc" -eq 0 ] \
    && [ "$settled_reads" -eq 6 ] && [ "$settled_value" = written ] \
    && [ "$after_blank_rc" -eq 9 ] && [ "$after_blank_reads" -eq 6 ]; then
    ok "SQL gates require three settled reads before and after a database write"
  else
    bad "device SQL gate wrong (garbage_rc=$garbage_rc garbage_reads=$garbage_reads blank_rc=$blank_rc blank_reads=$blank_reads blip_rc=$blip_rc blip_reads=$reads settled_rc=$settled_rc settled_reads=$settled_reads value=$settled_value after_blank_rc=$after_blank_rc after_blank_reads=$after_blank_reads)"
  fi
}

fake_force_stop_markers_case() {
  fake_reset vanish
  : > "$FAKE_DEV/fake/pid_dead_once"
  : > "$FAKE_DEV/fake/vanished"
  adb shell am force-stop com.kalsa.app
  local force_stops
  force_stops=$(fake_force_stop_count)
  if [ -f "$FAKE_DEV/fake/pid_dead_once" ] && [ -f "$FAKE_DEV/fake/vanished" ] \
    && [ "$force_stops" -eq 1 ]; then
    ok "fake force-stop preserves crash and vanish markers until relaunch"
  else
    bad "fake force-stop erased its crash oracle (force_stops=$force_stops)"
  fi
}

pidof_settled_case
adb_drop_flap_case
abort_turn_allow_list_case
adb_drop_verdict_case
adb_drop_offline_case
mdns_serial_case
unknown_turn_health_case
unknown_pid_callers_case
sql_write_state_gate_case
fake_force_stop_markers_case

t20c_config_flags_case() {
  local out="$WORK/t20c-g2-flags" no_flags="$WORK/t20c-no-flags" serial rc
  fake_reset marker-turn1
  mkdir -p "$out"
  serial=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["device"])' "$REPO/campaigns/t20c-g2.json")
  env FAKE_DEV="$FAKE_DEV" PKG=com.kalsa.app BENCH_TARGET=device \
    ANDROID_SERIAL="$serial" OUT="$out" CAMPAIGN_CONFIG="$REPO/campaigns/t20c-g2.json" \
    CAMPAIGN_STARTUP_MARKER="$CAMPAIGN_STARTUP_MARKER" CAMPAIGN_METRO_BUNDLE_URL= \
    bash "$HERE/run-t20c.sh" > "$out/run.log" 2>&1
  rc=$?
  if [ "$serial" = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp" ] \
    && [ "$rc" -eq 1 ] \
    && grep -Fq 'T20C config flags compaction=anchored memory=0 toolhelp=0' "$out/run.log" \
    && grep -Fq 'JavaScript provenance gate failed before any device operation; set CAMPAIGN_METRO_BUNDLE_URL' "$out/run.log" \
    && ! grep -Fq 'ANDROID_SERIAL must be exactly' "$out/run.log" \
    && ! grep -Fq 'battery preflight' "$out/run.log"; then
    ok "G2 flags load and its mDNS serial passes the exact check before the expected Metro gate refusal"
  else
    bad "G2 config preflight wrong (rc=$rc serial=$serial)"
    tail -5 "$out/run.log" | sed 's/^/   | /'
  fi
  mkdir -p "$no_flags/t20c" "$no_flags/out"
  cp "$REPO/campaigns/t20c/script.json" "$no_flags/t20c/script.json"
  python3 - "$REPO/campaigns/t20c-g2.json" "$no_flags/config.json" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
cfg.pop("arms", None)
json.dump(cfg, open(sys.argv[2], "w", encoding="utf-8"))
PY
  env FAKE_DEV="$FAKE_DEV" PKG=com.kalsa.app BENCH_TARGET=device \
    ANDROID_SERIAL="$serial" OUT="$no_flags/out" CAMPAIGN_CONFIG="$no_flags/config.json" \
    CAMPAIGN_STARTUP_MARKER="$CAMPAIGN_STARTUP_MARKER" CAMPAIGN_METRO_BUNDLE_URL= \
    bash "$HERE/run-t20c.sh" > "$no_flags/out/run.log" 2>&1
  rc=$?
  if [ "$rc" -eq 2 ] && grep -Fq 'has no complete T20C arm flags' "$no_flags/out/run.log"; then
    ok "run-t20c refuses a config without arm flags"
  else
    bad "run-t20c did not refuse missing arm flags (rc=$rc)"
  fi
}

t20c_config_flags_case

assistant_count_failure_case() {
  local out="$WORK/assistant-count-failure" failed malformed wait_rc status
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    sql() {
      case "$1" in
        *"$CONVERSATIONS_INDEX_KEY"*) printf '\n' ;;
        *) return 1 ;;
      esac
    }
    failed=$(device_history_assistant_count)
    printf '%s\n' "$failed" > "$out/failed.txt"
    sql() {
      case "$1" in
        *"$CONVERSATIONS_INDEX_KEY"*) printf '\n' ;;
        *) printf '%s\n' '{broken json' ;;
      esac
    }
    malformed=$(device_history_assistant_count)
    printf '%s\n' "$malformed" > "$out/malformed.txt"
    source "$HERE/turn.sh"
    CAMPAIGN_TURN_I=7
    campaign_logcat_ensure() { :; }
    campaign_logcat_slice() { :; }
    campaign_turn_tool_state() { printf '%s\n' exhausted; }
    campaign_adb_state() { printf '%s\n' device; }
    campaign_pidof_settled() { printf '%s\n' 4242; }
    campaign_assistant_count() { printf '%s\n' err; }
    CAMPAIGN_TURN_TIMEOUT_MS=1 CAMPAIGN_TOOLCALL_QUIET_MS=0
    campaign_wait_turn 0 "$out/slice.txt" 0
    wait_rc=$?
    printf '%s\n' "$wait_rc" > "$out/wait-rc.txt"
    printf '%s\n' "$CAMPAIGN_TURN_STATUS" > "$out/status.txt"
  ) > "$out/count.log" 2>&1
  failed=$(cat "$out/failed.txt" 2>/dev/null || printf missing)
  malformed=$(cat "$out/malformed.txt" 2>/dev/null || printf missing)
  wait_rc=$(cat "$out/wait-rc.txt" 2>/dev/null || printf missing)
  status=$(cat "$out/status.txt" 2>/dev/null || printf missing)
  if [ "$failed" = err ] && [ "$malformed" = err ] \
    && [ "$wait_rc" -ne 0 ] && [ "$status" = db-read-error ]; then
    ok "failed and malformed assistant counts stay err and cannot complete a toolcap turn"
  else
    bad "assistant count failure was treated as completion (failed=$failed malformed=$malformed rc=$wait_rc status=$status)"
    tail -5 "$out/count.log" | sed 's/^/   | /'
  fi
}

stale_toolcap_status_case() {
  local out="$WORK/stale-toolcap-status" status
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" SCRIPT="$REPO/campaigns/t20c/script.json"
    source "$HERE/oneTurn.sh"
    campaign_assistant_count() { printf '%s\n' 0; }
    campaign_logcat_offset() { printf '%s\n' 0; }
    campaign_send_turn() { return 1; }
    campaign_record_recovery() { printf '%s\n' "$1" > "$out/recovery.txt"; }
    log() { :; }
    sleep() { :; }
    CAMPAIGN_TURN_STATUS=toolcap
    campaign_one_turn 1 'stale status reset probe'
    printf '%s\n' "${CAMPAIGN_TURN_STATUS:-empty}" > "$out/status.txt"
  ) > "$out/turn.log" 2>&1
  status=$(cat "$out/status.txt" 2>/dev/null || printf missing)
  if [ "$status" = empty ] && [ "$(cat "$out/recovery.txt" 2>/dev/null)" = send-failed ]; then
    ok "oneTurn clears a stale toolcap status before retry and the completion-signal gate"
  else
    bad "oneTurn retained stale toolcap status (status=$status)"
    tail -5 "$out/turn.log" | sed 's/^/   | /'
  fi
}

assistant_count_failure_case

one_turn_unreadable_count_case() {
  local out="$WORK/one-turn-unreadable-count" stage rc sends expected
  rm -rf "$out"; mkdir -p "$out"
  for stage in before wait retry; do
    mkdir -p "$out/$stage"
    (
      export OUT="$out/$stage" SCRIPT="$REPO/campaigns/t20c/script.json"
      export CAMPAIGN_ARM_ID=T20C CAMPAIGN_VARIANT_ID=V1 CAMPAIGN_CONV_ID=c1-V1
      source "$HERE/oneTurn.sh"
      die() { printf 'DIE: %s\n' "$*" >&2; exit 7; }
      log() { :; }
      sleep() { :; }
      send_count=0
      campaign_assistant_count() {
        case "$stage" in
          before) printf 'err\n' ;;
          wait) printf '0\n' ;;
          retry)
            if [ -n "${CAMPAIGN_RETRIED:-}" ]; then printf 'err\n'; else printf '0\n'; fi
            ;;
        esac
      }
      campaign_logcat_offset() { printf '0\n'; }
      campaign_send_turn() { send_count=$((send_count + 1)); printf '%s\n' "$send_count" > "$OUT/send-count"; return 0; }
      campaign_wait_turn() {
        if [ "$stage" = wait ]; then CAMPAIGN_TURN_STATUS=db-read-error; else CAMPAIGN_TURN_STATUS=pid-death; fi
        return 1
      }
      campaign_record_recovery() { :; }
      campaign_abort_turn() { :; }
      campaign_recover_status() { :; }
      campaign_user_landed() { return 1; }
      campaign_one_turn 4 'unreadable assistant count probe'
    ) > "$out/$stage/run.log" 2>&1
    rc=$?
    sends=$(cat "$out/$stage/send-count" 2>/dev/null || printf 0)
    case "$stage" in
      before) expected='assistant count unreadable before turn 4; aborting before send';;
      wait) expected='assistant count unreadable turn 4; aborting without force-stop or completion record';;
      retry) expected='assistant count unreadable before retry turn 4; aborting before resend';;
    esac
    if [ "$rc" -ne 7 ] || ! grep -Fq "$expected" "$out/$stage/run.log"; then
      bad "oneTurn $stage unreadable count did not die at its guard (rc=$rc)"
      tail -5 "$out/$stage/run.log" | sed 's/^/   | /'
      return
    fi
    if [ "$stage" = before ] && [ "$sends" -ne 0 ]; then
      bad "oneTurn before-send unreadable count sent a message"
      return
    fi
    if [ "$stage" != before ] && [ "$sends" -ne 1 ]; then
      bad "oneTurn $stage unreadable count sent an unexpected number of messages ($sends)"
      return
    fi
  done
  ok "oneTurn dies on unreadable counts before send, during wait, and before retry"
}

acceptance_stats_encoding_case() {
  local out="$WORK/acceptance-stats-encoding" stats rc
  rm -rf "$out"; mkdir -p "$out"
  printf '%s\n\n' '{"i":1}' > "$out/input.jsonl"
  printf '\377\n' >> "$out/input.jsonl"
  stats=$(python3 "$HERE/acceptanceStats.py" "$out/input.jsonl" 2>"$out/stderr")
  rc=$?
  if [ "$rc" -eq 0 ] && [ "$stats" = '1 0 0 0 1' ]; then
    ok "acceptance stats count invalid UTF-8 as unparseable and skip blank lines"
  else
    bad "acceptance stats encoding handling wrong (rc=$rc stats=$stats)"
    tail -5 "$out/stderr" | sed 's/^/   | /'
  fi
}

one_turn_unreadable_count_case
acceptance_stats_encoding_case
stale_toolcap_status_case

db_put_messages() {
  python3 - "$FAKE_DEV/databases/RKStorage" "$1" <<'PY'
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute(
    "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES (?,?)",
    ("kalsa.messages.v1", open(sys.argv[2], encoding="utf-8").read()),
)
conn.commit()
PY
}

# make_messages <path> <n_assistant> <assistant_len>
make_messages() {
  python3 -c '
import json, sys
path, n_asst, asst_len = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
msgs = [{"role": "user", "text": "domanda"}]
for k in range(n_asst):
    msgs.append({"role": "assistant", "text": ("r%d " % k) + "x" * asst_len})
json.dump(msgs, open(path, "w", encoding="utf-8"))
' "$1" "$2" "$3"
}

# jsonl_reason <jsonl> <i> <reason> — exit 0 only when a RECOVERY-shaped record
# for turn <i> with <reason> is on disk.
jsonl_reason() {
  python3 -c '
import json, sys
path, want_i, want_reason = sys.argv[1], int(sys.argv[2]), sys.argv[3]
rows = []
try:
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            rows.append(json.loads(line))
except OSError:
    pass
hit = [
    r for r in rows
    if r.get("event") == "RECOVERY"
    and r.get("reason") == want_reason
    and r.get("i") == want_i
    and r.get("scores") is None
    and r.get("arm") == "T20C"
    and r.get("variant") == "V1"
    and r.get("conv") == "c1-V1"
]
print("records=%d summary=%s" % (len(rows), " ".join(
    "%s/%s%s" % (r.get("i"), r.get("event", "TURN"), "/" + str(r.get("reason")) if r.get("reason") else "")
    for r in rows)))
sys.exit(0 if len(hit) == 1 else 1)
' "$1" "$2" "$3"
}

hard_abort_recovery_case() {
  local out="$WORK/hard-abort-recovery" rc
  fake_reset hot
  rm -rf "$out"
  mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    export CAMPAIGN_ROOT="$HERE" CAMPAIGN_ARM_ID=T20C CAMPAIGN_VARIANT_ID=V1 CAMPAIGN_CONV_ID=c1-V1
    export SCRIPT="$REPO/campaigns/t20c/script.json"
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/conversation.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    source "$HERE/oneTurn.sh"
    campaign_send_turn() { CAMPAIGN_TURN_STATUS=thermal; return 1; }
    campaign_thermal_cooldown() {
      CAMPAIGN_THERMAL_HARD_ABORT_REASON="unplugged battery 44.0°C >= 44.0°C"
      return 1
    }
    campaign_one_turn 1 "hard abort test"
    printf '%s' "$?" > "$out/rc.txt"
  ) > "$out/turn.log" 2>&1
  rc=$(cat "$out/rc.txt" 2>/dev/null || printf missing)
  if [ "$rc" != 0 ] \
    && grep -q 'thermal hard abort turn 1: unplugged battery 44.0°C' "$out/turn.log" \
    && grep -q '"reason": "thermal-hard-abort: unplugged battery' "$out/turn.log"; then
    ok "hard abort in recovery path records reason and stops the run"
  else
    bad "hard abort in recovery path did not stop after recording the reason (rc=$rc)"
    tail -8 "$out/turn.log" | sed 's/^/   | /'
  fi
}

thermal_turn_case() {
  local name="$1" mode="$2" sender="$3" out="$WORK/$1" rc
  fake_reset "$mode"
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    export CAMPAIGN_ROOT="$HERE" CAMPAIGN_ARM_ID=T20C CAMPAIGN_VARIANT_ID=V1 CAMPAIGN_CONV_ID=c1-V1
    export SCRIPT="$REPO/campaigns/t20c/script.json"
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/conversation.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    source "$HERE/oneTurn.sh"
    CAMPAIGN_THERMAL_MAX_C=42
    CAMPAIGN_THERMAL_COOLDOWN_STEP_S=1
    CAMPAIGN_THERMAL_COOLDOWN_CAP_S=2
    CAMPAIGN_THERMAL_OVERSHOOT_S=1
    : > "$out/logcat.txt"
    if [ "$sender" = real-status ]; then
      campaign_send_turn() {
        if campaign_thermal_should_pause; then
          CAMPAIGN_TURN_STATUS=thermal
        else
          CAMPAIGN_TURN_STATUS=not-thermal
        fi
        return 1
      }
    else
      campaign_send_turn() { CAMPAIGN_TURN_STATUS=thermal; return 1; }
    fi
    campaign_thermal_cooldown() { campaign_thermal_cooldown_wait no; }
    campaign_one_turn 1 "thermal recovery test"
    printf '%s' "$?" > "$out/rc.txt"
  ) > "$out/turn.log" 2>&1
  rc=$(cat "$out/rc.txt" 2>/dev/null || printf missing)
  if [ "$rc" != 0 ] && grep -q 'thermal hard abort turn 1: thermal-giveup: cooldown cap 2s reached' "$out/turn.log" \
    && grep -q '"reason": "thermal-hard-abort: thermal-giveup: cooldown cap 2s reached' "$out/turn.log"; then
    ok "thermal GIVEUP reached through oneTurn and stopped the run"
  elif [ "$name" = thermal-status-turn ] && [ "$rc" != 0 ] \
    && grep -q 'thermal hard abort turn 1: unplugged thermal status 3' "$out/turn.log"; then
    ok "thermal status 3 reached hard abort through the real turn path"
  elif [ "$name" = thermal-unreadable-status-turn ] && [ "$rc" != 0 ] \
    && grep -q 'thermal hard abort turn 1: unplugged battery 44.5°C >= 44.0°C' "$out/turn.log"; then
    ok "unreadable thermal status still reaches the battery hard abort through the real turn path"
  else
    bad "$name did not stop through the expected oneTurn path (rc=$rc)"
    tail -8 "$out/turn.log" | sed 's/^/   | /'
  fi
}

thermal_sustained_case() {
  local mode="$1" want="$2" also="${3:-}" out="$WORK/$1" rc
  fake_reset "$mode"
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    CAMPAIGN_THERMAL_MAX_C=42
    CAMPAIGN_THERMAL_COOLDOWN_STEP_S=1
    CAMPAIGN_THERMAL_COOLDOWN_CAP_S=8
    CAMPAIGN_THERMAL_OVERSHOOT_S=2
    scenario_step=0
    if [ "$mode" = thermal-sustained-rise ]; then
      sleep() {
        scenario_step=$((scenario_step + 1))
        printf '%s' "$scenario_step" > "$FAKE_DEV/fake/thermal_step"
      }
    fi
    campaign_thermal_cooldown_wait no
    printf '%s' "$?" > "$out/rc.txt"
  ) > "$out/thermal.log" 2>&1
  rc=$(cat "$out/rc.txt" 2>/dev/null || printf missing)
  if [ "$rc" = 1 ] && grep -qF "$want" "$out/thermal.log" \
    && { [ -z "$also" ] || grep -qF "$also" "$out/thermal.log"; }; then
    ok "$mode reaches its recovery branch"
  else
    bad "$mode did not reach '$want' (rc=$rc)"
    tail -8 "$out/thermal.log" | sed 's/^/   | /'
  fi
}

thermal_step_clamp_case() {
  local out="$WORK/thermal-step-clamp" rc
  fake_reset thermal-rise-fall
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    CAMPAIGN_THERMAL_MAX_C=42 CAMPAIGN_THERMAL_COOLDOWN_STEP_S=5
    CAMPAIGN_THERMAL_OVERSHOOT_S=2 CAMPAIGN_THERMAL_COOLDOWN_CAP_S=6
    campaign_thermal_cooldown_wait no
    rc=$?
    printf '%s' "$rc" > "$out/rc.txt"
  ) > "$out/thermal.log" 2>&1
  rc=$(cat "$out/rc.txt" 2>/dev/null || printf missing)
  if grep -q 'clamping step to 2s' "$out/thermal.log"; then
    ok "cooldown clamps a step longer than the overshoot window (rc=$rc)"
  else
    bad "cooldown did not clamp the overshoot step (rc=$rc)"
  fi
}

thermal_trend_failure_case() {
  local out="$WORK/thermal-trend-failure"
  fake_reset thermal-rise-fall
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    campaign_thermal_trend() { return 1; }
    CAMPAIGN_THERMAL_MAX_C=42 CAMPAIGN_THERMAL_COOLDOWN_STEP_S=1
    CAMPAIGN_THERMAL_OVERSHOOT_S=1 CAMPAIGN_THERMAL_COOLDOWN_CAP_S=3
    campaign_thermal_cooldown_wait no
  ) > "$out/thermal.log" 2>&1
  if grep -q 'thermal trend unavailable: failed to compare battery readings' "$out/thermal.log"; then
    ok "failed thermal trend computation is explicit and unknown"
  else
    bad "failed thermal trend computation was not reported"
  fi
}

completion_backstop_case() {
  local out="$WORK/completion-backstop"
  fake_reset throttled
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/turn.sh"
    source "$HERE/oneTurn.sh"
    CAMPAIGN_TURN_TIMEOUT_MS=180000 CAMPAIGN_COMPLETION_PROGRESS_WAIT_MS=30000
    CAMPAIGN_COMPLETION_PROGRESS_MAX_MS=120000 CAMPAIGN_TELEMETRY_SEEN=0
    CAMPAIGN_LOGCAT_FILE="$out/logcat.txt"
    virtual_ms=0
    emit_marker=0
    sleep() {
      virtual_ms=$((virtual_ms + ${1%.*} * 1000))
      make_messages "$FAKE_DEV/fake/long.json" 1 "$((virtual_ms / 1000))"
      db_put_messages "$FAKE_DEV/fake/long.json"
      if [ "$emit_marker" -eq 1 ] && [ "$virtual_ms" -ge 150000 ]; then
        printf '%s\n' "$TELEMETRY_LINE" >> "$out/logcat.txt"
      fi
    }
    make_messages "$FAKE_DEV/fake/long.json" 1 1
    db_put_messages "$FAKE_DEV/fake/long.json"
    : > "$out/logcat.txt"
    : > "$out/.slice.txt"
    campaign_completion_signal_lost 2 "$out/.slice.txt" > "$out/expiry.log" 2>&1
    printf '%s' "$?" > "$out/expiry-rc.txt"
    virtual_ms=0
    emit_marker=1
    CAMPAIGN_COMPLETION_PROGRESS_MAX_MS=180000
    : > "$out/logcat.txt"
    campaign_completion_signal_lost 2 "$out/.slice.txt" > "$out/late.log" 2>&1
    printf '%s' "$?" > "$out/late-rc.txt"
  ) > "$out/turn.log" 2>&1
  expiry_rc=$(cat "$out/expiry-rc.txt" 2>/dev/null || printf missing)
  late_rc=$(cat "$out/late-rc.txt" 2>/dev/null || printf missing)
  if [ "$expiry_rc" = 0 ] \
    && grep -q 'for 120000ms; progress fingerprint kept changing through the turn-timeout backstop' "$out/expiry.log" \
    && [ "$late_rc" = 1 ] \
    && grep -q 'completion counter stayed at 0 for 120000ms' "$out/late.log" \
    && grep -q 'KALSA_TELEMETRY ' "$out/logcat.txt"; then
    ok "completion probe exercises the expiry branch and survives the late marker"
  else
    bad "completion probe expiry/late checks failed (expiry_rc=$expiry_rc late_rc=$late_rc)"
    tail -8 "$out/turn.log" "$out/expiry.log" "$out/late.log" | sed 's/^/   | /'
  fi
}

case "${CAMPAIGN_SELFTEST_ONLY:-}" in
hard-abort-recovery)
  printf '\n== isolated hard-abort recovery case ==\n'
  hard_abort_recovery_case
  printf 'passed=%d failed=%d\n' "$pass" "$fail"
  [ "$fail" -eq 0 ]
  exit
  ;;
thermal-giveup)
  thermal_turn_case thermal-giveup thermal-giveup giveup
  printf 'passed=%d failed=%d\n' "$pass" "$fail"; [ "$fail" -eq 0 ]; exit ;;
thermal-status-turn)
  thermal_turn_case thermal-status-turn thermal-status-abort real-status
  printf 'passed=%d failed=%d\n' "$pass" "$fail"; [ "$fail" -eq 0 ]; exit ;;
thermal-unreadable-status-turn)
  thermal_turn_case thermal-unreadable-status-turn thermal-unreadable-status real-status
  printf 'passed=%d failed=%d\n' "$pass" "$fail"; [ "$fail" -eq 0 ]; exit ;;
thermal-sustained-rise)
  thermal_sustained_case thermal-sustained-rise 'unplugged battery kept rising for 3 consecutive samples'
  printf 'passed=%d failed=%d\n' "$pass" "$fail"; [ "$fail" -eq 0 ]; exit ;;
thermal-unknown-power)
  thermal_sustained_case thermal-unknown-power 'power state is unknown — no hard abort' 'THERMAL HARD ABORT unavailable: power state unknown'
  printf 'passed=%d failed=%d\n' "$pass" "$fail"; [ "$fail" -eq 0 ]; exit ;;
thermal-step-clamp)
  thermal_step_clamp_case
  printf 'passed=%d failed=%d\n' "$pass" "$fail"; [ "$fail" -eq 0 ]; exit ;;
thermal-trend-failure)
  thermal_trend_failure_case
  printf 'passed=%d failed=%d\n' "$pass" "$fail"; [ "$fail" -eq 0 ]; exit ;;
completion-backstop)
  completion_backstop_case
  printf 'passed=%d failed=%d\n' "$pass" "$fail"; [ "$fail" -eq 0 ]; exit ;;
esac

# ── (a) liveness is not the completion marker ───────────────────────────────
# driver = background mutation; expect = CAMPAIGN_TURN_STATUS the wait must end
# with. hang is the failure mode being fixed; timeout means liveness kept the
# turn alive for the whole budget.
liveness_case() {
  local label="$1" expect="$2" driver="$3" out="$WORK/live"
  fake_reset marker-turn1
  rm -rf "$out"
  mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    # shellcheck source=../../scripts/ci-lib.sh
    source "$REPO/scripts/ci-lib.sh"
    # shellcheck source=../../scripts/device-share-send.sh
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    CAMPAIGN_TURN_TIMEOUT_MS=6000
    CAMPAIGN_TELEMETRY_GAP_MS=2000
    CAMPAIGN_POLL_MS=1000
    campaign_logcat_start "$out/logcat.txt"
    sleep 1
    case "$driver" in
      native)
        (
          for i in $(seq 1 30); do
            printf '09-16 12:00:30.%03d 4242 4243 I ReactNativeJS: KALSA_NATIVE info Grammar still awaiting trigger after token %d\n' "$i" "$i" \
              >> "$FAKE_DEV/fake/stream.txt"
            sleep 0.5
          done
        ) >/dev/null 2>&1 &
        ;;
      reply)
        (
          for i in $(seq 1 30); do
            make_messages "$FAKE_DEV/fake/live.json" 1 "$((10 + i))"
            db_put_messages "$FAKE_DEV/fake/live.json"
            sleep 0.5
          done
        ) >/dev/null 2>&1 &
        ;;
      bubble)
        (
          for i in $(seq 1 30); do
            make_messages "$FAKE_DEV/fake/live.json" "$i" 20
            db_put_messages "$FAKE_DEV/fake/live.json"
            sleep 0.5
          done
        ) >/dev/null 2>&1 &
        ;;
      complete)
        make_messages "$FAKE_DEV/fake/live.json" 1 20
        db_put_messages "$FAKE_DEV/fake/live.json"
        printf '%s\n' "$TELEMETRY_LINE" >> "$FAKE_DEV/fake/stream.txt"
        ;;
      frozen) : ;;
    esac
    campaign_wait_turn 0 "$out/.slice.txt" 0
    printf '%s' "$CAMPAIGN_TURN_STATUS" > "$out/status.txt"
    campaign_logcat_stop
    wait >/dev/null 2>&1 || true
  )
  local status
  status=$(cat "$out/status.txt" 2>/dev/null || printf 'missing')
  if [ "$status" = "$expect" ]; then
    ok "$label (status=$status)"
  else
    bad "$label (status=$status, want $expect)"
  fi
}

printf '== (a) liveness vs completion marker ==\n'
liveness_case "frozen turn is still a hang" hang frozen
liveness_case "native engine lines keep it alive" timeout native
liveness_case "growing reply keeps it alive" timeout reply
liveness_case "new assistant bubbles keep it alive" timeout bubble
liveness_case "telemetry + new bubble still completes ok" ok complete

# ── (b) the run stops after turn 2 without the completion signal ────────────
# marker-turn1 = today's replay: turn 1 emits KALSA_TELEMETRY, turn 2 does not.
# never        = the signal never appears at all.
run_campaign_case() {
  local mode="$1" want_rc="$2" out served port url
  out="$WORK/out-b-$mode"
  served="$WORK/bundle"
  fake_reset "$mode"
  rm -rf "$out" "$served"
  mkdir -p "$out" "$served/.expo"
  {
    printf '%s\n' "$CAMPAIGN_STARTUP_MARKER"
    printf '%s\n' 'function shouldRunForegroundIdleDispose(args) {'
    printf '%s\n' "$CAMPAIGN_METRO_IN_FLIGHT_NEEDLE"
    printf '%s\n' '}'
  } > "$served/.expo/.virtual-metro-entry.bundle"
  port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
  python3 -m http.server "$port" --directory "$served" >/dev/null 2>&1 &
  local http_pid=$!
  disown "$http_pid" 2>/dev/null || true
  url="http://127.0.0.1:$port/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&lazy=true&minify=false&app=com.kalsa.app&modulesOnly=false&runModule=true"
  env -i PATH="$WORK/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" \
    FAKE_DEV="$FAKE_DEV" PKG=com.kalsa.app BENCH_TARGET=device \
    ANDROID_SERIAL=192.168.1.152:43089 OUT="$out" \
    CAMPAIGN_METRO_BUNDLE_URL="$url" \
    CAMPAIGN_STARTUP_MARKER="$CAMPAIGN_STARTUP_MARKER" \
    CAMPAIGN_TURN_TIMEOUT_MS=6000 CAMPAIGN_TELEMETRY_GAP_MS=2000 CAMPAIGN_POLL_MS=1000 \
    CAMPAIGN_COMPLETION_PROGRESS_WAIT_MS=1000 \
    bash "$HERE/run-t20c.sh" > "$out/run.log" 2>&1
  local rc=$?
  kill "$http_pid" >/dev/null 2>&1 || true
  printf 'mode=%s rc=%d (want %s)\n' "$mode" "$rc" "$want_rc"
  if [ "$rc" -eq "$want_rc" ]; then
    ok "$mode run exit rc=$want_rc"
  else
    bad "$mode run exit rc=$rc (want $want_rc); tail: $(tail -3 "$out/run.log" | tr '\n' '|')"
  fi
  if [ "$mode" = native-log-off ]; then
    if grep -Fq 'native log setup refused: INFO liveness evidence is disabled' "$out/run.log"; then
      ok "nativelog=off refuses campaign startup"
    else
      bad "nativelog=off did not refuse startup in $out/run.log"
    fi
  elif grep -q 'ABORT after turn 2: completion counter stayed at' "$out/run.log"; then
    ok "$mode abort names the missing signal"
  else
    bad "$mode abort message missing in $out/run.log"
  fi
  if grep -q 'UNHANDLED' "$FAKE_DEV/fake/unhandled.log" 2>/dev/null; then
    bad "$mode fake-device gaps: $(sort -u "$FAKE_DEV/fake/unhandled.log" | tr '\n' '|')"
  else
    ok "$mode fake adb handled every call"
  fi
  local restored_pref
  restored_pref=$(sqlite3 "$FAKE_DEV/databases/RKStorage" \
    "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.nativelog';" 2>/dev/null)
  if [ -z "$restored_pref" ]; then
    ok "$mode campaign teardown restored the previously absent nativelog preference"
  else
    bad "$mode campaign teardown left nativelog=$restored_pref instead of ABSENT"
  fi
  # Owner end-state on EVERY exit path (die-before-turn-1 included: this
  # case dies in native log setup, the exact S23 failure): timeout at max,
  # the setting NEVER deleted, Kalsa back in the foreground after teardown.
  local exit_timeout exit_focus
  exit_timeout=$(cat "$FAKE_DEV/fake/settings-timeout" 2>/dev/null || printf null)
  exit_focus=$(cat "$FAKE_DEV/fake/focus" 2>/dev/null || printf unknown)
  if [ "$exit_timeout" = 2147483647 ] \
     && [ ! -e "$FAKE_DEV/fake/settings-timeout-deleted" ] \
     && [ "$exit_focus" = kalsa ]; then
    ok "$mode exit ends screen-safe: timeout=2147483647, never deleted, Kalsa foreground"
  else
    bad "$mode exit screen state: timeout=$exit_timeout deleted=$([ -e "$FAKE_DEV/fake/settings-timeout-deleted" ] && printf yes || printf no) focus=$exit_focus"
  fi
  if [ "$mode" != native-log-off ]; then
    printf '   jsonl: %s\n' "$(jsonl_reason "$out/T20C/c1-V1.jsonl" 2 already-landed-skip-send >/dev/null 2>&1 && printf ok || printf 'no already-landed row')"
  fi
}

printf '\n== (b) early abort after turn 2 ==\n'
run_campaign_case marker-turn1 4
run_campaign_case never 4
run_campaign_case native-log-off 1

# The serial guard is the ONLY thing that can exit 2 here: CAMPAIGN_APK_PATH is
# bound the way a real run binds it, so with the guard removed the run gets past
# the APK gate and the exit code stops looking like that gate's refusal.
serial_refusal_case() {
  local out="$WORK/serial-refusal" rc
  rm -rf "$out"
  mkdir -p "$out"
  env -i PATH="$WORK/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" \
    CAMPAIGN_CONFIG="$REPO/campaigns/t20c-jelly.json" \
    CAMPAIGN_APK_PATH="$out/not-installed.apk" \
    ANDROID_SERIAL=192.168.1.152:43089 OUT="$out" \
    bash "$HERE/run-t20c.sh" > "$out/run.log" 2>&1
  rc=$?
  if [ "$rc" -eq 2 ] && grep -Fq "refuse: ANDROID_SERIAL must be exactly 192.168.1.82:5555 (got '192.168.1.152:43089')" "$out/run.log"; then
    ok "mismatched configured serial is refused"
  else
    bad "mismatched configured serial was not refused as expected (rc=$rc; output: $(cat "$out/run.log"))"
  fi
}

serial_refusal_case

# A synthetic config lives in the case's own temp dir, together with the sibling
# script the runner derives from it. `device` is injected as raw JSON so a case
# can hand it a non-string (`null`) as well as a string.
write_synthetic_config() {
  local dir="$1" device_json="$2" turns="$3" model_json="${4:-}" model_member=""
  # deviceModel is emitted only when a case declares one: a config without the
  # key must stay on the pre-existing "not enforcing" path.
  [ -n "$model_json" ] && model_member=",
 \"deviceModel\": $model_json"
  mkdir -p "$dir/t20c"
  cp "$REPO/campaigns/t20c/script.json" "$dir/t20c/script.json"
  cat > "$dir/config.json" <<JSON
{
 "name": "selftest-synthetic",
 "device": $device_json,
 "resultsDir": "results/t20c-jelly-campaign",
 "turns": $turns$model_member,
 "arms": [{"id":"T20C","flags":{"kalsa.context.compaction":"ciswire","kalsa.memory.enabled":"0","kalsa.ciswire.toolhelp":"0"}}]
}
JSON
  # The runner writes its telemetry schema from the config before the identity
  # gate, so the fixture needs that key to reach the gate at all.
  python3 - "$dir/config.json" "$REPO/campaigns/t20c-jelly.json" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
cfg["telemetry"] = json.load(open(sys.argv[2], encoding="utf-8"))["telemetry"]
json.dump(cfg, open(sys.argv[1], "w", encoding="utf-8"))
PY
}

printf '\n== (a2) the pre-device guards read the config ==\n'

# (a) POSITIVE: the guard must read the configured serial, not a literal Jelly.
# 10.0.0.1:9999 appears nowhere else in the tree. With CAMPAIGN_APK_PATH bound
# the run gets past the APK gate and refuses at the JavaScript provenance gate —
# the next refusal on this path — which proves the serial guard let it through.
configured_serial_case() {
  local dir="$WORK/configured-serial" out="$WORK/configured-serial/out" rc
  rm -rf "$dir"
  write_synthetic_config "$dir" '"10.0.0.1:9999"' 20
  mkdir -p "$out"
  env -i PATH="$WORK/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" \
    FAKE_DEV="$dir/device" CAMPAIGN_STARTUP_MARKER="$CAMPAIGN_STARTUP_MARKER" \
    CAMPAIGN_CONFIG="$dir/config.json" \
    CAMPAIGN_APK_PATH="$dir/not-installed.apk" \
    ANDROID_SERIAL=10.0.0.1:9999 OUT="$out" \
    bash "$HERE/run-t20c.sh" > "$out/run.log" 2>&1
  rc=$?
  if grep -qF 'refuse: ANDROID_SERIAL must be exactly' "$out/run.log"; then
    bad "configured serial 10.0.0.1:9999 was refused by the serial guard (rc=$rc)"
  elif [ "$rc" -eq 2 ]; then
    bad "configured serial 10.0.0.1:9999 stopped at a pre-device gate (rc=$rc; output: $(cat "$out/run.log"))"
  elif grep -qF 'JavaScript provenance gate failed before any device operation' "$out/run.log"; then
    ok "configured serial 10.0.0.1:9999 passed the serial guard, refused at the provenance gate"
  else
    bad "configured serial 10.0.0.1:9999: expected the provenance refusal, got rc=$rc; $(tail -3 "$out/run.log" | tr '\n' '|')"
  fi
}

# (b) `"device": null` stringifies to None, so ANDROID_SERIAL=None satisfies the
# comparison whenever the extraction emits it. It must refuse instead.
null_device_case() {
  local dir="$WORK/null-device" out="$WORK/null-device/out" rc
  rm -rf "$dir"
  write_synthetic_config "$dir" 'null' 20
  mkdir -p "$out"
  env -i PATH="$WORK/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" \
    FAKE_DEV="$dir/device" CAMPAIGN_STARTUP_MARKER="$CAMPAIGN_STARTUP_MARKER" \
    CAMPAIGN_CONFIG="$dir/config.json" \
    CAMPAIGN_APK_PATH="$dir/not-installed.apk" \
    ANDROID_SERIAL=None OUT="$out" \
    bash "$HERE/run-t20c.sh" > "$out/run.log" 2>&1
  rc=$?
  if [ "$rc" -eq 2 ] && grep -Fq "refuse: ANDROID_SERIAL must be exactly <config device unavailable> (got 'None')" "$out/run.log"; then
    ok "a non-string device is refused, not compared as None"
  else
    bad "device:null was not refused as a non-string (rc=$rc; output: $(cat "$out/run.log"))"
  fi
}

# (c) This runner executes exactly 20 turns; a config declaring another count
# would run the T20C arm, ids and evidence under that config's name.
foreign_turns_case() {
  local dir="$WORK/foreign-turns" out="$WORK/foreign-turns/out" rc
  rm -rf "$dir"
  write_synthetic_config "$dir" '"10.0.0.2:9999"' 24
  mkdir -p "$out"
  env -i PATH="$WORK/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" \
    FAKE_DEV="$dir/device" CAMPAIGN_STARTUP_MARKER="$CAMPAIGN_STARTUP_MARKER" \
    CAMPAIGN_CONFIG="$dir/config.json" \
    CAMPAIGN_APK_PATH="$dir/not-installed.apk" \
    ANDROID_SERIAL=10.0.0.2:9999 OUT="$out" \
    bash "$HERE/run-t20c.sh" > "$out/run.log" 2>&1
  rc=$?
  if [ "$rc" -eq 2 ] && grep -Fq 'declares turns=24' "$out/run.log"; then
    ok "a config declaring 24 turns is refused"
  else
    bad "turns=24 config was not refused (rc=$rc; output: $(cat "$out/run.log"))"
  fi
}

configured_serial_case
null_device_case
foreign_turns_case

# (d) $(...) strips a trailing newline, so "192.168.1.82:5555\n" matches the
# stripped ANDROID_SERIAL and passes the serial guard. It names no device.
untrimmed_device_case() {
  local dir="$WORK/untrimmed-device" out="$WORK/untrimmed-device/out" rc
  rm -rf "$dir"
  write_synthetic_config "$dir" '"192.168.1.82:5555\n"' 20
  mkdir -p "$out"
  env -i PATH="$WORK/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" \
    FAKE_DEV="$dir/device" CAMPAIGN_STARTUP_MARKER="$CAMPAIGN_STARTUP_MARKER" \
    CAMPAIGN_CONFIG="$dir/config.json" \
    CAMPAIGN_APK_PATH="$dir/not-installed.apk" \
    ANDROID_SERIAL=192.168.1.82:5555 OUT="$out" \
    bash "$HERE/run-t20c.sh" > "$out/run.log" 2>&1
  rc=$?
  if [ "$rc" -eq 2 ] && grep -Fq 'declares device="192.168.1.82:5555\n"' "$out/run.log"; then
    ok "a device string with a trailing newline is refused, not compared stripped"
  else
    bad "trailing-newline device was not refused (rc=$rc; output: $(cat "$out/run.log"))"
  fi
}

# (e) turns is read as JSON text, so the string "20" satisfies the numeric
# comparison even though it is not the int this runner runs.
string_turns_case() {
  local dir="$WORK/string-turns" out="$WORK/string-turns/out" rc
  rm -rf "$dir"
  write_synthetic_config "$dir" '"10.0.0.4:9999"' '"20"'
  mkdir -p "$out"
  env -i PATH="$WORK/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" \
    FAKE_DEV="$dir/device" CAMPAIGN_STARTUP_MARKER="$CAMPAIGN_STARTUP_MARKER" \
    CAMPAIGN_CONFIG="$dir/config.json" \
    CAMPAIGN_APK_PATH="$dir/not-installed.apk" \
    ANDROID_SERIAL=10.0.0.4:9999 OUT="$out" \
    bash "$HERE/run-t20c.sh" > "$out/run.log" 2>&1
  rc=$?
  if [ "$rc" -eq 2 ] && grep -Fq 'declares turns="20"' "$out/run.log"; then
    ok "turns as the string \"20\" is refused, not compared as the int"
  else
    bad "string turns was not refused (rc=$rc; output: $(cat "$out/run.log"))"
  fi
}

untrimmed_device_case
string_turns_case

printf '\n== (a3) the identity gate reads the config deviceModel ==\n'

# The fake adb answers ro.product.model with SM-S911B, but the identity gate sits
# behind the Metro gate, so a synthetic config reaches it only with a bundle that
# passes: serve the same minimal bundle the (b) cases serve.
run_identity_config() {
  local name="$1" model_json="$2" fake_model="${3:-SM-S911B}" dir served out port url rc http_pid
  dir="$WORK/identity-$name"
  served="$WORK/identity-$name-bundle"
  out="$dir/out"
  rm -rf "$dir" "$served"
  write_synthetic_config "$dir" '"10.0.0.3:9999"' 20 "$model_json"
  mkdir -p "$out" "$served/.expo"
  {
    printf '%s\n' "$CAMPAIGN_STARTUP_MARKER"
    printf '%s\n' 'function shouldRunForegroundIdleDispose(args) {'
    printf '%s\n' "$CAMPAIGN_METRO_IN_FLIGHT_NEEDLE"
    printf '%s\n' '}'
  } > "$served/.expo/.virtual-metro-entry.bundle"
  port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
  python3 -m http.server "$port" --directory "$served" >/dev/null 2>&1 &
  http_pid=$!
  disown "$http_pid" 2>/dev/null || true
  url="http://127.0.0.1:$port/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&lazy=true&minify=false&app=com.kalsa.app&modulesOnly=false&runModule=true"
  fake_reset marker-turn1
  env -i PATH="$WORK/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" \
    FAKE_DEV="$FAKE_DEV" PKG=com.kalsa.app BENCH_TARGET=device \
    FAKE_DEVICE_MODEL="$fake_model" \
    CAMPAIGN_STARTUP_MARKER="$CAMPAIGN_STARTUP_MARKER" \
    CAMPAIGN_CONFIG="$dir/config.json" CAMPAIGN_METRO_BUNDLE_URL="$url" \
    ANDROID_SERIAL=10.0.0.3:9999 OUT="$out" \
    CAMPAIGN_TURN_TIMEOUT_MS=6000 CAMPAIGN_TELEMETRY_GAP_MS=2000 CAMPAIGN_POLL_MS=1000 \
    CAMPAIGN_COMPLETION_PROGRESS_WAIT_MS=1000 \
    bash "$HERE/run-t20c.sh" > "$out/run.log" 2>&1
  rc=$?
  kill "$http_pid" >/dev/null 2>&1 || true
  printf '%s' "$rc"
}

# (f) The Jelly Star is the phone the campaign config names; a device answering
# SM-S911B must be refused, and the refusal must name both models — the serial
# alone cannot tell the two apart.
mismatched_model_case() {
  local dir="$WORK/identity-mismatched-model" rc
  rc=$(run_identity_config mismatched-model '"Jelly Star"')
  if [ "$rc" -eq 1 ] && grep -Fq "device identity mismatch: $dir/config.json declares deviceModel 'Jelly Star', got 'SM-S911B'" "$dir/out/run.log"; then
    ok "deviceModel Jelly Star on an SM-S911B device is refused, naming both models"
  else
    bad "deviceModel mismatch was not refused naming both models (rc=$rc; output: $(tail -3 "$dir/out/run.log" | tr '\n' '|'))"
  fi
}

# (g) Dual of (f): the model the fake device answers must clear the gate and the
# run must continue into the turn loop, with the identity line naming the config
# as the source. A gate that refuses every declared model fails here.
matching_model_case() {
  local dir="$WORK/identity-matching-model" rc
  rc=$(run_identity_config matching-model '"SM-S911B"')
  if grep -qF 'device identity mismatch' "$dir/out/run.log"; then
    bad "deviceModel SM-S911B was refused by the identity gate (rc=$rc)"
  elif [ "$rc" -eq 4 ] && grep -qF "DEVICE IDENTITY: model=SM-S911B serial=10.0.0.3:9999 (matches config deviceModel 'SM-S911B')" "$dir/out/run.log"; then
    ok "deviceModel SM-S911B clears the identity gate and the run continues to the turn loop"
  else
    bad "deviceModel SM-S911B did not clear the identity gate (rc=$rc; identity: $(grep -F 'DEVICE IDENTITY' "$dir/out/run.log" | tail -1))"
  fi
}

# (g2) The real model carries a SPACE. Both cases above compare a model without
# one, so an unquoted comparison ships green: it dies with "too many arguments",
# the mismatch case still sees its refusal, and the matching case still passes.
# This case is the only one that fails when the comparison loses its quotes.
spaced_model_case() {
  local dir="$WORK/identity-spaced-model" rc
  rc=$(run_identity_config spaced-model '"Jelly Star"' 'Jelly Star')
  if [ "$rc" -eq 4 ] && grep -Fq "DEVICE IDENTITY: model=Jelly Star serial=10.0.0.3:9999 (matches config deviceModel 'Jelly Star')" "$dir/out/run.log"; then
    ok "a model name with a space clears the gate, quoted end to end"
  else
    bad "spaced deviceModel did not clear the gate (rc=$rc; identity: $(grep -F 'DEVICE IDENTITY' "$dir/out/run.log" | tail -1); tail: $(tail -2 "$dir/out/run.log" | tr '\n' '|'))"
  fi
}

# (g3) A declared-but-empty deviceModel must refuse. Falling through to "not
# enforcing" would let a malformed declaration switch off the check it asks for.
empty_model_case() {
  local dir="$WORK/identity-empty-model" rc
  rc=$(run_identity_config empty-model '""')
  if [ "$rc" -eq 1 ] \
     && grep -Fq "declares a deviceModel that is not a bare model string" "$dir/out/run.log" \
     && ! grep -qF "DEVICE IDENTITY:" "$dir/out/run.log"; then
    ok "a declared-but-empty deviceModel is refused, not silently unenforced"
  else
    bad "empty deviceModel did not refuse (rc=$rc; identity: $(grep -F 'DEVICE IDENTITY' "$dir/out/run.log" | tail -1))"
  fi
}

mismatched_model_case
matching_model_case
spaced_model_case
empty_model_case

# A throttled engine changes its progress fingerprint before its marker lands.
# The late marker and the changing assistant text both come from the fake adb.
completion_progress_case() {
  local out="$WORK/throttled" rc
  fake_reset throttled
  rm -rf "$out"
  mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/logcat.sh"
    source "$HERE/turn.sh"
    source "$HERE/oneTurn.sh"
    CAMPAIGN_TURN_TIMEOUT_MS=180000
    CAMPAIGN_COMPLETION_PROGRESS_WAIT_MS=30000
    CAMPAIGN_TELEMETRY_SEEN=0
    virtual_ms=0
    sleep() {
      virtual_ms=$((virtual_ms + ${1%.*} * 1000))
      make_messages "$FAKE_DEV/fake/long.json" 1 "$((virtual_ms / 1000))"
      db_put_messages "$FAKE_DEV/fake/long.json"
      if [ "$virtual_ms" -ge 150000 ]; then
        printf '%s\n' "$TELEMETRY_LINE" >> "$out/logcat.txt"
      fi
    }
    make_messages "$FAKE_DEV/fake/long.json" 1 1
    db_put_messages "$FAKE_DEV/fake/long.json"
    campaign_logcat_start "$out/logcat.txt"
    : > "$out/.slice.txt"
    campaign_completion_signal_lost 2 "$out/.slice.txt"
    printf '%s' "$?" > "$out/rc.txt"
    campaign_logcat_stop
    wait >/dev/null 2>&1 || true
  ) > "$out/turn.log" 2>&1
  rc=$(cat "$out/rc.txt" 2>/dev/null || printf missing)
  if [ "$rc" = 1 ] && grep -q 'progress fingerprint changed' "$out/turn.log" \
    && grep -q 'completion counter stayed at 0 for 120000ms' "$out/turn.log"; then
    ok "throttled completion: changing fingerprint survives beyond the old 120s ceiling"
  else
    bad "throttled completion: rc=$rc and/or progress continuation missing"
    tail -5 "$out/turn.log" | sed 's/^/   | /'
  fi
  if grep -q 'KALSA_TELEMETRY ' "$out/logcat.txt"; then
    ok "throttled completion: late marker arrived after the progress probe"
  else
    bad "throttled completion: fake marker did not arrive late"
  fi
}

printf '\n== (b2) throttled completion gets a progress probe ==\n'
completion_progress_case

# Turn 1 must have produced a TURN record only in marker-turn1; turn 2 must
# never vanish silently in either mode (defect 3 site at oneTurn.sh's
# "user+assistant already landed — skip retry send").
check_jsonl() {
  local mode="$1" want_turns="$2" want_skips="$3" out
  out="$WORK/out-b-$mode"
  local got
  got=$(python3 -c '
import json, sys
rows = []
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if line:
        rows.append(json.loads(line))
turns = sorted({r["i"] for r in rows if r.get("event") != "RECOVERY"})
skips = [r for r in rows if r.get("event") == "RECOVERY" and r.get("reason") == "already-landed-skip-send"]
print("%s|%s|%s" % (",".join(map(str, turns)), len(skips), ",".join(sorted({str(r["i"]) for r in skips}))))
' "$out/T20C/c1-V1.jsonl")
  printf '%-12s turns=[%s] already-landed-skips=%s (i=%s)\n' "$mode" "${got%%|*}" \
    "$(printf '%s' "$got" | cut -d'|' -f2)" "$(printf '%s' "$got" | cut -d'|' -f3)"
  if [ "$(printf '%s' "$got" | cut -d'|' -f1)" = "$want_turns" ] \
    && [ "$(printf '%s' "$got" | cut -d'|' -f2)" -eq "$want_skips" ]; then
    ok "$mode: skip rows=$want_skips, no silent disappearance (turns=[$want_turns])"
  else
    bad "$mode: jsonl turns=[$(printf '%s' "$got" | cut -d'|' -f1)] want [$want_turns], skip rows=$(printf '%s' "$got" | cut -d'|' -f2) want $want_skips"
  fi
}

check_jsonl marker-turn1 1 1
check_jsonl never "" 2

# ── (c) every skip path appends a record ────────────────────────────────────
# stub: none | cooldown-fail | recover-2 — only the dependency that would wait
# hours (or that is unreachable) is replaced; the skip path itself is real.
skip_case() {
  local mode="$1" stub="$2" want="$3" out
  out="$WORK/out-c-$mode-$stub"
  fake_reset "$mode"
  rm -rf "$out"
  mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    export CAMPAIGN_ROOT="$HERE" CAMPAIGN_ARM_ID=T20C CAMPAIGN_VARIANT_ID=V1 CAMPAIGN_CONV_ID=c1-V1
    export SCRIPT="$REPO/campaigns/t20c/script.json"
    # shellcheck source=../../scripts/ci-lib.sh
    source "$REPO/scripts/ci-lib.sh"
    # shellcheck source=../../scripts/device-share-send.sh
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/conversation.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    source "$HERE/oneTurn.sh"
    CAMPAIGN_LAUNCHED_PID=4242
    CAMPAIGN_TURN_TIMEOUT_MS=6000
    CAMPAIGN_TELEMETRY_GAP_MS=2000
    CAMPAIGN_POLL_MS=1000
    CAMPAIGN_THERMAL_MAX_C=42
    case "$stub" in
      cooldown-fail) campaign_thermal_cooldown() { return 1; } ;;
      recover-2) campaign_recover_status() { return 2; } ;;
    esac
    campaign_logcat_start "$out/logcat.txt"
    sleep 1
    user=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["turns"][0]["user"])' "$SCRIPT")
    campaign_one_turn 1 "$user"
    printf '%s' "$?" > "$out/rc.txt"
    printf '%s' "${CAMPAIGN_TURN_STATUS:-}" > "$out/status.txt"
    campaign_logcat_stop
  ) > "$out/turn.log" 2>&1
  local rc
  rc=$(cat "$out/rc.txt" 2>/dev/null || printf 'missing')
  if [ "$rc" = "0" ] && jsonl_reason "$out/T20C/c1-V1.jsonl" 1 "$want" >/dev/null 2>&1; then
    ok "skip path '$want' recorded (oneTurn rc=$rc)"
    printf '   jsonl: %s\n' "$(jsonl_reason "$out/T20C/c1-V1.jsonl" 1 "$want" | sed 's/^records=[0-9]* //')"
  else
    bad "skip path '$want': rc=$rc jsonl=$(jsonl_reason "$out/T20C/c1-V1.jsonl" 1 "$want" 2>&1 | head -1)"
    tail -5 "$out/turn.log" | sed 's/^/   | /' 
  fi
  if [ "$stub" = cooldown-fail ] && [ -s "$out/status.txt" ]; then
    bad "technical cooldown failure left CAMPAIGN_TURN_STATUS set to $(cat "$out/status.txt")"
  elif [ "$stub" = cooldown-fail ]; then
    ok "technical cooldown failure clears CAMPAIGN_TURN_STATUS before skipping"
  fi
}

printf '\n== (c) skip paths leave a RECOVERY-shaped record ==\n'
skip_case fail-send none send-failed
skip_case vanish none retry-send-failed
skip_case hot cooldown-fail thermal-cooldown-failed
skip_case never recover-2 recovery-refused

printf '\n== (c2) hard abort in recovery path stops the run ==\n'
hard_abort_recovery_case
thermal_turn_case thermal-giveup thermal-giveup giveup

# Thermal direction and the unplugged hard stop use the fake adb's evolving
# battery/status fixtures; no case is allowed to reach a real adb binary.
cooldown_case() {
  local mode="$1" want_rc="$2" want_log="$3" out="$WORK/cool-$1" rc
  fake_reset "$mode"
  rm -rf "$out"
  mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    CAMPAIGN_THERMAL_MAX_C=42
    CAMPAIGN_THERMAL_COOLDOWN_STEP_S=1
    CAMPAIGN_THERMAL_COOLDOWN_CAP_S=6
    CAMPAIGN_THERMAL_OVERSHOOT_S=2
    campaign_thermal_cooldown
    printf '%s' "$?" > "$out/rc.txt"
  ) > "$out/thermal.log" 2>&1
  rc=$(cat "$out/rc.txt" 2>/dev/null || printf missing)
  if [ "$rc" = "$want_rc" ]; then
    ok "$mode cooldown rc=$want_rc"
  else
    bad "$mode cooldown rc=$rc (want $want_rc)"
  fi
  if grep -qF "$want_log" "$out/thermal.log"; then
    ok "$mode records '$want_log'"
  else
    bad "$mode missing '$want_log'"
    tail -8 "$out/thermal.log" | sed 's/^/   | /'
  fi
}

printf '\n== (g) thermal overshoot direction and unplugged hard stops ==\n'
# This fixture guards both the expected overshoot log and the eventual cool exit;
# a test that only checked rc=0 would also pass with the direction logic removed.
cooldown_case thermal-rise-fall 0 'thermal overshoot window'
cooldown_case thermal-hard-abort 1 'THERMAL HARD ABORT: unplugged battery'
cooldown_case thermal-status-abort 1 'THERMAL HARD ABORT: unplugged thermal status'
cooldown_case thermal-plugged-rise 1 'rising temperature is not a reason to stop'
thermal_turn_case thermal-status-turn thermal-status-abort real-status
thermal_turn_case thermal-unreadable-status-turn thermal-unreadable-status real-status
thermal_sustained_case thermal-sustained-rise 'unplugged battery kept rising for 3 consecutive samples'
thermal_sustained_case thermal-unknown-power 'power state is unknown — no hard abort' 'THERMAL HARD ABORT unavailable: power state unknown'
thermal_step_clamp_case
thermal_trend_failure_case

printf '\n== (d) the verdict tool reads the markers it claims to read ==\n'
# Synthetic run, because the real 5.4 MB reference logcat lives under the
# gitignored out/. Line shapes copied from
# out/t20c-fixprotocol-20260915/logcat.txt.
VRUN="$WORK/verdict-run"
mkdir -p "$VRUN/T20C"
{
  printf '%s\n' '09-15 15:45:41.563  9858  9918 I ReactNativeJS: KALSA_SESSION {"op":"window_align","from":1,"to":0}'
  printf '%s\n' '09-15 15:47:11.832  9858  9918 I ReactNativeJS: KALSA_SESSION {"op":"window_align","from":2,"to":4}'
  printf '%s\n' '09-15 15:45:41.617  9858  9918 I ReactNativeJS: KALSA_WINDOW_SLIDE {"nCtx":8192,"ceiling":4312,"prevStart":0,"newStart":4,"advanced":true,"kvCleared":true}'
  printf '%s\n' '09-15 16:03:35.302  9858  9918 I ReactNativeJS: KALSA_WINDOW_SLIDE {"nCtx":8192,"ceiling":4312,"prevStart":4,"newStart":10,"advanced":true,"kvCleared":true}'
  # A telemetry line carrying `truncated` is what proves the build COULD have
  # reported a truncation; without it the verdict must refuse to score that
  # condition rather than pass it vacuously (asserted below).
  printf '%s\n' '09-15 16:03:40.100  9858  9918 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":10,"tokensEvaluated":10,"tokensPredicted":5,"truncated":false}'
} > "$VRUN/logcat.txt"
{
  printf '%s\n' '{"arm":"T20C","i":1,"intent":"chat-1","assistant":"a"}'
  printf '%s\n' '{"arm":"T20C","i":2,"intent":"chat-2","assistant":"b"}'
} > "$VRUN/T20C/c1-V1.jsonl"

vout="$(node "$HERE/verdict.mjs" "$VRUN" --turns 2 2>&1)"
vrc=$?
# The align count is the regression guard: keying on the inner "op" field finds
# no payload (the brace precedes it) and reports 0 of 0, which PASSES vacuously.
if grep -q '1 of 2 aligns land on 0' <<<"$vout"; then
  ok "verdict parses window_align through the outer marker (1 of 2)"
else
  bad "verdict lost the aligns (vacuous pass regression)"
  printf '%s\n' "$vout" | sed 's/^/   | /'
fi
if [ "$vrc" -eq 0 ]; then
  ok "verdict exits 0 when every turn answered and slides are monotone"
else
  bad "verdict exited $vrc on a clean synthetic run"
  printf '%s\n' "$vout" | sed 's/^/   | /'
fi

VBARE="$WORK/verdict-bare"
mkdir -p "$VBARE/T20C"
grep -v KALSA_TELEMETRY "$VRUN/logcat.txt" > "$VBARE/logcat.txt"
cp "$VRUN/T20C/c1-V1.jsonl" "$VBARE/T20C/c1-V1.jsonl"
# Capture, then grep: verdict.mjs exits 1 here by design, and under pipefail a
# `node ... | grep -q` pipeline inherits that 1 and sends the `if` to else even
# when grep matched.
vbout="$(node "$HERE/verdict.mjs" "$VBARE" --turns 2 2>&1 || true)"
if grep -q 'UNVERIFIABLE' <<<"$vbout"; then
  ok "verdict refuses to score truncation on a build that cannot report it"
else
  bad "verdict scored truncation vacuously on an uninstrumented run"
fi


# ── (e) a send the ENGINE accepted is not re-sent because the DB lags ───────
# 2026-09-17, S23 turn 3: the app logged KALSA_THINKING 0.3 s after the send but
# had not written the user message to RKStorage. campaign_user_landed read the
# DB, saw nothing for 45 s, and re-shared — the engine threw away 92 s of work
# and restarted the same question as a new turn. The run then died waiting for a
# completion marker that arrived 63 s after the harness gave up.
run_db_lag_send() {
  local out="$WORK/dblag"
  rm -rf "$out"; mkdir -p "$out"
  fake_reset db-lag
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    campaign_logcat_start "$out/logcat.txt"
    sleep 1
    campaign_send_turn "Domanda di prova per il fake" && printf 'ok' > "$out/rc.txt" || printf 'fail' > "$out/rc.txt"
    campaign_logcat_stop
    wait >/dev/null 2>&1 || true
  )
  local rc shares taps
  rc=$(cat "$out/rc.txt" 2>/dev/null || printf 'missing')
  shares=$(grep -c 'android.intent.action.VIEW' "$FAKE_DEV/fake/invocations.log" 2>/dev/null || printf 0)
  taps=$(grep -c 'input tap' "$FAKE_DEV/fake/invocations.log" 2>/dev/null || printf 0)
  if [ "$rc" = "ok" ]; then
    ok "db-lag: send accepted on engine evidence (DB never got the user message)"
  else
    bad "db-lag: send reported $rc — the harness still needs the DB copy"
  fi
  if [ "$shares" -eq 1 ]; then
    ok "db-lag: exactly one share intent — no duplicate turn over live work"
  else
    bad "db-lag: $shares share intents — the harness re-sent over work in flight"
  fi
  # Hostile audit, 2026-09-17: the first version of this case passed with the
  # tap deleted from campaign_send_turn, because the fake emitted the engine
  # marker at share time. The fake now fires it from `input tap` on a non-empty
  # composer; this asserts the tap the marker is supposed to be evidence OF.
  if [ "$taps" -eq 1 ]; then
    ok "db-lag: the turn started from one Send tap, not from the share alone"
  else
    bad "db-lag: $taps send taps — the engine evidence is not evidence of a send"
  fi
}

printf '\n== (e) a send the engine accepted is not re-sent ==\n'
run_db_lag_send

printf '%s\n' '{"arm":"T20C","i":3,"intent":"chat-3","assistant":""}' >> "$VRUN/T20C/c1-V1.jsonl"
node "$HERE/verdict.mjs" "$VRUN" --turns 3 > /dev/null 2>&1
if [ $? -eq 1 ]; then
  ok "verdict exits 1 when a turn was never answered"
else
  bad "verdict did not fail on an unanswered turn"
fi


# -- (f) the run-cost report survives the shapes a real logcat throws at it ---
# Hostile audit 2026-09-17 found three defects in verdictSpend.mjs, all of them
# invisible because nothing asserted its output: the -1 "missing counter"
# sentinel printed as a measurement ("-1 tok in -0s") because -1 is finite;
# two slides with no turn between them billed the SAME turn twice; and the
# prewarm's prefill was dropped entirely, because React Native renders a
# multi-arg console.log quoted and JSON.parse threw on a well-formed line.
SRUN="$WORK/spend-run"
mkdir -p "$SRUN/T20C"
{
  # Quoted RN shape: this is how a multi-argument console.log reaches logcat.
  printf '%s\n' "09-17 10:00:00.000 1 2 I ReactNativeJS: KALSA_PREWARM', '{\"op\":\"done\",\"promptMs\":10000,\"promptN\":1832}'"
  printf '%s\n' '09-17 10:01:00.000 1 2 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"promptMs":2000,"prompt_n":100,"predictedMs":8000,"predictedPerSecond":10.0}'
  printf '%s\n' '09-17 10:02:00.000 1 2 I ReactNativeJS: KALSA_WINDOW_SLIDE {"nCtx":8192,"prevStart":0,"newStart":4,"advanced":true,"kvCleared":true}'
  printf '%s\n' '09-17 10:02:01.000 1 2 I ReactNativeJS: KALSA_WINDOW_SLIDE {"nCtx":8192,"prevStart":4,"newStart":8,"advanced":true,"kvCleared":true}'
  printf '%s\n' '09-17 10:03:00.000 1 2 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"2","round":0,"promptMs":4000,"prompt_n":400,"predictedMs":8000,"predictedPerSecond":5.0}'
  # Every counter absent: the app encodes that as -1, not as a missing field.
  printf '%s\n' '09-17 10:04:00.000 1 2 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"3","round":0,"promptMs":-1,"prompt_n":-1,"predictedMs":-1,"predictedPerSecond":-1}'
} > "$SRUN/logcat.txt"
printf '%s\n' '{"arm":"T20C","i":1,"intent":"chat-1","assistant":"a"}' > "$SRUN/T20C/c1-V1.jsonl"

sout="$(node "$HERE/verdict.mjs" "$SRUN" --turns 1 2>&1 || true)"

printf '\n== (f) the run-cost report is asserted, not just printed ==\n'
if grep -qF '16s prefill (10s of it prewarm) / 16s decode (prefill 50%)' <<<"$sout"; then
  ok "spend: prewarm prefill is counted, and named separately"
else
  bad "spend: prefill split wrong: $(printf '%s' "$sout" | grep -F 'prefill vs decode')"
fi
if grep -qF '400 tok in 4s, turn after the slide reported no prefill counters' <<<"$sout"; then
  ok "spend: one turn pays one slide, and -1 is refused as a measurement"
else
  bad "spend: slide bill wrong: $(printf '%s' "$sout" | grep -F 're-prefill after')"
fi
if grep -q 'tok in -0s' <<<"$sout"; then
  bad "spend: the -1 sentinel printed as a measurement"
else
  ok "spend: no negative bill reached the report"
fi
if grep -qF '10.00 -> 5.00 (-50%)' <<<"$sout"; then
  ok "spend: decode decay skips the turn with no rate"
else
  bad "spend: decay wrong: $(printf '%s' "$sout" | grep -F 'decode tok/s')"
fi

printf '\n== (g) a turn carrying a tool round is timingValid:false; a clean turn is true ==\n'

# collector.mjs stamps timingValid=false only when charging. A turn whose
# telemetry contains ANY round with a `tool` field is VOID, never an abort, so
# it must come out timingValid:false with reason "tool_rounds" — a reader can
# tell a tool-invalidated turn from a charging-invalidated one. A turn WITHOUT
# tool rounds must STILL come out timingValid:true: a rule that invalidates
# everything is not a rule.
timing_valid_case() {
  local dir="$WORK/timing-valid" schemas msgs tool_out clean_out
  rm -rf "$dir"
  mkdir -p "$dir"
  schemas="$dir/schemas.json"
  msgs="$dir/messages.json"
  printf '%s\n' '[{"prefix":"KALSA_TELEMETRY"}]' > "$schemas"
  printf '%s\n' '[]' > "$msgs"
  # One of two telemetry rounds carries "tool":"web_search".
  printf '%s\n' \
    '09-17 10:00:00.000 1 2 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"tool":"web_search"}' \
    '09-17 10:00:00.000 1 2 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":1}' \
    > "$dir/tool.logcat"
  # No round carries a tool field.
  printf '%s\n' \
    '09-17 10:00:00.000 1 2 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0}' \
    '09-17 10:00:00.000 1 2 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":1}' \
    > "$dir/clean.logcat"
  node "$HERE/collector.mjs" --logcat "$dir/tool.logcat" --telemetry "$schemas" --messages "$msgs" --out "$dir/tool.jsonl"
  node "$HERE/collector.mjs" --logcat "$dir/clean.logcat" --telemetry "$schemas" --messages "$msgs" --out "$dir/clean.jsonl"
  local tool_valid tool_reason clean_valid
  tool_valid=$(python3 -c "import json;print(json.load(open('$dir/tool.jsonl')).get('timingValid'))")
  tool_reason=$(python3 -c "import json;print(json.load(open('$dir/tool.jsonl')).get('timingReason'))")
  clean_valid=$(python3 -c "import json;print(json.load(open('$dir/clean.jsonl')).get('timingValid'))")
  if [ "$tool_valid" = "False" ] && [ "$tool_reason" = "tool_rounds" ] && [ "$clean_valid" = "True" ]; then
    ok "a tool round forces timingValid:false (reason tool_rounds); a clean turn stays timingValid:true"
  else
    bad "timingValid/tool_rounds wrong: tool_valid=$tool_valid tool_reason=$tool_reason clean_valid=$clean_valid"
  fi
}

timing_valid_case

printf '\n== (h) the cell writes AND verifies the three tool keys as 0 ==\n'

# A measurement cell runs with tools OFF, and a turn carrying any tool round is
# VOID, never an abort. campaign_write_flags must therefore WRITE the three tool
# keys (kalsa.web.enabled, kalsa.tools.device, kalsa.tools.calendar) as the
# literal "0", and campaign_verify_flags must READ them all back, dying on a
# mismatch. This case proves both halves against the fake DB:
#   - half 1 fails if the WRITE is removed (the three keys never land, so the
#     independent readback finds them absent);
#   - half 2 fails if the VERIFY is removed (a deliberately corrupted key is no
#     longer caught, so campaign_verify_flags stops dying on it).
flags_tools_case() {
  local db="$FAKE_DEV/databases/RKStorage"
  rm -rf "$WORK/flags-tools"
  mkdir -p "$WORK/flags-tools"
  # Fresh fake DB with the table the harness reads.
  sqlite3 "$db" "CREATE TABLE IF NOT EXISTS catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT);" >/dev/null
  # campaign_write_flags/campaign_verify_flags live here; source them.
  source "$HERE/flags.sh"
  # Operate on the fake DB directly (no device pull/push). die() ABORTS the
  # subshell (exit 1) so campaign_verify_flags can fail the case on mismatch.
  sql() { sqlite3 "$db" "$1" 2>/dev/null; }
  sql_write() {
    local statement="$1" key="$2" expected="$3" actual
    printf '%s\n' "$statement" | sqlite3 -bail "$db" >/dev/null 2>&1 || return 1
    actual=$(sqlite3 "$db" "SELECT value FROM catalystLocalStorage WHERE key='${key}';" 2>/dev/null | tr -d '[:space:]')
    if [ "$expected" = "__ABSENT__" ]; then [ -z "$actual" ]; else [ "$actual" = "$expected" ]; fi
  }
  die() { printf 'flags: die: %s\n' "$*" >&2; exit 1; }
  log() { :; }
  PKG="com.kalsa.app"

  # Half 1 (catches a removed WRITE): campaign_write_flags writes the three tool
  # keys as "0" and verifies them; read them back independently.
  if ( COMPACTION_VAL=off MEMORY_VAL=0 TOOLHELP_VAL=0 FLAG_PARAMS="" campaign_write_flags ) \
     && [ "$(sqlite3 "$db" "SELECT value FROM catalystLocalStorage WHERE key='kalsa.web.enabled';" 2>/dev/null | tr -d '[:space:]')" = "0" ] \
     && [ "$(sqlite3 "$db" "SELECT value FROM catalystLocalStorage WHERE key='kalsa.tools.device';" 2>/dev/null | tr -d '[:space:]')" = "0" ] \
     && [ "$(sqlite3 "$db" "SELECT value FROM catalystLocalStorage WHERE key='kalsa.tools.calendar';" 2>/dev/null | tr -d '[:space:]')" = "0" ]; then
    ok "campaign_write_flags wrote the three tool keys as 0 and verified them"
  else
    bad "campaign_write_flags did not write the three tool keys as 0"
  fi

  # Half 2 (catches a removed VERIFY): corrupt one tool key, then require
  # campaign_verify_flags to DIE on it. A verify that ignores the three keys
  # lets the corrupted key stand → case goes RED.
  sqlite3 "$db" "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.web.enabled','1');" >/dev/null
  if ( COMPACTION_VAL=off MEMORY_VAL=0 TOOLHELP_VAL=0 FLAG_PARAMS="" campaign_verify_flags ) 2>/dev/null; then
    bad "campaign_verify_flags let a corrupted tool key through (verify removed?)"
  else
    ok "campaign_verify_flags died on a corrupted tool key"
  fi

  unset sql sql_write die log
}

flags_tools_case

native_log_off_refusal_case() {
  local out="$WORK/native-log-off.log" rc
  (
    log() { printf '%s\n' "$*" >&2; }
    die() { printf 'DIE: %s\n' "$*" >&2; exit 1; }
    campaign_native_log_require_on 'bench: thinking=default, nativelog=off' \
      || die "native log setup refused: INFO liveness evidence is disabled"
  ) > "$out" 2>&1
  rc=$?
  if [ "$rc" -ne 0 ] && grep -Fq 'native log setup refused: INFO liveness evidence is disabled' "$out"; then
    ok "campaign refuses startup when bench:show reports nativelog=off"
  else
    bad "campaign did not refuse startup for nativelog=off (rc=$rc; output: $(cat "$out"))"
  fi
}

native_log_off_refusal_case

# Governor engagement gate (S23 governor run): the Fit plan is accepted only
# with pref=1; pref=0, a NoFit plan and a missing plan must all refuse.
governor_engagement_case() {
  local out="$WORK/governor" rc plan nofit
  mkdir -p "$out"
  (
    log() { printf '%s\n' "$*" >&2; }
    source "$HERE/governor.sh"
    printf '%s\n' 'I ReactNativeJS: KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit","decode_repack":false,"available_mib":4006.86}' > "$out/fit.txt"
    plan=$(campaign_governor_wait_plan "$out/fit.txt" 6) || exit 1
    campaign_governor_verify "$plan" 1 || exit 1
    # React Native's quoted multi-arg render of the same plan must parse too
    # (defects:1194 precedent: this is how a multi-arg console.log reaches logcat).
    cat > "$out/quoted-plan.txt" <<'EOF'
09-27 15:07:57.162 30336 30363 I ReactNativeJS: 'KALSA_GOVERNOR_PLAN', '{"gpu_fit":"Fit","decode_repack":false,"required_mib_with_repack":4518.12,"required_mib_without_repack":2998.06,"available_mib":4285,"bench_norepack_forced":null}'
EOF
    qplan=$(campaign_governor_wait_plan "$out/quoted-plan.txt" 6) || exit 5
    campaign_governor_verify "$qplan" 1 || exit 6
    campaign_governor_verify "$plan" 0 && exit 1
    printf '%s\n' 'I ReactNativeJS: KALSA_GOVERNOR_PLAN {"gpu_fit":"NoFit"}' > "$out/nofit.txt"
    nofit=$(campaign_governor_wait_plan "$out/nofit.txt" 6) || exit 1
    campaign_governor_verify "$nofit" 1 && exit 1
    campaign_governor_wait_plan "$out/absent.txt" 1 && exit 1
    exit 0
  ) > "$out/log.txt" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "governor gate accepts Fit+pref1 and refuses pref0, NoFit and a missing plan"
  else
    bad "governor engagement gate wrong (rc=$rc)"
    tail -8 "$out/log.txt" | sed 's/^/   | /'
  fi
}

governor_engagement_case

# Pref OFF → the fake app logs no KALSA_GOVERNOR_PLAN (like the real one)
# and the engagement gate refuses; pref ON → the plan appears and verifies.
governor_pref_off_case() {
  local out="$WORK/gov-pref-off" rc
  fake_reset marker-turn1
  rm -rf "$out"; mkdir -p "$out"
  (
    log() { printf '%s\n' "$*" >&2; }
    source "$HERE/governor.sh"
    adb shell am start -n com.kalsa.app/.MainActivity </dev/null >/dev/null 2>&1 || exit 1
    if campaign_governor_wait_plan "$FAKE_DEV/fake/stream.txt" 1 >/dev/null; then
      echo "pref off but a plan was logged"; exit 2
    fi
    campaign_governor_verify "" "" && { echo "gate accepted a pref-off device"; exit 3; }
    sqlite3 "$FAKE_DEV/databases/RKStorage" \
      "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.governor.enabled','1');" || exit 4
    adb shell am start -n com.kalsa.app/.MainActivity </dev/null >/dev/null 2>&1 || exit 5
    plan=$(campaign_governor_wait_plan "$FAKE_DEV/fake/stream.txt" 6) || { echo "no plan after pref on"; exit 6; }
    campaign_governor_verify "$plan" 1 || exit 7
  ) > "$out/log.txt" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "pref off logs no plan and the gate dies; pref on logs a verifiable Fit plan"
  else
    bad "governor pref-off fake-device case failed (rc=$rc)"
    tail -8 "$out/log.txt" | sed 's/^/   | /'
  fi
}

governor_pref_off_case

# ── the screen-ON rule: Awake+focused counts, anything else redos ───────────
screen_pass_case() {
  local out="$WORK/screen-pass" jsonl rc lines
  fake_reset marker-turn1
  rm -rf "$out"; mkdir -p "$out"
  jsonl="$out/turn.jsonl"
  (
    log() { printf '%s\n' "$*" >&2; }
    export PKG=com.kalsa.app ANDROID_SERIAL=fake:5555
    source "$HERE/screen.sh"
    fake_turn() { printf '{"i":1,"assistant":"ok"}\n' >> "$jsonl"; }
    campaign_screen_verify || exit 11
    campaign_screen_turn "$jsonl" 1 3 fake_turn
  ) > "$out/log.txt" 2>&1
  rc=$?
  lines=$(wc -l < "$jsonl" 2>/dev/null | tr -d ' ')
  if [ "$rc" -eq 0 ] && [ "${lines:-0}" = 1 ] && ! grep -q recovery "$jsonl"; then
    ok "Awake+focused turn passes the screen rule and is counted once"
  else
    bad "Awake+focused turn failed (rc=$rc lines=${lines:-0})"
    tail -6 "$out/log.txt" | sed 's/^/   | /'
  fi
}

screen_pass_case

# A dozing turn is invalidated (recovery=screen-invalid: verdict never counts
# it), the phone is woken + foregrounded, and the same turn is redone once.
screen_redo_case() {
  local out="$WORK/screen-redo" jsonl rc runs
  fake_reset marker-turn1
  screen_doze; screen_unfocus
  rm -rf "$out"; mkdir -p "$out"
  jsonl="$out/turn.jsonl"
  (
    log() { printf '%s\n' "$*" >&2; }
    export PKG=com.kalsa.app ANDROID_SERIAL=fake:5555 CAMPAIGN_SCREEN_WAKE_WAIT_S=2
    source "$HERE/screen.sh"
    fake_turn() {
      runs=$((runs + 1))
      printf '{"i":1,"assistant":"answer"}\n' >> "$jsonl"
      if [ "$runs" -eq 1 ]; then
        printf '%s\n' dozing > "$FAKE_DEV/fake/screen"
        printf '%s\n' other > "$FAKE_DEV/fake/focus"
      fi
      printf '%s\n' "$runs" > "$out/runs.txt"
    }
    runs=0
    campaign_screen_turn "$jsonl" 1 3 fake_turn
  ) > "$out/log.txt" 2>&1
  rc=$?
  runs=$(cat "$out/runs.txt" 2>/dev/null || printf 0)
  if [ "$rc" -eq 0 ] && [ "$runs" = 2 ] \
     && [ "$(grep -c screen-invalid "$jsonl")" = 1 ] \
     && [ "$(wc -l < "$jsonl" | tr -d ' ')" = 2 ] \
     && [ "$(cat "$FAKE_DEV/fake/screen")" = awake ] \
     && [ "$(cat "$FAKE_DEV/fake/focus")" = kalsa ]; then
    ok "dozing turn invalidated (screen-invalid) and redone; phone woken and foregrounded"
  else
    bad "screen redo wrong (rc=$rc runs=$runs)"
    cat "$jsonl" 2>/dev/null | sed 's/^/   | /'; tail -6 "$out/log.txt" | sed 's/^/   | /'
  fi
}

screen_redo_case

# A device whose wake never takes must hit the cap and die — the turn that
# was running when it failed is never counted either.
screen_stuck_case() {
  local out="$WORK/screen-stuck" jsonl rc
  fake_reset marker-turn1
  screen_stuck
  rm -rf "$out"; mkdir -p "$out"
  jsonl="$out/turn.jsonl"
  (
    log() { printf '%s\n' "$*" >&2; }
    export PKG=com.kalsa.app ANDROID_SERIAL=fake:5555 CAMPAIGN_SCREEN_WAKE_WAIT_S=1
    source "$HERE/screen.sh"
    fake_turn() { printf '{"i":1,"assistant":"never"}\n' >> "$jsonl"; }
    campaign_screen_turn "$jsonl" 1 2 fake_turn
  ) > "$out/log.txt" 2>&1
  rc=$?
  if [ "$rc" -eq 1 ] && grep -q "SCREEN REFUSED" "$out/log.txt" && [ ! -s "$jsonl" ]; then
    ok "a phone that stays not-Awake hits the redo cap and dies, without counting"
  else
    bad "screen cap did not die (rc=$rc)"
    tail -6 "$out/log.txt" | sed 's/^/   | /'
  fi
}

screen_stuck_case

# ── fail-closed readings: 3 consecutive unreadable reads of one sensor stop ─
readings_case() {
  local out="$WORK/readings" rc
  rm -rf "$out"; mkdir -p "$out"
  (
    log() { printf '%s\n' "$*"; }
    die() { printf 'DIE: %s\n' "$*"; exit 9; }
    export ANDROID_SERIAL=fake:5555
    source "$REPO/scripts/device-env.sh"
    source "$HERE/recovery.sh"
    reset() {
      CAMPAIGN_STREAK_PLUGGED=0
      CAMPAIGN_STREAK_THERMAL_STATUS=0
      CAMPAIGN_STREAK_BATTERY_TEMP=0
      CAMPAIGN_STREAK_LEVEL=0
      CAMPAIGN_READINGS_DEAD=""
    }
    fail=0

    # 1) thermal status: three unavailable statuses must stop the run
    reset
    printf '%s\n' 'Thermal Status: unavailable' > "$FAKE_DEV/fake/thermalservice.txt"
    calls=0
    while [ "$calls" -lt 3 ]; do campaign_thermal_should_pause >/dev/null; calls=$((calls + 1)); done
    campaign_readings_dead || { echo "status did not kill"; fail=1; }
    campaign_thermal_should_pause >/dev/null || { echo "dead status does not pause"; fail=1; }

    # 2) battery temperature: three unreadable temps (status healthy) must stop
    reset
    printf '%s\n' 'Thermal Status: 0' > "$FAKE_DEV/fake/thermalservice.txt"
    grep -v 'temperature:' "$FAKE_DEV/fake/battery.txt" > "$FAKE_DEV/fake/battery.txt.new" \
      && mv "$FAKE_DEV/fake/battery.txt.new" "$FAKE_DEV/fake/battery.txt"
    calls=0
    while [ "$calls" -lt 3 ]; do campaign_thermal_should_pause >/dev/null; calls=$((calls + 1)); done
    campaign_readings_dead || { echo "battery-temp did not kill"; fail=1; }
    campaign_thermal_should_pause >/dev/null || { echo "dead temp does not pause"; fail=1; }

    # 3) plugged: the real reader over a dump with no power lines, 3 strikes
    reset
    fake_reset thermal-unknown-power
    calls=0
    while [ "$calls" -lt 3 ]; do campaign_thermal_hard_abort_reason >/dev/null 2>&1; calls=$((calls + 1)); done
    campaign_readings_dead || { echo "plugged did not kill"; fail=1; }
    campaign_thermal_should_hard_abort || { echo "dead plugged does not hard-abort"; fail=1; }
    case "$CAMPAIGN_THERMAL_HARD_ABORT_REASON" in unreadable\ plugged*) ;; *) echo "reason not plugged: ${CAMPAIGN_THERMAL_HARD_ABORT_REASON:-EMPTY}"; fail=1 ;; esac

    # 4) level: the shared T20C arm stops at the 3rd unreadable level
    reset
    r=0; campaign_level_should_stop unreadable 25 && r=1
    [ "$r" -eq 0 ] || { echo "1st unreadable level stopped early"; fail=1; }
    r=0; campaign_level_should_stop unreadable 25 && r=1
    [ "$r" -eq 0 ] || { echo "2nd unreadable level stopped early"; fail=1; }
    campaign_level_should_stop unreadable 25 || { echo "3rd unreadable level did not stop"; fail=1; }
    case "$CAMPAIGN_STOP_REASON" in unreadable*) ;; *) echo "level reason wrong: ${CAMPAIGN_STOP_REASON:-EMPTY}"; fail=1 ;; esac
    reset
    campaign_level_should_stop 90 25 && { echo "90% stopped"; fail=1; }
    campaign_level_should_stop 20 25 || { echo "20% did not stop"; fail=1; }

    exit "$fail"
  ) > "$out/log.txt" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "thermal status, battery temp, level and plugged each stop at 3 consecutive invalid reads"
  else
    bad "fail-closed readings case failed (rc=$rc)"
    tail -12 "$out/log.txt" | sed 's/^/   | /'
  fi
}

readings_case

# Per-sensor streaks: two sensors alternating invalid must still die when
# ONE of them reaches 3 consecutive reads (a single shared slot resets on
# every switch and never reaches the cap — the red that proved this bug).
readings_alternating_case() {
  local out="$WORK/readings-alt" rc
  rm -rf "$out"; mkdir -p "$out"
  (
    log() { printf '%s\n' "$*" >&2; }
    source "$HERE/recovery.sh"
    fail=0
    campaign_reading_invalid plugged
    campaign_reading_invalid thermal-status
    campaign_reading_invalid plugged
    campaign_reading_invalid thermal-status
    if campaign_readings_dead; then
      echo "died while both sensors were still at 2/3"
      fail=1
    fi
    campaign_reading_invalid plugged # plugged reaches 3 while thermal-status sits at 2
    campaign_readings_dead || { echo "alternating sensors never died at 3 consecutive reads each"; fail=1; }
    exit "$fail"
  ) > "$out/log.txt" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "two alternating invalid sensors keep per-sensor streaks and die at 3 each"
  else
    bad "alternating-sensor streak wrong (rc=$rc)"
    tail -8 "$out/log.txt" | sed 's/^/   | /'
  fi
}

readings_alternating_case

# ── readiness gate: KALSA_PREWARM op=done since THIS launch + composer ─────
# The gate is a log API, not the model-sheet "Ready" label (the main screen
# never shows it: S23 2026-09-27, op=done at 21 s, label gate timed out).
# The five sources stay INLINE in each subshell: `source` inside a function
# scopes device-share's `readonly _SHARE_*_LABELS=(...)` to that function and
# the arrays vanish when it returns (bash: readonly acts declare-like here).
READINESS_SOURCES='source "$REPO/scripts/device-share-send.sh"
  source "$HERE/logcat.sh"
  source "$HERE/watchdog.sh"
  source "$HERE/flags.sh"
  source "$HERE/conversation.sh"'

readiness_env() {
  export BENCH_TARGET=device PKG=com.kalsa.app OUT="$1" MODEL_ID=lfm2.5-2.6b
  export CAMPAIGN_LOGCAT_FILE="$FAKE_DEV/fake/stream.txt" CAMPAIGN_READY_TIMEOUT="${2:-10}"
  export ANDROID_SERIAL=fake:5555
}

readiness_fresh_case() {
  local out="$WORK/ready-fresh" rc
  fake_reset marker-turn1
  rm -rf "$out"; mkdir -p "$out"
  (
    eval "$READINESS_SOURCES"
    # After the sources: ci-lib owns log/die, and this die must be a stub so
    # the assertion sees the message + a deterministic code, not die's capture.
    die() { printf 'DIE: %s\n' "$*" >&2; exit 7; }
    readiness_env "$out" 10
    campaign_launch || exit 2
    campaign_wait_ready || exit 3
    exit 0
  ) > "$out/log.txt" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ] && grep -q 'ready after' "$out/log.txt"; then
    ok "readiness passes on this launch's KALSA_PREWARM op=done + enabled composer"
  else
    bad "fresh readiness failed (rc=$rc)"
    tail -6 "$out/log.txt" | sed 's/^/   | /'
  fi
}

readiness_fresh_case

# A prewarm done from the PREVIOUS launch sits before this launch's offset:
# it must never satisfy the gate (the fake refuses the fresh line).
readiness_stale_case() {
  local out="$WORK/ready-stale" rc
  fake_reset marker-turn1
  printf '%s\n' '09-16 11:59:59.000 4242 4243 I ReactNativeJS: KALSA_PREWARM {"op":"done","promptMs":1,"promptN":1,"hash":"stale"}' >> "$FAKE_DEV/fake/stream.txt"
  : > "$FAKE_DEV/fake/no-prewarm"
  rm -rf "$out"; mkdir -p "$out"
  (
    eval "$READINESS_SOURCES"
    # After the sources: ci-lib owns log/die, and this die must be a stub so
    # the assertion sees the message + a deterministic code, not die's capture.
    die() { printf 'DIE: %s\n' "$*" >&2; exit 7; }
    readiness_env "$out" 5
    campaign_launch || exit 2
    if campaign_wait_ready; then exit 3; fi
    exit 0
  ) > "$out/log.txt" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "readiness refuses a stale prewarm line from a previous launch"
  else
    bad "stale prewarm line satisfied the gate (rc=$rc)"
    tail -6 "$out/log.txt" | sed 's/^/   | /'
  fi
}

readiness_stale_case

# The log line alone is not enough: the composer must be enabled in the XML.
readiness_composer_disabled_case() {
  local out="$WORK/ready-disabled" rc
  fake_reset marker-turn1
  rm -rf "$out"; mkdir -p "$out"
  (
    eval "$READINESS_SOURCES"
    # After the sources: ci-lib owns log/die, and this die must be a stub so
    # the assertion sees the message + a deterministic code, not die's capture.
    die() { printf 'DIE: %s\n' "$*" >&2; exit 7; }
    readiness_env "$out" 5
    campaign_launch || exit 2
    cat > "$FAKE_DEV/fake/ui.xml" <<'EOF'
<hierarchy>
<node class="android.widget.TextView" text="Pronto" bounds="[0,0][10,10]"/>
<node class="android.widget.EditText" text="Ask a question…" enabled="false" bounds="[0,100][900,200]"/>
</hierarchy>
EOF
    if campaign_wait_ready; then exit 3; fi
    exit 0
  ) > "$out/log.txt" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "readiness refuses a disabled composer even with the log line"
  else
    bad "disabled composer passed the gate (rc=$rc)"
    tail -6 "$out/log.txt" | sed 's/^/   | /'
  fi
}

readiness_composer_disabled_case

# ── dead-load marker: preflight reads/clears loudly, re-death dies ────────
# Product safety net src/engine/loadMarker.ts: key kalsa.load.dead.<modelId>,
# value "1"; a marker that outlived its process refuses the next load.
marker_preflight_case() {
  local out="$WORK/marker-preflight" rc
  fake_reset marker-turn1
  sqlite3 "$FAKE_DEV/databases/RKStorage" \
    "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.load.dead.lfm2.5-2.6b','1');"
  rm -rf "$out"; mkdir -p "$out"
  (
    eval "$READINESS_SOURCES"
    # After the sources: ci-lib owns log/die, and this die must be a stub so
    # the assertion sees the message + a deterministic code, not die's capture.
    die() { printf 'DIE: %s\n' "$*" >&2; exit 7; }
    readiness_env "$out" 5
    campaign_load_dead_preflight || exit 2
    [ -z "$(sqlite3 "$FAKE_DEV/databases/RKStorage" \
      "SELECT value FROM catalystLocalStorage WHERE key='kalsa.load.dead.lfm2.5-2.6b';" 2>/dev/null)" ] || exit 3
    grep -q '"load_dead_marker_cleared": true' "$OUT/run-record.json" || exit 4
    exit 0
  ) > "$out/log.txt" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ] && grep -q 'LOAD DEAD MARKER' "$out/log.txt"; then
    ok "dead-load marker: preflight logs loudly, clears it and records load_dead_marker_cleared=true"
  else
    bad "dead-load marker preflight wrong (rc=$rc)"
    tail -8 "$out/log.txt" | sed 's/^/   | /'
  fi
}

marker_preflight_case

# After a cleared marker the load must produce a prewarm done inside the
# cap; a re-dead load dies with "model load died" and a logcat snapshot.
marker_load_died_case() {
  local out="$WORK/marker-load-died" rc
  fake_reset marker-turn1
  : > "$FAKE_DEV/fake/no-prewarm"
  rm -rf "$out"; mkdir -p "$out"
  (
    eval "$READINESS_SOURCES"
    # After the sources: ci-lib owns log/die, and this die must be a stub so
    # the assertion sees the message + a deterministic code, not die's capture.
    die() { printf 'DIE: %s\n' "$*" >&2; exit 7; }
    readiness_env "$out" 5
    export CAMPAIGN_LOAD_DEAD_MARKER_CLEARED=1
    campaign_launch || exit 2
    campaign_wait_ready
    exit 0
  ) > "$out/log.txt" 2>&1
  rc=$?
  if [ "$rc" -eq 7 ] \
     && grep -q 'model load died' "$out/log.txt" \
     && [ -s "$out/model-load-died.logcat" ]; then
    ok "a re-dead load dies with 'model load died' and a logcat snapshot"
  else
    bad "re-dead load did not die correctly (rc=$rc)"
    tail -8 "$out/log.txt" | sed 's/^/   | /'
  fi
}

marker_load_died_case

# A release build (or any single-string emitter) logs the same event as one
# unquoted string — the gate must keep accepting that form too.
readiness_release_form_case() {
  local out="$WORK/ready-release" rc
  fake_reset marker-turn1
  : > "$FAKE_DEV/fake/no-prewarm"
  rm -rf "$out"; mkdir -p "$out"
  (
    eval "$READINESS_SOURCES"
    # After the sources: ci-lib owns log/die, this stub keeps the assertion honest.
    die() { printf 'DIE: %s\n' "$*" >&2; exit 7; }
    readiness_env "$out" 5
    campaign_launch || exit 2
    printf '%s\n' '09-16 12:00:05.000 4242 4243 I ReactNativeJS: KALSA_PREWARM {"op":"done","promptMs":42.5,"promptN":1,"hash":"release-form"}' >> "$FAKE_DEV/fake/stream.txt"
    campaign_wait_ready || exit 3
    exit 0
  ) > "$out/log.txt" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ] && grep -q 'ready after' "$out/log.txt"; then
    ok "readiness also accepts the unquoted release form of op=done"
  else
    bad "release-form prewarm did not satisfy the gate (rc=$rc)"
    tail -6 "$out/log.txt" | sed 's/^/   | /'
  fi
}

readiness_release_form_case

# ── a tool continuation keeps the turn open until its final round ───────────
# Baseline raw (raw/baseline-before-thermal-20260927, turn 1): round 0 ended
# with telemetry + KALSA_TOOLCALL{executed:1} at 16:42:10, then 133 s of tool
# until round 1 + KALSA_GOVERNOR at 16:44:33. The old wait collected at round
# 0 — the JSONL row was assistant "#", telemetry round 0 only, KALSA_GOVERNOR:[]
# (REPORT "S23 pre-thermal baseline"). The five logcat lines below are
# VERBATIM; the final assistant text is shaped (the bug prevented the real
# one from ever being captured).
tool_continuation_case() {
  local out="$WORK/tool-cont" rc
  fake_reset marker-turn1
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    export CAMPAIGN_ROOT="$HERE" CAMPAIGN_ARM_ID=T20C CAMPAIGN_VARIANT_ID=V1 CAMPAIGN_CONV_ID=c1-V1
    export COMPACTION_VAL=ciswire
    # shellcheck source=../../scripts/ci-lib.sh
    source "$REPO/scripts/ci-lib.sh"
    # shellcheck source=../../scripts/device-share-send.sh
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    CAMPAIGN_TURN_TIMEOUT_MS=60000
    CAMPAIGN_TELEMETRY_GAP_MS=120000
    CAMPAIGN_POLL_MS=500
    campaign_logcat_start "$out/logcat.txt"
    sleep 1
    # Round 0: one partial assistant "#" in the store (the collected row's text).
    python3 - "$FAKE_DEV/fake/live.json" <<'MSG'
import json, sys
json.dump([{"role": "user", "text": "domanda"}, {"role": "assistant", "text": "#"}], open(sys.argv[1], "w"))
MSG
    db_put_messages "$FAKE_DEV/fake/live.json"
    printf '%s\n' '09-27 16:42:10.870 18337 18368 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":2303,"tokensEvaluated":1943,"tokensPredicted":359,"draftTokens":0,"draftAccepted":0,"promptMs":17038.508,"predictedMs":31011.363999999998,"predictedPerSecond":11.576401476568398,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":1943,"ciswireFlags":1}' >> "$FAKE_DEV/fake/stream.txt"
    printf '%s\n' '09-27 16:42:10.885 18337 18368 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":0,"toolChoice":"auto","structuredCalls":1,"fallbackCalls":0,"fallbackDialect":"none","executed":1,"skippedCap":0,"skippedDup":0,"skippedFailedRepeat":0,"failed":0,"blockedPrivacy":0,"namesValid":true,"argsParsed":true,"toolNames":["write_note"]}' >> "$FAKE_DEV/fake/stream.txt"
    # The late continuation (133 s on device, 2 s here): final message, round 1
    # telemetry + toolcall, and the turn-ending KALSA_GOVERNOR line.
    (
      sleep 2
      python3 - "$FAKE_DEV/fake/live.json" <<'MSG'
import json, sys
json.dump([{"role": "user", "text": "domanda"}, {"role": "assistant", "text": "Risposta finale completa con la nota."}], open(sys.argv[1], "w"))
MSG
      db_put_messages "$FAKE_DEV/fake/live.json"
      printf '%s\n' '09-27 16:44:33.975 18337 18368 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":1,"tokensCached":3609,"tokensEvaluated":2126,"tokensPredicted":1482,"draftTokens":0,"draftAccepted":0,"promptMs":2332.741,"predictedMs":140586.572,"predictedPerSecond":10.541547310791533,"contextFull":false,"interrupted":false,"truncated":false,"tool":"write_note","prompt_n":186,"ciswireFlags":1}' >> "$FAKE_DEV/fake/stream.txt"
      printf '%s\n' '09-27 16:44:33.975 18337 18368 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":1,"toolChoice":"auto","structuredCalls":0,"fallbackCalls":0,"fallbackDialect":"none","executed":0,"skippedCap":0,"skippedDup":0,"skippedFailedRepeat":0,"failed":0,"blockedPrivacy":0,"namesValid":true,"argsParsed":true,"toolNames":[]}' >> "$FAKE_DEV/fake/stream.txt"
      printf '%s\n' '09-27 16:44:33.978 18337 18368 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":28164608,"commit_ms":8.459,"prefill_ms":2332.741,"prefill_chunks":"2+128+56","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":"","attempt":1,"turnId":"1","route_requested":"auto","route_mode":"auto","route_push":"applied","route_mismatch":null,"route_chunks":[{"index":0,"requested":"auto","actual":"gpu","tokens":2,"prefill_ms":359,"forced":false},{"index":1,"requested":"auto","actual":"gpu","tokens":128,"prefill_ms":1276,"forced":false},{"index":2,"requested":"auto","actual":"gpu","tokens":56,"prefill_ms":696,"forced":false}],"route_chunks_dropped":0,"route_chunks_truncated":false}' >> "$FAKE_DEV/fake/stream.txt"
    ) >/dev/null 2>&1 &
    campaign_wait_turn 0 "$out/.slice.txt" 0
    printf '%s' "$CAMPAIGN_TURN_STATUS" > "$out/status.txt"
    campaign_logcat_stop
    wait >/dev/null 2>&1 || true
    # Collect only after the wait returned: the record must carry BOTH rounds,
    # both toolcalls and the turn-ending governor line.
    node "$HERE/config.mjs" --telemetry-schema "$REPO/campaigns/t20c.json" "$OUT/.telemetry-schema.json" >/dev/null || exit 7
    printf '%s\n' '{"intent":"tool-continuation","user":"domanda","probes":[]}' > "$OUT/.turn-script.json"
    campaign_collect_file "$out/.slice.txt" "$FAKE_DEV/fake/live.json" false "$out/rec.json" || exit 8
  ) > "$out/log.txt" 2>&1
  rc=$?
  local status
  status=$(cat "$out/status.txt" 2>/dev/null || printf missing)
  local verdict
  verdict=$(python3 - "$out/rec.json" <<'REC'
import json, sys

try:
    rec = json.load(open(sys.argv[1], encoding="utf-8"))
except OSError:
    print("missing-record")
    raise SystemExit(0)
tel = rec.get("telemetry", {}).get("KALSA_TELEMETRY", [])
gov = rec.get("telemetry", {}).get("KALSA_GOVERNOR", [])
tools = rec.get("telemetry", {}).get("KALSA_TOOLCALL", [])
ok = (
    [t.get("round") for t in tel] == [0, 1]
    and len(gov) == 1
    and gov[0].get("thermal_state") == "FAST"
    and [t.get("executed") for t in tools] == [1, 0]
    and rec.get("assistant") == "Risposta finale completa con la nota."
)
print("ok" if ok else f"rounds={[t.get('round') for t in tel]} gov={len(gov)} tools={[t.get('executed') for t in tools]} assistant={rec.get('assistant')!r}")
REC
)
  if [ "$rc" -eq 0 ] && [ "$status" = "ok" ] \
     && grep -q "tool round pending" "$out/log.txt" \
     && [ "$verdict" = ok ]; then
    ok "tool continuation: wait held through the tool round and the record carries both rounds + KALSA_GOVERNOR (verbatim baseline lines)"
  else
    bad "tool continuation wrong (rc=$rc status=$status verdict=$verdict)"
    tail -8 "$out/log.txt" | sed 's/^/   | /'
  fi
}

tool_continuation_case

tool_exhausted_record_case() {
  local out="$WORK/tool-exhausted-record" rc status reply_pid
  fake_reset marker-turn1
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    export CAMPAIGN_ROOT="$HERE" CAMPAIGN_ARM_ID=T20C CAMPAIGN_VARIANT_ID=V1 CAMPAIGN_CONV_ID=c1-V1
    export COMPACTION_VAL=ciswire
    source "$REPO/scripts/ci-lib.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/turn.sh"
    source "$HERE/oneTurn.sh"
    campaign_pidof_settled() { printf '%s\n' 4242; }
    CAMPAIGN_TURN_TIMEOUT_MS=5000
    CAMPAIGN_TELEMETRY_GAP_MS=5000
    CAMPAIGN_POLL_MS=250
    printf '%s\n' '[{"role":"user","text":"question"}]' > "$FAKE_DEV/fake/live.json"
    db_put_messages "$FAKE_DEV/fake/live.json"
    printf '%s\n' '10-09 14:33:37.300 14923 14950 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":2,"ciswireFlags":1}' >> "$FAKE_DEV/fake/stream.txt"
    printf '%s\n' '10-09 14:33:37.317 14923 14950 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":2,"executed":1}' >> "$FAKE_DEV/fake/stream.txt"
    printf '%s\n' '10-09 14:34:52.364 14923 14950 I ReactNativeJS: KALSA_TOOLROUND_EXHAUSTED {"turnId":"1","roundsUsed":3,"streamedLen":0,"fallbackFired":true,"fallbackOk":false}' >> "$FAKE_DEV/fake/stream.txt"
    campaign_logcat_start "$out/logcat.txt"
    (
      sleep 0.5
      printf '%s\n' '[{"role":"user","text":"question"},{"role":"assistant","text":"Canned answer"}]' > "$FAKE_DEV/fake/live.json"
      db_put_messages "$FAKE_DEV/fake/live.json"
    ) &
    reply_pid=$!
    campaign_wait_turn 0 "$out/slice.txt" 0
    printf '%s' "$CAMPAIGN_TURN_STATUS" > "$out/status.txt"
    wait "$reply_pid"
    node "$HERE/config.mjs" --telemetry-schema "$REPO/campaigns/t20c.json" "$OUT/.telemetry-schema.json" >/dev/null || exit 7
    printf '%s\n' '{"intent":"toolcap","user":"question","probes":[]}' > "$OUT/.turn-script.json"
    campaign_collect_file "$out/slice.txt" "$FAKE_DEV/fake/live.json" false "$out/rec.json" || exit 8
    campaign_stamp_toolcap_record "$out/rec.json"
    campaign_logcat_stop
  ) > "$out/log.txt" 2>&1
  rc=$?
  status=$(cat "$out/status.txt" 2>/dev/null || printf missing)
  if [ "$rc" -eq 0 ] && [ "$status" = toolcap ] \
    && python3 - "$out/rec.json" <<'PY'
import json, sys
rec = json.load(open(sys.argv[1], encoding="utf-8"))
rows = rec.get("telemetry", {}).get("KALSA_TOOLROUND_EXHAUSTED", [])
raise SystemExit(0 if len(rows) == 1 and rec.get("toolcap") is True and rec.get("assistant") == "Canned answer" else 1)
PY
  then
    ok "EXHAUSTED waits for and records the canned assistant reply as a completed toolcap turn"
  else
    bad "EXHAUSTED record wrong (rc=$rc status=$status)"
    tail -8 "$out/log.txt" | sed 's/^/   | /'
  fi
}

tool_exhausted_record_case

toolcap_no_answer_case() {
  local out="$WORK/toolcap-no-answer" status no_answer stats
  fake_reset marker-turn1
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    source "$REPO/scripts/ci-lib.sh"
    source "$HERE/turn.sh"
    source "$HERE/oneTurn.sh"
    log() { :; }
    campaign_logcat_ensure() { :; }
    campaign_logcat_slice() { :; }
    campaign_turn_tool_state() { printf '%s\n' exhausted; }
    campaign_adb_state() { printf '%s\n' device; }
    campaign_pidof_settled() { printf '%s\n' 4242; }
    campaign_assistant_count() { printf '%s\n' 19; }
    sleep() { :; }
    CAMPAIGN_TURN_I=20 CAMPAIGN_TOOLCALL_QUIET_MS=0
    campaign_wait_turn 19 "$out/slice.txt" 0
    printf '%s\n' "$CAMPAIGN_TURN_STATUS" > "$out/status.txt"
    printf '%s\n' "${CAMPAIGN_TOOLCAP_NO_ANSWER:-0}" > "$out/no-answer.txt"
    printf '%s\n' '{"i":20}' > "$out/no-answer-record.json"
    campaign_stamp_toolcap_record "$out/no-answer-record.json"
    python3 - "$out/acceptance.jsonl" "$out/no-answer-record.json" <<'PY'
import json, sys
path, no_answer_path = sys.argv[1:]
with open(path, "w", encoding="utf-8") as stream:
    for turn in range(1, 20):
        stream.write(json.dumps({"i": turn}) + "\n")
    with open(no_answer_path, encoding="utf-8") as source:
        stream.write(source.read() + "\n")
PY
  ) > "$out/no-answer.log" 2>&1
  status=$(cat "$out/status.txt" 2>/dev/null || printf missing)
  no_answer=$(cat "$out/no-answer.txt" 2>/dev/null || printf missing)
  stats=$(python3 "$HERE/acceptanceStats.py" "$out/acceptance.jsonl" 2>/dev/null || printf missing)
  if [ "$status" = toolcap ] && [ "$no_answer" = 1 ] \
    && [ "$stats" = '19 1 1 0 0' ] \
    && python3 - "$out/no-answer-record.json" <<'PY'
import json, sys
record = json.load(open(sys.argv[1], encoding="utf-8"))
raise SystemExit(0 if record.get("toolcapNoAnswer") is True else 1)
PY
  then
    ok "toolcap without an assistant bubble is recorded and excluded from the 20-turn acceptance count"
  else
    bad "no-answer toolcap passed or was not recorded (status=$status no_answer=$no_answer stats=$stats)"
    tail -5 "$out/no-answer.log" | sed 's/^/   | /'
  fi
}

toolcap_no_answer_case

# ── the tool gate's knobs: quiet window, round bound, both wire forms ───────
# Quiet window: explicit and poll-aware — max(1500, 2 x poll), env override.
toolcall_quiet_ms_case() {
  local got_q got_p got_d got_o
  got_q=$(CAMPAIGN_POLL_MS=1000 bash -c 'log(){ :; }; source "$0"; campaign_toolcall_quiet_ms' "$HERE/turn.sh")
  got_p=$(CAMPAIGN_POLL_MS=500 bash -c 'log(){ :; }; source "$0"; campaign_toolcall_quiet_ms' "$HERE/turn.sh")
  got_d=$(CAMPAIGN_POLL_MS=5000 bash -c 'log(){ :; }; source "$0"; campaign_toolcall_quiet_ms' "$HERE/turn.sh")
  got_o=$(CAMPAIGN_POLL_MS=1000 CAMPAIGN_TOOLCALL_QUIET_MS=250 bash -c 'log(){ :; }; source "$0"; campaign_toolcall_quiet_ms' "$HERE/turn.sh")
  if [ "$got_q" = 2000 ] && [ "$got_p" = 1500 ] && [ "$got_d" = 10000 ] && [ "$got_o" = 250 ]; then
    ok "quiet window = max(1500, 2 x poll), env override wins (1000→2000, 500→1500, 5000→10000, override→250)"
  else
    bad "quiet window wrong: q=$got_q p=$got_p d=$got_d o=$got_o"
  fi
}

toolcall_quiet_ms_case

# Both wire forms of KALSA_TOOLCALL parse (shared dual-needle pattern).
tool_state_forms_case() {
  local out="$WORK/tool-forms" unquoted quoted pending_q invalid missing_executed rc
  rm -rf "$out"; mkdir -p "$out"
  printf '%s\n' '09-27 16:42:10.885 18337 18368 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":0,"executed":1}' > "$out/unquoted.txt"
  printf '%s\n' "09-27 16:44:33.975 18337 18368 I ReactNativeJS: 'KALSA_TOOLCALL', '{\"turnId\":\"1\",\"round\":2,\"executed\":0}'" > "$out/quoted.txt"
  printf '%s\n' "09-27 16:44:33.975 18337 18368 I ReactNativeJS: 'KALSA_TOOLCALL', '{\"turnId\":\"1\",\"round\":3,\"executed\":1}'" > "$out/quoted-pending.txt"
  # S23 2026-10-09: the cap round emits no KALSA_TOOLCALL, only EXHAUSTED.
  printf '%s\n' '10-09 14:33:37.317 14923 14950 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":2,"executed":1}' \
    '10-09 14:34:52.364 14923 14950 I ReactNativeJS: KALSA_TOOLROUND_EXHAUSTED {"turnId":"1","roundsUsed":3,"streamedLen":0,"fallbackFired":true,"fallbackOk":false}' > "$out/exhausted.txt"
  printf '%s\n' "10-09 14:33:37.317 14923 14950 I ReactNativeJS: 'KALSA_TOOLCALL', '{\"turnId\":\"1\",\"round\":2,\"executed\":1}'" \
    "10-09 14:34:52.364 14923 14950 I ReactNativeJS: 'KALSA_TOOLROUND_EXHAUSTED', '{\"turnId\":\"1\",\"roundsUsed\":3}'" > "$out/exhausted-quoted.txt"
  printf '%s\n' '10-09 14:33:37.317 14923 14950 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":2,"executed":1}' \
    '10-09 14:34:52.364 14923 14950 I ReactNativeJS: diagnostic mentions KALSA_TOOLROUND_EXHAUSTED {"turnId":"1","roundsUsed":3}' > "$out/mention.txt"
  printf '%s\n' '10-09 14:33:37.317 14923 14950 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":2,"executed":1}' \
    '10-09 14:34:52.364 14923 14950 I ReactNativeJS: KALSA_TOOLROUND_EXHAUSTED {"turnId":"2","roundsUsed":3}' > "$out/mismatch.txt"
  printf '%s\n' '10-09 14:33:37.317 14923 14950 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":2,"executed":1}' \
    '10-09 14:34:52.364 14923 14950 I ReactNativeJS: KALSA_TOOLROUND_EXHAUSTED {"turnId":"1","roundsUsed":3}' \
    '10-09 14:35:52.364 14923 14950 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":2,"executed":1}' > "$out/un-stuck.txt"
  printf '%s\n' '10-09 14:35:52.364 14923 14950 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":3,"executed":"not-a-number"}' > "$out/invalid.txt"
  printf '%s\n' '10-09 14:35:52.364 14923 14950 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":3}' > "$out/missing-executed.txt"
  (
    log() { :; }
    source "$HERE/turn.sh"
    u=$(campaign_turn_tool_state "$out/unquoted.txt")
    q=$(campaign_turn_tool_state "$out/quoted.txt")
    qp=$(campaign_turn_tool_state "$out/quoted-pending.txt")
    a=$(campaign_turn_tool_state "$out/nonexistent.txt")
    x=$(campaign_turn_tool_state "$out/exhausted.txt")
    xq=$(campaign_turn_tool_state "$out/exhausted-quoted.txt")
    m=$(campaign_turn_tool_state "$out/mention.txt")
    mm=$(campaign_turn_tool_state "$out/mismatch.txt")
    us=$(campaign_turn_tool_state "$out/un-stuck.txt")
    invalid=$(campaign_turn_tool_state "$out/invalid.txt")
    missing_executed=$(campaign_turn_tool_state "$out/missing-executed.txt")
    [ "$u" = "pending 0" ] && [ "$q" = "final" ] && [ "$qp" = "pending 3" ] \
      && [ "$a" = "absent" ] && [ "$x" = "exhausted" ] && [ "$xq" = "exhausted" ] && [ "$m" = "pending 2" ] \
      && [ "$mm" = "pending 2" ] && [ "$us" = "pending 2" ] \
      && [ "$invalid" = absent ] && [ "$missing_executed" = absent ]
  )
  rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "tool state parses both wire forms, clears stale EXHAUSTED, and fails closed on invalid executed values"
  else
    bad "tool state wire forms wrong (rc=$rc)"
  fi
}

tool_state_forms_case

# A continuation that never arrives ends the turn as toolround at the bound,
# with its own log line — never the 45-min turn timeout.
tool_round_lost_case() {
  local out="$WORK/tool-lost" rc
  fake_reset marker-turn1
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    CAMPAIGN_TURN_TIMEOUT_MS=60000
    CAMPAIGN_TELEMETRY_GAP_MS=120000
    CAMPAIGN_POLL_MS=500
    CAMPAIGN_TOOL_ROUND_MAX_MS=1500
    campaign_logcat_start "$out/logcat.txt"
    sleep 1
    make_messages "$FAKE_DEV/fake/live.json" 1 8
    db_put_messages "$FAKE_DEV/fake/live.json"
    printf '%s\n' '09-16 12:00:10.000 4242 4243 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"tokensPredicted":10}' >> "$FAKE_DEV/fake/stream.txt"
    printf '%s\n' '09-16 12:00:10.010 4242 4243 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":0,"executed":1}' >> "$FAKE_DEV/fake/stream.txt"
    campaign_wait_turn 0 "$out/.slice.txt" 0
    wrc=$?
    printf '%s' "$CAMPAIGN_TURN_STATUS" > "$out/status.txt"
    campaign_logcat_stop
    exit "$wrc"
  ) > "$out/log.txt" 2>&1
  rc=$?
  local status
  status=$(cat "$out/status.txt" 2>/dev/null || printf missing)
  if [ "$rc" -ne 0 ] && [ "$status" = "toolround" ] \
     && grep -q "tool continuation lost: round 0 pending for 1500ms" "$out/log.txt"; then
    ok "a lost continuation ends the turn as toolround at CAMPAIGN_TOOL_ROUND_MAX_MS, with its own log"
  else
    bad "lost continuation wrong (rc=$rc status=$status)"
    tail -6 "$out/log.txt" | sed 's/^/   | /'
  fi
}

tool_round_lost_case

# The bound restarts per pending round: healthy multi-tool turns (round N
# pending → round N+1 pending → final) are never killed by an earlier round.
tool_round_rotating_case() {
  local out="$WORK/tool-rotating" rc
  fake_reset marker-turn1
  rm -rf "$out"; mkdir -p "$out"
  (
    export OUT="$out" PKG=com.kalsa.app BENCH_TARGET=device
    export ANDROID_SERIAL=fake:5555 CAMPAIGN_SERIAL=fake:5555
    source "$REPO/scripts/ci-lib.sh"
    source "$REPO/scripts/device-share-send.sh"
    source "$HERE/logcat.sh"
    source "$HERE/watchdog.sh"
    source "$HERE/recovery.sh"
    source "$HERE/turn.sh"
    CAMPAIGN_TURN_TIMEOUT_MS=60000
    CAMPAIGN_TELEMETRY_GAP_MS=120000
    CAMPAIGN_POLL_MS=500
    CAMPAIGN_TOOL_ROUND_MAX_MS=800
    campaign_logcat_start "$out/logcat.txt"
    sleep 1
    make_messages "$FAKE_DEV/fake/live.json" 1 8
    db_put_messages "$FAKE_DEV/fake/live.json"
    printf '%s\n' '09-16 12:00:10.000 4242 4243 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"tokensPredicted":10}' >> "$FAKE_DEV/fake/stream.txt"
    printf '%s\n' '09-16 12:00:10.010 4242 4243 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":0,"executed":1}' >> "$FAKE_DEV/fake/stream.txt"
    (
      sleep 0.8
      printf '%s\n' '09-16 12:00:11.000 4242 4243 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":1,"executed":1}' >> "$FAKE_DEV/fake/stream.txt"
      sleep 0.8
      printf '%s\n' '09-16 12:00:12.000 4242 4243 I ReactNativeJS: KALSA_TOOLCALL {"turnId":"1","round":2,"executed":0}' >> "$FAKE_DEV/fake/stream.txt"
    ) >/dev/null 2>&1 &
    campaign_wait_turn 0 "$out/.slice.txt" 0
    printf '%s' "$CAMPAIGN_TURN_STATUS" > "$out/status.txt"
    campaign_logcat_stop
    wait >/dev/null 2>&1 || true
  ) > "$out/log.txt" 2>&1
  rc=$?
  local status
  status=$(cat "$out/status.txt" 2>/dev/null || printf missing)
  if [ "$rc" -eq 0 ] && [ "$status" = "ok" ] \
     && ! grep -q "tool continuation lost" "$out/log.txt"; then
    ok "rotating tool rounds restart the bound: multi-tool turn completes, never toolround"
  else
    bad "rotating tool rounds wrong (rc=$rc status=$status)"
    tail -6 "$out/log.txt" | sed 's/^/   | /'
  fi
}

tool_round_rotating_case

printf '\npassed=%d failed=%d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
