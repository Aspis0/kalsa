#!/usr/bin/env bash
# Shared adb/emulator helpers for Kalsa CI scripts (ci-e2e.sh, ci-bench.sh).
# Proven on a KVM-accelerated GitHub Actions runner (run 30836136405 passed:
# reply after 516s). Bounds-based tap_node, ui_texts, sql idioms are reused
# verbatim — do not "simplify" them, the fixed-coordinate approach they
# replaced was flaky (a 320x640 default AVD once swallowed every tap).
#
# Contract: the sourcing script must set OUT (evidence dir, already created)
# and may override PKG before sourcing this file.
set -uo pipefail

PKG="${PKG:-com.kalsa.app}"
DB="/data/data/$PKG/databases/RKStorage"
BENCH_TARGET="${BENCH_TARGET:-emulator}"
# Keep-awake ceiling applied to system screen_off_timeout on a device arm (ms).
# 24h covers the full length of any single arm; it is always saved+restored
# on exit, so a dev phone is never left with a long timeout.
KA_SCREEN_TIMEOUT_MS=86400000

# ── Device thermal gate (unplugged measurement discipline) ───────────
# Measured on an unplugged S23 16-turn arm: battery 44.1 °C and
# dumpsys thermalservice → Thermal Status: 3 (SEVERE) while reply times
# roughly doubled vs a cool phone (turn 7: 505 s vs 237 s). Numbers that
# drift with temperature cannot be compared — including with earlier turns
# of the same arm. Pause above the hot ceiling; resume below the cool floor.
# Android thermal status: 0=NONE … 3=SEVERE … 6=SHUTDOWN.
# Battery temperature from dumpsys battery is tenths of a degree Celsius.
THERMAL_STATUS_PAUSE=3            # SEVERE and above → pause before the turn
THERMAL_STATUS_RESUME=1           # LIGHT or cooler → cool enough to resume
THERMAL_BATTERY_PAUSE_DECI=440    # 44.0 °C
THERMAL_BATTERY_RESUME_DECI=390   # 39.0 °C
THERMAL_POLL_S=30
THERMAL_WAIT_CAP_S=1200           # 20 min; then die naming the thermal state

log() { echo "[ci] $*"; }
dump_ui() { adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1; adb shell cat /data/local/tmp/ui.xml 2>/dev/null; }
ui_texts() { dump_ui | grep -o 'text="[^"]\{1,200\}"' | sed 's/^text="//; s/"$//'; }
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null; }

_device_pull_db() {
  local dir="$1"
  local files="RKStorage"
  # Decide which siblings exist before the pull so we can tolerate an
  # absent -wal/-shm (a freshly checkpointed DB has none).
  adb shell "run-as $PKG test -f databases/RKStorage-wal" >/dev/null 2>&1 && files="$files RKStorage-wal"
  adb shell "run-as $PKG test -f databases/RKStorage-shm" >/dev/null 2>&1 && files="$files RKStorage-shm"

  # ONE stream for all three files (Fix 1): pulling base + WAL + shm in a
  # single `tar cf -` shrinks the window in which the app can checkpoint
  # between the base file and its WAL/shm siblings, so we never get base
  # state A with WAL frames from state B→C. If tar is unavailable in the
  # app's run-as environment, fall back to three separate cats below.
  if adb exec-out run-as "$PKG" tar cf - -C databases $files 2>/dev/null \
       | tar xf - -C "$dir" 2>/dev/null; then
    local f all_ok=1
    for f in $files; do [ -f "$dir/$f" ] || all_ok=0; done
    [ "$all_ok" -eq 1 ] && return 0
  fi

  # Fallback: tar absent or failed — re-pull each file with a separate cat,
  # tolerating absent -wal/-shm.
  rm -f "$dir/RKStorage" "$dir/RKStorage-wal" "$dir/RKStorage-shm"
  adb exec-out run-as "$PKG" cat databases/RKStorage > "$dir/RKStorage" 2>/dev/null || return 1
  case " $files " in
    *" RKStorage-wal "*) adb exec-out run-as "$PKG" cat databases/RKStorage-wal > "$dir/RKStorage-wal" 2>/dev/null || return 1 ;;
  esac
  case " $files " in
    *" RKStorage-shm "*) adb exec-out run-as "$PKG" cat databases/RKStorage-shm > "$dir/RKStorage-shm" 2>/dev/null || return 1 ;;
  esac
  [ -f "$dir/RKStorage" ] || return 1
}

# Validate a pulled copy before trusting it (Fix 1). quick_check must report
# exactly "ok" — an inconsistent base/WAL pair reports corruption here instead
# of silent garbage or a malformed-image error downstream.
_device_db_ok() {
  local db="$1"
  [ -f "$db" ] || return 1
  [ "$(sqlite3 "$db" "PRAGMA quick_check;" 2>/dev/null | tr -d '\r')" = "ok" ] || return 1
}

sql() {
  if [ "$BENCH_TARGET" = "emulator" ]; then
    adb shell "sqlite3 $DB \"$1\"" 2>&1 | tr -d '\r'
    return
  fi

  local dir status attempt=0
  # Pull + validate, retry up to 3 times. A failed/invalid pull is NOT silent:
  # it logs a greppable line and returns non-zero so the empty evidence file
  # left by `|| : > file` has a recorded cause (Fix 1).
  while [ "$attempt" -lt 3 ]; do
    attempt=$((attempt + 1))
    dir=$(mktemp -d "${TMPDIR:-/tmp}/kalsa-rkstorage.XXXXXX") || return 1
    if _device_pull_db "$dir" && _device_db_ok "$dir/RKStorage"; then
      sqlite3 "$dir/RKStorage" "$1"
      status=$?
      rm -rf "$dir"
      return "$status"
    fi
    rm -rf "$dir"
    log "device DB pull invalid or failed (attempt $attempt/3)"
    sleep 1
  done
  log "device DB pull failed after 3 attempts"
  return 1
}

# sql_write <statement> <key> <expected-value>; use __ABSENT__ for a delete.
sql_write() {
  if [ "$BENCH_TARGET" = "emulator" ]; then
    sql "$1"
    return
  fi

  local statement="$1" key="$2" expected="$3" dir remote actual escaped_key
  local app_state
  app_state=$(adb shell "if pidof $PKG >/dev/null 2>&1; then echo RUNNING; else echo STOPPED; fi" 2>/dev/null | tr -d '\r') || {
    die "cannot determine whether $PKG is running before device SQL write"
  }
  case "$app_state" in
    RUNNING) die "refusing device SQL write while $PKG is running; force-stop the app first" ;;
    STOPPED) ;;
    *) die "cannot determine whether $PKG is running before device SQL write (got '$app_state')" ;;
  esac

  dir=$(mktemp -d "${TMPDIR:-/tmp}/kalsa-rkstorage.XXXXXX") || die "cannot create temporary directory for device SQL write"
  if ! _device_pull_db "$dir"; then
    rm -rf "$dir"
    die "cannot read $DB through run-as before device SQL write"
  fi
  if ! printf '%s\nPRAGMA wal_checkpoint(TRUNCATE);\n' "$statement" | sqlite3 -bail "$dir/RKStorage" >/dev/null; then
    rm -rf "$dir"
    die "host sqlite3 failed while applying device SQL write"
  fi

  remote="/data/local/tmp/kalsa-rkstorage-$$"
  if ! adb push "$dir/RKStorage" "$remote" >/dev/null 2>&1 \
    || ! adb shell "run-as $PKG cp $remote databases/RKStorage" >/dev/null 2>&1 \
    || ! adb shell "run-as $PKG rm -f databases/RKStorage-wal databases/RKStorage-shm" >/dev/null 2>&1; then
    adb shell "rm -f $remote" >/dev/null 2>&1 || true
    rm -rf "$dir"
    die "could not install the locally updated database through run-as"
  fi
  adb shell "rm -f $remote" >/dev/null 2>&1 || true
  rm -rf "$dir"

  escaped_key=$(printf '%s' "$key" | sed "s/'/''/g")
  if ! actual=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$escaped_key';"); then
    die "device SQL write verification read failed for key '$key'"
  fi
  if [ "$expected" = "__ABSENT__" ]; then
    [ -z "$actual" ] || die "device SQL write verification found key '$key' after delete (got '$actual')"
  else
    [ "$actual" = "$expected" ] \
      || die "device SQL write verification for key '$key' got '$actual', expected '$expected'"
  fi
}

# Wipe kalsa.ciswire.gateAudit (src/rules/gateAuditLog.ts GATE_AUDIT_KEY).
# Prefs/sql_write trick — there is no app API. Call BETWEEN ARMS, not between
# conversations of the same seed-pair (PAIR_POS=2). Cap 500; blending arms
# is the bug this exists to prevent.
clear_gate_audit() {
  sql_write "DELETE FROM catalystLocalStorage WHERE key='kalsa.ciswire.gateAudit';" "kalsa.ciswire.gateAudit" "__ABSENT__"
}

# Dismiss a system ANR dialog ("<app> isn't responding") covering the screen —
# the loaded CI AVD throws these for Pixel Launcher after multi-GB pushes and
# every node lookup then fails (runs 31235650917/31278860896). Tap Wait (keeps
# processes) and re-foreground the app under test.
dismiss_anr() {
  if dump_ui | grep -qE "isn.{1,3}t responding"; then
    log "ANR dialog detected — tapping Wait + refocusing $PKG"
    tap_node "Wait" || true
    sleep 3
    adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
    sleep 8
  fi
}

# Tap a node found by content-desc OR text, using its LIVE bounds. Never use
# fixed coordinates: the CI AVD resolution differs from any dev device, and
# the IME shifts the layout.
tap_node() {
  local needle="$1"
  local b
  b=$(dump_ui | tr '>' '\n' \
      | grep -E "content-desc=\"$needle\"|text=\"$needle\"" \
      | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  [ -z "$b" ] && { log "node '$needle' NOT FOUND"; return 1; }
  local n; n=$(echo "$b" | grep -o '[0-9]\+' | tr '\n' ' ')
  local x1 y1 x2 y2; read -r x1 y1 x2 y2 <<< "$n"
  local cx=$(( (x1 + x2) / 2 )) cy=$(( (y1 + y2) / 2 ))
  log "tap '$needle' at ${cx},${cy}"
  adb shell input tap "$cx" "$cy"
}

# capture_death_evidence — on the fatal path, capture system-level evidence
# (logcat, crash buffer, memory state) so we can distinguish OOM kill from
# native crash. Called from die() before exit; every adb call can fail since
# the process may already be gone, so each is guarded with || true.
# Writes separate files in $OUT/ next to fatal_state.txt (upload glob bench-out/**
# picks them up — confirmed in .github/workflows/bench.yml line 534).
capture_death_evidence() {
  [ -n "${OUT:-}" ] || return 0
  mkdir -p "$OUT" 2>/dev/null || true

  # 1) Logcat tail (last 500 lines) — enough context around the death event,
  #    not the whole ring buffer (which can be thousands of lines of noise).
  adb logcat -d 2>/dev/null | tail -500 > "$OUT/fatal_logcat_tail.txt" || true

  # 2) Crash buffer specifically — native crashes, ANRs, tombstones.
  adb logcat -d -b crash 2>/dev/null > "$OUT/fatal_logcat_crash.txt" || true

  # 3) Filter main buffer for kill/OOM/crash signals.
  #    Patterns: lowmemorykiller, Killing, ANR, FATAL EXCEPTION, libc, SIGSEGV,
  #    SIGABRT, died. Empty file when nothing matches (absence is evidence too).
  adb logcat -d 2>/dev/null \
    | grep -E 'lowmemorykiller|Killing|ANR|FATAL EXCEPTION|libc|SIGSEGV|SIGABRT|died' \
    > "$OUT/fatal_logcat_filtered.txt" 2>/dev/null || true

  # 4) Per-process memory if the process still exists; otherwise note it is gone.
  #    dumpsys meminfo fails when the PID is dead — that is the expected case.
  if adb shell dumpsys meminfo "$PKG" 2>/dev/null > "$OUT/fatal_meminfo.txt"; then
    # Process alive but dumpsys returned nothing — leave a note.
    [ -s "$OUT/fatal_meminfo.txt" ] || echo "(dumpsys meminfo returned empty)" > "$OUT/fatal_meminfo.txt"
  else
    echo "(process gone — dumpsys meminfo failed)" > "$OUT/fatal_meminfo.txt"
  fi

  # 5) System-wide free memory — always captured (does not depend on the app).
  adb shell cat /proc/meminfo 2>/dev/null | head -20 > "$OUT/fatal_procmeminfo.txt" || true
  [ -s "$OUT/fatal_procmeminfo.txt" ] || echo "(could not read /proc/meminfo)" > "$OUT/fatal_procmeminfo.txt"
}

# _sysprobe_empty_body
#   Fixed-key fallback for a completely failed adb shell. Individual reads
#   inside the remote probe already emit the same keys with empty values.
_sysprobe_empty_body() {
  printf '%s\n' \
    'VmHWM=' 'VmRSS=' 'RssAnon=' 'RssFile=' 'VmSwap=' \
    'minflt=' 'majflt=' \
    'io_rchar=' 'io_wchar=' 'io_syscr=' 'io_syscw=' \
    'io_read_bytes=' 'io_write_bytes=' 'io_cancelled_write_bytes=' \
    'workingset_refault_file=' 'workingset_refault_anon=' 'pgmajfault=' \
    'pgsteal_kswapd=' 'pgsteal_direct=' 'allocstall_normal=' 'allocstall_movable=' \
    'MemFree=' 'MemAvailable=' 'Cached=' 'SwapCached=' 'Dirty=' 'Writeback=' \
    'diskstats_readable=0' 'diskstats_device=' 'diskstats_line=' \
    'diskstats_sectors_read=' 'diskstats_sectors_written=' \
    'diskstats_time_reading_ms=' 'diskstats_io_ticks=' \
    'thermal_status=' 'battery_deci_c=' \
    'battery_charge_uah=' 'battery_level_pct=' 'battery_ac_powered='
}

# capture_sysprobe_snapshot <turn_dir> <pre|post> [pid]
#   Capture cheap, best-effort process/system evidence in one adb shell. The
#   remote side emits a stable key=value format and keeps going after every
#   unreadable path. A probe failure must never fail a benchmark turn.
capture_sysprobe_snapshot() {
  local turn_dir="${1:-}" tag="${2:-}" requested_pid="${3:-}" dest
  local remote_cmd remote remote_pid body stamp epoch remote_pid_q pkg_q
  [ -n "$turn_dir" ] || return 0
  [ -n "$tag" ] || return 0
  dest="$turn_dir/sysprobe_$tag.txt"
  mkdir -p "$turn_dir" 2>/dev/null || return 0

  case "$requested_pid" in
    ''|*[!0-9]*) requested_pid='' ;;
  esac
  printf -v remote_pid_q '%q' "$requested_pid"
  printf -v pkg_q '%q' "${PKG:-com.kalsa.app}"

  # Keep this as one remote shell: adb round trips dominate the cost of the
  # individual reads, while the snapshot itself remains outside turn timing.
  remote_cmd=$(cat <<'REMOTE'
pid=__KALSA_PID__
pkg=__KALSA_PKG__
if [ -z "$pid" ]; then
  pid=$(pidof "$pkg" 2>/dev/null | awk '{print $1}' || true)
fi

printf 'pid=%s\n' "$pid"

emit_status() {
  values=""
  if [ -r "/proc/$pid/status" ]; then
    values=$(awk '
      BEGIN { h=rss=anon=file=swap=cpus="" }
      $1 == "VmHWM:" {h=$2}
      $1 == "VmRSS:" {rss=$2}
      $1 == "RssAnon:" {anon=$2}
      $1 == "RssFile:" {file=$2}
      $1 == "VmSwap:" {swap=$2}
      # Which CPUs this PROCESS may run on -- not which are online, and not how fast
      # they are clocked. Two S23 runs collapsed with every core online at full
      # frequency while the process had been confined: occupancy halved, per-token
      # compute tripled, flash I/O did not move. Neither RSS nor scaling_cur_freq
      # shows that. This does.
      $1 == "Cpus_allowed_list:" {cpus=$2}
      END {
        if (h != "") h = h " kB"
        if (rss != "") rss = rss " kB"
        if (anon != "") anon = anon " kB"
        if (file != "") file = file " kB"
        if (swap != "") swap = swap " kB"
        printf "VmHWM=%s\n", h
        printf "VmRSS=%s\n", rss
        printf "RssAnon=%s\n", anon
        printf "RssFile=%s\n", file
        printf "VmSwap=%s\n", swap
        printf "Cpus_allowed_list=%s\n", cpus
      }
    ' "/proc/$pid/status" 2>/dev/null || true)
  fi
  [ -n "$values" ] && printf '%s\n' "$values" || printf '%s\n' \
    'VmHWM=' 'VmRSS=' 'RssAnon=' 'RssFile=' 'VmSwap=' 'Cpus_allowed_list='
  # The other half of the same question. "/" is unconstrained; a "/background" or
  # "/restricted" path is the scheduler having parked the app off the big cores.
  cpuset=""
  [ -r "/proc/$pid/cpuset" ] && cpuset=$(cat "/proc/$pid/cpuset" 2>/dev/null | tr -d '\r\n')
  printf 'cpuset=%s\n' "$cpuset"
}

emit_faults() {
  values=""
  if [ -r "/proc/$pid/stat" ]; then
    values=$(awk '{print "minflt=" $10; print "majflt=" $12; exit}' "/proc/$pid/stat" 2>/dev/null || true)
  fi
  [ -n "$values" ] && printf '%s\n' "$values" || printf '%s\n' 'minflt=' 'majflt='
}

emit_io() {
  values=""
  if [ -n "$pid" ]; then
    values=$(run-as "$pkg" cat "/proc/$pid/io" 2>/dev/null | awk '
      BEGIN { rchar=wchar=syscr=syscw=read_bytes=write_bytes=cancelled="" }
      $1 == "rchar:" {rchar=$2}
      $1 == "wchar:" {wchar=$2}
      $1 == "syscr:" {syscr=$2}
      $1 == "syscw:" {syscw=$2}
      $1 == "read_bytes:" {read_bytes=$2}
      $1 == "write_bytes:" {write_bytes=$2}
      $1 == "cancelled_write_bytes:" {cancelled=$2}
      END {
        print "io_rchar=" rchar
        print "io_wchar=" wchar
        print "io_syscr=" syscr
        print "io_syscw=" syscw
        print "io_read_bytes=" read_bytes
        print "io_write_bytes=" write_bytes
        print "io_cancelled_write_bytes=" cancelled
      }
    ' 2>/dev/null || true)
  fi
  [ -n "$values" ] && printf '%s\n' "$values" || printf '%s\n' \
    'io_rchar=' 'io_wchar=' 'io_syscr=' 'io_syscw=' \
    'io_read_bytes=' 'io_write_bytes=' 'io_cancelled_write_bytes='
}

emit_vmstat() {
  values=""
  if [ -r /proc/vmstat ]; then
    values=$(awk '
      BEGIN { file=anon=maj=kswapd=direct=normal=movable="" }
      $1 == "workingset_refault_file" {file=$2}
      $1 == "workingset_refault_anon" {anon=$2}
      $1 == "pgmajfault" {maj=$2}
      $1 == "pgsteal_kswapd" {kswapd=$2}
      $1 == "pgsteal_direct" {direct=$2}
      $1 == "allocstall_normal" {normal=$2}
      $1 == "allocstall_movable" {movable=$2}
      END {
        print "workingset_refault_file=" file
        print "workingset_refault_anon=" anon
        print "pgmajfault=" maj
        print "pgsteal_kswapd=" kswapd
        print "pgsteal_direct=" direct
        print "allocstall_normal=" normal
        print "allocstall_movable=" movable
      }
    ' /proc/vmstat 2>/dev/null || true)
  fi
  [ -n "$values" ] && printf '%s\n' "$values" || printf '%s\n' \
    'workingset_refault_file=' 'workingset_refault_anon=' 'pgmajfault=' \
    'pgsteal_kswapd=' 'pgsteal_direct=' 'allocstall_normal=' 'allocstall_movable='
}

emit_meminfo() {
  values=""
  if [ -r /proc/meminfo ]; then
    values=$(awk '
      BEGIN { free=available=cached=swapcached=dirty=writeback="" }
      $1 == "MemFree:" {free=$2}
      $1 == "MemAvailable:" {available=$2}
      $1 == "Cached:" {cached=$2}
      $1 == "SwapCached:" {swapcached=$2}
      $1 == "Dirty:" {dirty=$2}
      $1 == "Writeback:" {writeback=$2}
      END {
        if (free != "") free = free " kB"
        if (available != "") available = available " kB"
        if (cached != "") cached = cached " kB"
        if (swapcached != "") swapcached = swapcached " kB"
        if (dirty != "") dirty = dirty " kB"
        if (writeback != "") writeback = writeback " kB"
        printf "MemFree=%s\n", free
        printf "MemAvailable=%s\n", available
        printf "Cached=%s\n", cached
        printf "SwapCached=%s\n", swapcached
        printf "Dirty=%s\n", dirty
        printf "Writeback=%s\n", writeback
      }
    ' /proc/meminfo 2>/dev/null || true)
  fi
  [ -n "$values" ] && printf '%s\n' "$values" || printf '%s\n' \
    'MemFree=' 'MemAvailable=' 'Cached=' 'SwapCached=' 'Dirty=' 'Writeback='
}

emit_status
emit_faults
emit_io
emit_vmstat
emit_meminfo

data_source=$(df -P /data 2>/dev/null | awk 'NR > 1 {print $1; exit}' || true)
data_device="${data_source##*/}"
resolved_source=$(readlink -f "$data_source" 2>/dev/null || true)
[ -n "$resolved_source" ] && data_device="${resolved_source##*/}"
disk_line=""
[ -n "$data_device" ] && disk_line=$(awk -v dev="$data_device" '$3 == dev {print; exit}' /proc/diskstats 2>/dev/null || true)
if [ -n "$disk_line" ]; then
  printf 'diskstats_readable=1\n'
  printf 'diskstats_device=%s\n' "$data_device"
  printf 'diskstats_line=%s\n' "$disk_line"
  awk '{print "diskstats_sectors_read=" $6; print "diskstats_time_reading_ms=" $7; print "diskstats_sectors_written=" $10; print "diskstats_io_ticks=" $13; exit}' <<EOF_DISK
$disk_line
EOF_DISK
else
  printf '%s\n' 'diskstats_readable=0' 'diskstats_device=' 'diskstats_line=' \
    'diskstats_sectors_read=' 'diskstats_sectors_written=' \
    'diskstats_time_reading_ms=' 'diskstats_io_ticks='
fi

for cpu in /sys/devices/system/cpu/cpu[0-9]*; do
  [ -d "$cpu" ] || continue
  cpu_name="${cpu##*/}"
  freq=$(cat "$cpu/cpufreq/scaling_cur_freq" 2>/dev/null | tr -d '\r\n' || true)
  printf '%s_scaling_cur_freq=%s\n' "$cpu_name" "$freq"
done

for zone in /sys/class/thermal/thermal_zone[0-9]*; do
  [ -d "$zone" ] || continue
  zone_name="${zone##*/}"
  zone_type=$(cat "$zone/type" 2>/dev/null | tr -d '\r\n' || true)
  zone_temp=$(cat "$zone/temp" 2>/dev/null | tr -d '\r\n' || true)
  printf '%s_type=%s\n' "$zone_name" "$zone_type"
  printf '%s_temp=%s\n' "$zone_name" "$zone_temp"
done

thermal_status=$(dumpsys thermalservice 2>/dev/null | grep -m1 -E 'Thermal Status:[[:space:]]*[0-9]+' | sed -E 's/.*Thermal Status:[[:space:]]*([0-9]+).*/\1/' || true)
# ONE dumpsys battery, three fields. Temperature alone cannot answer "what did
# this arm cost the battery" — Charge counter is the coulomb counter (uAh,
# falling while discharging) and is the only field here that integrates energy.
# It sits in the same output the probe was already paying for and was thrown
# away. grep -m1 takes the service-state block, which dumpsys prints before the
# ACTION_BATTERY_CHANGED history lines that repeat these same key names.
battery_dump=$(dumpsys battery 2>/dev/null || true)
battery_deci_c=$(printf '%s\n' "$battery_dump" | grep -m1 -E 'temperature:[[:space:]]*[0-9]+' | sed -E 's/.*temperature:[[:space:]]*([0-9]+).*/\1/' || true)
battery_charge_uah=$(printf '%s\n' "$battery_dump" | grep -m1 -E 'Charge counter:[[:space:]]*-?[0-9]+' | sed -E 's/.*Charge counter:[[:space:]]*(-?[0-9]+).*/\1/' || true)
battery_level_pct=$(printf '%s\n' "$battery_dump" | grep -m1 -E '^[[:space:]]*level:[[:space:]]*-?[0-9]+' | sed -E 's/.*level:[[:space:]]*(-?[0-9]+).*/\1/' || true)
battery_ac=$(printf '%s\n' "$battery_dump" | grep -m1 -E 'AC powered:' | sed -E 's/.*AC powered:[[:space:]]*//' || true)
printf 'thermal_status=%s\n' "$thermal_status"
printf 'battery_deci_c=%s\n' "$battery_deci_c"
printf 'battery_charge_uah=%s\n' "$battery_charge_uah"
printf 'battery_level_pct=%s\n' "$battery_level_pct"
printf 'battery_ac_powered=%s\n' "$battery_ac"
REMOTE
)
  remote_cmd=${remote_cmd//__KALSA_PID__/$remote_pid_q}
  remote_cmd=${remote_cmd//__KALSA_PKG__/$pkg_q}
  remote=$(adb shell "$remote_cmd" 2>/dev/null | tr -d '\r' || true)
  remote_pid=$(printf '%s\n' "$remote" | sed -n 's/^pid=//p' | head -1)
  stamp=$(date +%Y-%m-%dT%H:%M:%S 2>/dev/null || true)
  epoch=$(date +%s 2>/dev/null || true)
  if [ -n "$remote" ]; then
    body=$(printf '%s\n' "$remote" | sed '/^pid=/d')
  else
    body=$(_sysprobe_empty_body)
  fi
  {
    printf 'ts=%s epoch=%s label=%s pid=%s\n' "$stamp" "$epoch" "$tag" "$remote_pid"
    printf '%s\n' "$body"
  } > "$dest" 2>/dev/null || true
  return 0
}

# die() expects $OUT to already exist (the caller creates it before sourcing
# or before the first call that can fail).
die() {
  log "FATAL: $*"
  ui_texts > "$OUT/fatal_state.txt" 2>/dev/null
  shot fatal
  capture_death_evidence
  exit 1
}

case "$BENCH_TARGET" in
  emulator|device) ;;
  *) die "BENCH_TARGET must be one of: emulator, device (got '$BENCH_TARGET')" ;;
esac

# After a primary turn-end signal (telemetry / SQL), confirm the chat UI is
# idle before the next type_into_composer. Soft-fail on timeout.
wait_ui_idle() {
  local cap_s="${1:-240}"
  local poll_s=5
  local elapsed=0
  local raw="$OUT/.wait_ui_idle_raw.xml"
  local dump="$OUT/.wait_ui_idle_dump.txt"
  log "wait_ui_idle: confirming UI idle (cap ${cap_s}s)"
  while [ "$elapsed" -lt "$cap_s" ]; do
    # ONE dump per iteration (a uiautomator dump + cat is expensive on a loaded
    # AVD; two of them doubled the cost for nothing).
    dump_ui > "$raw" 2>/dev/null || true
    grep -o 'text="[^"]\{1,200\}"' "$raw" 2>/dev/null | sed 's/^text="//; s/"$//' > "$dump" || true
    # Status labels are matched as WHOLE text nodes (-x): a substring grep hit
    # the assistant's own prose ("after reading the docs…") and pinned this
    # helper at the cap on ordinary turns. STATUS_LABELS must cover every label
    # LlamaService can set — "Fetching page…" (web_fetch) was the one missing
    # when a fetch turn slipped through (run 31282669354).
    # Cursor check needs the RAW xml: ui_texts truncates at 200 chars, so a long
    # streaming bubble's trailing ▋ never reaches $dump.
    if grep -qxF "Ask a question…" "$dump" 2>/dev/null \
      && ! grep -qxFf <(printf '%s\n' "Writing" "Thinking" "Searching the web…" "Fetching page…" "Tool failed — continuing without it") "$dump" 2>/dev/null \
      && ! grep -qF "▋" "$raw" 2>/dev/null; then
      log "wait_ui_idle: UI idle after ${elapsed}s"
      return 0
    fi
    sleep "$poll_s"
    elapsed=$((elapsed + poll_s))
    log "wait_ui_idle: still in-flight (${elapsed}s/${cap_s}s)"
  done
  log "WARN: wait_ui_idle timed out after ${cap_s}s — continuing (soft-fail; dump → turnend_timeout_ui.txt)"
  ui_texts > "$OUT/turnend_timeout_ui.txt" 2>/dev/null || true
  return 0
}

# Capture the last native loadPrompt reuse line for turn N into $OUT/reuse_tN.txt.
# Ground truth for prefix reuse: "Input processed: n_past=<REUSED>, embd.size=<TOTAL>".
# Do NOT use KALSA_TELEMETRY tokensCached — that field is n_past at END of completion
# (total context length), not tokens reused from the KV cache.
# Attribution: `tail -1` is the chat turn's line because no utility completion
# runs after it in CI (memory extract is opt-in and unseeded). If a background
# summarize ever lands between the reply and this call, its own (cold) line wins
# and the verdict under-reports warm — conservative, never a false WARM.
#   capture_kv_reuse <turn_number>
capture_kv_reuse() {
  local turn="$1"
  local dest="$OUT/reuse_t${turn}.txt"
  # ALL prompt loads since the last logcat clear, newest last — not just the
  # tail: with compaction on, a background summarize runs after the chat turn
  # and its own (longer) prompt would otherwise be read as the turn's. The
  # verdict picks the line whose embd.size matches the turn's tokensEvaluated.
  # Keeping every line also exposes utility completions that run BETWEEN a
  # session restore and the chat turn — they replace embd and would explain an
  # n_common of 0 after a successful restore.
  adb logcat -d 2>/dev/null \
    | grep -oE "Input processed: n_past=[0-9]+, embd\.size=[0-9]+" \
    | tail -20 > "$dest" || true
  [ -f "$dest" ] || : > "$dest"
  if [ -s "$dest" ]; then
    log "kv_reuse turn${turn}: $(tr -d '\r\n' < "$dest")"
  else
    log "kv_reuse turn${turn}: (no Input processed line)"
  fi
  # When checkpoint recovery failed, the patched binding names WHY (n_common vs
  # the snapshot lengths it holds) — capture it next to the reuse line.
  local diag="$OUT/kvdiag_t${turn}.txt"
  {
    adb logcat -d 2>/dev/null \
      | grep -oE "KALSA_KVDIAG n_common=[0-9]+ total=[0-9]+ search_max=[0-9]+ checkpoints=\[[0-9,]*\]" \
      | tail -1
    # Zero common prefix while a cache existed: the heads name the divergence.
    adb logcat -d 2>/dev/null \
      | grep -oE "KALSA_KVDIAG0 cache_len=[0-9]+ prompt_len=[0-9]+ cache_head=\[[0-9 ]*\] prompt_head=\[[0-9 ]*\]" \
      | tail -1
  } > "$diag" 2>/dev/null || true
  [ -f "$diag" ] || : > "$diag"
  [ -s "$diag" ] && log "kvdiag turn${turn}: $(tr -d '\r\n' < "$diag")"
  return 0
}

# Write KALSA_KVDIAG0 lines from a logcat buffer to dest. Always creates dest
# (empty when none) so absent-file vs empty-capture stay distinguishable —
# same contract as capture_turn_evidence's neighbouring greps. Pure: no adb.
#   capture_kvdiag_from_buf <buf_path> <dest_path>
capture_kvdiag_from_buf() {
  grep -F "KALSA_KVDIAG0 " "$1" 2>/dev/null > "$2" 2>/dev/null || : > "$2"
}

# One "cache_len=N prompt_len=M" line per KALSA_KVDIAG0 match — for
# prompt_meta.txt (human glance: did prefix reuse collapse this turn?).
#   kvdiag_meta_lines <kvdiag_path>
kvdiag_meta_lines() {
  grep -oE "KALSA_KVDIAG0 cache_len=[0-9]+ prompt_len=[0-9]+" "$1" 2>/dev/null \
    | sed -E 's/.*cache_len=([0-9]+) prompt_len=([0-9]+)/cache_len=\1 prompt_len=\2/' \
    || true
}

# ── Sideload guards ─────────────────────────────────────────────────
# Pure-logic functions (take values, never run adb) so they can be unit-tested
# with fake inputs — the caller extracts on-device values and passes them in.

# assert_size_match <actual_bytes> <expected_bytes> <label>
#   A silent partial copy must become a loud failure at the moment it happens,
#   not a mystery 18 minutes later (smoke 31829304518 lesson).
assert_size_match() {
  local actual="$1" expected="$2" label="$3"
  if [ "$actual" != "$expected" ]; then
    die "sideload size mismatch for $label: on-device ${actual} bytes != expected ${expected} bytes (truncated/corrupt transfer)"
  fi
  log "sideload verified: $label ($actual bytes)"
}

# check_free_space <available_bytes> <needed_bytes> <model_label>
#   Dies naming the model, its size, and the space available — the message a
#   human should see, not "model not downloaded".
check_free_space() {
  local available="$1" needed="$2" label="$3"
  case "$available" in
    ''|*[!0-9]*) die "check_free_space: could not determine free space on device (got '$available')" ;;
  esac
  case "$needed" in
    ''|*[!0-9]*) die "check_free_space: invalid needed size '$needed'" ;;
  esac
  if [ "$available" -lt "$needed" ]; then
    die "insufficient device space for $label: need $needed bytes, only $available bytes available on /data"
  fi
}

# ── Engine positive control ─────────────────────────────────────────
# _engine_tokens_evaluated <telemetry_jsonl>
#   Best numeric tokensEvaluated > 0 across parseable lines, else 0.
#   Shared by assert_engine_ran (lethal) and wait_for_engine_ran (poll).
_engine_tokens_evaluated() {
  local file="$1" evaluated
  evaluated=$(python3 -c '
import json, sys
best = 0
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if not isinstance(rec, dict):
                continue
            v = rec.get("tokensEvaluated")
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                continue
            if int(v) > best:
                best = int(v)
except Exception:
    pass
print(best)
' "$file" 2>/dev/null)
  case "$evaluated" in
    ''|*[!0-9]*) evaluated=0 ;;
  esac
  printf '%s\n' "$evaluated"
}

# assert_engine_ran <telemetry_jsonl> [turn_label]
#   Direct proof that the inference engine actually ran: at least one
#   KALSA_TELEMETRY line (src/engine/LlamaService.ts, one per completion round)
#   with a numeric tokensEvaluated > 0. Pure logic on a file — no adb — so it is
#   unit-testable (scripts/test_sideload_guards.sh).
#
#   WHY numbers only: a device arm (BENCH_TARGET=device, smoke, 4B) could not
#   load the model, so all 7 turns recorded the app's error bubble
#   ("⚠️ Caricamento del modello non riuscito…"), the arm exited 0 and wrote a
#   complete result.json with fact_recall null — an infrastructure failure that
#   looks exactly like a model failure, so the next person debugs the model.
#   The bubble text is localized and this repo has already been burned by a
#   language-dependent grader (HONESTY_PATTERNS, Italian-only): keying this gate
#   on any user-visible string would reintroduce that defect. tokensEvaluated is
#   language-independent by construction.
#
#   A malformed line is not evidence (skipped, not trusted): only strictly
#   parseable JSON objects count. Non-positive counts are not evidence either:
#   0 is turnTelemetry.ts's `result.tokens_evaluated ?? 0` default (native counter
#   absent) and -1 is the grader's "unavailable" sentinel. On turn 1 of a fresh
#   conversation the new user message cannot come from the KV cache, so a live
#   engine always evaluates prompt tokens — full reuse cannot fake a 0 here.
assert_engine_ran() {
  local file="$1" turn="${2:-1}" evaluated
  evaluated=$(_engine_tokens_evaluated "$file")
  if [ "$evaluated" -le 0 ]; then
    die "engine never ran on turn $turn (no KALSA_TELEMETRY / tokensEvaluated<=0) — model not loaded? (evidence: $file)"
    return 1
  fi
  log "engine control: turn $turn tokensEvaluated=$evaluated (engine alive)"
  return 0
}

# wait_for_engine_ran <telemetry_jsonl> [turn] [timeout_s] [interval_s] [refresh_fn]
#   Poll until tokensEvaluated>0 instead of sampling once. The UI can settle
#   (history stable) before the native layer emits end-of-turn KALSA_TELEMETRY
#   — measured gap: settled_s=136s vs promptMs+predictedMs≈153s on a device
#   arm; a single post-settle sample then false-dies a live engine.
#
#   refresh_fn (optional function name) is invoked after each sleep so the
#   caller can re-source evidence (adb logcat → telemetry.jsonl in production;
#   a test double that writes the file late). First sample uses the file as-is
#   (no sleep). No busy-spin: sleeps interval_s between attempts.
#
#   Default timeout 180s: exceeds the measured 153s full engine turn so a
#   premature settle or thermal mid-turn throttle still has headroom; interval
#   5s matches other ci-lib polls. On late success logs the wait. On timeout
#   still dies via assert_engine_ran — this removes a false negative, not the
#   guard.
wait_for_engine_ran() {
  local file="$1" turn="${2:-1}" timeout_s="${3:-180}" interval_s="${4:-5}"
  local refresh_fn="${5:-}"
  local waited=0 evaluated

  while true; do
    evaluated=$(_engine_tokens_evaluated "$file")
    if [ "$evaluated" -gt 0 ]; then
      if [ "$waited" -gt 0 ]; then
        log "engine control: telemetry appeared after ${waited}s wait (turn $turn)"
      fi
      assert_engine_ran "$file" "$turn"
      return 0
    fi
    if [ "$waited" -ge "$timeout_s" ]; then
      assert_engine_ran "$file" "$turn"
      return 1
    fi
    sleep "$interval_s"
    waited=$((waited + interval_s))
    if [ -n "$refresh_fn" ]; then
      "$refresh_fn" || true
    fi
  done
}

# ── Device keep-awake (unplugged measurement discipline) ──────────────
# A real arm runs UNPLUGGED (as the measurement discipline requires). On USB the
# old `svc power stayon usb` held the display, but unplugged the device hits
# screen_off_timeout, then Doze, and a Galaxy S23 mid-arm went
# mWakefulness=Dozing — the app stopped generating and the harness wasted its
# full 40-min reply timeout waiting for a turn that could never arrive (turn 2
# of a 4B fase4 arm).
#
# This applies THREE things, ONLY when BENCH_TARGET=device (the emulator path is
# untouched), and SAVES+RESTORES every mutated value through an EXIT trap so a
# dev phone is never left with a 24h screen timeout or a permanent Doze exemption.
#
#   KA_SCREEN_TIMEOUT_MS  screen_off_timeout raised so the display cannot sleep
#                         for the length of one arm (restored to the saved value).
#   deviceidle whitelist  $PKG exempted from Doze/app-standby for the run
#                         (removed on exit UNLESS it was already whitelisted).
#   KEYCODE_WAKEUP       display woken once so the arm never starts dozing.

# wakefulness_is_fatal <wakefulness-token>
#   Pure decision (no adb): given the mWakefulness token from `dumpsys power`
#   (e.g. "Awake", "Dozing", "Asleep", "Dreaming", or "" when the probe did not
#   answer), return 0 (fatal → arm must die NOW) or 1 (continue).
#     Awake      → continue (1)
#     Dozing     → die      (0)   device is idle/dozing, cannot generate
#     Asleep     → die      (0)
#     Dreaming   → die      (0)   screensaver / dream state, app not active
#     ""/unknown → continue (1)   never fail an arm on a probe that did not answer
# Covered by scripts/test_sideload_guards.sh.
wakefulness_is_fatal() {
  case "${1:-}" in
    Dozing|Asleep|Dreaming) return 0 ;;
    *) return 1 ;;
  esac
}

# Sentinel for composer probe failure (dump unavailable). Cannot appear as real
# EditText text. Distinct from "" so message_was_submitted does not treat a
# failed dump as "composer empty → submitted".
COMPOSER_PROBE_FAILED="__composer_probe_failed__"

# message_was_submitted <prev_count> <cur_count> <composer_text>
#   Pure decision (no adb): did the user message leave the composer?
#   Returns 0 if submitted, 1 if not.
#   Third arg has THREE states:
#     1. real empty string ""  → composer empty (may mean submitted when counts equal)
#     2. non-empty real text   → still holding message → NOT submitted
#     3. COMPOSER_PROBE_FAILED → dump probe failed → NOT submitted (retry send)
#   Count rules:
#     cur_count > prev_count                          → submitted (0)
#     cur_count == prev_count AND composer empty      → submitted (0)
#       (reply may not have landed in history yet)
#     cur_count == prev_count AND composer non-empty  → NOT submitted (1)
#     empty / non-integer / unknown count probes      → NOT submitted (1)
#       so a retry runs; never a false success.
# Covered by scripts/test_sideload_guards.sh.
message_was_submitted() {
  local prev="${1:-}" cur="${2:-}" ctext="${3:-}"
  # Probe failed → not submitted; never confuse with real empty.
  if [ "$ctext" = "$COMPOSER_PROBE_FAILED" ]; then
    return 1
  fi
  case "$prev" in
    ''|*[!0-9]*) return 1 ;;
  esac
  case "$cur" in
    ''|*[!0-9]*) return 1 ;;
  esac
  if [ "$cur" -gt "$prev" ]; then
    return 0
  fi
  if [ "$cur" -eq "$prev" ] && [ -z "$ctext" ]; then
    return 0
  fi
  return 1
}

# validate_bench_norepack <value>
#   Pure (no adb): empty / 0 / 1 accepted; anything else dies with a message.
#   empty → leave kalsa.bench.norepack absent (production repack on)
#   0     → write "0" (repack on, explicit)
#   1     → write "1" (no_extra_bufts / repack off)
# Covered by scripts/test_sideload_guards.sh.
validate_bench_norepack() {
  case "${1:-}" in
    ""|0|1) return 0 ;;
    *) die "NOREPACK must be empty, 0, or 1 (got '$1')" ;;
  esac
}

# validate_bench_ngl <value>
#   Pure (no adb): empty or a non-negative integer; anything else dies.
#   empty → leave kalsa.bench.engine absent (production: cpu-only on Android)
#   N     → write {"nGpuLayers":N,"flashAttn":"off"}
#
# The flashAttn escort is not decoration. applyEngineOverride refuses
# nGpuLayers on Android unless the same override carries flashAttn "off",
# because offload WITH flash attention on CPU is the combination that kills
# llama_init_from_model — writing the layers alone would produce an arm that
# silently ran on CPU. Covered by scripts/test_sideload_guards.sh.
validate_bench_ngl() {
  case "${1:-}" in
    "") return 0 ;;
    *[!0-9]*) die "NGL must be empty or a non-negative integer (got '$1')" ;;
    *) return 0 ;;
  esac
}

# bench_engine_json <ngl>
#   The exact string ci-bench writes to kalsa.bench.engine, and the exact
#   string it asserts back. One function so the two can never drift.
# bench_engine_json <ngl> [moe_stream_json] [use_mmap_bool]
#   Both parts optional; with only <ngl> the output is byte-identical to what
#   this emitted before MoE streaming existed (test_sideload_guards.sh asserts
#   the flashAttn escort against that exact string).
bench_engine_json() {
  local ngl="${1:-}" moe="${2:-}" mmap="${3:-}" parts=""
  if [ -n "$ngl" ]; then
    parts=$(printf '"nGpuLayers":%s,"flashAttn":"off"' "$ngl")
  fi
  if [ -n "$moe" ]; then
    [ -n "$parts" ] && parts="$parts,"
    parts="$parts$(printf '"moeStream":%s' "$moe")"
  fi
  if [ -n "$mmap" ]; then
    [ -n "$parts" ] && parts="$parts,"
    parts="$parts$(printf '"useMmap":%s' "$mmap")"
  fi
  printf '{%s}' "$parts"
}

# ── Multi-conversation storage keys ─────────────────────────────────
# App writer: src/conversations/ConversationsStore.ts
#   INDEX_KEY = kalsa.conversations.v1  →  { activeId, items: [{id, updatedAt, …}] }
#   messagesKey(id) = kalsa.messages.<id>
# Compactor: src/context/compactor.ts
#   kalsa.chat.compactor.<chatId || "default">
#   kalsa.chat.summary.<chatId || "default">
# Pre-multi-chat legacy (older APKs): kalsa.messages.v1 + *.default
# Covered by scripts/test_sideload_guards.sh.

CONVERSATIONS_INDEX_KEY="kalsa.conversations.v1"
LEGACY_MESSAGES_KEY="kalsa.messages.v1"

# resolve_active_conversation_id <json>
#   Pure (no adb). Rule matches ConversationsStore.parseConversationsState:
#     1) activeId when it names an item in items[]
#     2) else most recent item by updatedAt
#   Empty / missing index value → print "" (caller falls back to legacy keys
#   so an older APK that never wrote kalsa.conversations.v1 still benches).
#   Present but unparseable / empty items / no resolvable id → die naming the
#   key (silent empty key burned a 40-min arm after the multi-chat merge).
resolve_active_conversation_id() {
  local raw="${1-}" out rc
  if [ -z "$raw" ]; then
    printf '%s\n' ""
    return 0
  fi
  out=$(python3 -c '
import json, sys
raw = sys.argv[1]
try:
    obj = json.loads(raw)
except Exception:
    sys.exit(2)
if not isinstance(obj, dict) or not isinstance(obj.get("items"), list):
    sys.exit(2)
items = []
for it in obj["items"]:
    if not isinstance(it, dict):
        continue
    cid = it.get("id")
    if isinstance(cid, str) and cid:
        items.append(it)
if not items:
    sys.exit(2)
active = obj.get("activeId")
if isinstance(active, str) and active:
    for it in items:
        if it["id"] == active:
            print(active)
            sys.exit(0)
def recency(it):
    u = it.get("updatedAt")
    return u if isinstance(u, (int, float)) and u == u else 0
items.sort(key=recency, reverse=True)
print(items[0]["id"])
' "$raw" 2>/dev/null)
  rc=$?
  if [ "$rc" -ne 0 ] || [ -z "$out" ]; then
    die "cannot resolve active conversation id from $CONVERSATIONS_INDEX_KEY (missing, unparseable, or empty items)"
    return 1
  fi
  printf '%s\n' "$out"
}

# list_conversation_ids <json>
#   Pure: one id per line from items[]. Empty / unparseable → no output
#   (reset still wipes the index key + legacy keys).
list_conversation_ids() {
  local raw="${1-}"
  [ -z "$raw" ] && return 0
  python3 -c '
import json, sys
raw = sys.argv[1]
try:
    obj = json.loads(raw)
except Exception:
    sys.exit(0)
if not isinstance(obj, dict) or not isinstance(obj.get("items"), list):
    sys.exit(0)
for it in obj["items"]:
    if isinstance(it, dict) and isinstance(it.get("id"), str) and it["id"]:
        print(it["id"])
' "$raw" 2>/dev/null || true
}

# messages_storage_key <conversation_id>
#   Empty id → legacy kalsa.messages.v1 (older APK / no multi-chat index).
messages_storage_key() {
  local id="${1-}"
  if [ -z "$id" ]; then
    printf '%s\n' "$LEGACY_MESSAGES_KEY"
  else
    printf '%s\n' "kalsa.messages.$id"
  fi
}

# compactor_storage_key <conversation_id>
#   Empty id → kalsa.chat.compactor.default (legacy / app default chatId).
compactor_storage_key() {
  local id="${1-}"
  if [ -z "$id" ]; then
    printf '%s\n' "kalsa.chat.compactor.default"
  else
    printf '%s\n' "kalsa.chat.compactor.$id"
  fi
}

# summary_storage_key <conversation_id>
#   Empty id → kalsa.chat.summary.default.
summary_storage_key() {
  local id="${1-}"
  if [ -z "$id" ]; then
    printf '%s\n' "kalsa.chat.summary.default"
  else
    printf '%s\n' "kalsa.chat.summary.$id"
  fi
}

# Pure matcher: given dumpsys deviceidle whitelist text (one package per
# indented line, plus section headers), report whether $PKG is present as an
# exact trimmed line. Output: "1" if present, "0" otherwise.
# dumpsys does NOT emit comma-separated lists — do not match on commas.
# Covered by scripts/test_sideload_guards.sh.
_device_whitelist_match() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    if [ "$line" = "$PKG" ]; then
      echo 1
      return 0
    fi
  done <<EOF
${1:-}
EOF
  echo 0
}

# Report whether $PKG is already in the deviceidle whitelist. Output: "1" if
# present, "0" if absent (any read failure → "0", best-effort).
_device_whitelist_has_pkg() {
  local wl
  wl=$(adb shell "dumpsys deviceidle whitelist" 2>/dev/null | tr -d '\r' || true)
  _device_whitelist_match "$wl"
}

# Pure restore decision for screen_off_timeout given the value saved at setup.
# Prints one of: put <ms> | delete | leave
#   numeric (not our KA ceiling) → put it back
#   null                         → delete (setting was never written; put cannot undo unset)
#   empty                        → leave  (adb unreadable — do not guess)
#   equal to KA_SCREEN_TIMEOUT_MS → delete (leak from a prior un-restored run;
#                                  platform default is the sane fallback)
# Covered by scripts/test_sideload_guards.sh.
_device_timeout_restore_decision() {
  local saved="${1-}"
  case "$saved" in
    '') echo leave ;;
    null|"$KA_SCREEN_TIMEOUT_MS") echo delete ;;
    *) echo "put $saved" ;;
  esac
}

# Install the keep-awake settings and register the restore trap. Idempotent:
# calling it twice (or on emulator) is a no-op beyond the first successful setup.
# ── IME suspension (opt-in, device arms only) ───────────────────────
# WHY: `input text` is not raw input — it reaches the app THROUGH the IME, and
# a predictive keyboard rewrites it. Measured on the Jelly Star (Gboard,
# 2026-08-23): typing "il colore e Zaffiro" landed as "Il colored e Zaffiro" —
# autocapitalisation AND an English autocorrect on an Italian word. It is not
# the space keyevent: typing the space as text garbles identically. With the
# IME disabled the same call lands byte-exact.
#
# The S23 does not show it, which is why the type path looked sound: this is a
# per-keyboard behaviour, not a per-Android-version one, so it will reappear on
# whatever phone happens to run a predictive IME.
#
# Opt-in (IME_SUSPEND=1) rather than default: an arm already measured with a
# keyboard attached must stay comparable to itself, and a suspended IME changes
# what covers the screen. Saved and restored through the same EXIT trap as
# keep-awake, so a killed run never leaves a phone without a keyboard.
device_ime_suspend() {
  [ "$BENCH_TARGET" = "device" ] || return 0
  [ "${IME_SUSPEND:-0}" = "1" ] || return 0
  [ "${_IME_SUSPENDED:-0}" = "1" ] && return 0

  _IME_SAVED=$(adb shell "settings get secure default_input_method" 2>/dev/null | tr -d '\r' || true)
  case "${_IME_SAVED:-}" in
    ''|null) log "ime: no default_input_method to suspend (skipping)"; return 0 ;;
  esac
  _IME_SUSPENDED=1
  if adb shell "ime disable $_IME_SAVED" >/dev/null 2>&1; then
    log "ime: suspended $_IME_SAVED (restored on exit)"
  else
    _IME_SUSPENDED=0
    log "ime: WARNING could not disable $_IME_SAVED — typed text may be autocorrected"
  fi
}

device_ime_restore() {
  [ "${_IME_SUSPENDED:-0}" = "1" ] || return 0
  _IME_SUSPENDED=0
  if adb shell "ime enable ${_IME_SAVED}" >/dev/null 2>&1 \
     && adb shell "ime set ${_IME_SAVED}" >/dev/null 2>&1; then
    log "ime: restored ${_IME_SAVED}"
  else
    log "ime: WARNING failed to restore ${_IME_SAVED} — the phone may have no keyboard; re-enable it in Settings"
  fi
}

# One EXIT trap, two things to put back. Adding a second `trap ... EXIT` would
# REPLACE the first and silently leak whichever was armed earlier.
_device_session_restore() {
  device_ime_restore
  device_keepawake_restore
}

device_keepawake_setup() {
  [ "$BENCH_TARGET" = "device" ] || return 0
  [ "${_KA_SETUP_DONE:-0}" = "1" ] && return 0

  # Save current values and arm the EXIT trap BEFORE any mutation so a kill
  # mid-setup still restores (the old order left a 24h timeout with no trap).
  _KA_SCREEN_TIMEOUT_SAVED=$(adb shell "settings get system screen_off_timeout" 2>/dev/null | tr -d '\r' || true)
  log "keep-awake: saved screen_off_timeout=${_KA_SCREEN_TIMEOUT_SAVED:-<empty>}"
  # 2) deviceidle whitelist — remember whether WE add it so restore only removes
  #    what we added (never drop a whitelist entry the device already had).
  _KA_WL_WAS_WHITELISTED=$(_device_whitelist_has_pkg)
  _KA_SETUP_DONE=1
  # Restore on success, failure (die), and interrupt (the EXIT trap also fires
  # on signal-induced exit). Idempotent + no-op when never set up.
  trap _device_session_restore EXIT

  # 1) screen_off_timeout — raise to KA_SCREEN_TIMEOUT_MS (saved above).
  if adb shell "settings put system screen_off_timeout $KA_SCREEN_TIMEOUT_MS" >/dev/null 2>&1; then
    log "keep-awake: set screen_off_timeout=$KA_SCREEN_TIMEOUT_MS (restored on exit)"
  else
    log "keep-awake: WARNING could not set screen_off_timeout (continuing best-effort)"
  fi

  if adb shell "dumpsys deviceidle whitelist +$PKG" >/dev/null 2>&1; then
    log "keep-awake: added $PKG to deviceidle whitelist (was_whitelisted=$_KA_WL_WAS_WHITELISTED)"
  else
    log "keep-awake: WARNING 'dumpsys deviceidle whitelist +$PKG' failed/unavailable on this build (Doze exemption skipped; timeout still applies)"
  fi

  # 3) Suspend a predictive IME when asked (see device_ime_suspend).
  device_ime_suspend

  # 3) Wake the display once so the arm never begins against a dozing device.
  adb shell "input keyevent KEYCODE_WAKEUP" >/dev/null 2>&1 || true
  log "keep-awake: sent KEYCODE_WAKEUP"
}

# Inverse of setup. Called by the EXIT trap; safe to call repeatedly.
device_keepawake_restore() {
  [ "${_KA_SETUP_DONE:-0}" = "1" ] || return 0
  _KA_SETUP_DONE=0

  # 1) Restore screen_off_timeout (put / delete / leave — pure decision above).
  case "$(_device_timeout_restore_decision "${_KA_SCREEN_TIMEOUT_SAVED-}")" in
    leave)
      log "keep-awake: WARNING screen_off_timeout unreadable at setup (adb failed); left $KA_SCREEN_TIMEOUT_MS; check the device"
      ;;
    delete)
      if adb shell "settings delete system screen_off_timeout" >/dev/null 2>&1; then
        if [ "${_KA_SCREEN_TIMEOUT_SAVED-}" = "null" ]; then
          log "keep-awake: deleted screen_off_timeout (was unset/null at setup; put cannot undo unset)"
        else
          log "keep-awake: deleted screen_off_timeout (leak: saved equalled KA_SCREEN_TIMEOUT_MS=$KA_SCREEN_TIMEOUT_MS from a prior run)"
        fi
      else
        log "keep-awake: WARNING failed to delete screen_off_timeout (saved=${_KA_SCREEN_TIMEOUT_SAVED-}); left $KA_SCREEN_TIMEOUT_MS"
      fi
      ;;
    put\ *)
      if adb shell "settings put system screen_off_timeout ${_KA_SCREEN_TIMEOUT_SAVED}" >/dev/null 2>&1; then
        log "keep-awake: restored screen_off_timeout=${_KA_SCREEN_TIMEOUT_SAVED} (was $KA_SCREEN_TIMEOUT_MS)"
      else
        log "keep-awake: WARNING failed to restore screen_off_timeout (saved=${_KA_SCREEN_TIMEOUT_SAVED}); left $KA_SCREEN_TIMEOUT_MS"
      fi
      ;;
  esac

  # 2) Remove from Doze whitelist only if WE added it.
  if [ "${_KA_WL_WAS_WHITELISTED:-0}" = "0" ]; then
    if adb shell "dumpsys deviceidle whitelist -$PKG" >/dev/null 2>&1; then
      log "keep-awake: removed $PKG from deviceidle whitelist"
    else
      log "keep-awake: WARNING failed to remove $PKG from deviceidle whitelist"
    fi
  else
    log "keep-awake: left $PKG in deviceidle whitelist (was already whitelisted before run)"
  fi
}

# thermal_decision <status> <battery_deci_celsius>
#   Pure decision (no adb): given Android thermal status (0–6) and battery
#   temperature in tenths of a degree C, print one of:
#     pause    — status >= THERMAL_STATUS_PAUSE or battery >= THERMAL_BATTERY_PAUSE_DECI
#     continue — cool enough to run (or warm but below the pause ceiling)
#     unknown  — probe unreadable (empty / non-numeric / N/A); caller must NOT
#                pause or resume on this — same rule as wakefulness_is_fatal
#   Resume after a pause is just continue once status <= THERMAL_STATUS_RESUME
#   and battery <= THERMAL_BATTERY_RESUME_DECI (checked by the wait loop).
# Covered by scripts/test_sideload_guards.sh.
thermal_decision() {
  local status="${1:-}" batt="${2:-}"
  local status_ok=0 batt_ok=0
  case "$status" in
    ''|*[!0-9]*) ;;
    *) status_ok=1 ;;
  esac
  case "$batt" in
    ''|*[!0-9]*) ;;
    *) batt_ok=1 ;;
  esac
  # Both fields mute → unknown (caller continues; never invent a pause).
  if [ "$status_ok" -eq 0 ] && [ "$batt_ok" -eq 0 ]; then
    echo unknown
    return 0
  fi
  # Act on whichever half answered. SEVERE alone or 44°C alone is enough.
  if [ "$status_ok" -eq 1 ] && [ "$status" -ge "$THERMAL_STATUS_PAUSE" ]; then
    echo pause
    return 0
  fi
  if [ "$batt_ok" -eq 1 ] && [ "$batt" -ge "$THERMAL_BATTERY_PAUSE_DECI" ]; then
    echo pause
    return 0
  fi
  echo continue
}

# thermal_is_cool_enough <status> <battery_deci_celsius>
#   Pure: return 0 if status <= RESUME and battery <= RESUME_DECI (readable).
#   Unreadable → 1 (keep waiting; never act on a mute probe).
thermal_is_cool_enough() {
  local status="${1:-}" batt="${2:-}"
  case "$status" in
    ''|*[!0-9]*) return 1 ;;
  esac
  case "$batt" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$status" -le "$THERMAL_STATUS_RESUME" ] && [ "$batt" -le "$THERMAL_BATTERY_RESUME_DECI" ]
}

# device_thermal_probe
#   Read Thermal Status (dumpsys thermalservice) and battery temperature
#   (dumpsys battery, tenths of °C). Print "STATUS BATTERY_DECI" on one line.
#   On any unreadable field print "unknown" for that field — never invent
#   numbers. Caller must not act on unknown (thermal_decision → unknown).
device_thermal_probe() {
  local status batt raw
  raw=$(adb shell "dumpsys thermalservice" 2>/dev/null | tr -d '\r' || true)
  status=$(printf '%s\n' "$raw" | grep -m1 -E 'Thermal Status:[[:space:]]*[0-9]+' \
    | sed -E 's/.*Thermal Status:[[:space:]]*([0-9]+).*/\1/' || true)
  case "$status" in
    ''|*[!0-9]*) status=unknown ;;
  esac

  raw=$(adb shell "dumpsys battery" 2>/dev/null | tr -d '\r' || true)
  batt=$(printf '%s\n' "$raw" | grep -m1 -E 'temperature:[[:space:]]*[0-9]+' \
    | sed -E 's/.*temperature:[[:space:]]*([0-9]+).*/\1/' || true)
  case "$batt" in
    ''|*[!0-9]*) batt=unknown ;;
  esac

  printf '%s %s\n' "$status" "$batt"
}

# Last probe values at turn start (set by device_thermal_gate). Empty when
# the emulator path skipped the gate or the probe never ran.
THERMAL_STATUS_AT_TURN=""
THERMAL_BATTERY_DECI_AT_TURN=""

# device_thermal_gate
#   Device mode only (emulator is a no-op). Probe thermal state; if hot
#   (thermal_decision → pause), wait until cool enough, polling every
#   THERMAL_POLL_S, capped at THERMAL_WAIT_CAP_S — then die naming the
#   thermal state rather than emit throttled data. unknown → continue
#   without pausing. Sets THERMAL_STATUS_AT_TURN / THERMAL_BATTERY_DECI_AT_TURN
#   to the values at the moment the turn is allowed to start.
device_thermal_gate() {
  THERMAL_STATUS_AT_TURN=""
  THERMAL_BATTERY_DECI_AT_TURN=""
  [ "$BENCH_TARGET" = "device" ] || return 0

  local status batt decision waited=0 cool_ok=0
  # shellcheck disable=SC2034  # read assigns both
  read -r status batt <<EOF
$(device_thermal_probe)
EOF
  THERMAL_STATUS_AT_TURN="$status"
  THERMAL_BATTERY_DECI_AT_TURN="$batt"

  decision=$(thermal_decision "$status" "$batt")
  case "$decision" in
    pause) ;;
    *) return 0 ;;
  esac

  log "thermal: pause — status=$status battery_deci=$batt (SEVERE or battery>=${THERMAL_BATTERY_PAUSE_DECI}dC); waiting for status<=$THERMAL_STATUS_RESUME and battery<=${THERMAL_BATTERY_RESUME_DECI}dC (cap ${THERMAL_WAIT_CAP_S}s)"

  while [ "$waited" -lt "$THERMAL_WAIT_CAP_S" ]; do
    sleep "$THERMAL_POLL_S"
    waited=$((waited + THERMAL_POLL_S))
    read -r status batt <<EOF
$(device_thermal_probe)
EOF
    THERMAL_STATUS_AT_TURN="$status"
    THERMAL_BATTERY_DECI_AT_TURN="$batt"

    # Sparse poll log (every poll is 30s — one line each is readable, not spam).
    log "thermal: cooling… waited=${waited}s status=$status battery_deci=$batt"

    if thermal_is_cool_enough "$status" "$batt"; then
      cool_ok=1
      break
    fi
  done

  if [ "$cool_ok" -ne 1 ]; then
    die "thermal: still hot after ${THERMAL_WAIT_CAP_S}s — status=$status battery_deci=$batt (refusing throttled data)"
  fi
  log "thermal: resume after ${waited}s — status=$status battery_deci=$batt"
  return 0
}

# Installs the APK and, on the emulator, sideloads the GGUF into
# files/models/<model_dir>/<model_file>. On a device, the model must already
# have been downloaded by the app.
#   install_and_sideload <apk_path> <model_src_path> <model_dir> <model_file>
install_and_sideload() {
  local apk="$1"
  local model_src="$2"
  local model_dir="$3"
  local model_file="$4"

  adb wait-for-device
  adb shell settings put global hide_error_dialogs 1 || true
  if [ "$BENCH_TARGET" = "device" ]; then
    device_keepawake_setup
  fi
  if [ "$BENCH_TARGET" = "emulator" ]; then
    adb root >/dev/null 2>&1 || true; sleep 5; adb wait-for-device
  fi

  log "install APK ($apk)"
  if [ "$BENCH_TARGET" = "device" ]; then
    if ! adb install -r "$apk" 2>&1 | tail -2; then
      die "adb install -r failed for $apk"
    fi
  else
    adb install -r "$apk" 2>&1 | tail -2
  fi

  if [ "$BENCH_TARGET" = "device" ]; then
    adb shell am force-stop "$PKG" >/dev/null 2>&1 || true
    local model_ls model_size
    if ! model_ls=$(adb shell "run-as $PKG ls -la files/models/$model_dir/$model_file" 2>/dev/null | tr -d '\r'); then
      die "model $model_file is not downloaded; open the app and download $model_file once"
    fi
    model_size=$(printf '%s\n' "$model_ls" | awk 'NF >= 5 {print $5; exit}')
    case "$model_size" in
      ''|*[!0-9]*) die "model $model_file is not plausibly sized; open the app and download $model_file once" ;;
    esac
    [ "$model_size" -ge 1048576 ] \
      || die "model $model_file is not plausibly sized ($model_size bytes); open the app and download $model_file once"
    log "model present through run-as: $model_ls"
    return 0
  fi

  # ── Pre-flight: source size + device free space ───────────────
  local src_size
  src_size=$(stat -c %s "$model_src")
  log "model source size: $src_size bytes ($model_file)"

  # df -P (POSIX format): Filesystem 1024-blocks Used Available Capacity Mounted
  # Column 4 = Available in 1K blocks.  /data is the userdata partition where
  # the app's files/ directory lives.
  local avail_kb
  avail_kb=$(adb shell "df -P /data" 2>/dev/null | awk 'NR==2{print $4}' | tr -d '\r')
  case "$avail_kb" in
    ''|*[!0-9]*) die "could not parse df output for /data (raw: $(adb shell df -P /data 2>/dev/null | head -3 | tr -d '\r'))" ;;
  esac
  local avail_bytes=$((avail_kb * 1024))
  log "device /data free: $avail_bytes bytes (df reported ${avail_kb}K)"

  check_free_space "$avail_bytes" "$src_size" "$model_file"

  # ── Push + move (single copy, not two) ────────────────────────
  # /data/local/tmp and /data/data are on the same ext4/f2fs filesystem,
  # so mv is a rename(2) — instant, zero extra disk.  cp would hold two
  # full copies at peak (5.2 GB → 10.4 GB for the 8B model, exceeding the
  # old 8 GB userdata partition and silently failing the push).
  log "sideload model $model_file"
  adb shell "mkdir -p /data/data/$PKG/files/models/$model_dir"
  adb push "$model_src" /data/local/tmp/model.gguf 2>&1 | tail -1
  adb shell "mv /data/local/tmp/model.gguf /data/data/$PKG/files/models/$model_dir/$model_file"

  # ── Assert on-device size matches source ──────────────────────
  local dev_size
  dev_size=$(adb shell "stat -c %s /data/data/$PKG/files/models/$model_dir/$model_file" 2>/dev/null | tr -d '\r')
  assert_size_match "$dev_size" "$src_size" "$model_file"

  local uid_line
  uid_line=$(adb shell "stat -c %U /data/data/$PKG" | tr -d '\r')
  adb shell "chown -R $uid_line:$uid_line /data/data/$PKG/files/models"
  adb shell "ls -la /data/data/$PKG/files/models/$model_dir/" | tr -d '\r'

  log "first launch (creates AsyncStorage db)"
  adb shell am start -n "$PKG/.MainActivity" >/dev/null; sleep 25
  adb shell am force-stop "$PKG"; sleep 3
}

# Tap the composer by widget class — works whether or not it already has text
# (the "Ask a question…" placeholder disappears as soon as the user types).
tap_editable() {
  local b
  b=$(dump_ui | tr '>' '\n' | grep 'class="android.widget.EditText"' \
      | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  [ -z "$b" ] && { log "no EditText on screen"; return 1; }
  local n; n=$(echo "$b" | grep -o '[0-9]\+' | tr '\n' ' ')
  local x1 y1 x2 y2; read -r x1 y1 x2 y2 <<< "$n"
  log "tap EditText at $(( (x1 + x2) / 2 )),$(( (y1 + y2) / 2 ))"
  adb shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
}

# Type a possibly multi-word string reliably.
# `adb shell input text "a b"` reaches the device as two arguments (only "a" is
# typed) and the %s escape is not honoured consistently across images, so type
# each word and press KEYCODE_SPACE (62) in between.
type_text() {
  local msg="$1" first=1 w
  for w in $msg; do
    [ "$first" -eq 1 ] || adb shell input keyevent 62
    adb shell input text "$w"
    first=0
  done
}

# Pull the EditText contents out of an already-captured uiautomator dump ($1).
# Split out of composer_text so clear_composer can judge the SAME dump it parses
# (a second dump_ui could disagree with the first, and costs a round trip).
_composer_text_from_dump() {
  printf '%s' "$1" | tr '>' '\n' | grep 'class="android.widget.EditText"' \
    | grep -o 'text="[^"]*"' | head -1 | sed 's/^text="//; s/"$//'
}

# What is actually in the EditText right now (for diagnostics).
composer_text() {
  _composer_text_from_dump "$(dump_ui)"
}

# Lives here, not in ci-bench.sh, because composer_looks_empty below consumes it:
# ci-bench.sh defined it *after* sourcing this file, which left every other
# sourcing script one `set -u` away from an unbound-variable death.
# Empty React Native TextInput: uiautomator reports the PLACEHOLDER in the
# EditText text="…" attribute (not a real empty string). composer_text therefore
# returns this on a truly empty field; tap_node matches it the same way.
# Treating the placeholder as non-empty would clear-and-fail every turn.
# Both languages on purpose (not derived from $LOCALE / seeded kalsa.locale):
# the list stays correct if the seed changes again, and a stale entry costs nothing.
# Ellipsis is the single char "…", not three dots (src/i18n/{en,it}.ts chat.placeholder).
# Deliberately NOT readonly: ci-lib.sh has no include guard, and a readonly here
# would turn any future double-source into a hard error. Nothing reassigns it.
COMPOSER_PLACEHOLDERS=(
  "Ask a question…"
  "Fai una domanda…"
)

# True if $1 is blank or equals any accepted composer placeholder (empty field).
# Placeholder counts as empty: uiautomator puts a COMPOSER_PLACEHOLDERS entry
# into EditText text="…" on a blank TextInput (see the array comment above).
composer_looks_empty() {
  local t="$1" p
  [ -z "$t" ] && return 0
  for p in "${COMPOSER_PLACEHOLDERS[@]}"; do
    [ "$t" = "$p" ] && return 0
  done
  return 1
}

# Wipe the composer until it is empty (or return non-zero after 3 attempts).
# WHY: a fixed 60× DEL loop (ci-bench.sh pre-Fix) truncated prompts longer than
# 60 chars — e.g. an 89-char prompt left 21 residual chars after MOVE_END+60 DEL,
# causing the arm to send garbage instead of the intended message. We move to
# the cursor end, delete ${#text}+8 times, re-read, and repeat up to 3 passes.
# A hard per-pass ceiling of 400 caps runaway loops if the UI lies about text.
#
# A FAILED DUMP IS NOT AN EMPTY FIELD. dump_ui (ci-lib.sh:36) swallows every
# error and cats an absent/stale file, so composer_text returns "" both when the
# composer is empty and when we simply could not see it. The first version of
# this function trusted that "" and returned success without sending one DEL —
# the same trap ci-bench.sh:448 already documents for dump_ui_retry (run
# 31367691176 logged "no EditText on screen" on a screen that had one). So we
# require positive evidence of an EditText node before believing any verdict.
clear_composer() {
  local pass i text n ui seen=false
  for pass in 1 2 3; do
    ui=$(dump_ui)
    case "$ui" in
      *'class="android.widget.EditText"'*) seen=true ;;
      *) sleep 2; continue ;;   # could not see the field — retry, do not conclude
    esac
    text=$(_composer_text_from_dump "$ui")
    composer_looks_empty "$text" && return 0
    adb shell input keyevent KEYCODE_MOVE_END
    n=$(( ${#text} + 8 ))
    [ "$n" -gt 400 ] && n=400
    for (( i = 0; i < n; i++ )); do
      adb shell input keyevent 67 >/dev/null 2>&1
    done
    sleep 0.5
  done
  if [ "$seen" = false ]; then
    log "clear_composer: no EditText in any of 3 dumps — field state unknown" >&2
    return 1
  fi
  ui=$(dump_ui)
  case "$ui" in
    *'class="android.widget.EditText"'*) ;;
    *) log "clear_composer: final dump failed — field state unknown" >&2; return 1 ;;
  esac
  text=$(_composer_text_from_dump "$ui")
  composer_looks_empty "$text" && return 0
  log "clear_composer: composer still non-empty after 3 passes: [$text]" >&2
  return 1
}
