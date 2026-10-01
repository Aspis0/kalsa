#!/usr/bin/env bash
set -u
. /tmp/s23-gov/env.sh
for i in $(seq 1 40); do
  st=$(adb -s $S shell 'dumpsys thermalservice | grep -m1 "Thermal Status"' | tr -dc '0-9')
  skin=$(adb -s $S shell 'dumpsys thermalservice | grep -m1 "mName=SKIN"' | sed 's/.*mValue=\([0-9.]*\).*/\1/' | tr -dc '0-9.')
  ok=0; [ -n "$st" ] && [ "$st" -le 1 ] && ok=1
  [ -n "$skin" ] && awk "BEGIN{exit !($skin < 38.0)}" && [ "$ok" -eq 1 ] && break
  sleep 30
done
bash /tmp/s23-gov/sqlw.sh kalsa.bench.route cpu >/dev/null || exit 3
bash /tmp/s23-gov/sqlw.sh kalsa.bench.npu_lane off >/dev/null || exit 3
echo "=== CPULONG keys written $(date +%H:%M:%S) ==="
bash /tmp/s23-gov/turn.sh cpu1-l1 long
echo "rc=$?"
[ -f $OUT/cpu1-l1-kalsa.txt ] && [ $(adb -s $S shell 'dumpsys battery | grep -E "^  level"' | tr -dc '0-9') -ge 23 ] && bash /tmp/s23-gov/turn.sh cpu2-l1 long
echo "rc=$?"
echo CPULONG DONE
