#!/usr/bin/env bash
# CPU-only decode vs CPU<->NPU hop every 32 tokens, alternated ABABAB, in-app,
# production defaults otherwise (npu_lane/route keys absent). Zone sampler on
# the phone for the whole session; the turn's window comes from its sendtime.
set -u
. /tmp/s23-hop/env.sh
R=$LAB/raw
adb -s $S shell 'mkdir -p /data/local/tmp/heat3way/hopapp; rm -f /data/local/tmp/heat3way/hopapp/stop /data/local/tmp/heat3way/hopapp/fatal'
adb -s $S push $R/sample.sh /data/local/tmp/heat3way/hopapp/sample.sh >/dev/null
adb -s $S shell 'cd /data/local/tmp/heat3way/hopapp && (setsid nohup sh sample.sh > sampler.log 2>&1 < /dev/null &)'
for spec in "cpu 1" "hop 1" "cpu 2" "hop 2" "cpu 3" "hop 3"; do
  set -- $spec
  if [ "$1" = hop ]; then bash $R/sqlw.sh kalsa.bench.decode_hop 32 | tail -1; else bash $R/sqld.sh kalsa.bench.decode_hop | tail -1; fi
  bash $R/turn.sh hop-$1-$2 decode > $R/hop-$1-$2.out 2>&1
  rc=$?
  echo "hop-$1-$2 EXIT=$rc $(grep -E 'dur=' $R/hop-$1-$2.out)"
  [ "$rc" -ge 8 ] && break
done
adb -s $S shell 'touch /data/local/tmp/heat3way/hopapp/stop'
bash $R/sqld.sh kalsa.bench.decode_hop | tail -1
