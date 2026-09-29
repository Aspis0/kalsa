#!/usr/bin/env bash
# 30_prune.sh — rank experts once per ratio and cut checkpoints on CPU.
# Responsibility: 4 keep-sets + 4 pruned HF dirs from ONE observation.
# Ratios are PRUNE fractions (paper Table 2 uses keep fractions: 1 - these).
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
MODEL_DIR="$ROOT/models/Qwen3.6-35B-A3B"
MOEP="$ROOT/moep"
export PYTHONPATH="$MOEP/src"

declare -A KEEP=( [25]=0.75 [50]=0.50 [65]=0.35 [75]=0.25 )

test -f "$RUN/profile.stats.pt" || { echo "30_prune: run 20_observe first" >&2; exit 1; }

for R in 25 50 65 75; do
  keep="${KEEP[$R]}"
  sel="$RUN/keep_reap_${keep}.json"
  out="$ROOT/models/kalsa-reap${R}"
  if [ ! -f "$sel" ]; then
    "$ROOT/.venv-kalsa/bin/python" -m moep.cli score \
      --run "$RUN" --stats "$RUN/profile.stats.pt" \
      --criterion reap --keep-ratio "$keep"
  fi
  if [ ! -f "$out/model.safetensors.index.json" ]; then
    "$ROOT/.venv-kalsa/bin/python" -m moep.cli prune \
      --run "$RUN" --model "$MODEL_DIR" --selection "$sel" --out "$out"
  fi
  n_exp=$("$ROOT/.venv-kalsa/bin/python" -c "
import json
c = json.load(open('$out/config.json'))
print(c.get('text_config', c)['num_experts'])")
  expect=$(( 256 - R * 256 / 100 ))
  if [ "$n_exp" != "$expect" ]; then
    echo "30_prune: reap$R config num_experts=$n_exp, expected $expect" >&2
    exit 1
  fi
  echo "30_prune: reap$R OK ($n_exp experts/layer)"
done
echo "30_prune: OK"
