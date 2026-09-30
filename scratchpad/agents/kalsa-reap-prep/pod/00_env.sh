#!/usr/bin/env bash
# 00_env.sh — pinned toolchain on the pod. Idempotent. Needs NO HF token.
# Responsibility: one venv + one moep clone. No compiler toolchain and no
# llama.cpp here: the pod only profiles and scores; conversion, imatrix and
# quantisation run on the Mac (mac/30_convert.sh).
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
MOEP="$ROOT/moep"
PY="$ROOT/.venv-kalsa"
OK="$RUN/00_env.ok"

mkdir -p "$RUN" "$ROOT/kalsa-reap-prep/pod"
if [ -f "$OK" ]; then echo "00_env: already verified OK"; exit 0; fi

if [ ! -x "$PY/bin/python" ]; then
  python3 -m venv "$PY"
fi
PIP="$PY/bin/pip"
"$PIP" install --quiet --disable-pip-version-check \
  "torch==2.7.1" \
  "transformers==5.16.0" \
  "accelerate==1.10.0" \
  "safetensors==0.5.3" \
  "huggingface_hub[cli]==0.34.4" \
  "datasets==3.6.0"

"$PY/bin/python" - <<'EOF'
import torch, transformers, safetensors, huggingface_hub
assert torch.__version__ == "2.7.1", torch.__version__
assert transformers.__version__ == "5.16.0", transformers.__version__
assert torch.cuda.is_available(), "pod must expose CUDA (20_observe profiles on GPU)"
name = torch.cuda.get_device_name(0)
mem = torch.cuda.get_device_properties(0).total_memory / 2**30
print(f"cuda ok: {name}, {mem:.0f} GiB")
assert mem >= 75, f"expected ~80GB card, got {mem:.0f} GiB"
EOF

if [ ! -d "$MOEP/src/moep" ]; then
  git clone --quiet "https://github.com/anik-jha/moep.git" "$MOEP"
fi
git -C "$MOEP" fetch --quiet origin || true
git -C "$MOEP" checkout --quiet --force "fdc9a3fc025236bfbc48e050e23e46d0562a5956"
test -f "$MOEP/src/moep/manifest.py" \
  || { echo "moep clone incomplete (no src/moep/manifest.py)" >&2; exit 1; }

touch "$OK"
echo "00_env: OK"
