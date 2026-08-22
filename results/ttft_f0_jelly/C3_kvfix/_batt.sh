#!/data/data/com.termux/files/usr/bin/bash
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:/system/bin:/system/xbin:$PATH"
echo "=== cmd battery ==="
timeout 5 cmd battery 2>&1 | head -40
echo "=== dumpsys battery ==="
timeout 5 dumpsys battery 2>&1 | head -40
echo "=== dumpsys batterystats ==="
timeout 5 dumpsys batterystats --checkin 2>&1 | head -5
echo "=== settings ==="
timeout 5 settings get global battery_percentage 2>&1
timeout 5 dumpsys power 2>&1 | grep -iE 'mBattery|plugged|charging|level' | head -20
echo "=== uevent try ==="
timeout 3 ls -l /sys/class/power_supply 2>&1
echo "=== termux-api retry ==="
timeout 6 termux-battery-status > /data/data/com.termux/files/home/experiments/results/ttft_f0_jelly/.batt.json 2>&1
echo rc=$?
cat /data/data/com.termux/files/home/experiments/results/ttft_f0_jelly/.batt.json
echo
