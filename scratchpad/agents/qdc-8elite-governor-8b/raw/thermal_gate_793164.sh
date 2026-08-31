#!/bin/bash
# Thermal gate per AMENDMENT-1 of cell #38 (binding): read the LIVE HAL group,
# never the frozen "Cached temperatures:" group. PASS iff every CPU/GPU/skin
# temp in the HAL group is <= 60.0 C and Thermal Status <= 1.
# Usage: ANDROID_ADB_SERVER_PORT=6037 ./thermal_gate.sh <serial> <outfile>
set -u
SERIAL="$1"; OUT="$2"
adb -s "$SERIAL" shell dumpsys thermalservice > /tmp/therm_full.txt 2>&1
# extract the live HAL block + status
awk '/Current temperatures from HAL/{f=1} f{print} /Current cooling devices from HAL/{f=0}' /tmp/therm_full.txt > "$OUT"
grep "Thermal Status:" /tmp/therm_full.txt | head -1 >> "$OUT"
STATUS=$(grep "Thermal Status:" /tmp/therm_full.txt | head -1 | grep -o '[0-9]*' | head -1)
MAXT=$(grep -o 'mValue=[0-9.]*' "$OUT" | cut -d= -f2 | sort -n | tail -1)
echo "max_hal_temp=$MAXT status=$STATUS" >> "$OUT"
OK=$(echo "$MAXT <= 60.0" | bc -l 2>/dev/null || echo 0)
if [ "$OK" = "1" ] && [ "${STATUS:-9}" -le 1 ]; then echo GATE_PASS; exit 0; else echo GATE_FAIL; exit 1; fi
