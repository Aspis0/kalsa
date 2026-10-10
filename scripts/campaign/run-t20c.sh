#!/usr/bin/env bash
# T20C acceptance runner: one 20-turn conversation on the configured device.
# Enforces the Metro provenance gate, fresh-start 85%
# battery floor, thermal start gate, and fail-closed charging monitoring.
# Writes append-only acceptance evidence; no APK install.
#
#   ANDROID_SERIAL=<configured-device> bash run-t20c.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CAMPAIGN_CONFIG="${CAMPAIGN_CONFIG:-$REPO/campaigns/t20c.json}"
CONFIG="$CAMPAIGN_CONFIG"
SCRIPT="$(dirname "$CONFIG")/t20c/script.json"
# Only a non-empty JSON string names a device. null, true, 1234 and ["a"]
# stringify to None/True/1234/['a'], which would otherwise pass the check below.
SERIAL="$(python3 -c 'import json,sys
d=json.load(open(sys.argv[1], encoding="utf-8"))["device"]
if isinstance(d, str) and d: print(d)' "$CONFIG" 2>/dev/null)"
# $(...) strips a trailing newline, so a config device of "192.168.1.82:5555\n"
# compares equal to the stripped ANDROID_SERIAL below. Only a string that is
# already its own stripped form names a device; json.dumps keeps the whitespace
# visible in the refusal.
SERIAL_UNTRIMMED="$(python3 -c 'import json,sys
d=json.load(open(sys.argv[1], encoding="utf-8"))["device"]
if isinstance(d, str) and d != d.strip(): print(json.dumps(d))' "$CONFIG" 2>/dev/null)"
if [ -n "$SERIAL_UNTRIMMED" ]; then
  echo "refuse: $CONFIG declares device=$SERIAL_UNTRIMMED, which is not a bare serial (got '${ANDROID_SERIAL:-}')" >&2
  exit 2
fi
if [ -z "$SERIAL" ] || [ "${ANDROID_SERIAL:-}" != "$SERIAL" ]; then
  echo "refuse: ANDROID_SERIAL must be exactly ${SERIAL:-<config device unavailable>} (got '${ANDROID_SERIAL:-}')" >&2
  exit 2
fi
# This runner hard-codes 20 turns and derives the conversation script from the
# config. A config declaring another campaign's turn count or carrying no
# script would run the T20C arm, ids and evidence under that campaign's name.
# turns must be a JSON int: the string "20" satisfies [ "$CONFIG_TURNS" != "20" ].
# A non-int is printed as JSON, so the refusal shows the type it actually has.
CONFIG_TURNS="$(python3 -c 'import json,sys
t=json.load(open(sys.argv[1], encoding="utf-8"))["turns"]
if type(t) is int: print(t)
else: print(json.dumps(t))' "$CONFIG" 2>/dev/null)"
if [ "$CONFIG_TURNS" != "20" ]; then
  echo "refuse: $CONFIG declares turns=${CONFIG_TURNS:-<unreadable>}; run-t20c.sh runs exactly 20" >&2
  exit 2
fi
if [ ! -f "$SCRIPT" ]; then
  echo "refuse: conversation script not found: $SCRIPT" >&2
  exit 2
fi
# The fake harness has no installed phone APK; every real run must bind one.
if [ -z "${CAMPAIGN_APK_PATH:-}" ] && [ -z "${FAKE_DEV:-}" ]; then
  echo "refuse: CAMPAIGN_APK_PATH must point to the APK installed on the phone" >&2
  exit 2
fi

ARM_FLAGS="$(python3 - "$CONFIG" <<'PY'
import json
import sys

cfg = json.load(open(sys.argv[1], encoding="utf-8"))
arm = next((item for item in cfg.get("arms", []) if item.get("id") == "T20C"), None)
keys = ("kalsa.context.compaction", "kalsa.memory.enabled", "kalsa.ciswire.toolhelp")
flags = arm.get("flags") if isinstance(arm, dict) else None
if not isinstance(flags, dict) or any(key not in flags for key in keys):
    raise SystemExit("missing T20C arm flags")
values = [flags[key] for key in keys]
print(*(str(value) for value in values))
PY
)" || { echo "refuse: $CONFIG has no complete T20C arm flags" >&2; exit 2; }
read -r COMPACTION_VAL MEMORY_VAL TOOLHELP_VAL <<<"$ARM_FLAGS"
FLAG_PARAMS=""
CAMPAIGN_ARM_ID="T20C"
CAMPAIGN_VARIANT_ID="V1"
CAMPAIGN_CONV_ID="c1-V1"
echo "T20C config flags compaction=$COMPACTION_VAL memory=$MEMORY_VAL toolhelp=$TOOLHELP_VAL"

CAMPAIGN_ROOT="$REPO/scripts/campaign"

export PKG="com.kalsa.app"
export ANDROID_SERIAL="$SERIAL"
export CAMPAIGN_SERIAL="$SERIAL"
export BENCH_TARGET=device
export MODEL_ID="lfm2.5-2.6b"
export LOCALE_VAL="it"
CAMPAIGN_TURN_TIMEOUT_MS="${CAMPAIGN_TURN_TIMEOUT_MS:-2700000}"
CAMPAIGN_TELEMETRY_GAP_MS="${CAMPAIGN_TELEMETRY_GAP_MS:-1800000}"
CAMPAIGN_POLL_MS="${CAMPAIGN_POLL_MS:-5000}"
CAMPAIGN_THERMAL_PAUSE=5
CAMPAIGN_THERMAL_MAX_C=42
CAMPAIGN_THERMAL_COOLDOWN_CAP_S="${CAMPAIGN_THERMAL_COOLDOWN_CAP_S:-600}"
export CAMPAIGN_TURN_TIMEOUT_MS CAMPAIGN_TELEMETRY_GAP_MS CAMPAIGN_POLL_MS \
  CAMPAIGN_THERMAL_PAUSE CAMPAIGN_THERMAL_MAX_C CAMPAIGN_THERMAL_COOLDOWN_CAP_S

# Evidence goes where the config says. campaigns/t20c.json resolves to the same
# path as the old literal; OUT still overrides it for one-off runs.
RESULTS_REL="$(python3 -c 'import json,sys
d=json.load(open(sys.argv[1], encoding="utf-8"))["resultsDir"]
if isinstance(d, str) and d: print(d)' "$CONFIG" 2>/dev/null)"
if [ -z "$RESULTS_REL" ]; then
  echo "refuse: $CONFIG has no resultsDir; refusing to guess an evidence directory" >&2
  exit 2
fi
export OUT="${OUT:-$REPO/$RESULTS_REL}"
mkdir -p "$OUT"

# shellcheck source=../../scripts/device-share-send.sh
source "$REPO/scripts/device-share-send.sh"
source "$CAMPAIGN_ROOT/flags.sh"
source "$CAMPAIGN_ROOT/conversation.sh"
source "$CAMPAIGN_ROOT/logcat.sh"
source "$CAMPAIGN_ROOT/watchdog.sh"
source "$CAMPAIGN_ROOT/recovery.sh"
source "$CAMPAIGN_ROOT/turn.sh"
source "$CAMPAIGN_ROOT/nativeLog.sh"
source "$CAMPAIGN_ROOT/oneTurn.sh"
source "$CAMPAIGN_ROOT/screen.sh"
source "$CAMPAIGN_ROOT/metroPreflight.sh"
source "$CAMPAIGN_ROOT/governor.sh"

# Owner rule (screen ON): arm the exit guarantee BEFORE anything touches
# the phone — every die from here on ends screen-safe. keepawake_begin
# below REPLACES the EXIT trap with its own restore, so the full trap is
# re-armed there (the last trap wins); INT/TERM route through the EXIT trap.
trap campaign_screen_finalize EXIT
trap 'exit 130' INT TERM

command -v campaign_metro_preflight >/dev/null 2>&1 || die "Metro gate unavailable: campaign_metro_preflight is not defined"
campaign_metro_preflight

# --- delta 1: charging gate -------------------------------------------------
CHARGING_FLAG="$OUT/.STOP-CHARGING"
# The owner's unplugged stop line: refuse to continue at 25% — an unplugged
# 20-turn governor run must end on the floor, not on an empty battery
# mid-prefill (the old8 was a dead-phone line, far below the stop line).
BATTERY_FLOOR=25
CAMPAIGN_MIN_BATTERY_LEVEL="${CAMPAIGN_MIN_BATTERY_LEVEL:-85}"
rm -f "$CHARGING_FLAG"

charging_or_status2() {
  local d st
  if ! d=$(adb -s "$SERIAL" shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r'); then
    return 2
  fi
  [ -n "$d" ] || return 2
  if grep -qE '(AC|USB|Wireless|Dock) powered:[[:space:]]*true' <<<"$d"; then return 0; fi
  st=$(printf '%s\n' "$d" | awk '/^[[:space:]]*status:/ {print $2; exit}')
  case "$st" in
    2|5|6|7|8|9) return 0 ;;
    ''|*[!0-9]*) return 2 ;;
  esac
  return 1
}

battery_level_now() {
  local d
  d=$(adb -s "$SERIAL" shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' || true)
  printf '%s\n' "$d" | awk '/^[[:space:]]+level:/ {print $2; exit}'
}

battery_temp_now() {
  local d
  d=$(adb -s "$SERIAL" shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' || true)
  printf '%s\n' "$d" | awk '/^[[:space:]]+temperature:/ {print $2; exit}'
}

charging_monitor() {
  # Background sentinel: if the phone goes back on charge mid-run, drop the
  # flag; the turn loop stops at the next boundary and reports.
  local charge_rc unreadable_reads=0
  while :; do
    charge_rc=0
    charging_or_status2 || charge_rc=$?
    if [ "$charge_rc" -eq 0 ]; then
      unreadable_reads=0
      : > "$CHARGING_FLAG"
      exit 0
    fi
    case "$charge_rc" in
      2)
        unreadable_reads=$((unreadable_reads + 1))
        log "charging state unreadable (consecutive=$unreadable_reads)"
        [ "$unreadable_reads" -ge 3 ] && { : > "$CHARGING_FLAG"; exit 0; }
        ;;
      *) unreadable_reads=0 ;;
    esac
    sleep 30
  done
}

stop_reason=""
CHARGING_UNREADABLE_READS=0
run_should_stop() {
  local charge_rc
  # The owner's unplugged stop line lives in recovery.sh (thermal status >= 3
  # or battery >= 44°C, unplugged only — never written as bench.thermo).
  # Checked first so a phone BETWEEN turns still stops before SEVERE.
  if campaign_thermal_should_hard_abort; then
    stop_reason="thermal hard abort: $CAMPAIGN_THERMAL_HARD_ABORT_REASON"
    return 0
  fi
  if [ -f "$CHARGING_FLAG" ]; then
    stop_reason="phone back on charge mid-run (AC/USB/Wireless/Dock powered, or status 2 or >=5)"
    return 0
  elif charging_or_status2; then
    CHARGING_UNREADABLE_READS=0
    stop_reason="phone back on charge mid-run (AC/USB/Wireless/Dock powered, or status 2 or >=5)"
    return 0
  else
    charge_rc=$?
    case "$charge_rc" in
      2)
        CHARGING_UNREADABLE_READS=$((CHARGING_UNREADABLE_READS + 1))
        log "charging state unreadable (consecutive=$CHARGING_UNREADABLE_READS)"
        if [ "$CHARGING_UNREADABLE_READS" -ge 3 ]; then
          stop_reason="battery charging state unreadable — stopping safely"
          return 0
        fi
        ;;
      *) CHARGING_UNREADABLE_READS=0 ;;
    esac
  fi
  local lvl
  lvl=$(battery_level_now)
  if campaign_level_should_stop "$lvl" "$BATTERY_FLOOR"; then
    stop_reason="$CAMPAIGN_STOP_REASON"
    return 0
  fi
  return 1
}

node "$CAMPAIGN_ROOT/config.mjs" --telemetry-schema "$CONFIG" "$OUT/.telemetry-schema.json" \
  || die "T20C preflight: could not write telemetry schema"

battery_line() {
  local d l t c charge_rc
  d=$(adb -s "$SERIAL" shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' || true)
  l=$(printf '%s\n' "$d" | awk '/^[[:space:]]+level:/ {print $2; exit}')
  t=$(printf '%s\n' "$d" | awk '/^[[:space:]]+temperature:/ {print $2; exit}')
  if charging_or_status2; then
    c=true
  else
    charge_rc=$?
    if [ "$charge_rc" -eq 2 ]; then c=unknown; else c=false; fi
  fi
  case "$t" in ''|*[!0-9]*) log "battery level=${l:-?} temp=unknown charging=$c"; return ;; esac
  log "battery level=${l:-?} temp=$((t / 10)).$((t % 10))C charging=$c"
}

t20c_start_preflight() {
  local min_level="$CAMPAIGN_MIN_BATTERY_LEVEL" level temp_deci temp charging charge_rc target_jsonl
  case "$min_level" in
    ''|*[!0-9]*) die "battery preflight: CAMPAIGN_MIN_BATTERY_LEVEL must be an integer" ;;
  esac
  [ "$min_level" -le 100 ] || die "battery preflight: CAMPAIGN_MIN_BATTERY_LEVEL must be <= 100"
  target_jsonl="$OUT/$CAMPAIGN_ARM_ID/$CAMPAIGN_CONV_ID.jsonl"
  [ ! -s "$target_jsonl" ] || die "T20C start refused: acceptance JSONL is non-empty; use a new OUT: $OUT"

  level=$(battery_level_now)
  temp_deci=$(battery_temp_now)
  if charging_or_status2; then
    charging=true
  else
    charge_rc=$?
    case "$charge_rc" in
      1) charging=false ;;
      *) charging=unknown ;;
    esac
  fi
  case "$temp_deci" in
    ''|*[!0-9]*) temp=unknown ;;
    *) temp="$((temp_deci / 10)).$((temp_deci % 10))" ;;
  esac
  log "battery preflight floor=enforced level=${level:-unknown} temp=${temp}C charging=${charging}"

  case "$level" in
    ''|*[!0-9]*) die "battery preflight refused: battery level unreadable" ;;
  esac
  [ "$temp" != unknown ] || die "battery preflight refused: battery temperature unreadable"
  [ "$charging" = false ] || die "battery preflight refused: charging state unreadable or device is charging"
  [ "$level" -ge "$min_level" ] || die "battery preflight refused: battery level ${level}% below ${min_level}% floor"
}

campaign_arm_begin() {
  campaign_write_flags
  campaign_wipe_chat
  campaign_logcat_clear_arm
  campaign_launch || die "arm T20C: launch startup marker proof failed"
  campaign_wait_ready || die "arm T20C: never Pronto/Ready"
}

log "T20C rerun2 start serial=$ANDROID_SERIAL out=$OUT"
t20c_start_preflight
battery_line
campaign_ensure_device || die "device missing"
[ "$(campaign_adb_state)" = "device" ] || die "adb get-state is not device"
_device_model_rc=0
_device_model=$(adb -s "$SERIAL" shell getprop ro.product.model </dev/null 2>/dev/null | tr -d '\r') || _device_model_rc=$?
[ "$_device_model_rc" -eq 0 ] || die "device identity unreadable: ro.product.model read failed"
case "$_device_model" in
  ''|*[![:print:]]*) die "device identity unreadable: ro.product.model is empty or malformed" ;;
esac
# A serial is an address, not an identity: a DHCP lease that moves to another
# phone leaves the serial check passing. The config names the model this
# campaign must run on, and every enforcing branch records which physical
# device produced the evidence.
# A declared deviceModel that is empty, null, numeric or padded printed nothing
# here and fell through to "not enforcing": a malformed declaration disabled the
# very check it asks for. Declared means enforced, or the run refuses.
CONFIG_DEVICE_MODEL="$(python3 -c 'import json,sys
c=json.load(open(sys.argv[1], encoding="utf-8"))
if "deviceModel" in c:
    d=c["deviceModel"]
    if not isinstance(d, str) or not d or d != d.strip(): sys.exit(3)
    print(d)' "$CONFIG" 2>/dev/null)" ||
  die "device identity: $CONFIG declares a deviceModel that is not a bare model string"
if [ -n "$CONFIG_DEVICE_MODEL" ]; then
  [ "$_device_model" = "$CONFIG_DEVICE_MODEL" ] || die "device identity mismatch: $CONFIG declares deviceModel '$CONFIG_DEVICE_MODEL', got '$_device_model'"
  log "DEVICE IDENTITY: model=$_device_model serial=$SERIAL (matches config deviceModel '$CONFIG_DEVICE_MODEL')"
elif [ -n "${CAMPAIGN_EXPECT_MODEL:-}" ]; then
  [ "$_device_model" = "$CAMPAIGN_EXPECT_MODEL" ] || die "device identity mismatch: expected model '$CAMPAIGN_EXPECT_MODEL', got '$_device_model'"
  log "DEVICE IDENTITY: model=$_device_model serial=$SERIAL (matches CAMPAIGN_EXPECT_MODEL)"
else
  log "DEVICE IDENTITY: model=$_device_model (CAMPAIGN_EXPECT_MODEL unset; not enforcing)"
fi
device_thermal_gate
[ "${THERMAL_STATUS_AT_TURN:-unknown}" != unknown ] || die "thermal preflight refused: thermal status unreadable"
log "thermal preflight status=${THERMAL_STATUS_AT_TURN:-unknown} battery_deci=${THERMAL_BATTERY_DECI_AT_TURN:-unknown}"
device_keepawake_begin
# keepawake just REPLACED the EXIT trap with its own restore, which DELETEs
# screen_off_timeout here (saved == KA ceiling — the S23 failure): re-arm the
# FULL trap before the pin can die, so every later path ends screen-safe.
MON_PID=""
trap 'campaign_native_log_restore || true; campaign_logcat_stop; [ -n "$MON_PID" ] && kill "$MON_PID" 2>/dev/null; device_termux_wakelock_restore; campaign_screen_finalize' EXIT
# Owner rule (screen ON): pin the timeout at max and drop the keyguard now;
# keepawake just set its own shorter value, we override it after it.
campaign_screen_pin_timeout || die "screen: could not pin screen_off_timeout=2147483647"
campaign_logcat_start "$OUT/logcat.txt"

charging_monitor &
MON_PID=$!
log "charging monitor pid=$MON_PID (30s poll)"

# --- delta 2: thermal recovery never kills the app --------------------------
# Overrides the shared recovery.sh / watchdog.sh / conversation.sh behavior,
# which force-stops the app on every thermal pause (what shredded the
# 2026-09-14 run: turns force-stopped mid-prefill, every relaunch cold).

# Wait for cool with the app alive and in foreground. The cap comes from
# CAMPAIGN_THERMAL_COOLDOWN_CAP_S; reaching it records a GIVEUP and stops the run.
campaign_thermal_cooldown() {
  campaign_thermal_cooldown_wait no
}

# Same-conversation restore is only needed when the app actually died. On a
# thermal pause the app is alive mid-conversation — do NOT touch it.
campaign_restore_same_conv() {
  local app_state_rc=0
  if campaign_app_running; then
    log "restore: app still running (thermal path) — no force-stop, no relaunch"
    return 0
  else
    app_state_rc=$?
  fi
  if [ "$app_state_rc" -eq 2 ]; then
    die "restore: app process state stayed unknown after 3 settle rounds; aborting without force-stop"
  fi
  campaign_force_stop
  COMPACTION_VAL="${COMPACTION_VAL:?}" MEMORY_VAL="${MEMORY_VAL:?}" TOOLHELP_VAL="${TOOLHELP_VAL:?}" \
    campaign_write_flags
  campaign_launch || die "thermal restore: launch startup marker proof failed"
  campaign_wait_ready || die "restore: app never reached Pronto/Ready"
}

# Original records the turn and force-stops. Keep the record; force-stop only
# for non-thermal reasons (hang/timeout genuinely lost the engine). On thermal
# the generation keeps running in the app.
campaign_abort_turn() {
  local reason="${1:-timeout}"
  case "$reason" in
    thermal) log "RECOVERY reason=$reason (record only — app NOT force-stopped)" ;;
    *)       log "RECOVERY reason=$reason (force-stop $PKG)"; campaign_force_stop ;;
  esac
  campaign_record_recovery "$reason"
}

log "arm begin: flags->$COMPACTION_VAL, wipe chat, launch"
# The pref must be in storage BEFORE the launch whose load gate reads it;
# a post-load write would satisfy the readback and change nothing.
campaign_governor_enable || die "governor pref: could not write $GOVERNOR_PREF_KEY=1"
campaign_load_dead_preflight || die "load-dead marker preflight failed"
campaign_native_log_setup
campaign_arm_begin
battery_line

# --- delta 3: hot readback of the flags, app running ------------------------
log "--- hot flags readback (app running) ---"
sql "SELECT key||'='||value FROM catalystLocalStorage WHERE key IN ('kalsa.context.compaction','kalsa.context.compaction.choice','kalsa.memory.enabled','kalsa.ciswire.toolhelp','kalsa.locale','kalsa.model.id');" 2>/dev/null || log "WARN: hot flags readback failed"
_hot_toolchoice_rc=0
_hot_toolchoice=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.toolchoice';" 2>/dev/null | tr -d '[:space:]') || _hot_toolchoice_rc=$?
if [ "$_hot_toolchoice_rc" -ne 0 ]; then
  log "ERROR: kalsa.bench.toolchoice=UNREADABLE (SQL read failed rc=$_hot_toolchoice_rc; ABSENT not proven)"
else
  log "kalsa.bench.toolchoice=${_hot_toolchoice:-ABSENT} (ABSENT = auto = app-default tools ON; this run writes no toolchoice)"
fi
log "--- end hot flags readback ---"

# Real n_ctx from the engine log, needed to size the ceiling check.
sleep 5
log "--- engine init lines ---"
grep -m1 "KALSA_CTX_FLOOR" "$OUT/logcat.txt" | sed 's/^[^I]*I //' || true
grep -m1 "KALSA_NATIVE_VARIANT" "$OUT/logcat.txt" | sed 's/^[^I]*I //' || true
grep -m1 -oE "llama_context: *n_ctx[^,]*" "$OUT/logcat.txt" || true
grep -m1 -oE "n_ctx_per_seq[^,]*" "$OUT/logcat.txt" || true
log "--- end engine init lines ---"

# --- governor engagement gate (before turn 1) --------------------------------
# The pref alone proves nothing: a device whose load plan is not Fit keeps
# the pref set and runs CPU-only. Refuse to start instead of discovering it
# at turn 19. The plan lands when the model finishes loading; wait for it.
log "--- governor engagement ---"
governor_plan_json=""
if campaign_governor_wait_plan "$OUT/logcat.txt" "${CAMPAIGN_GOVERNOR_PLAN_WAIT_S:-180}" > "$OUT/.governor-plan.json"; then
  governor_plan_json="$(tr -d '\n' < "$OUT/.governor-plan.json")"
fi
governor_pref="$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.governor.enabled';" 2>/dev/null | tr -d '[:space:]')" || governor_pref=""
log "governor readback: $GOVERNOR_PREF_KEY=${governor_pref:-UNREADABLE} plan=${governor_plan_json:-ABSENT}"
campaign_governor_verify "$governor_plan_json" "$governor_pref" \
  || die "governor not engaged before turn 1 — refusing to start (no gpu_fit Fit plan or pref not set)"
log "--- end governor engagement ---"

rc=0
for i in $(seq 1 20); do
  if run_should_stop; then
    log "STOP before turn $i: $stop_reason"
    rc=3
    break
  fi
  user=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["turns"][int(sys.argv[2])]["user"])' \
    "$SCRIPT" "$((i - 1))")
  log "=== turn $i begins ==="
  screen_rc=0
  campaign_screen_turn "$OUT/${CAMPAIGN_ARM_ID}/${CAMPAIGN_CONV_ID}.jsonl" "$i" \
    "${CAMPAIGN_SCREEN_REDO_CAP:-3}" campaign_one_turn "$i" "$user" || screen_rc=$?
  if [ "$screen_rc" -eq 1 ]; then
    die "screen rule: turn $i never became awake+focused after ${CAMPAIGN_SCREEN_REDO_CAP:-3} attempts"
  elif [ "$screen_rc" -ne 0 ]; then
    log "WARN: turn $i failed — continuing loop"
    rc=1
  fi
  # Defect 2 (2026-09-16): a run whose completion signal is already gone can
  # only repeat the same 30-45 min wait. Stop at the first turn (from 2 on)
  # that ends without KALSA_TELEMETRY instead of grinding through the rest.
  if [ "${CAMPAIGN_TURN_STATUS:-}" != toolcap ] && campaign_completion_signal_lost "$i" "$OUT/.slice.txt"; then
    rc=4
    break
  fi
  battery_line
  if run_should_stop; then
    log "STOP after turn $i: $stop_reason"
    rc=3
    break
  fi
done

battery_line
jsonl="$OUT/$CAMPAIGN_ARM_ID/$CAMPAIGN_CONV_ID.jsonl"
# Turn records have no event key; recovery records do. Count distinct turns, not lines.
record_stats=$(python3 "$CAMPAIGN_ROOT/acceptanceStats.py" "$jsonl") \
  || die "T20C footer: could not count acceptance records in $jsonl"
turn_count=0
toolcap_count=0
toolcap_no_answer_count=0
recovery_count=0
unparseable_count=0
read -r turn_count toolcap_count toolcap_no_answer_count recovery_count unparseable_count <<EOF
$record_stats
EOF
if [ "$turn_count" -eq 20 ]; then
  log "T20C RUN COMPLETE — turns=$turn_count/20 toolcap=$toolcap_count toolcap_no_answer=$toolcap_no_answer_count recoveries=$recovery_count unparseable=$unparseable_count jsonl=$jsonl"
else
  log "T20C RUN INCOMPLETE — turns=$turn_count/20 toolcap=$toolcap_count toolcap_no_answer=$toolcap_no_answer_count recoveries=$recovery_count unparseable=$unparseable_count jsonl=$jsonl"
  [ "$rc" -ne 0 ] || rc=1
fi
exit "$rc"
