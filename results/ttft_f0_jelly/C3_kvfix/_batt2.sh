#!/data/data/com.termux/files/usr/bin/bash
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:/system/bin:$PATH"
echo "=== termux-api pkgs ==="
command -v termux-api-start
ls "$PREFIX/libexec/termux-api" 2>/dev/null | head
pm path com.termux.api 2>&1 | head
echo "=== start api ==="
timeout 5 termux-api-start 2>&1
echo start_rc=$?
sleep 2
echo "=== retry battery ==="
timeout 8 termux-battery-status
echo batt_rc=$?
echo "=== dumpsys power ==="
timeout 5 dumpsys power 2>&1 | grep -iE 'mBatteryLevel|mIsPowered|mPlugType|mCharging|plugged' | head -20
echo "=== thermal ==="
timeout 3 cat /sys/class/thermal/thermal_zone0/temp 2>&1
timeout 3 cat /sys/devices/virtual/thermal/thermal_zone0/temp 2>&1
echo "=== last ttft batt ==="
tail -5 "$HOME/experiments/results/ttft_f0_jelly/TTFT.master.log" 2>/dev/null
