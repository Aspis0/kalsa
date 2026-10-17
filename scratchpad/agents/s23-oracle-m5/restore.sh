#!/usr/bin/env bash
# usage: restore.sh — put every key this cell touches back to its pre-run value, read-back verified.
# Every value here was read off the device before this cell's first write: the bench keys and
# toolchoice were ABSENT, kalsa.web.enabled was 1, tools were 0, kalsa.governor.enabled was 1.
# The CPU arm (kind C) turns the governor OFF, so it is restored with the rest — leaving it at 0
# would silently change the owner's phone. kalsa.bench.energy_trace / kvtranscript / nativelog were
# already 1 and are never touched.
set -u; . "$(dirname "$0")/env.sh"
bash "$(dirname "$0")/kset.sh" \
  kalsa.bench.sampling=--del kalsa.bench.probs=--del kalsa.bench.toolchoice=--del \
  kalsa.bench.governor_force=--del kalsa.bench.force_ids=--del \
  kalsa.bench.npu_lane=--del kalsa.bench.route=--del kalsa.bench.thermo=--del \
  kalsa.governor.enabled=1 \
  kalsa.web.enabled=1 kalsa.tools.device=0 kalsa.tools.calendar=0
rc=$?
echo "--- final state of every kalsa.bench.* / governor / web / tools key"
sqlite3 $TMPD/kdb/readback "SELECT key||'='||substr(value,1,30) FROM catalystLocalStorage WHERE key LIKE 'kalsa.bench.%' OR key LIKE 'kalsa.governor.%' OR key LIKE 'kalsa.web.%' OR key LIKE 'kalsa.tools.%' ORDER BY key;"
exit $rc