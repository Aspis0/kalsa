#!/system/bin/sh
# Battery/thermal snapshot. PLUGGED exploratory.
echo "=== batt 08/22/2026 17:17:46 ==="
dumpsys battery | grep -E "AC powered|USB powered|status|level|temperature|plugged"
echo "=== thermal ==="
dumpsys thermalservice 2>/dev/null | head -n 40
