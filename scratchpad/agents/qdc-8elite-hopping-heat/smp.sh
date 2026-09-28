#!/system/bin/sh
# On-device 1 s thermal sampler + skin watchdog for qdc-8elite-hopping-heat.
# Adapted from ../qdc-8elite-heat-arms/smp.sh: + zone inventory, + thermal status; and the watchdog
# kills the running llama binary at skin >= 45.0 C (PREREG "Stop rules").
D=/data/local/tmp/h8h
OUT=$D/out/samples.txt
STOP=$D/out/smp.stop
echo "H sampler_start $(date +%s)" >> "$OUT"
MAX_EPOCH=$(( $(date +%s) + 7200 ))
ZONES=""
for z in /sys/class/thermal/thermal_zone*; do
  t=$(cat "$z/type" 2>/dev/null) || continue
  case "$t" in
    cpu*|cpuss*|gpuss*|nsp*) ZONES="$ZONES $z:$t" ;;
  esac
done
echo "H zones:$ZONES" >> "$OUT"
# Full inventory once: index, type, readable temp or UNREADABLE.
for z in /sys/class/thermal/thermal_zone*; do
  echo "I $z $(cat "$z/type" 2>/dev/null || echo NOTYPE) $(cat "$z/temp" 2>/dev/null || echo UNREADABLE)" >> "$OUT"
done
while [ ! -f "$STOP" ] && [ "$(date +%s)" -lt "$MAX_EPOCH" ]; do
  line="Z $(date +%s)"
  for zt in $ZONES; do
    z=${zt%%:*}; t=${zt#*:}
    line="$line $t=$(cat "$z/temp" 2>/dev/null)"
  done
  echo "$line" >> "$OUT"
  # HAL section only: the dump also carries a stale "Cached temperatures" skin.
  dump=$(dumpsys thermalservice 2>/dev/null)
  s=$(echo "$dump" | sed -n '/Current temperatures from HAL/,/Current cooling devices from HAL/p' | grep -Eo 'mValue=[0-9.]*, mType=3, mName=[sS][kK][iI][nN]' | head -1 | sed 's/mValue=//;s/,.*//')
  st=$(echo "$dump" | grep -m1 'Thermal Status:' | sed 's/.*Thermal Status: *//')
  echo "S $(date +%s) $s $st" >> "$OUT"
  case "$s" in
    [0-9]*)
      if [ "${s%%.*}" -ge 45 ]; then
        echo "K $(date +%s) $s" >> "$OUT"
        pkill -9 -f "bin/llama-" 2>/dev/null
      fi ;;
  esac
  sleep 1
done
echo "H sampler_done $(date +%s)" >> "$OUT"
