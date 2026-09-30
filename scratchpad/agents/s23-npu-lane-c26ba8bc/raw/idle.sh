#!/usr/bin/env bash
# usage: idle.sh LABEL SECONDS
# Idle current baseline: 1 Hz poll of the same fuel-gauge sysfs nodes the app's
# BATTERY_PROPERTY_CURRENT_NOW reads, run ON DEVICE so no adb round-trip jitter.
# Output CSV: LABEL-idle.csv  ->  t_s,current_now,voltage_now,thermal_status
S=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
OUT=/tmp/npu-b
LABEL=$1
SECS=${2:-70}
adb -s $S shell "n=0; end=\$(($SECS)); \
  while [ \$n -lt \$end ]; do \
    ts=\$(date +%s.%N); \
    c=\$(cat /sys/class/power_supply/battery/current_now 2>/dev/null); \
    v=\$(cat /sys/class/power_supply/battery/voltage_now 2>/dev/null); \
    echo \"\$ts,\$c,\$v\"; \
    n=\$((n+1)); sleep 1; \
  done" > $OUT/$LABEL-idle.csv 2>&1
echo "rows=$(wc -l < $OUT/$LABEL-idle.csv)"
head -2 $OUT/$LABEL-idle.csv
