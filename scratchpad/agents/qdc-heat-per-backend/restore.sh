#!/bin/bash
# Undo every device change d_run.sh makes, after any abnormal end (SIGKILL,
# crash, session abort): stay-on, screen timeout, disabled keyguard, sampler,
# the running app, and the bench prefs set_prefs wrote.
# Usage: bash restore.sh          (ADB_PORT/ADB_BIN overridable, as in d_run.sh)
set -u
OUT="$(cd "$(dirname "$0")" && pwd)"
ADB_PORT="${ADB_PORT:-6037}"; case "$ADB_PORT" in 6037|6039) ;; *) echo "ADB_PORT must be 6037 or 6039" >&2; exit 2;; esac
export LC_ALL=C ANDROID_ADB_SERVER_PORT="$ADB_PORT"
ADB_BIN="${ADB_BIN:-/opt/homebrew/bin/adb}"
PKG=com.kalsa.app
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
# Force-stop before touching anything app-owned: no writer races the DB edit
# and a runaway turn stops heating immediately.
"$ADB_BIN" -s "$SER" shell "am force-stop $PKG" >/dev/null 2>&1 || rc=1
"$ADB_BIN" -s "$SER" shell svc power stayon false >/dev/null 2>&1 || rc=1
"$ADB_BIN" -s "$SER" shell locksettings set-disabled false >/dev/null 2>&1 || rc=1
"$ADB_BIN" -s "$SER" shell settings put system screen_off_timeout "$SCREEN_OFF_TIMEOUT" >/dev/null 2>&1 || rc=1
"$ADB_BIN" -s "$SER" shell "touch $HEAT_TMP/stop" >/dev/null 2>&1 || true
pkill -f "$HEAT_TMP/smp.sh" 2>/dev/null || true

# Bench prefs set by set_prefs (parse.sh:165), removed as the whole
# kalsa.bench.* namespace so the app falls back to its defaults:
# kalsa.bench.thermo, kalsa.bench.governor_force, kalsa.bench.sampling,
# kalsa.bench.toolchoice. The other driver-set keys (kalsa.model.id,
# kalsa.governor.enabled, kalsa.web.enabled, kalsa.tools.device,
# kalsa.tools.calendar) are ordinary app settings, not bench overrides, and
# no pre-run value was recorded for them, so they are left in place.
# Same pull-edit-push round trip as set_prefs (pull RKStorage + wal + shm,
# sqlite DELETE, checkpoint, push, run-as copy, drop device-side wal/shm).
bench_prefs_clear() {
  local dir remote
  dir=$(mktemp -d /tmp/kalsa-restore.XXXXXX) || return 1
  "$ADB_BIN" -s "$SER" shell chmod 771 /data >/dev/null 2>&1 || { rm -rf "$dir"; return 1; }
  "$ADB_BIN" -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage > "$dir/RKStorage" 2>/dev/null || { rm -rf "$dir"; return 1; }
  # The test needs run-as too: databases/ lives in the app's private dir,
  # so a bare `test -f` outside run-as always says "not found" (d3f85707).
  if "$ADB_BIN" -s "$SER" shell "run-as $PKG test -f databases/RKStorage-wal" >/dev/null 2>&1; then
    "$ADB_BIN" -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage-wal > "$dir/RKStorage-wal" 2>/dev/null || { rm -rf "$dir"; return 1; }
  fi
  if "$ADB_BIN" -s "$SER" shell "run-as $PKG test -f databases/RKStorage-shm" >/dev/null 2>&1; then
    "$ADB_BIN" -s "$SER" exec-out run-as "$PKG" cat databases/RKStorage-shm > "$dir/RKStorage-shm" 2>/dev/null || { rm -rf "$dir"; return 1; }
  fi
  /usr/bin/sqlite3 -bail "$dir/RKStorage" "DELETE FROM catalystLocalStorage WHERE key LIKE 'kalsa.bench.%';" >/dev/null || { rm -rf "$dir"; return 1; }
  /usr/bin/sqlite3 -bail "$dir/RKStorage" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null || { rm -rf "$dir"; return 1; }
  remote="$HEAT_TMP/rkstorage-restore-$$"
  "$ADB_BIN" -s "$SER" shell "mkdir -p $HEAT_TMP" >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$SER" push "$dir/RKStorage" "$remote" >/dev/null 2>&1 || { rm -rf "$dir"; return 1; }
  # The cp and the wal/shm removal run as the app uid; the pushed file is NOT
  # removed inside this chain: $HEAT_TMP is shell-owned 0755, so the app uid
  # cannot unlink from it. Folding `rm -f $remote` into the chain is what made
  # every restore exit rc=1 while the DB itself was restored fine (leftover
  # rkstorage-restore-* on both QRD8650 units, 2026-09-26 sessions); set_prefs
  # (parse.sh) always removed the remote as shell in a separate step.
  printf 'restore %s serial=%s\n' "$(date '+%F %T')" "$SER" >> "$OUT/restore-prefs.log"
  "$ADB_BIN" -s "$SER" shell "run-as $PKG sh -c 'cp $remote databases/RKStorage && rm -f databases/RKStorage-wal databases/RKStorage-shm'" >> "$OUT/restore-prefs.log" 2>&1 || { rm -rf "$dir"; return 1; }
  # As shell uid (glob expands on-device): also sweeps stale leftovers from
  # the pre-fix restores. Must not fail the restore.
  "$ADB_BIN" -s "$SER" shell "rm -f $HEAT_TMP/rkstorage-restore-*" >/dev/null 2>&1 || true
  rm -rf "$dir"
  return 0
}
bench_prefs_clear || rc=1
echo "restored serial=$SER stayon=false screen_off_timeout=$SCREEN_OFF_TIMEOUT keyguard=enabled sampler=stopped app=force-stopped bench_prefs=removed rc=$rc"
exit "$rc"
