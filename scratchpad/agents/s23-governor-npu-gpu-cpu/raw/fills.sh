#!/usr/bin/env bash
# Fill missing turns after the ABBA campaign. Per group: write the arm's keys,
# then run each missing turn; wait for thermal <=1 and skin < 38 C before the
# group and after any rc=8. rc=9 (battery) aborts all. Every start temp is
# recorded per turn by turn.sh as usual.
set -u
. /tmp/s23-gov/env.sh
cool() {
  for i in $(seq 1 60); do
    st=$(adb -s $S shell 'dumpsys thermalservice | grep -m1 "Thermal Status"' | tr -dc '0-9')
    skin=$(adb -s $S shell 'dumpsys thermalservice | grep -m1 "mName=SKIN"' | sed 's/.*mValue=\([0-9.]*\).*/\1/' | tr -dc '0-9.')
    ok=0; [ -n "$st" ] && [ "$st" -le 1 ] && ok=1
    [ -n "$skin" ] && awk "BEGIN{exit !($skin < 38.0)}" && [ "$ok" -eq 1 ] && return 0
    sleep 30
  done
  return 8
}
group() {
  local name=$1 route=$2 lane=$3; shift 3
  cool || { echo "COOL TIMEOUT before $name"; exit 8; }
  bash /tmp/s23-gov/sqlw.sh kalsa.bench.route $route >/dev/null || exit 3
  bash /tmp/s23-gov/sqlw.sh kalsa.bench.npu_lane $lane >/dev/null || exit 3
  echo "=== FILL $name route=$route lane=$lane keys written $(date +%H:%M:%S) ==="
  for t in "$@"; do
    p=short; case $t in l*) p=long;; esac
    bash /tmp/s23-gov/turn.sh $name-$t $p
    rc=$?
    case $rc in
      8) echo "$name-$t thermal-stop; cooling"; cool || exit 8;;
      9) echo "BATTERY FLOOR - ABORT ALL"; exit 9;;
      7) echo "$name-$t failed (load/hang)";;
    esac
  done
}
group npu2 auto on l1 l2 l3
group gpu1 gpu off l2 l3
group gpu2 gpu off s3 l1 l2 l3
group auto2 auto on l2 l3
echo "FILLS DONE"
