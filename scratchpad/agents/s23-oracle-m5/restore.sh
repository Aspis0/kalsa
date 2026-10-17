#!/usr/bin/env bash
# usage: restore.sh — put every key this cell touches back to its pre-run value, read-back verified.
# Pre-run values were read from the device before any write (sha256 1745a49b…, 64 rows):
# the bench keys and toolchoice were all ABSENT, kalsa.web.enabled was 1, tools were 0.
# kalsa.bench.energy_trace / kvtranscript / nativelog were already 1 and are never touched.
set -u; . "$(dirname "$0")/env.sh"
bash "$(dirname "$0")/kset.sh" \
  kalsa.bench.sampling=--del kalsa.bench.probs=--del kalsa.bench.toolchoice=--del \
  kalsa.bench.governor_force=--del kalsa.bench.force_ids=--del \
  kalsa.bench.npu_lane=--del kalsa.bench.route=--del kalsa.bench.thermo=--del \
  kalsa.web.enabled=1 kalsa.tools.device=0 kalsa.tools.calendar=0
rc=$?
echo "--- final state of every kalsa.bench.* / web / tools key"
sqlite3 $TMPD/kdb/readback "SELECT key||'='||substr(value,1,30) FROM catalystLocalStorage WHERE key LIKE 'kalsa.bench.%' OR key LIKE 'kalsa.web.%' OR key LIKE 'kalsa.tools.%' ORDER BY key;"
exit $rc