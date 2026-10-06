# Per-leg thermal headroom feeder for governor-bench --headroom-file (S23, sysfs). Same rule as the binding's
# rn_thermal_legs (cpp/rn-thermal-legs.h): zone type prefix "cpu" -> CPU leg, "nsp" -> NPU leg, plus "gpu" -> GPU leg
# (step 5.3); per zone the LOWEST passive trip minus temp; per leg the min over its zones; C. Writes "cpu npu gpu"
# atomically (tmp + mv) every second until the stop file exists.
#   sh headroom-feeder.sh /data/local/tmp/govhtp/headroom.txt /data/local/tmp/govhtp/headroom.stop &
OUT=$1; STOP=$2
rm -f "$STOP"
# The zone list and each zone's lowest passive trip are read once; the loop reads temps only.
ZONES=$OUT.zones
: > "$ZONES"
for z in /sys/class/thermal/thermal_zone*; do
  case "$(cat $z/type 2>/dev/null)" in cpu*) leg=cpu;; nsp*) leg=npu;; gpu*) leg=gpu;; *) continue;; esac
  trip=""
  for tp in $z/trip_point_*_type; do
    [ "$(cat $tp 2>/dev/null)" = passive ] || continue
    v=$(cat ${tp%_type}_temp 2>/dev/null)
    [ -n "$v" ] && [ "$v" -gt 0 ] && { [ -z "$trip" ] || [ "$v" -lt "$trip" ]; } && trip=$v
  done
  [ -n "$trip" ] && echo "$leg $trip $z/temp" >> "$ZONES"
done
while [ ! -e "$STOP" ]; do
  while read leg trip path; do echo "$leg $((trip - $(cat $path)))"; done < "$ZONES" |
    awk '{ if (!($1 in m) || $2 < m[$1]) m[$1] = $2 }
         END { for (i = 1; i <= 3; i++) { k = (i == 1 ? "cpu" : i == 2 ? "npu" : "gpu");
               printf "%s%s", (k in m ? sprintf("%.1f", m[k] / 1000) : "nan"), (i < 3 ? " " : "\n") } }' > "$OUT.tmp" &&
    mv "$OUT.tmp" "$OUT"
  sleep 1
done
