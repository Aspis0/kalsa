#!/bin/sh
set -u

serial=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
remote_root=/data/local/tmp/govhtp
log_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ "$#" -lt 3 ]; then
    echo "usage: run_guarded.sh RUN_NAME direct|peak 'REMOTE_COMMAND'" >&2
    exit 2
fi

name=$1
mode=$2
command=$3

case "$mode" in
    direct)
        remote_command=$command
        ;;
    peak)
        remote_command="run_peak() { label=\$1; shift; \"\$@\" > \"$remote_root/\$label.log\" 2>&1 & pid=\$!; peak=0; while kill -0 \"\$pid\" 2>/dev/null; do rss=\$(awk '/VmHWM:/ {print \$2}' \"/proc/\$pid/status\" 2>/dev/null); if [ -n \"\$rss\" ] && [ \"\$rss\" -gt \"\$peak\" ]; then peak=\$rss; fi; sleep 1; done; wait \"\$pid\"; rc=\$?; echo EXIT=\$rc RSS_peak_kB=\$peak; tail -5 \"$remote_root/\$label.log\"; return \"\$rc\"; }; run_peak $name $command"
        ;;
    *)
        echo "unknown mode: $mode" >&2
        exit 2
        ;;
esac

gate() {
    adb -s "$serial" shell '
        wake=$(dumpsys power | sed -n "s/.*mWakefulness=//p" | head -1)
        battery=$(dumpsys battery)
        ac=$(printf "%s\n" "$battery" | sed -n "s/^  AC powered: //p" | head -1)
        usb=$(printf "%s\n" "$battery" | sed -n "s/^  USB powered: //p" | head -1)
        wireless=$(printf "%s\n" "$battery" | sed -n "s/^  Wireless powered: //p" | head -1)
        level=$(printf "%s\n" "$battery" | sed -n "s/^  level: //p" | head -1)
        temperature=$(printf "%s\n" "$battery" | sed -n "s/^  temperature: //p" | head -1)
        thermal=$(dumpsys thermalservice | sed -n "s/.*Thermal Status: //p" | head -1)
        traced=$(getprop persist.traced.enable)
        printf "mWakefulness=%s AC=%s USB=%s Wireless=%s battery=%s temperature_tenths_C=%s thermal_status=%s traced=%s\n" \
            "$wake" "$ac" "$usb" "$wireless" "$level" "$temperature" "$thermal" "$traced"
        [ "$wake" = Awake ] && [ "$ac" = false ] && [ "$usb" = false ] && [ "$wireless" = false ] \
            && [ "$level" -gt 30 ] && [ "$temperature" -lt 430 ] && [ "$thermal" -lt 3 ] && [ "$traced" = 0 ]
    '
}

if ! gate > "$log_dir/$name.pre.gate.log" 2>&1; then
    cat "$log_dir/$name.pre.gate.log"
    echo "PREFLIGHT_GATE_FAIL=$name"
    exit 30
fi

adb -s "$serial" shell am force-stop com.kalsa.app
if adb -s "$serial" shell pidof com.kalsa.app | grep -q .; then
    echo "APP_STILL_RUNNING=$name"
    exit 31
fi

adb -s "$serial" shell "cd $remote_root && export LD_LIBRARY_PATH=$remote_root/lib ADSP_LIBRARY_PATH=$remote_root/lib GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_HOSTBUF=1 GGML_OP_OFFLOAD_MIN_BATCH=32 && $remote_command" > "$log_dir/$name.summary.log" 2>&1
adb_status=$?
binary_status=$(sed -n 's/^EXIT=\([0-9][0-9]*\).*/\1/p' "$log_dir/$name.summary.log" | tail -1)

gate_status=0
if ! gate > "$log_dir/$name.post.gate.log" 2>&1; then
    gate_status=1
fi

remote_log="$remote_root/$name.log"
adb -s "$serial" pull "$remote_log" "$log_dir/$name.log" > "$log_dir/$name.pull.log" 2>&1
pull_status=$?

cat "$log_dir/$name.pre.gate.log"
cat "$log_dir/$name.summary.log"
cat "$log_dir/$name.post.gate.log"
printf "ADB_STATUS=%s BINARY_STATUS=%s POST_GATE_STATUS=%s PULL_STATUS=%s\n" \
    "$adb_status" "$binary_status" "$gate_status" "$pull_status"

[ "$adb_status" -eq 0 ] && [ "$binary_status" = 0 ] && [ "$gate_status" -eq 0 ] && [ "$pull_status" -eq 0 ]
