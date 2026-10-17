#!/bin/bash
# Post-run: extract this cell's rows, run the learning-governor replay on them, and write the design check.
#   replay.sh <pulled.jsonl>     (pulled with: exec-out run-as com.kalsa.app cat files/governor/observations.jsonl)
# Outputs in this directory: OUTPUT-s23-open6-designed-2026-10-17.md (the replay report, same format as the Xiaomi one)
# and ANALYSIS.md (per-row design table and within-design correlations).
set -u
CELL=$(cd "$(dirname "$0")" && pwd)
REPLAY=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/learning-governor/replay
SRC=${1:?usage: replay.sh <pulled.jsonl>}
python3 -I "$CELL/extract.py" "$SRC" "$CELL/raw"; rc=$?
echo "extract rc=$rc"
[ "$rc" = 0 ] || { echo "fewer than 20 usable rows: replay not run" >&2; exit 1; }
node "$REPLAY/run.mjs" "$CELL/raw/observations.jsonl" "$CELL/OUTPUT-s23-open6-designed-2026-10-17.md"; echo "replay rc=$?"
REPLAY="$REPLAY" node "$CELL/analyze.mjs" "$CELL/raw" > "$CELL/ANALYSIS.md"; echo "analysis rc=$?"
