#!/usr/bin/env bash
# 30_score.sh — rank experts ONCE for the single chosen ratio (owner decision
# 2026-09-30: 50% prune, only if the $0 Mac probe says it is worth it).
# Responsibility: one keep-set from ONE observation, verified structurally
# (uniform, sorted, unique, expected count). Surgery itself runs on the Mac
# (mac/20_surgery.sh) from this keep-set + the base model.
# PRUNE_RATIO is a PRUNE fraction (keep = 1 - ratio/100).
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
MOEP="$ROOT/moep"
RATIO="${PRUNE_RATIO:-50}"
export PYTHONPATH="$MOEP/src"

test -f "$RUN/profile.stats.pt" || { echo "30: run 20_observe first" >&2; exit 1; }

# moep names the file with the float's own repr (str(0.5) -> "0.5"), so the
# keep fraction must be %g-formatted or the sel path below will never match
keep=$(awk -v r="$RATIO" 'BEGIN {printf "%g", 1 - r/100}')
sel="$RUN/keep_reap_${keep}.json"
ok="$RUN/30_score.ok"
if [ -f "$ok" ]; then echo "30_score: already verified OK"; exit 0; fi
rm -f "$sel"

"$ROOT/.venv-kalsa/bin/python" -m moep.cli score \
  --run "$RUN" --stats "$RUN/profile.stats.pt" \
  --criterion reap --keep-ratio "$keep"
test -f "$sel" || { echo "30: score did not write $sel" >&2; exit 1; }

"$ROOT/.venv-kalsa/bin/python" - "$sel" "$keep" <<'EOF'
import json, sys
sel, keep = sys.argv[1], float(sys.argv[2])
d = json.load(open(sys.argv[1]))
keepsets = d["keep"]
assert keepsets, "empty selection"
counts = {len(v) for v in keepsets.values()}
assert len(counts) == 1, f"non-uniform keep counts: {sorted(counts)}"
n = next(iter(counts))
expect = round(256 * keep)
assert n == expect, f"kept {n} experts/layer, expected {expect}"
for layer, ids in keepsets.items():
    assert ids == sorted(set(ids)), f"layer {layer}: ids not sorted/unique"
    assert all(0 <= i < 256 for i in ids), f"layer {layer}: id out of range"
print(f"30: selection ok — {len(keepsets)} layers x {n} experts (keep {keep})")
EOF

touch "$ok"
echo "30_score: OK ($sel)"
