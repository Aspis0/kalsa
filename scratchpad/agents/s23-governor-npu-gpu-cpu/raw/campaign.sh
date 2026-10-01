#!/usr/bin/env bash
# Full ABBA campaign: NPU, GPU, CPU, AUTO, then AUTO, CPU, GPU, NPU.
# arm.sh exits 9 = battery floor (abort all), 8 = thermal (stop this arm's
# remaining schedule is also unsafe -> abort all here too).
set -u
. /tmp/s23-gov/env.sh
run_arm() {
  local name=$1 route=$2 lane=$3
  echo "=== ARM $name $route $lane start $(date +%H:%M:%S) ==="
  bash /tmp/s23-gov/arm.sh $name $route $lane
  local rc=$?
  echo "=== ARM $name rc=$rc end $(date +%H:%M:%S) ==="
  if [ $rc -ne 0 ]; then echo "CAMPAIGN STOP rc=$rc"; exit $rc; fi
}
run_arm npu1 auto on
run_arm gpu1 gpu off
run_arm cpu1 cpu off
run_arm auto1 auto on
run_arm auto2 auto on
run_arm cpu2 cpu off
run_arm gpu2 gpu off
run_arm npu2 auto on
echo "CAMPAIGN COMPLETE"
