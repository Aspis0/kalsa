#!/system/bin/sh

# Android toybox/POSIX thermal guard.
#
# usage:
#   thermal_guard.sh <pid|pid_file> <warn_tenths> <kill_tenths> <log_path> <interval_s>
#                    [session_hard_cap_tenths] [ready_path] [tracking_path] [sensor_fail_limit]
#
# A pid_file may contain BINARY_PID=<pid>. In that mode the guard starts
# before the workload wrapper and waits for the wrapper PID. The wrapper must
# wait for tracking_path before execing the real workload.

if [ "$#" -lt 5 ] || [ "$#" -gt 9 ]; then
    echo "usage: $0 <pid|pid_file> <warn_tenths> <kill_tenths> <log_path> <interval_s> [session_hard_cap_tenths] [ready_path] [tracking_path] [sensor_fail_limit]" >&2
    exit 64
fi

pid_source=$1
warn_tenths=$2
kill_tenths=$3
log_path=$4
interval_s=$5
session_hard_cap_tenths=${6:-0}
ready_path=${7:-}
tracking_path=${8:-}
sensor_fail_limit=${9:-4}
sensor_timeout_s=10
sensor_failure_window_s=$((sensor_fail_limit * sensor_timeout_s))
sensor_command_override=${THERMAL_SENSOR_CMD:-}

is_uint() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
        *) return 0 ;;
    esac
}

is_uint "$warn_tenths" || { echo "warn_tenths must be an integer" >&2; exit 64; }
is_uint "$kill_tenths" || { echo "kill_tenths must be an integer" >&2; exit 64; }
is_uint "$interval_s" || { echo "interval_s must be an integer" >&2; exit 64; }
is_uint "$session_hard_cap_tenths" || { echo "session_hard_cap_tenths must be an integer" >&2; exit 64; }
is_uint "$sensor_fail_limit" || { echo "sensor_fail_limit must be an integer" >&2; exit 64; }

if [ "$kill_tenths" -le 0 ] || [ "$interval_s" -le 0 ] || [ "$sensor_fail_limit" -le 0 ]; then
    echo "kill_tenths, interval_s, and sensor_fail_limit must be positive" >&2
    exit 64
fi
if [ "$warn_tenths" -gt "$kill_tenths" ]; then
    echo "warn_tenths must not exceed kill_tenths" >&2
    exit 64
fi
case "$pid_source" in
    '') echo "pid or pid_file required" >&2; exit 64 ;;
esac

# The caller-supplied kill is the documented threshold. A session hard cap is
# optional and explicit; when lower, it becomes the effective kill and is
# logged as such at START. It never silently shadows kill_tenths.
effective_kill_tenths=$kill_tenths
if [ "$session_hard_cap_tenths" -gt 0 ] && [ "$session_hard_cap_tenths" -lt "$effective_kill_tenths" ]; then
    effective_kill_tenths=$session_hard_cap_tenths
fi

max_temp=-1
max_level=-1
warned=0
sensor_failures=0
sensor_ok=0
target_pid=0
tracking_written=0
ready_written=0
sample_logged=0

log_line() {
    printf '%s\n' "$*" >> "$log_path"
}

pid_exists() {
    [ "$target_pid" -gt 0 ] 2>/dev/null || return 1
    [ -d "/proc/$target_pid" ] || return 1
    proc_state=$(cat "/proc/$target_pid/stat" 2>/dev/null | sed -n 's/^[0-9][0-9]* ([^)]*) \([A-Z]\).*$/\1/p')
    [ "$proc_state" = "Z" ] && return 1
    kill -0 "$target_pid" 2>/dev/null
}

resolve_target_pid() {
    if is_uint "$pid_source"; then
        target_pid=$pid_source
        return 0
    fi
    target_pid=0
    [ -r "$pid_source" ] || return 0
    candidate=$(sed -n 's/^BINARY_PID=\([0-9][0-9]*\).*/\1/p' "$pid_source" 2>/dev/null | sed -n '1p')
    case "$candidate" in
        ''|0|*[!0-9]*) target_pid=0 ;;
        *) target_pid=$candidate ;;
    esac
}

read_sample() {
    if [ -n "$sensor_command_override" ]; then
        sample_text=$(timeout "$sensor_timeout_s" sh -c "$sensor_command_override" 2>/dev/null)
    else
        sample_text=$(timeout "$sensor_timeout_s" dumpsys battery 2>/dev/null)
    fi
    # dumpsys battery has a current-value block followed by a history block.
    # Only the two-space current-block forms are authoritative; history lines
    # such as "Sending ACTION_BATTERY_CHANGED: ... temperature:..." must not
    # be selected.
    temp=$(printf '%s\n' "$sample_text" | grep -m 1 '^  temperature:[[:space:]]*[0-9][0-9]*' | sed -n 's/^  temperature:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
    level=$(printf '%s\n' "$sample_text" | grep -m 1 '^  level:[[:space:]]*[0-9][0-9]*' | sed -n 's/^  level:[[:space:]]*\([0-9][0-9]*\).*/\1/p')

    sensor_ok=1
    case "$temp" in
        ''|*[!0-9]*|0) sensor_ok=0; temp=0 ;;
    esac
    case "$level" in
        ''|*[!0-9]*) level=-1 ;;
    esac
    epoch=$(date +%s 2>/dev/null)
    case "$epoch" in
        ''|*[!0-9]*) epoch=0 ;;
    esac
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
    exit_code=$2
    log_line "$epoch,$temp,$level,$event"
    terminate_target
    kill_result=$?
    if [ "$kill_result" -eq 3 ]; then
        return 3
    fi
    log_line "$epoch,$temp,$level,KILLED"
    return "$exit_code"
}

process_sample() {
    [ "$temp" -gt "$max_temp" ] && max_temp=$temp
    [ "$level" -gt "$max_level" ] && max_level=$level
    if [ "$sample_logged" -eq 0 ]; then
        log_line "$epoch,$temp,$level" || return 3
        sample_logged=1
    fi

    if [ "$sensor_ok" -eq 0 ]; then
        sensor_failures=$((sensor_failures + 1))
        log_line "$epoch,$temp,$level,SENSOR_FAILURE_$sensor_failures" || return 3
        if [ "$sensor_failures" -ge "$sensor_fail_limit" ]; then
            log_line "$epoch,$temp,$level,SENSOR_ERROR" || return 3
            terminate_target
            kill_result=$?
            [ "$kill_result" -eq 3 ] && return 3
            [ "$target_pid" -gt 0 ] && log_line "$epoch,$temp,$level,KILLED"
            return 3
        fi
        return 0
    fi
    sensor_failures=0

    if [ "$level" -ge 0 ] && [ "$level" -lt 45 ]; then
        abort_with_kill BATTERY_LOW_ABORT 2
        return $?
    fi

    if [ "$temp" -ge "$warn_tenths" ] && [ "$warned" -eq 0 ]; then
        log_line "$epoch,$temp,$level,WARN" || return 3
        warned=1
    fi

    if [ "$temp" -ge "$effective_kill_tenths" ]; then
        if [ "$session_hard_cap_tenths" -gt 0 ] && [ "$session_hard_cap_tenths" -lt "$kill_tenths" ] && [ "$temp" -ge "$session_hard_cap_tenths" ]; then
            abort_with_kill HARD_ABORT 2
        else
            abort_with_kill KILL_THRESHOLD 2
        fi
        return $?
    fi
    return 0
}

: >> "$log_path" || exit 73
log_line "START,$(date +%s),warn_tenths=$warn_tenths,kill_tenths=$kill_tenths,hard_abort_tenths=$session_hard_cap_tenths,session_hard_cap_tenths=$session_hard_cap_tenths,effective_kill_tenths=$effective_kill_tenths,interval_s=$interval_s,sensor_fail_limit=$sensor_fail_limit,sensor_timeout_s=$sensor_timeout_s,sensor_failure_window_s=$sensor_failure_window_s,sensor_command_override=${sensor_command_override:-none},fail_closed_false_kill_accepted=1" || exit 73
if ! command -v timeout >/dev/null 2>&1; then
    log_line "TIMEOUT_BINARY_MISSING,timeout_required_for_${sensor_timeout_s}s_sensor_reads"
    exit 64
fi

while :; do
    poll_started=$(date +%s 2>/dev/null)
    read_sample
    sample_logged=0
    log_line "$epoch,$temp,$level" || exit 3
    sample_logged=1

    resolve_target_pid
    if [ "$target_pid" -eq 0 ]; then
        if [ "$sensor_ok" -eq 0 ]; then
            process_sample
            sample_result=$?
            [ "$sample_result" -ne 0 ] && exit "$sample_result"
        fi
        sleep 1
        continue
    fi
    if ! pid_exists; then
        if [ "$tracking_written" -eq 0 ]; then
            log_line "$epoch,$temp,$level,TARGET_GONE" || exit 3
            exit 3
        fi
        break
    fi

    if [ "$ready_written" -eq 0 ] && [ "$sensor_ok" -eq 1 ]; then
        log_line "$epoch,$temp,$level,READY" || exit 3
        if [ -n "$ready_path" ]; then
            printf 'GUARD_READY=%s\n' "$epoch" > "$ready_path" || exit 3
        fi
        ready_written=1
    fi
    if [ "$tracking_written" -eq 0 ]; then
        log_line "$epoch,$temp,$level,TRACKING_$target_pid" || exit 3
        if [ -n "$tracking_path" ]; then
            printf 'GUARD_TRACKING=%s\n' "$epoch" > "$tracking_path" || exit 3
        fi
        tracking_written=1
    fi

    process_sample
    sample_result=$?
    [ "$sample_result" -ne 0 ] && exit "$sample_result"

    poll_finished=$(date +%s 2>/dev/null)
    case "$poll_started" in
        ''|*[!0-9]*) poll_started=0 ;;
    esac
    case "$poll_finished" in
        ''|*[!0-9]*) poll_finished=$poll_started ;;
    esac
    elapsed=$((poll_finished - poll_started))
    remaining=$((interval_s - elapsed))
    [ "$remaining" -gt 0 ] && sleep "$remaining"
done

# Final sample is subject to the same WARN/KILL/sensor checks as every loop
# sample. A workload that exits at a dangerous temperature is still reported
# as a threshold event, not merely MAX.
read_sample
process_sample
sample_result=$?
[ "$sample_result" -ne 0 ] && exit "$sample_result"
log_line "$epoch,$max_temp,$max_level,MAX" || exit 3
exit 0
