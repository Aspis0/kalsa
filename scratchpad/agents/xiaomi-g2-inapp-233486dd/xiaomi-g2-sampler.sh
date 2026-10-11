# Xiaomi in-app G2 side sampler (2026-10-11): every 5 s, MemAvailable, the app's RssAnon, the hottest HAL skin sensor,
# battery temperature and level, Android thermal status. Read-only; stops when /data/local/tmp/kalsa-g2/stop exists.
D=/data/local/tmp/kalsa-g2; OUT=$D/g2-side.csv; mkdir -p $D; rm -f $D/stop
echo "epoch_s,mem_avail_kb,app_pid,app_rss_anon_kb,skin_c,batt_dc,level,status" > $OUT
while [ ! -e $D/stop ]; do
  ma=$(grep MemAvailable /proc/meminfo | grep -oE '[0-9]+'); p=$(pidof com.kalsa.app | awk '{print $1}')
  ra=""; [ -n "$p" ] && ra=$(grep RssAnon /proc/$p/status 2>/dev/null | grep -oE '[0-9]+')
  sk=$(dumpsys thermalservice | sed -n '/^Current temperatures from HAL/,/^Current cooling devices/p' | grep 'mName=skin' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p' | sort -n | tail -1)
  bt=$(dumpsys battery | grep -m1 '  temperature:' | grep -oE '[0-9]+'); lv=$(dumpsys battery | grep -m1 '  level:' | grep -oE '[0-9]+')
  st=$(dumpsys thermalservice | grep -m1 '^Thermal Status' | grep -oE '[0-9]+')
  echo "$(date +%s),$ma,$p,$ra,$sk,$bt,$lv,$st" >> $OUT
  sleep 5
done
