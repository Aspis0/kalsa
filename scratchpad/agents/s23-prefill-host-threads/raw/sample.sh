#!/system/bin/sh
D=/data/local/tmp/heat3way/prefillthreads
OUT=$D/samples.tsv
STOP=$D/stop
FATAL=$D/fatal
PID=$D/run.pid
ZONES=""
for z in /sys/class/thermal/thermal_zone*; do
  typ=
  IFS= read -r typ < "$z/type" 2>/dev/null || continue
  case "$typ" in cpu-*|cpuss-*|gpuss-*|nspss-*) ZONES="$ZONES $z:$typ" ;; esac
done
printf 'epoch_ns\tstatus\tskin_C\thal_bat_C\tbattery_zone_mC\tlevel\ttraced' > "$OUT"
for zt in $ZONES; do printf '\t%s' "${zt#*:}" >> "$OUT"; done
printf '\n' >> "$OUT"
while [ ! -f "$STOP" ]; do
  start=$(date +%s%N)
  values=$(dumpsys thermalservice 2>/dev/null | awk '
    /^Thermal Status:/ { status=$3 }
    /Current temperatures from HAL:/ { active=1; next }
    /Current cooling devices from HAL:/ { active=0 }
    active && /mName=SKIN/ { x=$0; sub(/^.*mValue=/,"",x); sub(/,.*/,"",x); skin=x }
    active && /mName=BAT,/ { x=$0; sub(/^.*mValue=/,"",x); sub(/,.*/,"",x); bat=x }
    END { printf "%d %.1f %.1f %d\n", status, skin, bat, bat * 10 + 0.5 }
  ')
  set -- $values
  status=$1; skin=$2; halbat=$3; bat_dC=$4
  level=$(cmd battery get level 2>/dev/null)
  traced=$(getprop persist.traced.enable)
  battery_zone=
  IFS= read -r battery_zone < /sys/class/thermal/thermal_zone94/temp 2>/dev/null
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s' "$start" "${status:-NA}" "${skin:-NA}" "${halbat:-NA}" "${battery_zone:-NA}" "${level:-NA}" "${traced:-NA}" >> "$OUT"
  for zt in $ZONES; do
    z=${zt%%:*}
    value=
    IFS= read -r value < "$z/temp" 2>/dev/null
    printf '\t%s' "${value:-NA}" >> "$OUT"
  done
  printf '\n' >> "$OUT"
  reason=
  [ -n "$level" ] && [ "$level" -le 30 ] && reason=battery30
  [ -n "$bat_dC" ] && [ "$bat_dC" -ge 430 ] && reason=battery43C
  [ -n "$status" ] && [ "$status" -ge 3 ] && reason=thermal3
  [ "$traced" = 0 ] || reason=traced
  if [ -n "$reason" ]; then
    echo "STOP $reason $start battery_dC=$bat_dC level=$level status=$status" >> "$FATAL"
    [ -s "$PID" ] && kill -TERM "$(cat "$PID")" 2>/dev/null
    touch "$STOP"
    break
  fi
  finish=$(date +%s%N)
  remaining=$((1000000000 - (finish - start)))
  if [ "$remaining" -gt 0 ]; then
    tenths=$(( (remaining + 99999999) / 100000000 ))
    sleep "$((tenths / 10)).$((tenths % 10))"
  fi
done
