#!/system/bin/sh
# On-device thermal sampler for the QDC heat run.
# Usage: sh /data/local/tmp/heat/smp.sh   (stop via /data/local/tmp/heat/stop)
# One line per sample: Z <epoch> <type>=<mtenths> ... then S <epoch> <skin_c> then E <epoch>.
# Cadence target 1 s; the epoch on each line is the truth (dumpsys costs what it costs).
OUT=/data/local/tmp/kalsa-heat/heat/samples.txt
STOP=/data/local/tmp/kalsa-heat/heat/stop
: > "$OUT"
ZONES=""
for z in /sys/class/thermal/thermal_zone*; do
  t=$(cat "$z/type" 2>/dev/null) || continue
  case "$t" in
    cpu*|gpuss*) ZONES="$ZONES $z:$t" ;;
  esac
done
echo "H zones:$ZONES" >> "$OUT"
while [ ! -f "$STOP" ]; do
  line="Z $(date +%s)"
  for zt in $ZONES; do
    z=${zt%%:*}; t=${zt#*:}
    v=$(cat "$z/temp" 2>/dev/null)
    line="$line $t=$v"
  done
  echo "$line" >> "$OUT"
  # HAL section only: the whole dump also carries a stale "Cached
  # temperatures" skin value (same trap as safety.sh live_readings).
  s=$(dumpsys thermalservice 2>/dev/null | sed -n '/Current temperatures from HAL/,/Current cooling devices from HAL/p' | grep -Eo 'mValue=[0-9.]*, mType=3, mName=[sS][kK][iI][nN]' | head -1 | sed 's/mValue=//;s/,.*//')
  echo "S $(date +%s) $s" >> "$OUT"
  sleep 1
done
echo "H sampler_done $(date +%s)" >> "$OUT"
