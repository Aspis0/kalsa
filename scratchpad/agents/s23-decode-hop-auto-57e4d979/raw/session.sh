#!/usr/bin/env bash
# CPU-only decode vs the thermal-headroom hop (kalsa.bench.decode_hop=32: with the S23's
# readable zones every window goes to the leg with more headroom), alternated ABABAB, in-app,
# production defaults otherwise. Zone sampler on the phone for the whole session; the turn's
# window comes from its sendtime.
set -u
. /tmp/s23-auto/env.sh
R=$LAB/raw
adb -s $S shell 'mkdir -p /data/local/tmp/heat3way/autoapp; rm -f /data/local/tmp/heat3way/autoapp/stop /data/local/tmp/heat3way/autoapp/fatal'
adb -s $S push $R/sample.sh /data/local/tmp/heat3way/autoapp/sample.sh >/dev/null
adb -s $S shell 'cd /data/local/tmp/heat3way/autoapp && (setsid nohup sh sample.sh > sampler.log 2>&1 < /dev/null &)'
for spec in "cpu 1" "hop 1" "cpu 2" "hop 2" "cpu 3" "hop 3"; do
  set -- $spec
  if [ "$1" = hop ]; then bash $R/sqlw.sh kalsa.bench.decode_hop 32 | tail -1; else bash $R/sqld.sh kalsa.bench.decode_hop | tail -1; fi
  bash $R/turn.sh hop-$1-$2 decode > $R/hop-$1-$2.out 2>&1
  rc=$?
  echo "hop-$1-$2 EXIT=$rc $(grep -E 'dur=' $R/hop-$1-$2.out)"
  [ "$rc" -ge 8 ] && break
done
adb -s $S shell 'touch /data/local/tmp/heat3way/autoapp/stop'
bash $R/sqld.sh kalsa.bench.decode_hop | tail -1
