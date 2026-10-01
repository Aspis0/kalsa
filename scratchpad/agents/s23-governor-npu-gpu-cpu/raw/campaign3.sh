#!/usr/bin/env bash
# Remaining arms after npu1 (6/6) and gpu1 (4/6, watchdog). rc=8 (thermal
# stop) now COOLS AND CONTINUES to the next arm - partial arms are recorded.
# rc=9 (battery floor) still aborts everything.
set -u
. /tmp/s23-gov/env.sh
wait_thermal() {
  for i in $(seq 1 40); do
    st=$(adb -s $S shell 'dumpsys thermalservice | grep -m1 "Thermal Status"' | tr -dc '0-9')
    [ -n "$st" ] && [ "$st" -le 1 ] && return 0
    sleep 30
  done
  return 8
}
run_arm() {
  local name=$1 route=$2 lane=$3
  wait_thermal || { echo "THERMAL WAIT TIMEOUT before $name $(date +%H:%M:%S)"; exit 8; }
  echo "=== ARM $name $route $lane start $(date +%H:%M:%S) ==="
  bash /tmp/s23-gov/arm.sh $name $route $lane
  local rc=$?
  echo "=== ARM $name rc=$rc end $(date +%H:%M:%S) ==="
  if [ $rc -eq 9 ]; then echo "CAMPAIGN STOP battery"; exit 9; fi
}
run_arm cpu1 cpu off
run_arm auto1 auto on
run_arm auto2 auto on
run_arm cpu2 cpu off
run_arm gpu2 gpu off
run_arm npu2 auto on
echo "CAMPAIGN COMPLETE"
