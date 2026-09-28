#!/system/bin/sh
D=/data/local/tmp/heat3way/s23-engine
OUT=$D/out
STOP=$OUT/smp.stop
FATAL=$OUT/fatal
PIDFILE=$OUT/run.pid
SAMPLES=$OUT/samples.tsv

echo "epoch battery_temp_dC thermal_status skin_C battery_pct wakefulness" > "$SAMPLES"
while [ ! -f "$STOP" ]; do
  now=$(date +%s)
  b=$(dumpsys battery 2>/dev/null)
  th=$(dumpsys thermalservice 2>/dev/null)
  temp=$(printf '%s\n' "$b" | sed -n 's/^[[:space:]]*temperature:[[:space:]]*//p' | head -1)
  level=$(printf '%s\n' "$b" | sed -n 's/^[[:space:]]*level:[[:space:]]*//p' | head -1)
  status=$(printf '%s\n' "$th" | sed -n 's/^Thermal Status:[[:space:]]*//p' | head -1)
  skin=$(printf '%s\n' "$th" | sed -n '/Current temperatures from HAL/,/Current cooling devices from HAL/p' | sed -n 's/.*mValue=\([0-9.]*\), mType=3, mName=SKIN.*/\1/p' | head -1)
  wake=$(dumpsys power 2>/dev/null | sed -n 's/^[[:space:]]*mWakefulness=//p' | head -1)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$now" "${temp:-NA}" "${status:-NA}" "${skin:-NA}" "${level:-NA}" "${wake:-NA}" >> "$SAMPLES"
  reason=""
  [ -n "$level" ] && [ "$level" -le 30 ] && reason=battery30
  [ -n "$temp" ] && [ "$temp" -ge 430 ] && reason=battery43C
  [ -n "$status" ] && [ "$status" -ge 3 ] && reason=thermal3
  [ "$(getprop persist.traced.enable)" = 0 ] || reason=traced
  echo "$b" | grep -Eq 'AC powered: true|USB powered: true|Wireless powered: true' && reason=plugged
  [ "$wake" = Awake ] || reason=screen_not_awake
  if [ -n "$reason" ]; then
    echo "STOP $reason $now battery_dC=${temp:-NA} status=${status:-NA} level=${level:-NA} wake=${wake:-NA}" >> "$FATAL"
    if [ -f "$PIDFILE" ]; then kill -TERM "$(cat "$PIDFILE")" 2>/dev/null; fi
    touch "$STOP"
    break
  fi
  sleep 1
done
