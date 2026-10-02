#!/bin/sh
# 60 s samples on the Xiaomi 14 (192.168.1.193:35051) while the
# htp-kv-attention xiaomi-v75 run is in progress (2026-10-01).
# Read-only probes only: cpufreq limits, battery level/temp, Android thermal
# status. UTC timestamps align with session-events.log.
SER=192.168.1.193:35051
OUT=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/htp-kv-attention/raw/xiaomi-v75/samples.log
for i in $(seq 1 45); do
  ts=$(date -u +%FT%TZ)
  fmax=$(adb -s $SER shell cat /sys/devices/system/cpu/cpu7/cpufreq/scaling_max_freq 2>/dev/null | tr -d '\r')
  fcur=$(adb -s $SER shell cat /sys/devices/system/cpu/cpu7/cpufreq/scaling_cur_freq 2>/dev/null | tr -d '\r')
  bat=$(adb -s $SER shell dumpsys battery 2>/dev/null | grep -E '^(  )?(level|temperature):' | tr -d '\r' | tr '\n' ' ')
  th=$(adb -s $SER shell dumpsys thermalservice 2>/dev/null | grep -m1 'Thermal Status' | tr -d '\r')
  echo "$ts cpu7_max=$fmax cpu7_cur=$fcur $bat $th" >> "$OUT"
  sleep 60
done
