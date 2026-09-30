#!/usr/bin/env bash
# 30_prune.sh — rank experts once per ratio and cut checkpoints on CPU.
# Responsibility: 4 keep-sets + 4 pruned HF dirs from ONE observation; each
# ratio gets a .ok only after config num_experts AND moep's byte-verification
# both pass; failed dirs are deleted so no partial state survives.
# Ratios are PRUNE fractions (paper Table 2 uses keep fractions: 1 - these).
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
MODEL_DIR="$ROOT/models/Qwen3.6-35B-A3B"
MOEP="$ROOT/moep"
export PYTHONPATH="$MOEP/src"

declare -A KEEP=( [25]=0.75 [50]=0.50 [65]=0.35 [75]=0.25 )

test -f "$RUN/profile.stats.pt" || { echo "30: run 20_observe first" >&2; exit 1; }

for R in 25 50 65 75; do
  keep="${KEEP[$R]}"
  sel="$RUN/keep_reap_${keep}.json"
  out="$ROOT/models/kalsa-reap${R}"
  ok="$RUN/30_prune_reap${R}.ok"
  if [ -f "$ok" ]; then echo "30_prune: reap$R already verified OK"; continue; fi
  rm -rf "$out"   # partial surgery output is not resumable state

  if [ ! -f "$sel" ]; then
    "$ROOT/.venv-kalsa/bin/python" -m moep.cli score \
      --run "$RUN" --stats "$RUN/profile.stats.pt" \
      --criterion reap --keep-ratio "$keep"
  fi
  test -f "$sel" || { echo "30: score did not write $sel" >&2; exit 1; }

  "$ROOT/.venv-kalsa/bin/python" -m moep.cli prune \
    --run "$RUN" --model "$MODEL_DIR" --selection "$sel" --out "$out"

  # verify 1: pruned config num_experts
  n_exp=$("$ROOT/.venv-kalsa/bin/python" -c "
import json
c = json.load(open('$out/config.json'))
print(c.get('text_config', c)['num_experts'])")
  expect=$(( 256 - R * 256 / 100 ))
  [ "$n_exp" = "$expect" ] \
    || { echo "30: reap$R config num_experts=$n_exp, expected $expect" >&2; rm -rf "$out"; exit 1; }

  # verify 2: moep's own manifest — status ok + byte-row checks recorded +
  # the pruned index it points at actually exists
  "$ROOT/.venv-kalsa/bin/python" - "$RUN" "$out" <<'EOF'
import json, pathlib, sys
run, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
m = json.loads((run / f"prune_{out.name}.json").read_text())
assert m["status"] == "ok", m["status"]
assert m["evidence"]["row_checks"] > 0, m["evidence"]
assert pathlib.Path(m["outputs"]["model"]).exists(), m["outputs"]
print(f"30: surgery manifest ok, row_checks={m['evidence']['row_checks']}")
EOF

  touch "$ok"
  echo "30_prune: reap$R OK ($n_exp experts/layer)"
done
echo "30_prune: OK"
