#!/usr/bin/env bash
# 20_observe.sh — one profiling pass over the Kalsa calibration set.
# Responsibility: run moep profile once, verify coverage/finiteness, .ok only
# after the asserts pass; delete partial stats on failure.
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
MODEL_DIR="$ROOT/models/Qwen3.6-35B-A3B"
CALIB="$ROOT/calib/kalsa-reap-calib.jsonl"
MOEP="$ROOT/moep"
OK="$RUN/20_observe.ok"

if [ -f "$OK" ]; then echo "20_observe: already verified OK"; exit 0; fi
rm -f "$RUN/profile.stats.pt" "$RUN/profile.stats.pt.summary.json" "$RUN/20_observe.ok"

test -f "$CALIB" || { echo "20: calibration file missing at $CALIB" >&2; exit 1; }

# On a 80GB card the 72GB checkpoint fits resident; batch kept small because
# the profiler recomputes all-expert activations per MoE block. If this ever
# OOMs, set POD_PROFILE_MAX_GPU_GIB=68 to disk-offload the remainder instead.
cd "$ROOT"
export PYTHONPATH="$MOEP/src"
if [ -n "${POD_PROFILE_MAX_GPU_GIB:-}" ]; then
  "$ROOT/.venv-kalsa/bin/python" -m moep.cli profile \
    --run "$RUN" --model "$MODEL_DIR" --calib "$CALIB" \
    --seq-len 4096 --batch-size 2 \
    --max-gpu-gib "$POD_PROFILE_MAX_GPU_GIB" --offload-dir "$RUN/offload"
else
  "$ROOT/.venv-kalsa/bin/python" -m moep.cli profile \
    --run "$RUN" --model "$MODEL_DIR" --calib "$CALIB" \
    --seq-len 4096 --batch-size 2
fi

test -f "$RUN/profile.stats.pt" || { echo "20: profile produced no stats" >&2; exit 1; }
"$ROOT/.venv-kalsa/bin/python" - "$RUN/profile.stats.pt.summary.json" <<'EOF'
import json, sys
s = json.load(open(sys.argv[1]))
assert s["min_layer_expert_coverage"] == 1.0, f"coverage {s['min_layer_expert_coverage']}"
assert all(s["stats_finite"].values()), s["stats_finite"]
assert "reap" in s["usable_criteria"], s["usable_criteria"]
print("20: coverage 100%, stats finite, reap usable")
EOF

touch "$OK"
echo "20_observe: OK"
