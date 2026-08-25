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
sensor_fail_limit=${9:-3}
sensor_timeout_s=5
sensor_failure_window_s=$((sensor_fail_limit * sensor_timeout_s))

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

log_line() {
    printf '%s\n' "$*" >> "$log_path"
}

pid_exists() {
    [ "$target_pid" -gt 0 ] 2>/dev/null && [ -d "/proc/$target_pid" ] && kill -0 "$target_pid" 2>/dev/null
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
    sample_text=$(timeout "$sensor_timeout_s" dumpsys battery 2>/dev/null)
    temp=$(printf '%s\n' "$sample_text" | grep -m 1 '^[[:space:]]*temperature:' | sed -n 's/.*temperature:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
    level=$(printf '%s\n' "$sample_text" | grep -m 1 '^[[:space:]]*level:' | sed -n 's/.*level:[[:space:]]*\([0-9][0-9]*\).*/\1/p')

    if [ -z "$temp" ]; then
        for zone in /sys/class/thermal/thermal_zone*; do
            [ -r "$zone/type" ] || continue
            zone_type=$(cat "$zone/type" 2>/dev/null)
            case "$zone_type" in
                *battery*|*Battery*|*BATTERY*)
                    zone_temp=$(cat "$zone/temp" 2>/dev/null)
                    case "$zone_temp" in
                        ''|*[!0-9]*) ;;
                        *)
                            if [ "$zone_temp" -ge 1000 ]; then
                                temp=$((zone_temp / 100))
                            else
                                temp=$zone_temp
                            fi
                            break
                            ;;
                    esac
                    ;;
            esac
        done
    fi

    sensor_ok=1
    case "$temp" in
        ''|*[!0-9]*|0) sensor_ok=0; temp=0 ;;
    esac
    case "$level" in
        ''|*[!0-9]*) sensor_ok=0; level=-1 ;;
    esac
    epoch=$(date +%s 2>/dev/null)
    case "$epoch" in
        ''|*[!0-9]*) epoch=0 ;;
    esac
}

terminate_target() {
    if pid_exists; then
        kill -9 "$target_pid" 2>/dev/null
        sleep 1
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
    log_line "$epoch,$temp,$level" || return 3

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

    if [ "$level" -lt 45 ]; then
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
log_line "START,$(date +%s),warn_tenths=$warn_tenths,kill_tenths=$kill_tenths,hard_abort_tenths=$session_hard_cap_tenths,session_hard_cap_tenths=$session_hard_cap_tenths,effective_kill_tenths=$effective_kill_tenths,interval_s=$interval_s,sensor_fail_limit=$sensor_fail_limit,sensor_timeout_s=$sensor_timeout_s,sensor_failure_window_s=$sensor_failure_window_s,fail_closed_false_kill_accepted=1" || exit 73
if ! command -v timeout >/dev/null 2>&1; then
    log_line "TIMEOUT_BINARY_MISSING,timeout_required_for_${sensor_timeout_s}s_sensor_reads"
    exit 64
fi

while :; do
    poll_started=$(date +%s 2>/dev/null)
    read_sample
    process_sample
    sample_result=$?
    [ "$sample_result" -ne 0 ] && exit "$sample_result"

    if [ "$ready_written" -eq 0 ] && [ "$sensor_ok" -eq 1 ]; then
        log_line "$epoch,$temp,$level,READY" || exit 3
        if [ -n "$ready_path" ]; then
            printf 'GUARD_READY=%s\n' "$epoch" > "$ready_path" || exit 3
        fi
        ready_written=1
    fi

    resolve_target_pid
    if [ "$target_pid" -gt 0 ]; then
        if ! pid_exists; then
            if [ "$tracking_written" -eq 0 ]; then
                log_line "$epoch,$temp,$level,TARGET_GONE" || exit 3
                exit 3
            fi
            break
        fi
        if [ "$tracking_written" -eq 0 ]; then
            log_line "$epoch,$temp,$level,TRACKING_$target_pid" || exit 3
            if [ -n "$tracking_path" ]; then
                printf 'GUARD_TRACKING=%s\n' "$epoch" > "$tracking_path" || exit 3
            fi
            tracking_written=1
        fi
    fi

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
