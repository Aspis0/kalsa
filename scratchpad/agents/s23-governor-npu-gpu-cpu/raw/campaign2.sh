#!/usr/bin/env bash
# Remaining arms after npu1 completed and gpu1 was watchdog-refused at
# preflight (Thermal Status 3, SKIN 42.2 C at 15:38). Waits for status <= 1
# before each arm; aborts all on rc 8/9.
set -u
. /tmp/s23-gov/env.sh
wait_thermal() {
  for i in $(seq 1 30); do
    st=$(adb -s $S shell 'dumpsys thermalservice | grep -m1 "Thermal Status"' | tr -dc '0-9')
    [ -n "$st" ] && [ "$st" -le 1 ] && return 0
    sleep 30
  done
  return 8
}
run_arm() {
  local name=$1 route=$2 lane=$3
  wait_thermal || { echo "THERMAL WAIT TIMEOUT before $name"; exit 8; }
  echo "=== ARM $name $route $lane start $(date +%H:%M:%S) ==="
  bash /tmp/s23-gov/arm.sh $name $route $lane
  local rc=$?
  echo "=== ARM $name rc=$rc end $(date +%H:%M:%S) ==="
  if [ $rc -ne 0 ]; then echo "CAMPAIGN STOP rc=$rc"; exit $rc; fi
}
run_arm gpu1 gpu off
run_arm cpu1 cpu off
run_arm auto1 auto on
run_arm auto2 auto on
run_arm cpu2 cpu off
run_arm gpu2 gpu off
run_arm npu2 auto on
echo "CAMPAIGN COMPLETE"
