#!/usr/bin/env bash
# 10_fetch_model.sh — HF BF16 download of the REAP source model at the pinned
# revision. Responsibility: fetch + size/shard/tokenizer verify + .ok marker.
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
MODEL_DIR="$ROOT/models/Qwen3.6-35B-A3B"
HF_REPO="Qwen/Qwen3.6-35B-A3B"
HF_REV="995ad96eacd98c81ed38be0c5b274b04031597b0"   # read on the Mac 2026-09-29
# safetensors index total_size in bytes (verified on the Mac from shard headers)
EXPECTED_WEIGHT_BYTES=71903645408
OK="$RUN/10_fetch_model.ok"

if [ -f "$OK" ]; then echo "10_fetch_model: already verified OK"; exit 0; fi
# a partial download is not resumable state: drop markers and shards
rm -f "$MODEL_DIR/.weights-verified"

[ -n "${HF_TOKEN:-}" ] || { echo "10: HF_TOKEN not provided to this stage" >&2; exit 2; }
mkdir -p "$RUN" "$(dirname "$MODEL_DIR")"

"$ROOT/.venv-kalsa/bin/hf" download "$HF_REPO" \
  --revision "$HF_REV" \
  --exclude "*.pth" --exclude "*.onnx*" --exclude "*.msgpack" --exclude "*.h5" \
  --local-dir "$MODEL_DIR" 2>&1 | tail -3

# verification: index total, shard count, tokenizer, and one real shard header
actual=$("$ROOT/.venv-kalsa/bin/python" - "$MODEL_DIR" <<'EOF'
import json, sys, pathlib
idx = json.load(open(pathlib.Path(sys.argv[1]) / "model.safetensors.index.json"))
print(idx["metadata"]["total_size"])
EOF
)
[ "$actual" = "$EXPECTED_WEIGHT_BYTES" ] \
  || { echo "10: index total_size $actual != expected $EXPECTED_WEIGHT_BYTES" >&2; exit 1; }
n_shards=$(find "$MODEL_DIR" -maxdepth 1 -name 'model-*.safetensors' | wc -l | tr -d ' ')
[ "$n_shards" = "26" ] || { echo "10: expected 26 shards, found $n_shards" >&2; exit 1; }
test -f "$MODEL_DIR/tokenizer.json" || { echo "10: tokenizer.json missing" >&2; exit 1; }
"$ROOT/.venv-kalsa/bin/python" - "$MODEL_DIR" <<'EOF'
import json, struct, sys, pathlib
p = next(sorted(pathlib.Path(sys.argv[1]).glob("model-00001-of-*.safetensors")))
with open(p, "rb") as f:
    head = f.read(262144)
n = struct.unpack("<Q", head[:8])[0]
keys = list(json.loads(head[8:8+n]))
assert keys, "shard header empty"
print(f"10: shard header ok ({len(keys)} tensors in {p.name})")
EOF

touch "$OK"
echo "10_fetch_model: OK ($MODEL_DIR @ $HF_REV)"
