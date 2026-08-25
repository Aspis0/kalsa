#!/system/bin/sh

pid=$1
out=$2
interval=${3:-1}

if [ -z "$pid" ] || [ -z "$out" ]; then
    exit 64
fi

printf 'epoch,uptime_s,utime_ticks,stime_ticks,majflt,read_bytes,psi_some_avg10,psi_some_total,psi_full_avg10,psi_full_total\n' > "$out" || exit 73

while [ -d "/proc/$pid" ]; do
    cmdline=$(tr '\000' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
    case "$cmdline" in
        *llama-bench*) break ;;
    esac
    sleep 0.2
done

while [ -d "/proc/$pid" ]; do
    stat_line=$(cat "/proc/$pid/stat" 2>/dev/null)
    case "$stat_line" in
        '') break ;;
    esac
    stat_rest=$(printf '%s\n' "$stat_line" | sed 's/^[0-9][0-9]* ([^)]*) //')
    set -- $stat_rest
    majflt=${10:-0}
    utime=${12:-0}
    stime=${13:-0}
    read_bytes=$(sed -n 's/^read_bytes:[[:space:]]*//p' "/proc/$pid/io" 2>/dev/null | sed -n '1p')
    [ -n "$read_bytes" ] || read_bytes=0
    epoch=$(date +%s 2>/dev/null)
    uptime_s=$(cut -d' ' -f1 /proc/uptime 2>/dev/null)
    [ -n "$epoch" ] || epoch=0
    [ -n "$uptime_s" ] || uptime_s=0

    psi_some=$(sed -n 's/^some avg10=\([^ ]*\).*total=\([0-9]*\).*/\1,\2/p' /proc/pressure/io 2>/dev/null | sed -n '1p')
    psi_full=$(sed -n 's/^full avg10=\([^ ]*\).*total=\([0-9]*\).*/\1,\2/p' /proc/pressure/io 2>/dev/null | sed -n '1p')
    some_avg10=$(printf '%s' "$psi_some" | cut -d, -f1)
    some_total=$(printf '%s' "$psi_some" | cut -d, -f2)
    full_avg10=$(printf '%s' "$psi_full" | cut -d, -f1)
    full_total=$(printf '%s' "$psi_full" | cut -d, -f2)
    [ -n "$some_avg10" ] || some_avg10=NA
    [ -n "$some_total" ] || some_total=NA
    [ -n "$full_avg10" ] || full_avg10=NA
    [ -n "$full_total" ] || full_total=NA

    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$epoch" "$uptime_s" "$utime" "$stime" "$majflt" "$read_bytes" "$some_avg10" "$some_total" "$full_avg10" "$full_total" >> "$out"
    sleep "$interval"
done

