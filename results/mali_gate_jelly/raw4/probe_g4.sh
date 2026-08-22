#!/system/bin/sh
echo === batt ===
dumpsys battery | grep -E "AC powered|USB powered|status|level|temperature"
echo === thermal ===
dumpsys thermalservice 2>/dev/null | grep -E "mValue|Thermal Status|mName=GPU|mName=CPU" | head -n 20
echo === gpu freq ===
find /sys/class/devfreq -name cur_freq -o -name min_freq -o -name max_freq 2>/dev/null
echo === cur_freq all ===
for f in /sys/class/devfreq/*/cur_freq; do
  if [ -r "$f" ]; then
    echo "$f=$(cat $f)"
  fi
done
echo === mali nodes ===
ls -d /sys/class/devfreq/*mali* /sys/class/devfreq/*gpu* 2>/dev/null
echo === done ===
