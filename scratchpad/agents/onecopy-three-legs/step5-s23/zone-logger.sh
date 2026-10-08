# 1 Hz thermal + mitigation log (S23) for the NPU hard-reset question: max NSP / GPU / CPU zone temp (mC), the
# cdsp / cdsp_hw / gpu cooling states, and sync after every line so a hard reset keeps the last seconds.
#   sh zone-logger.sh OUT.csv STOPFILE &
OUT=$1; STOP=$2; rm -f "$STOP"
mx() { m=0; for z in $1; do v=$(cat $z/temp); [ "$v" -gt "$m" ] && m=$v; done; echo $m; }
NSP=""; GPU=""; CPU=""
for z in /sys/class/thermal/thermal_zone*; do
  case "$(cat $z/type)" in nsp*) NSP="$NSP $z";; gpuss*) GPU="$GPU $z";; cpu-*) CPU="$CPU $z";; esac
done
C=/sys/class/thermal
echo "epoch,nsp_max,gpu_max,cpu_max,cdsp,cdsp_hw,gpu_cool" >> "$OUT"
while [ ! -e "$STOP" ]; do
  echo "$(date +%s),$(mx "$NSP"),$(mx "$GPU"),$(mx "$CPU"),$(cat $C/cooling_device38/cur_state),$(cat $C/cooling_device37/cur_state),$(cat $C/cooling_device36/cur_state)" >> "$OUT"
  sync; sleep 1
done
