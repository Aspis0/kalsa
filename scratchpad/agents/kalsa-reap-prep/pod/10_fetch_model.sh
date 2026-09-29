#!/usr/bin/env bash
# 10_fetch_model.sh — HF BF16 download of the REAP source model. Idempotent.
# Responsibility: fetch + size-verify Qwen/Qwen3.6-35B-A3B (~72 GB weights).
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
MODEL_DIR="$ROOT/models/Qwen3.6-35B-A3B"
HF_REPO="Qwen/Qwen3.6-35B-A3B"
# safetensors index total_size in bytes (verified on the Mac from shard headers)
EXPECTED_WEIGHT_BYTES=71903645408

mkdir -p "$RUN" "$(dirname "$MODEL_DIR")"

if [ -z "${HF_TOKEN:-}" ]; then
  echo "10_fetch_model: HF_TOKEN not set (export it; never echoed)" >&2
  exit 2
fi

if [ ! -f "$MODEL_DIR/.weights-verified" ]; then
  "$ROOT/.venv-kalsa/bin/hf" download "$HF_REPO" \
    --exclude "*.pth" --exclude "*.onnx*" --exclude "*.msgpack" --exclude "*.h5" \
    --local-dir "$MODEL_DIR" 2>&1 | tail -3
  actual=$(python3 - "$MODEL_DIR" <<'EOF'
import json, sys, pathlib
idx = json.load(open(pathlib.Path(sys.argv[1]) / "model.safetensors.index.json"))
print(idx["metadata"]["total_size"])
EOF
)
  if [ "$actual" != "$EXPECTED_WEIGHT_BYTES" ]; then
    echo "10_fetch_model: index total_size $actual != expected $EXPECTED_WEIGHT_BYTES" >&2
    exit 1
  fi
  n_shards=$(find "$MODEL_DIR" -maxdepth 1 -name 'model-*.safetensors' | wc -l | tr -d ' ')
  if [ "$n_shards" != "26" ]; then
    echo "10_fetch_model: expected 26 shards, found $n_shards" >&2
    exit 1
  fi
  test -f "$MODEL_DIR/tokenizer.json" || { echo "tokenizer.json missing" >&2; exit 1; }
  touch "$MODEL_DIR/.weights-verified"
fi
echo "10_fetch_model: OK ($MODEL_DIR)"
