#!/usr/bin/env bash
# 10_fetch_base.sh — fetch the REAP source model on the MAC (moved off the pod;
# surgery streams the shards here on CPU). Responsibility: fetch + verify
# (index total, shard count, tokenizer, one real shard header) + .ok marker.
# Usage: mac/10_fetch_base.sh   (env: KALSA_MODELS, HF_TOKEN)
set -euo pipefail

KALSA_MODELS="${KALSA_MODELS:-$HOME/kalsa-models}"
MODEL_DIR="${MODEL_DIR:-$KALSA_MODELS/reap-src/base}"
HF_REPO="Qwen/Qwen3.6-35B-A3B"
HF_REV="995ad96eacd98c81ed38be0c5b274b04031597b0"   # read on the Mac 2026-09-29
EXPECTED_WEIGHT_BYTES=71903645408   # safetensors index total (Mac-verified)
OK="$MODEL_DIR/.weights-verified"

if [ -f "$OK" ]; then echo "10_fetch_base: already verified OK"; exit 0; fi
rm -f "$OK"
[ -n "${HF_TOKEN:-}" ] || { echo "10_fetch_base: HF_TOKEN not in env" >&2; exit 2; }

mkdir -p "$MODEL_DIR"
HF_TOKEN="$HF_TOKEN" hf download "$HF_REPO" --revision "$HF_REV" \
  --exclude "*.pth" --exclude "*.onnx*" --exclude "*.msgpack" --exclude "*.h5" \
  --local-dir "$MODEL_DIR" 2>&1 | tail -3

python3 - "$MODEL_DIR" "$EXPECTED_WEIGHT_BYTES" <<'EOF'
import json, struct, sys, pathlib
d = pathlib.Path(sys.argv[1])
want = int(sys.argv[2])
idx = json.load(open(d / "model.safetensors.index.json"))
total = idx["metadata"]["total_size"]
assert total == want, f"index total_size {total} != {want}"
shards = list(d.glob("model-*.safetensors"))
assert len(shards) == 26, f"expected 26 shards, found {len(shards)}"
assert (d / "tokenizer.json").exists(), "tokenizer.json missing"
p = sorted(d.glob("model-00001-of-*.safetensors"))[0]
with open(p, "rb") as f:
    head = f.read(262144)
n = struct.unpack("<Q", head[:8])[0]
keys = list(json.loads(head[8:8+n]))
assert keys, "shard header empty"
print(f"10_fetch_base: index/shards/tokenizer/header ok ({len(keys)} tensors in {p.name})")
EOF

touch "$OK"
echo "10_fetch_base: OK ($MODEL_DIR @ $HF_REV)"
