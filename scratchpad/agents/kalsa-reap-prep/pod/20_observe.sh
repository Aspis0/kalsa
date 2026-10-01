#!/usr/bin/env bash
# 20_observe.sh — profiling over the calib-v2 seven-domain calibration set
# (it fr es en zh code math, ~450k tokens each; CALIB-V2-MANIFEST.sha256).
# ONE moep profile call = ONE model load + seven dataset passes: per-domain
# profile_<domain>.stats.pt plus a merged profile.stats.pt (additive stats
# summed, norm_max = Super-Expert accumulator kept as the element-wise max).
# Requires the moep patch patches/moep-domain-normmax.patch applied on top of
# 00_env.sh's pinned checkout (adds --domain/--device and the norm_max stat).
# Responsibility: run moep profile, verify coverage/finiteness per domain and
# for the merged file, .ok only after the asserts pass; delete partial stats
# on failure.
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
MODEL_DIR="$ROOT/models/Qwen3.6-35B-A3B"
CALIB_DIR="$ROOT/calib-v2"
MOEP="$ROOT/moep"
OK="$RUN/20_observe.ok"
DOMAINS="${CALIB_V2_DOMAINS:-it fr es en zh code math}"

if [ -f "$OK" ]; then echo "20_observe: already verified OK"; exit 0; fi
for d in $DOMAINS; do
  test -f "$CALIB_DIR/$d.jsonl" || { echo "20: missing $CALIB_DIR/$d.jsonl" >&2; exit 1; }
done
rm -f "$RUN"/profile*.stats.pt "$RUN"/profile*.stats.pt.summary.json \
      "$RUN"/profile.json "$RUN"/profile_*.json "$OK"

# On a 80GB card the 72GB checkpoint fits resident; batch kept small because
# the profiler recomputes all-expert activations per MoE block. If this ever
# OOMs, set POD_PROFILE_MAX_GPU_GIB=68 to disk-offload the remainder instead.
cd "$ROOT"
export PYTHONPATH="$MOEP/src"
CALIB_ARGS=()
for d in $DOMAINS; do CALIB_ARGS+=(--calib "$CALIB_DIR/$d.jsonl" --domain "$d"); done
if [ -n "${POD_PROFILE_MAX_GPU_GIB:-}" ]; then
  "$ROOT/.venv-kalsa/bin/python" -m moep.cli profile \
    --run "$RUN" --model "$MODEL_DIR" "${CALIB_ARGS[@]}" \
    --seq-len 4096 --batch-size 2 \
    --max-gpu-gib "$POD_PROFILE_MAX_GPU_GIB" --offload-dir "$RUN/offload"
else
  "$ROOT/.venv-kalsa/bin/python" -m moep.cli profile \
    --run "$RUN" --model "$MODEL_DIR" "${CALIB_ARGS[@]}" \
    --seq-len 4096 --batch-size 2
fi

test -f "$RUN/profile.stats.pt" || { echo "20: profile produced no merged stats" >&2; exit 1; }
"$ROOT/.venv-kalsa/bin/python" - "$RUN" "$DOMAINS" <<'EOF'
import json, pathlib, sys
run = pathlib.Path(sys.argv[1])
for d in sys.argv[2].split() + [None]:
    name = "profile" if d is None else f"profile_{d}"
    s = json.loads((run / f"{name}.stats.pt.summary.json").read_text())
    assert s["min_layer_expert_coverage"] == 1.0, f"{name}: coverage {s['min_layer_expert_coverage']}"
    assert all(s["stats_finite"].values()), f"{name}: {s['stats_finite']}"
    assert "reap" in s["usable_criteria"], f"{name}: {s['usable_criteria']}"
    assert s["max_norm_max"] > 0, f"{name}: norm_max accumulator is 0"
    print(f"20: {name}: coverage 100%, stats finite, reap usable, norm_max>0 ({s['max_norm_max']:.1f})")
EOF

touch "$OK"
echo "20_observe: OK ($DOMAINS)"
