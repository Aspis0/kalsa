#!/bin/bash
# restore.sh — undo every device change d_run.sh makes, after any end: normal,
# stop, signal, or SIGKILL of the driver. One responsibility: restore the
# device. It is called from d_run.sh's EXIT trap (normal path) and standalone
# after an abnormal end.
#
# Changes d_run.sh makes, and their inverse here: the saved
# stay_on_while_plugged_in value restored (A13 — the previous value, not a
# guessed `stayon false`); screen_off_timeout saved -> restored (or deleted
# if it was absent); the 1 s sampler -> stop marker + host pkill; a mid-arm
# llama-completion -> device pkill with the bracketed non-self-matching
# pattern (A3). Kit/model/prompt files under $D are left in place
# (npu-spec-verify does the same; deleting 1.59 GB is a separate decision,
# not a restore).
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
SER=""; SCREEN_OFF_TIMEOUT=""; STAYON=""; JOB=""
STATE_PRESENT=0
if [ -f "$CELL/.restore-state" ]; then
  . "$CELL/.restore-state"
  STATE_PRESENT=1
fi
[ -n "$STAYON" ] || STAYON=null
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
# A3: bracketed so the wrapping `sh -c` carrying this very pattern is not
# matched and killed by its own pkill. A-4: the kill is VERIFIED — pgrep RC=1
# (gone) is the only pass; still-running or tool-missing fails the restore
# loudly instead of pretending the phone is clean.
llama_rc=$("$ADB_BIN" -s "$SER" shell "pkill -f 'llama-completio[n]'; pgrep -f 'llama-completio[n]' >/dev/null 2>&1; echo PGREP_RC=\$?" 2>/dev/null | tr -d '\r' || true)
case "$llama_rc" in
  *PGREP_RC=1*) ;;
  *) echo "RESTORE_LLAMA_STILL_RUNNING pgrep=[$llama_rc]" >&2; rc=1 ;;
esac
if [ "$STATE_PRESENT" -eq 1 ]; then
  # A13: put back exactly what was read before the mutation (d_run.sh's
  # `svc power stayon true` overwrites this global with 3).
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
fi
{
  printf 'restore %s serial=%s state=%s stayon_restored=%s screen_off_timeout=%s sampler=stopped llama=pkill rc=%s\n' \
    "$(date '+%F %T')" "$SER" "$STATE_PRESENT" "$STAYON" "${SCREEN_OFF_TIMEOUT:-na}" "$rc"
} >> "$RESTORE_LOG"
exit "$rc"
