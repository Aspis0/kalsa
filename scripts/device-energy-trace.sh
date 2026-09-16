#!/usr/bin/env bash
#
# device-energy-trace.sh - record a battery/energy trace from ONE Android phone
# while a long campaign runs BESIDE it (this script never joins the campaign).
#
# READ-ONLY toward the device. The only adb calls are
#   adb -s "$SERIAL" shell 'cat /proc/uptime; echo ---; dumpsys battery'
# one round trip per sample so the device clock (t_s) and the battery reading
# come from the same instant. Nothing else is run on the device: no settings,
# no am/pm, no input, no install, no dumpsys battery set/unplug/reset, no root,
# no adb kill-server/disconnect. Every adb invocation carries an explicit -s.
#
# Output schema: kalsa-app-energy-trace-v1 - a COARSE framework-cadence trace
# from the Android framework's dumpsys battery (values refresh on the
# ACTION_BATTERY_CHANGED broadcast, 30-90 s under load, so a poll faster than
# that buys no resolution, only adb contention). This is NOT a battery-terminal
# sampler and NOT the frozen kalsa-energy-rep-v1/v2/v3 contract; do not join it
# as if it were.
#
# Parse guard (the likely bug in any dumpsys scraper): dumpsys battery ends with
# EventLogBuffer / BattActionChangedLogBuffer / Battery History sections that
# repeat level:/status/temperature/current_avg tokens from hours ago. Two
# independent guards in parse_dev_blob():
#   1. awk exits at the first history-section marker; nothing after is examined.
#   2. every field regex is anchored with ^ (plus optional indentation), so a
#      history line such as '<6>[ 64177.5] level: 11 ...' can never match.
#
# Units: dumpsys prints 'voltage:' in millivolts; the CSV column voltage_uv is
# converted to microvolts (x1000). 'temperature:' is already deci-Celsius.
#
# ok=true only when t_s and all required battery fields parsed. Required:
# t_s, charge_counter_uah, voltage_uv, level_pct, batt_temp_deci_c, status_code,
# plugged. Optional (Samsung-specific, may be absent without failing the row):
# current_now_ua, current_avg_ua. Missing values are written as EMPTY cells,
# never as 0 - a zero that means "no reading" is how a measurement lies.
#
# usage: device-energy-trace.sh -s SERIAL -o OUT.csv [-i SECONDS] [-d SECONDS]
#        device-energy-trace.sh --parse-fixture FILE
#
#   -s SERIAL   adb serial (or set ANDROID_SERIAL). Refuses to run if empty:
#               a bare adb could reach the other phone on this network.
#   -o OUT.csv  output file. Append-only. An existing non-empty file is
#               appended to only if its first three lines match this schema's
#               header exactly; otherwise the script refuses and exits.
#   -i SECONDS  poll interval, default 10. Values below 5 are refused.
#   -d SECONDS  optional total duration; default: run until SIGINT/SIGTERM.
#   --parse-fixture FILE
#               offline parser check: parse a captured
#               'cat /proc/uptime; echo ---; dumpsys battery' blob and print
#               one CSV row. No adb, no device, serial not needed.
#
# Exit codes: 0 clean stop, 2 usage/config refusal, 130 SIGINT, 143 SIGTERM.

set -euo pipefail

SCHEMA='kalsa-app-energy-trace-v1'
ADB="${ADB:-adb}"

HDR_COMMENT="# ${SCHEMA} | one CSV row per sample | source: Android framework 'dumpsys battery' (values refresh on ACTION_BATTERY_CHANGED, 30-90 s under load) | coarse framework-cadence trace, NOT a battery-terminal sampler, NOT kalsa-energy-rep-v1/v2/v3"
HDR_UNITS='# units: t_s=s uptime | charge_counter_uah=uAh | current_now_ua=uA | current_avg_ua=uA | voltage_uv=uV (dumpsys "voltage:" is mV, x1000) | level_pct=% | batt_temp_deci_c=deci-C as printed by dumpsys | status_code=BatteryManager status int | plugged,ok=true|false | ok=false => adb failed or a required field was missing; missing cells stay EMPTY, never 0'
HDR_COLS='host_iso,t_s,charge_counter_uah,current_now_ua,current_avg_ua,voltage_uv,level_pct,batt_temp_deci_c,status_code,plugged,ok'

die() {
  printf 'device-energy-trace: %s\n' "$*" >&2
  exit 2
}

usage() {
  sed -n '/^# usage:/,/^set -euo/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo/d'
}

is_int() { printf '%s' "${1-}" | grep -qE '^-?[0-9]+$'; }
is_dec() { printf '%s' "${1-}" | grep -qE '^[0-9]+(\.[0-9]+)?$'; }

# ---------------------------------------------------------------------------
# Parsing: stdin = dumpsys battery text, stdout = 8 lines in fixed order:
#   charge_counter_uah, current_now_ua, current_avg_ua, voltage_uv (mV*1000),
#   level_pct, batt_temp_deci_c, status_code, plugged
# Empty line = field absent or non-numeric. No zeros are invented.
# ---------------------------------------------------------------------------
parse_dev_blob() {
  awk '
    function after(s,  t) {
      t = s
      sub(/^[^:]*:[[:space:]]*/, "", t)
      sub(/[[:space:]]+$/, "", t)
      return t
    }
    function keep(k, s) {
      if (!(k in seen)) { seen[k] = 1; out[k] = after(s) }
    }
    function isint(s) { return s ~ /^-?[0-9]+$/ }

    # Guard 1: stop before any history section; nothing after this line is read.
    /^[[:space:]]*(EventLogBuffer|BattActionChangedLogBuffer|Battery History)[[:space:]]*:/ { exit }

    # Guard 2: anchored at the start of a line, then the exact field token.
    /^[[:space:]]*Charge counter[[:space:]]*:/ { keep("cc", $0) }
    /^[[:space:]]*current now[[:space:]]*:/   { keep("cn", $0) }
    /^[[:space:]]*current_avg[[:space:]]*:/   { keep("ca", $0) }
    /^[[:space:]]*voltage[[:space:]]*:/       { keep("v",  $0) }
    /^[[:space:]]*level[[:space:]]*:/         { keep("l",  $0) }
    /^[[:space:]]*temperature[[:space:]]*:/   { keep("t",  $0) }
    /^[[:space:]]*status[[:space:]]*:/        { keep("st", $0) }
    /^[[:space:]]*(AC|USB|Wireless|Dock) powered[[:space:]]*:/ {
      if (after($0) == "true")  p = 1
      if (after($0) == "false") f = 1
    }

    END {
      print (isint(out["cc"]) ? out["cc"] : "")
      print (isint(out["cn"]) ? out["cn"] : "")
      print (isint(out["ca"]) ? out["ca"] : "")
      print (isint(out["v"])  ? out["v"] * 1000 : "")
      print (isint(out["l"])  ? out["l"] : "")
      print (isint(out["t"])  ? out["t"] : "")
      print (isint(out["st"]) ? out["st"] : "")
      print (p ? "true" : (f ? "false" : ""))
    }
  '
}

# emit_row <host_iso> <raw blob>  -> one CSV row on stdout.
emit_row() {
  local host_iso="$1" raw="${2-}"
  local up dev parsed line req i=0
  local t_s="" charge="" cn="" ca="" volt="" level="" temp="" status="" plugged=""
  local ok="false"
  local -a f=()

  raw=${raw//$'\r'/}

  up=$(printf '%s\n' "$raw" | awk '/^---[[:space:]]*$/ { exit } { print; exit }')
  dev=$(printf '%s\n' "$raw" | awk '/^---[[:space:]]*$/ { seen=1; next } seen { print }')

  t_s="${up%% *}"
  is_dec "$t_s" || t_s=""

  if [ -n "$dev" ]; then
    parsed=$(printf '%s\n' "$dev" | parse_dev_blob)
    while IFS= read -r line; do
      f[$i]="$line"
      i=$((i + 1))
    done <<<"$parsed"
    charge="${f[0]:-}"
    cn="${f[1]:-}"
    ca="${f[2]:-}"
    volt="${f[3]:-}"
    level="${f[4]:-}"
    temp="${f[5]:-}"
    status="${f[6]:-}"
    plugged="${f[7]:-}"
  fi

  ok=true
  for req in "$t_s" "$charge" "$volt" "$level" "$temp" "$status" "$plugged"; do
    [ -n "$req" ] || ok=false
  done

  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$host_iso" "$t_s" "$charge" "$cn" "$ca" "$volt" "$level" "$temp" "$status" "$plugged" "$ok"
  return 0
}

# collect_row <serial> -> one CSV row on stdout. A failed adb read must never
# kill the loop and must never become a zero row: the || keeps the loop alive,
# emit_row writes ok=false with empty cells.
collect_row() {
  local serial="$1" host_iso raw=""
  host_iso=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  raw=$("$ADB" -s "$serial" shell 'cat /proc/uptime; echo ---; dumpsys battery' </dev/null 2>/dev/null) || raw=""
  emit_row "$host_iso" "$raw"
}

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
SERIAL="${ANDROID_SERIAL:-}"
OUT=""
INTERVAL=10
DURATION=""
FIXTURE=""

while [ $# -gt 0 ]; do
  case "$1" in
    -s) [ $# -ge 2 ] || die "-s needs a serial"; SERIAL="$2"; shift 2 ;;
    -o) [ $# -ge 2 ] || die "-o needs a path";   OUT="$2";    shift 2 ;;
    -i) [ $# -ge 2 ] || die "-i needs seconds";  INTERVAL="$2"; shift 2 ;;
    -d) [ $# -ge 2 ] || die "-d needs seconds";  DURATION="$2"; shift 2 ;;
    --parse-fixture) [ $# -ge 2 ] || die "--parse-fixture needs a file"; FIXTURE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

is_int "$INTERVAL" || die "interval must be an integer number of seconds"
if [ "$INTERVAL" -lt 5 ]; then
  die "interval ${INTERVAL}s refused: dumpsys battery only refreshes on ACTION_BATTERY_CHANGED (30-90 s under load), a faster poll adds adb contention without adding resolution"
fi
if [ -n "$DURATION" ]; then
  is_int "$DURATION" || die "duration must be an integer number of seconds"
  [ "$DURATION" -ge 1 ] || die "duration must be >= 1s"
fi

if [ -n "$FIXTURE" ]; then
  [ -f "$FIXTURE" ] || die "fixture not found: $FIXTURE"
  raw=$(cat -- "$FIXTURE") || die "cannot read fixture: $FIXTURE"
  emit_row "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$raw"
  exit 0
fi

[ -n "$SERIAL" ] || die "no serial: pass -s SERIAL or set ANDROID_SERIAL. Refusing to run, a bare adb could reach the other phone on this network"
case "$SERIAL" in
  -*) die "serial must not start with '-': $SERIAL" ;;
  *[!A-Za-z0-9._:-]*) die "serial has unsupported characters: $SERIAL" ;;
esac
[ -n "$OUT" ] || die "no output file: pass -o OUT.csv"

# ---------------------------------------------------------------------------
# Output file: never truncate, never destroy. Header must match on append.
# ---------------------------------------------------------------------------
if [ -e "$OUT" ] && [ ! -f "$OUT" ]; then
  die "output path exists and is not a regular file: $OUT"
fi

if [ -s "$OUT" ]; then
  got1=$(sed -n '1p' "$OUT")
  got2=$(sed -n '2p' "$OUT")
  got3=$(sed -n '3p' "$OUT")
  if [ "$got1" != "$HDR_COMMENT" ] || [ "$got2" != "$HDR_UNITS" ] || [ "$got3" != "$HDR_COLS" ]; then
    die "refusing to append to $OUT: header is not ${SCHEMA} (not this instrument's trace)"
  fi
  printf 'device-energy-trace: appending to existing %s trace: %s\n' "$SCHEMA" "$OUT" >&2
else
  printf '%s\n' "$HDR_COMMENT" "$HDR_UNITS" "$HDR_COLS" >>"$OUT" || die "cannot write header to $OUT"
fi

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
SLEEP_PID=""
STOP_REASON=""
N_SAMPLES=0
N_FAILED=0
TRACE_STARTED=0

cleanup() {
  if [ -n "${SLEEP_PID:-}" ]; then
    kill "$SLEEP_PID" 2>/dev/null || true
    wait "$SLEEP_PID" 2>/dev/null || true
    SLEEP_PID=""
  fi
}

finish() {
  cleanup
  if [ "${TRACE_STARTED:-0}" = 1 ]; then
    printf 'device-energy-trace: stopped (%s): %d samples, %d with ok=false -> %s\n' \
      "${STOP_REASON:-exit}" "${N_SAMPLES:-0}" "${N_FAILED:-0}" "$OUT" >&2
  fi
}

on_signal() {
  STOP_REASON="$1"
  exit "$2"
}

nap() {
  # Foreground sleep cannot be interrupted by a trap; a tracked background
  # sleep that cleanup() always kills can. No untracked children remain.
  sleep "$1" &
  SLEEP_PID=$!
  wait "$SLEEP_PID" 2>/dev/null || true
  SLEEP_PID=""
}

trap 'on_signal INT 130' INT
trap 'on_signal TERM 143' TERM
trap 'finish' EXIT

END_EPOCH=""
if [ -n "$DURATION" ]; then
  END_EPOCH=$(( $(date +%s) + DURATION ))
fi

TRACE_STARTED=1
printf 'device-energy-trace: %s via serial=%s interval=%ss -> %s (SIGINT/SIGTERM to stop)\n' \
  "$SCHEMA" "$SERIAL" "$INTERVAL" "$OUT" >&2

while :; do
  row=$(collect_row "$SERIAL")
  printf '%s\n' "$row" >>"$OUT" || die "cannot append to $OUT"
  N_SAMPLES=$((N_SAMPLES + 1))
  case "$row" in
    *,false)
      N_FAILED=$((N_FAILED + 1))
      printf 'device-energy-trace: sample %d ok=false (adb read failed or required field missing)\n' "$N_SAMPLES" >&2
      ;;
  esac
  if [ -n "$END_EPOCH" ] && [ "$(date +%s)" -ge "$END_EPOCH" ]; then
    STOP_REASON="duration ${DURATION}s reached"
    break
  fi
  nap "$INTERVAL"
done

exit 0
