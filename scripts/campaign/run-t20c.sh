#!/usr/bin/env bash
# T20C acceptance runner: one 20-turn conversation on the Galaxy S23 at
# 192.168.1.152:43089. Enforces the Metro provenance gate, fresh-start 85%
# battery floor, thermal start gate, and fail-closed charging monitoring.
# Writes append-only acceptance evidence; no APK install.
#
#   ANDROID_SERIAL=192.168.1.152:43089 bash run-t20c.sh
set -uo pipefail

SERIAL="192.168.1.152:43089"
if [ "${ANDROID_SERIAL:-}" != "$SERIAL" ]; then
  echo "refuse: ANDROID_SERIAL must be exactly $SERIAL (got '${ANDROID_SERIAL:-}')" >&2
  exit 2
fi
# The fake harness has no installed phone APK; every real run must bind one.
if [ -z "${CAMPAIGN_APK_PATH:-}" ] && [ -z "${FAKE_DEV:-}" ]; then
  echo "refuse: CAMPAIGN_APK_PATH must point to the APK installed on the phone" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CAMPAIGN_ROOT="$REPO/scripts/campaign"
CONFIG="$REPO/campaigns/t20c.json"
SCRIPT="$REPO/campaigns/t20c/script.json"

export PKG="com.kalsa.app"
export ANDROID_SERIAL="$SERIAL"
export CAMPAIGN_SERIAL="$SERIAL"
export BENCH_TARGET=device
export MODEL_ID="lfm2.5-2.6b"
export LOCALE_VAL="it"
CAMPAIGN_TURN_TIMEOUT_MS=2700000
CAMPAIGN_TELEMETRY_GAP_MS=1800000
CAMPAIGN_POLL_MS=5000
CAMPAIGN_THERMAL_PAUSE=5
CAMPAIGN_THERMAL_MAX_C=42
CAMPAIGN_THERMAL_COOLDOWN_CAP_S="${CAMPAIGN_THERMAL_COOLDOWN_CAP_S:-600}"
export CAMPAIGN_TURN_TIMEOUT_MS CAMPAIGN_TELEMETRY_GAP_MS CAMPAIGN_POLL_MS \
  CAMPAIGN_THERMAL_PAUSE CAMPAIGN_THERMAL_MAX_C CAMPAIGN_THERMAL_COOLDOWN_CAP_S

export OUT="${OUT:-$REPO/results/t20c-campaign}"
mkdir -p "$OUT"

# shellcheck source=../../scripts/device-share-send.sh
source "$REPO/scripts/device-share-send.sh"
source "$CAMPAIGN_ROOT/flags.sh"
source "$CAMPAIGN_ROOT/conversation.sh"
source "$CAMPAIGN_ROOT/logcat.sh"
source "$CAMPAIGN_ROOT/watchdog.sh"
source "$CAMPAIGN_ROOT/recovery.sh"
source "$CAMPAIGN_ROOT/turn.sh"
source "$CAMPAIGN_ROOT/oneTurn.sh"
source "$CAMPAIGN_ROOT/metroPreflight.sh"

command -v campaign_metro_preflight >/dev/null 2>&1 || die "Metro gate unavailable: campaign_metro_preflight is not defined"
campaign_metro_preflight

COMPACTION_VAL="ciswire"
MEMORY_VAL="0"
TOOLHELP_VAL="0"
FLAG_PARAMS=""
CAMPAIGN_ARM_ID="T20C"
CAMPAIGN_VARIANT_ID="V1"
CAMPAIGN_CONV_ID="c1-V1"

# --- delta 1: charging gate -------------------------------------------------
CHARGING_FLAG="$OUT/.STOP-CHARGING"
BATTERY_FLOOR=8   # stop and report at/above this little left — a dead phone mid-prefill is another destroyed run
CAMPAIGN_MIN_BATTERY_LEVEL="${CAMPAIGN_MIN_BATTERY_LEVEL:-85}"
rm -f "$CHARGING_FLAG"

charging_or_status2() {
  local d st
  if ! d=$(adb -s "$SERIAL" shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r'); then
    return 2
  fi
  [ -n "$d" ] || return 2
  if printf '%s\n' "$d" | grep -qE '(AC|USB|Wireless|Dock) powered:[[:space:]]*true'; then return 0; fi
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
  case "$lvl" in ''|*[!0-9]*) return 1 ;; esac
  if [ "$lvl" -le "$BATTERY_FLOOR" ]; then
    stop_reason="battery level $lvl <= floor $BATTERY_FLOOR — stopping before an unplanned shutdown mid-prefill"
    return 0
  fi
  return 1
}

python3 -c 'import json,sys; json.dump(json.load(open(sys.argv[1]))["telemetry"], open(sys.argv[2],"w"))' \
  "$CONFIG" "$OUT/.telemetry-schema.json" || die "T20C preflight: could not write telemetry schema"

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
if [ -n "${CAMPAIGN_EXPECT_MODEL:-}" ]; then
  [ "$_device_model" = "$CAMPAIGN_EXPECT_MODEL" ] || die "device identity mismatch: expected model '$CAMPAIGN_EXPECT_MODEL', got '$_device_model'"
  # Record which physical device produced this evidence, not just that it matched.
  log "DEVICE IDENTITY: model=$_device_model serial=$SERIAL (matches CAMPAIGN_EXPECT_MODEL)"
else
  log "DEVICE IDENTITY: model=$_device_model (CAMPAIGN_EXPECT_MODEL unset; not enforcing)"
fi
device_thermal_gate
[ "${THERMAL_STATUS_AT_TURN:-unknown}" != unknown ] || die "thermal preflight refused: thermal status unreadable"
log "thermal preflight status=${THERMAL_STATUS_AT_TURN:-unknown} battery_deci=${THERMAL_BATTERY_DECI_AT_TURN:-unknown}"
device_keepawake_begin
campaign_logcat_start "$OUT/logcat.txt"
MON_PID=""
trap 'campaign_logcat_stop; [ -n "$MON_PID" ] && kill "$MON_PID" 2>/dev/null; device_termux_wakelock_restore; _device_session_restore' EXIT

charging_monitor &
MON_PID=$!
log "charging monitor pid=$MON_PID (30s poll)"

# --- delta 2: thermal recovery never kills the app --------------------------
# Overrides the shared recovery.sh / watchdog.sh / conversation.sh behavior,
# which force-stops the app on every thermal pause (what shredded the
# 2026-09-14 run: turns force-stopped mid-prefill, every relaunch cold).

# Wait for cool with the app alive and in foreground. Budget 600s (10 min);
# still hot after that -> die (run stops and reports, per run order).
campaign_thermal_cooldown() {
  campaign_thermal_cooldown_wait no
}

# Same-conversation restore is only needed when the app actually died. On a
# thermal pause the app is alive mid-conversation — do NOT touch it.
campaign_restore_same_conv() {
  if campaign_app_running; then
    log "restore: app still running (thermal path) — no force-stop, no relaunch"
    return 0
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

log "arm begin: flags->ciswire, wipe chat, launch"
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
  if ! campaign_one_turn "$i" "$user"; then
    log "WARN: turn $i failed — continuing loop"
    rc=1
  fi
  # Defect 2 (2026-09-16): a run whose completion signal is already gone can
  # only repeat the same 30-45 min wait. Stop at the first turn (from 2 on)
  # that ends without KALSA_TELEMETRY instead of grinding through the rest.
  if campaign_completion_signal_lost "$i" "$OUT/.slice.txt"; then
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
record_stats=$(python3 - "$jsonl" <<'PY'
import json
import sys

turns = set()
recoveries = 0
unparseable = 0
try:
    stream = open(sys.argv[1], encoding="utf-8")
except OSError:
    print("0 0 0")
    raise SystemExit(0)
with stream:
    for line in stream:
        try:
            record = json.loads(line)
        except (TypeError, ValueError):
            unparseable += 1
            continue
        if not isinstance(record, dict):
            unparseable += 1
        elif "event" in record:
            recoveries += 1
        elif isinstance(record.get("i"), int) and not isinstance(record.get("i"), bool):
            turns.add(record["i"])
        else:
            unparseable += 1
print(len(turns), recoveries, unparseable)
PY
) || die "T20C footer: could not count acceptance records in $jsonl"
turn_count=0
recovery_count=0
unparseable_count=0
read -r turn_count recovery_count unparseable_count <<EOF
$record_stats
EOF
if [ "$turn_count" -eq 20 ]; then
  log "T20C RUN COMPLETE — turns=$turn_count/20 recoveries=$recovery_count unparseable=$unparseable_count jsonl=$jsonl"
else
  log "T20C RUN INCOMPLETE — turns=$turn_count/20 recoveries=$recovery_count unparseable=$unparseable_count jsonl=$jsonl"
  [ "$rc" -ne 0 ] || rc=1
fi
exit "$rc"
