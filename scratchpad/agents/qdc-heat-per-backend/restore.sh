#!/bin/bash
# Undo every device change d_run.sh makes, after any abnormal end (SIGKILL,
# crash, session abort): stay-on, screen timeout, disabled keyguard, sampler.
# Usage: bash restore.sh          (ADB_PORT/ADB_BIN overridable, as in d_run.sh)
set -u
OUT="$(cd "$(dirname "$0")" && pwd)"
ADB_PORT="${ADB_PORT:-6037}"; case "$ADB_PORT" in 6037|6039) ;; *) echo "ADB_PORT must be 6037 or 6039" >&2; exit 2;; esac
export LC_ALL=C ANDROID_ADB_SERVER_PORT="$ADB_PORT"
ADB_BIN="${ADB_BIN:-/opt/homebrew/bin/adb}"
SER=""; SCREEN_OFF_TIMEOUT=60000
# Written by d_run.sh right after configure_screen; source it for the pre-run
# timeout and the serial (restores the values cleanup would have restored).
[ -f "$OUT/.restore-state" ] && . "$OUT/.restore-state"
# A serial from an old .restore-state (device swapped since) would fail every
# command below; drop it and fall back to whatever is connected now.
if [ -n "$SER" ] && ! "$ADB_BIN" -s "$SER" get-state >/dev/null 2>&1; then
  SER=""
fi
if [ -z "$SER" ]; then
  SER=$("$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }' | tr -d '\r')
fi
[ -n "$SER" ] || { echo "NO_DEVICE on $ADB_PORT" >&2; exit 2; }
case "$SCREEN_OFF_TIMEOUT" in ''|*[!0-9]*) SCREEN_OFF_TIMEOUT=60000 ;; esac
HEAT_TMP=/data/local/tmp/kalsa-heat/heat
rc=0
"$ADB_BIN" -s "$SER" shell svc power stayon false >/dev/null 2>&1 || rc=1
"$ADB_BIN" -s "$SER" shell locksettings set-disabled false >/dev/null 2>&1 || rc=1
"$ADB_BIN" -s "$SER" shell settings put system screen_off_timeout "$SCREEN_OFF_TIMEOUT" >/dev/null 2>&1 || rc=1
"$ADB_BIN" -s "$SER" shell "touch $HEAT_TMP/stop" >/dev/null 2>&1 || true
pkill -f "$HEAT_TMP/smp.sh" 2>/dev/null || true
echo "restored serial=$SER stayon=false screen_off_timeout=$SCREEN_OFF_TIMEOUT keyguard=enabled sampler=stopped rc=$rc"
exit "$rc"
