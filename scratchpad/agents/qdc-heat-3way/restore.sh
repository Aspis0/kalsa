#!/bin/bash
# restore.sh — undo every device change d_run.sh makes, after any end: normal,
# stop, signal, or SIGKILL of the driver. One responsibility: restore the
# device. It is called from d_run.sh's EXIT trap (normal path) and standalone
# after an abnormal end.
#
# Changes d_run.sh makes, and their inverse here: stayon true -> false;
# screen_off_timeout saved -> restored (or deleted if it was absent); the
# 1 s sampler -> stop marker + host pkill; a mid-arm llama-completion (only
# possible after a stop kill) -> device pkill. Kit/model/prompt files under
# $D are left in place (npu-spec-verify does the same; deleting 1.59 GB is a
# separate decision, not a restore).
#
# .restore-state is written by d_run.sh BEFORE the first mutation, so its
# presence gates the settings restore: without it nothing was changed and
# writing a guessed default timeout would itself be a device change.
set -euo pipefail
CELL="$(cd "$(dirname "$0")" && pwd)"
ADB_PORT="${ADB_PORT:-5037}"
case "$ADB_PORT" in 5037|6037|6039) ;; *) echo "ADB_PORT must be 5037, 6037, or 6039" >&2; exit 2;; esac
export LC_ALL=C ANDROID_ADB_SERVER_PORT="$ADB_PORT"
ADB_BIN="${ADB_BIN:-/opt/homebrew/bin/adb}"
D=/data/local/tmp/heat3way
HEAT_TMP=$D/heat
SER=""; SCREEN_OFF_TIMEOUT=""; JOB=""
STATE_PRESENT=0
if [ -f "$CELL/.restore-state" ]; then
  . "$CELL/.restore-state"
  STATE_PRESENT=1
fi
# Per-session log when the session's RAW dir exists (normal and post-SIGKILL
# paths); cell-level fallback when .restore-state is absent or stale.
RESTORE_LOG="$CELL/restore.log"
if [ -n "$JOB" ] && [ -d "$CELL/raw/$JOB" ]; then RESTORE_LOG="$CELL/raw/$JOB/restore.log"; fi
if [ -n "$SER" ] && ! "$ADB_BIN" -s "$SER" get-state >/dev/null 2>&1; then SER=""; fi
if [ -z "$SER" ]; then
  SER=$("$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }' | tr -d '\r' || true)
fi
[ -n "$SER" ] || { echo "RESTORE_NO_DEVICE port=$ADB_PORT" >&2; exit 2; }
rc=0
"$ADB_BIN" -s "$SER" shell "touch $HEAT_TMP/stop" >/dev/null 2>&1 || true
pkill -f "$HEAT_TMP/smp.sh" 2>/dev/null || true
"$ADB_BIN" -s "$SER" shell pkill -f llama-completion >/dev/null 2>&1 || true
if [ "$STATE_PRESENT" -eq 1 ]; then
  "$ADB_BIN" -s "$SER" shell svc power stayon false >/dev/null 2>&1 || rc=1
  case "$SCREEN_OFF_TIMEOUT" in
    null) "$ADB_BIN" -s "$SER" shell settings delete system screen_off_timeout >/dev/null 2>&1 || rc=1 ;;
    ''|*[!0-9]*) echo "RESTORE_BAD_TIMEOUT value=$SCREEN_OFF_TIMEOUT" >&2; rc=1 ;;
    *) "$ADB_BIN" -s "$SER" shell settings put system screen_off_timeout "$SCREEN_OFF_TIMEOUT" >/dev/null 2>&1 || rc=1 ;;
  esac
fi
{
  printf 'restore %s serial=%s state=%s stayon=false screen_off_timeout=%s sampler=stopped llama=pkill rc=%s\n' \
    "$(date '+%F %T')" "$SER" "$STATE_PRESENT" "${SCREEN_OFF_TIMEOUT:-na}" "$rc"
} >> "$RESTORE_LOG"
exit "$rc"
