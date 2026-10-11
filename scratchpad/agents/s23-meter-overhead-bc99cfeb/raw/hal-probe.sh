# Health HAL CPU probe (S23, 2026-10-11, rerun after the audit): shell uid, every 2 s, the SUM of
# /proc/<hal>/task/*/schedstat run-ns over all the HAL's threads, the process-wide utime+stime ticks,
# and whether the app's GovernorBatterySampler thread is alive. Stops on /data/local/tmp/kalsa-g2/hal.stop.
D=/data/local/tmp/kalsa-g2; OUT=$D/hal-all.txt; rm -f $D/hal.stop
H=$(pidof vendor.samsung.hardware.health-service)
while [ ! -e $D/hal.stop ]; do
  # awk sums in floating point: the shell's 32-bit arithmetic overflows on ns totals.
  set -- $(cat /proc/$H/task/*/schedstat | awk '{s+=$1; n++} END{printf "%d %.0f", n, s}'); n=$1; sum=$2
  s=$(cat /proc/$H/stat); set -- ${s#*) }
  alive=0; p=$(pidof com.kalsa.app)
  if [ -n "$p" ]; then for t in /proc/$p/task/*; do case "$(cat $t/comm 2>/dev/null)" in GovernorBatter*) alive=1;; esac; done; fi
  echo "$(date +%s) $H $n $sum $(( ${12} + ${13} )) $alive" >> $OUT
  sleep 2
done
