#!/system/bin/sh

# q64 sampler: the argument is BINARY_PID and is never replaced by a shell
# wrapper PID.  It records the process only after bmoe-cli has exec'd.

binary_pid=$1
out=$2
interval=${3:-1}

if [ -z "$binary_pid" ] || [ -z "$out" ]; then
    exit 64
fi

printf 'epoch,uptime_s,utime_ticks,stime_ticks,majflt,read_bytes,memavailable_kb,cpuset,cpus_allowed_list\n' > "$out" || exit 73

while [ -d "/proc/$binary_pid" ]; do
    cmdline=$(tr '\000' ' ' < "/proc/$binary_pid/cmdline" 2>/dev/null)
    case "$cmdline" in
        *bmoe-cli*) break ;;
    esac
    sleep 0.2
done

while [ -d "/proc/$binary_pid" ]; do
    stat_line=$(cat "/proc/$binary_pid/stat" 2>/dev/null)
    case "$stat_line" in
        '') break ;;
    esac
    stat_rest=$(printf '%s\n' "$stat_line" | sed 's/^[0-9][0-9]* ([^)]*) //')
    set -- $stat_rest
    majflt=${10:-0}
    utime=${12:-0}
    stime=${13:-0}
    read_bytes=$(sed -n 's/^read_bytes:[[:space:]]*//p' "/proc/$binary_pid/io" 2>/dev/null | sed -n '1p')
    [ -n "$read_bytes" ] || read_bytes=0
    memavailable_kb=$(sed -n 's/^MemAvailable:[[:space:]]*\([0-9][0-9]*\).*/\1/p' /proc/meminfo 2>/dev/null | sed -n '1p')
    [ -n "$memavailable_kb" ] || memavailable_kb=0
    cpuset=$(cat "/proc/$binary_pid/cpuset" 2>/dev/null | tr -d '\r\n')
    [ -n "$cpuset" ] || cpuset=NA
    cpus_allowed_list=$(sed -n 's/^Cpus_allowed_list:[[:space:]]*//p' "/proc/$binary_pid/status" 2>/dev/null | sed -n '1p' | tr -d '\r\n')
    [ -n "$cpus_allowed_list" ] || cpus_allowed_list=NA
    epoch=$(date +%s 2>/dev/null)
    uptime_s=$(cut -d' ' -f1 /proc/uptime 2>/dev/null)
    [ -n "$epoch" ] || epoch=0
    [ -n "$uptime_s" ] || uptime_s=0

    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
        "$epoch" "$uptime_s" "$utime" "$stime" "$majflt" "$read_bytes" \
        "$memavailable_kb" "$cpuset" "$cpus_allowed_list" >> "$out"
    sleep "$interval"
done
