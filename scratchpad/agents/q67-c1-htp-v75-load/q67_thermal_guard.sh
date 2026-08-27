#!/system/bin/sh

# q67 fail-closed battery-temperature guard.  The target is a pid file whose
# first BINARY_PID value is the workload wrapper; that wrapper execs the real
# binary after READY and TRACKING have been published.

if [ "$#" -lt 8 ]; then
    echo "usage: $0 pid_file warn_tenths kill_tenths log interval_s ready tracking sensor_fail_limit" >&2
    exit 64
fi

pid_source=$1
warn_tenths=$2
kill_tenths=$3
log_path=$4
interval_s=$5
ready_path=$6
tracking_path=$7
sensor_fail_limit=$8
sensor_timeout_s=10

max_temp=-1
max_level=-1
warned=0
sensor_failures=0
target_pid=0
tracking_written=0
ready_written=0

log_line() {
    printf '%s\n' "$*" >> "$log_path"
}

pid_exists() {
    [ "$target_pid" -gt 0 ] 2>/dev/null || return 1
    [ -d "/proc/$target_pid" ] || return 1
    kill -0 "$target_pid" 2>/dev/null
}

resolve_target_pid() {
    target_pid=0
    [ -r "$pid_source" ] || return 0
    candidate=$(sed -n 's/^BINARY_PID=\([0-9][0-9]*\).*/\1/p' "$pid_source" 2>/dev/null | sed -n '1p')
    case "$candidate" in
        ''|0|*[!0-9]*) target_pid=0 ;;
        *) target_pid=$candidate ;;
    esac
}

read_sample() {
    sample_text=$(timeout "$sensor_timeout_s" dumpsys battery 2>/dev/null)
    temp=$(printf '%s\n' "$sample_text" | grep -m 1 '^  temperature:[[:space:]]*[0-9][0-9]*' | sed -n 's/^  temperature:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
    level=$(printf '%s\n' "$sample_text" | grep -m 1 '^  level:[[:space:]]*[0-9][0-9]*' | sed -n 's/^  level:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
    epoch=$(date +%s 2>/dev/null)
    sensor_ok=1
    case "$temp" in ''|*[!0-9]*|0) sensor_ok=0; temp=0 ;; esac
    case "$level" in ''|*[!0-9]*) level=-1 ;; esac
}

terminate_target() {
    if pid_exists; then
        kill -9 "$target_pid" 2>/dev/null
        poll=0
        while [ "$poll" -lt 10 ] && pid_exists; do
            sleep 0.5
            poll=$((poll + 1))
        done
        if pid_exists; then
            log_line "$epoch,$temp,$level,KILL_FAILED"
            return 3
        fi
    fi
    return 0
}

abort_with_kill() {
    event=$1
    code=$2
    log_line "$epoch,$temp,$level,$event"
    terminate_target
    result=$?
    [ "$result" -eq 3 ] && return 3
    log_line "$epoch,$temp,$level,KILLED"
    return "$code"
}

process_sample() {
    [ "$temp" -gt "$max_temp" ] && max_temp=$temp
    [ "$level" -gt "$max_level" ] && max_level=$level
    if [ "$sensor_ok" -eq 0 ]; then
        sensor_failures=$((sensor_failures + 1))
        log_line "$epoch,$temp,$level,SENSOR_FAILURE_$sensor_failures"
        if [ "$sensor_failures" -ge "$sensor_fail_limit" ]; then
            log_line "$epoch,$temp,$level,SENSOR_ERROR"
            terminate_target
            result=$?
            [ "$result" -eq 3 ] && return 3
            [ "$target_pid" -gt 0 ] && log_line "$epoch,$temp,$level,KILLED"
            return 3
        fi
        return 0
    fi
    sensor_failures=0
    if [ "$level" -ge 0 ] && [ "$level" -lt 40 ]; then
        abort_with_kill BATTERY_LOW_ABORT 2
        return $?
    fi
    if [ "$temp" -ge "$warn_tenths" ] && [ "$warned" -eq 0 ]; then
        log_line "$epoch,$temp,$level,WARN"
        warned=1
    fi
    if [ "$temp" -ge "$kill_tenths" ]; then
        abort_with_kill KILL_THRESHOLD 2
        return $?
    fi
    return 0
}

: >> "$log_path" || exit 73
log_line "START,$(date +%s),warn_tenths=$warn_tenths,kill_tenths=$kill_tenths,interval_s=$interval_s,sensor_fail_limit=$sensor_fail_limit,sensor_timeout_s=$sensor_timeout_s,battery_floor=40"
if ! command -v timeout >/dev/null 2>&1; then
    log_line "TIMEOUT_BINARY_MISSING"
    exit 64
fi

while :; do
    poll_started=$(date +%s 2>/dev/null)
    read_sample
    log_line "$epoch,$temp,$level"
    resolve_target_pid
    if [ "$target_pid" -eq 0 ]; then
        sleep 1
        continue
    fi
    if ! pid_exists; then
        if [ "$tracking_written" -eq 0 ]; then
            log_line "$epoch,$temp,$level,TARGET_GONE"
            exit 3
        fi
        break
    fi
    if [ "$ready_written" -eq 0 ] && [ "$sensor_ok" -eq 1 ]; then
        log_line "$epoch,$temp,$level,READY"
        printf 'GUARD_READY=%s\n' "$epoch" > "$ready_path" || exit 3
        ready_written=1
    fi
    if [ "$tracking_written" -eq 0 ]; then
        log_line "$epoch,$temp,$level,TRACKING_$target_pid"
        printf 'GUARD_TRACKING=%s\n' "$epoch" > "$tracking_path" || exit 3
        tracking_written=1
    fi
    process_sample
    result=$?
    [ "$result" -ne 0 ] && exit "$result"
    poll_finished=$(date +%s 2>/dev/null)
    elapsed=$((poll_finished - poll_started))
    remaining=$((interval_s - elapsed))
    [ "$remaining" -gt 0 ] && sleep "$remaining"
done

read_sample
process_sample
result=$?
[ "$result" -ne 0 ] && exit "$result"
log_line "$epoch,$max_temp,$max_level,MAX"
exit 0
