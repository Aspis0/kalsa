#!/usr/bin/env bash
# Prove the adb, run-as, WAL-safe SQLite, and UI chain on one real phone.
set -uo pipefail

OUT="${OUT:-out/device/preflight}"
mkdir -p "$OUT"
PKG="${PKG:-com.kalsa.app}"
BENCH_TARGET=device

# shellcheck source=../ci/ci-lib.sh
source "$(dirname "$0")/../ci/ci-lib.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

die() {
  fail "SQL path: $*"
}

if ! devices=$(adb devices 2>/dev/null); then
  fail "device discovery (adb devices failed)"
fi
attached=$(printf '%s\n' "$devices" | awk '$2 == "device" {print $1}')
attached_count=$(printf '%s\n' "$attached" | awk 'NF {n++} END {print n + 0}')
[ "$attached_count" -eq 1 ] \
  || fail "device discovery (expected exactly one attached device, found $attached_count)"
serial="$attached"
case "$serial" in
  emulator-*) fail "device discovery (attached serial $serial is an emulator)" ;;
esac
if ! qemu=$(adb shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r'); then
  fail "device discovery (could not read ro.kernel.qemu)"
fi
case "$qemu" in
  1|true) fail "device discovery (ro.kernel.qemu=$qemu identifies an emulator)" ;;
esac
echo "PASS: exactly one attached non-emulator device ($serial)"

if ! run_as_id=$(adb shell "run-as $PKG id" 2>/dev/null | tr -d '\r'); then
  fail "debuggable APK (run-as $PKG id failed)"
fi
[ -n "$run_as_id" ] || fail "debuggable APK (run-as returned no id)"
printf 'PASS: debuggable APK, run-as id="%s"\n' "$run_as_id"

if ! row_count=$(sql "SELECT count(*) FROM catalystLocalStorage;"); then
  fail "database read path (run-as pull or host sqlite3 failed)"
fi
row_count=$(printf '%s' "$row_count" | tr -d '[:space:]')
case "$row_count" in
  ''|*[!0-9]*) fail "database read path (count(*) was '$row_count')" ;;
esac
echo "PASS: database read path, catalystLocalStorage count=$row_count"

# Fix 3: the throwaway key kalsa.bench.preflight is written below and only
# deleted on the happy path. Any failure after the insert would leave it in
# the device DB (and thus in every later campaign's prefs.txt). Trap cleanup
# that removes it on any exit once it has been written. Idempotent: a DELETE
# on an absent key is a no-op, and the happy-path delete sets a flag so the
# trap skips an already-removed key.
PREF_KEY_WRITTEN=0
PREF_KEY_DELETED=0
cleanup_preflight_key() {
  trap '' EXIT   # guard against re-entrancy from sql_write's own die
  if [ "$PREF_KEY_WRITTEN" -eq 1 ] && [ "$PREF_KEY_DELETED" -ne 1 ]; then
    sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.bench.preflight';" \
      "kalsa.bench.preflight" "__ABSENT__" >/dev/null 2>&1 || true
  fi
}
trap cleanup_preflight_key EXIT

adb shell am force-stop "$PKG" >/dev/null 2>&1 \
  || fail "write round-trip (could not force-stop $PKG)"
sleep 2
preflight_value="device-preflight-$$-$(date +%s)"
# Mark the throwaway key as written so the EXIT trap cleans it up if any
# later step in the round-trip fails (Fix 3).
PREF_KEY_WRITTEN=1
if ! sql_write "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.preflight','$preflight_value');" \
  "kalsa.bench.preflight" "$preflight_value"; then
  fail "write round-trip (insert failed)"
fi
if ! read_back=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.preflight';"); then
  fail "write round-trip (read-back failed)"
fi
[ "$read_back" = "$preflight_value" ] \
  || fail "write round-trip (read-back was '$read_back')"
if ! sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.bench.preflight';" \
  "kalsa.bench.preflight" "__ABSENT__"; then
  fail "write round-trip (delete failed)"
fi
PREF_KEY_DELETED=1
if ! gone=$(sql "SELECT value FROM catalystLocalStorage WHERE key='kalsa.bench.preflight';"); then
  fail "write round-trip (post-delete read failed)"
fi
[ -z "$gone" ] || fail "write round-trip (throwaway key remains: '$gone')"
echo "PASS: stopped-app write/read/delete round-trip"

adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 \
  || fail "UI input path (could not launch $PKG)"
sleep 3
if ! ui=$(adb shell uiautomator dump /data/local/tmp/kalsa-preflight-ui.xml >/dev/null 2>&1 \
  && adb shell cat /data/local/tmp/kalsa-preflight-ui.xml 2>/dev/null | tr -d '\r'); then
  fail "UI input path (uiautomator dump failed)"
fi
printf '%s' "$ui" | grep -q '<hierarchy' \
  || fail "UI input path (dump did not contain a hierarchy)"
node_count=$(printf '%s' "$ui" | grep -o '<node ' | wc -l | tr -d ' ')
[ "$node_count" -gt 0 ] || fail "UI input path (dump contained no nodes)"
adb shell input text KalsaPreflight >/dev/null 2>&1 \
  || fail "UI input path (input text failed)"
echo "PASS: uiautomator dump + input text usable (nodes=$node_count)"

command -v sqlite3 >/dev/null 2>&1 \
  || fail "host sqlite3 (sqlite3 is not on PATH)"
if ! sqlite_version=$(sqlite3 --version 2>&1); then
  fail "host sqlite3 (could not get version)"
fi
echo "PASS: host sqlite3 ($sqlite_version)"

battery=$(adb shell dumpsys battery 2>/dev/null | tr -d '\r' || true)

# dumpsys battery indents every field by two spaces, so a naive `-F': '`
# split leaves $1 == "  level" and never matches (Fix 2). Match the field
# name anchored to a leading "name:" and strip surrounding whitespace.
battery_field() {
  printf '%s\n' "$battery" | awk -v f="$1" '
    $0 ~ "^[[:space:]]*" f ":[[:space:]]" {
      sub("^[[:space:]]*" f ":[[:space:]]*", "")
      sub("[[:space:]]*$", "")
      print
      exit
    }'
}

battery_level=$(battery_field "level")
usb_powered=$(battery_field "USB powered")
battery_temp_raw=$(battery_field "temperature")
# dumpsys reports temperature in tenths of a degree (282 → 28.2 °C, Fix 2).
battery_temp="unknown"
if [ -n "$battery_temp_raw" ]; then
  battery_temp=$(awk -v t="$battery_temp_raw" 'BEGIN { printf "%.1f", t / 10 }')" °C"
fi

echo "PASS: battery level=${battery_level:-unknown}, USB powered: ${usb_powered:-unknown}, temperature=${battery_temp:-unknown}"
if [ "$usb_powered" = "true" ]; then
  echo "WARNING: USB powered: true — a campaign must run UNPLUGGED" >&2
fi
