#!/system/bin/sh
# On-device 1 s thermal sampler for qdc-heat-3way. One responsibility: one
# timestamped line per second while it runs (cpu*/gpuss* zones + HAL skin).
# Copied from ../qdc-heat-per-backend/smp.sh (body lines 4-31): paths only
# were retargeted to /data/local/tmp/heat3way/heat — this cell must not edit
# that cell's files while its own session runs, so the sampler (which this
# cell pushes to its own device dir) is a copy, not a source.
OUT=/data/local/tmp/heat3way/heat/samples.txt
STOP=/data/local/tmp/heat3way/heat/stop
# Append-only (A-11): the driver pauses and resumes the sampler around each
# measured turn, and a resumed sampler must not truncate the series — d_run's
# kit_setup sweeps samples.txt once per session instead.
echo "H sampler_start $(date +%s)" >> "$OUT"
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
