#!/system/bin/sh

# Android toybox/POSIX thermal guard.
# usage: thermal_guard.sh <pid> <warn_tenths> <kill_tenths> <log_path> <interval_s>

if [ "$#" -ne 5 ]; then
    echo "usage: $0 <pid> <warn_tenths> <kill_tenths> <log_path> <interval_s>" >&2
    exit 64
fi

pid=$1
warn_tenths=$2
kill_tenths=$3
log_path=$4
interval_s=$5

case "$pid:$warn_tenths:$kill_tenths:$interval_s" in
    *[!0-9:]*|*:*:*:*:*)
        echo "numeric pid/threshold/interval required" >&2
        exit 64
        ;;
esac

if [ "$interval_s" -le 0 ] 2>/dev/null; then
    echo "interval_s must be positive" >&2
    exit 64
fi

# Session-wide hard safety limit. This remains active even when a caller
# supplies the future-cell production threshold of 430 tenths.
hard_tenths=380
max_temp=-1
max_level=-1
warned=0
sensor_ok=1

log_line() {
    printf '%s\n' "$*" >> "$log_path"
}

pid_exists() {
    [ -d "/proc/$pid" ] && kill -0 "$pid" 2>/dev/null
}

read_sample() {
    sample_text=$(dumpsys battery 2>/dev/null)
    temp=$(printf '%s\n' "$sample_text" | grep -m 1 '^[[:space:]]*temperature:' | sed -n 's/.*temperature:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
    level=$(printf '%s\n' "$sample_text" | grep -m 1 '^[[:space:]]*level:' | sed -n 's/.*level:[[:space:]]*\([0-9][0-9]*\).*/\1/p')

    if [ -z "$temp" ]; then
        for zone in /sys/class/thermal/thermal_zone*; do
            [ -r "$zone/type" ] || continue
            zone_type=$(cat "$zone/type" 2>/dev/null)
            case "$zone_type" in
                *battery*|*Battery*|*BATTERY*)
                    temp=$(cat "$zone/temp" 2>/dev/null)
                    break
                    ;;
            esac
        done
    fi

    if [ -z "$temp" ]; then
        sensor_ok=0
    else
        sensor_ok=1
    fi
    case "$temp" in
        ''|*[!0-9]*) temp=0 ;;
    esac
    case "$level" in
        ''|*[!0-9]*) level=-1 ;;
    esac
    epoch=$(date +%s)
}

: >> "$log_path" || exit 73

while pid_exists; do
    read_sample
    [ "$temp" -gt "$max_temp" ] && max_temp=$temp
    [ "$level" -gt "$max_level" ] && max_level=$level
    log_line "$epoch,$temp,$level"

    if [ "$sensor_ok" -eq 0 ]; then
        log_line "$epoch,$temp,$level,SENSOR_ERROR"
        kill -9 "$pid" 2>/dev/null
        log_line "$epoch,$temp,$level,KILLED"
        exit 2
    fi

    if [ "$level" -ge 0 ] && [ "$level" -lt 45 ]; then
        log_line "$epoch,$temp,$level,BATTERY_ABORT"
        kill -9 "$pid" 2>/dev/null
        log_line "$epoch,$temp,$level,KILLED"
        exit 2
    fi

    if [ "$temp" -ge "$hard_tenths" ]; then
        log_line "$epoch,$temp,$level,HARD_ABORT"
        kill -9 "$pid" 2>/dev/null
        log_line "$epoch,$temp,$level,KILLED"
        exit 2
    fi

    if [ "$temp" -ge "$warn_tenths" ] && [ "$warned" -eq 0 ]; then
        log_line "$epoch,$temp,$level,WARN"
        warned=1
    fi

    if [ "$temp" -ge "$kill_tenths" ]; then
        log_line "$epoch,$temp,$level,KILLED"
        kill -9 "$pid" 2>/dev/null
        exit 2
    fi

    sleep "$interval_s"
done

# Capture a final sample and record the observed maximum on normal exit.
read_sample
[ "$temp" -gt "$max_temp" ] && max_temp=$temp
[ "$level" -gt "$max_level" ] && max_level=$level
log_line "$epoch,$temp,$level"
if [ "$sensor_ok" -eq 0 ]; then
    log_line "$epoch,$temp,$level,SENSOR_ERROR"
    log_line "$epoch,$max_temp,$max_level,MAX"
    exit 2
fi
if [ "$level" -ge 0 ] && [ "$level" -lt 45 ]; then
    log_line "$epoch,$temp,$level,BATTERY_ABORT"
    log_line "$epoch,$max_temp,$max_level,MAX"
    exit 2
fi
if [ "$temp" -ge "$hard_tenths" ]; then
    log_line "$epoch,$temp,$level,HARD_ABORT"
    log_line "$epoch,$max_temp,$max_level,MAX"
    exit 2
fi
log_line "$epoch,$max_temp,$max_level,MAX"
exit 0
