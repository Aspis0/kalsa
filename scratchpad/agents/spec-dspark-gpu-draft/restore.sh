#!/bin/bash
# restore.sh — undo every device change d_run.sh makes, after ANY end: normal
# (EXIT trap), stop, signal, or a SIGKILL of the driver (then run it manually
# or let the next run repair it). One responsibility: restore the device.
#
# Written in this cell (not copied from qdc-heat-3way, whose restore.sh is
# being fixed in parallel): it must stay runnable standalone with only
# $ADB_BIN/$ADB_PORT/env and ./.restore-state. Changes to undo, and their
# inverse: stay_on_while_plugged_in -> put back the saved value (never a
# guessed `stayon false`), screen_off_timeout -> saved value or delete if it
# was absent, and the cell's binary -> device pkill with the bracketed pattern
# (belt and braces; the verified kill lives in d_run.sh). Kit/model files under
# $D stay (npu-spec-verify precedent: deleting 2 GB is a separate decision).
#
# .restore-state is written by d_run.sh BEFORE the first mutation, so its
# presence gates the settings restore: without it nothing was changed and
# writing a guessed default would itself be a device change.
set -euo pipefail
CELL="$(cd "$(dirname "$0")" && pwd)"
ADB_PORT="${ADB_PORT:-5037}"
case "$ADB_PORT" in 5037|6037|6039) ;; *) echo "ADB_PORT must be 5037, 6037, or 6039" >&2; exit 2 ;; esac
export LC_ALL=C ANDROID_ADB_SERVER_PORT="$ADB_PORT"
ADB_BIN="${ADB_BIN:-/opt/homebrew/bin/adb}"
D=/data/local/tmp/dspark-spec
SER=""; SCREEN_OFF_TIMEOUT=""; STAYON=""; JOB=""
STATE_PRESENT=0
if [ -f "$CELL/.restore-state" ]; then
  # shellcheck disable=SC1091
  . "$CELL/.restore-state"
  STATE_PRESENT=1
fi
[ -n "$STAYON" ] || STAYON=null
[ -n "$SCREEN_OFF_TIMEOUT" ] || SCREEN_OFF_TIMEOUT=null
RESTORE_LOG="$CELL/restore.log"
if [ -n "$JOB" ] && [ -d "$CELL/raw/$JOB" ]; then RESTORE_LOG="$CELL/raw/$JOB/restore.log"; fi
if [ -n "$SER" ] && ! "$ADB_BIN" -s "$SER" get-state >/dev/null 2>&1; then SER=""; fi
if [ -z "$SER" ]; then
  SER=$("$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }' | tr -d '\r' || true)
fi
[ -n "$SER" ] || { echo "RESTORE_NO_DEVICE port=$ADB_PORT" >&2; exit 2; }
rc=0
# Bracketed so the wrapping sh -c carrying this pattern cannot self-match.
"$ADB_BIN" -s "$SER" shell "pkill -f 'llama-speculative-simpl[e]'" >/dev/null 2>&1 || true
if [ "$STATE_PRESENT" -eq 1 ]; then
  case "$STAYON" in
    null) "$ADB_BIN" -s "$SER" shell settings delete global stay_on_while_plugged_in >/dev/null 2>&1 || rc=1 ;;
    ''|*[!0-9]*) echo "RESTORE_BAD_STAYON value=$STAYON" >&2; rc=1 ;;
    *) "$ADB_BIN" -s "$SER" shell settings put global stay_on_while_plugged_in "$STAYON" >/dev/null 2>&1 || rc=1 ;;
  esac
  case "$SCREEN_OFF_TIMEOUT" in
    null) "$ADB_BIN" -s "$SER" shell settings delete system screen_off_timeout >/dev/null 2>&1 || rc=1 ;;
    ''|*[!0-9]*) echo "RESTORE_BAD_TIMEOUT value=$SCREEN_OFF_TIMEOUT" >&2; rc=1 ;;
    *) "$ADB_BIN" -s "$SER" shell settings put system screen_off_timeout "$SCREEN_OFF_TIMEOUT" >/dev/null 2>&1 || rc=1 ;;
  esac
  rm -f "$CELL/.restore-state"
fi
{
  printf 'restore %s serial=%s state=%s stayon_restored=%s screen_off_timeout=%s pkill=spec-simple rc=%s\n' \
    "$(date '+%F %T')" "$SER" "$STATE_PRESENT" "$STAYON" "${SCREEN_OFF_TIMEOUT:-na}" "$rc"
} >> "$RESTORE_LOG"
exit "$rc"
