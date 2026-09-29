#!/usr/bin/env bash
# 00_env.sh — pinned toolchain on the pod. Idempotent: skips done work.
# Responsibility: one venv + two git clones + one small llama.cpp CPU build.
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
LAB="$ROOT/kalsa-reap-prep"
RUN="$ROOT/runs"
MOEP="$ROOT/moep"
REAP="$ROOT/reap-hqta1110"          # reference only: REAP metric cross-reading
LLAMA="$ROOT/kalsallama"
PY="$ROOT/.venv-kalsa"

mkdir -p "$RUN" "$LAB/pod"

# --- python venv, pinned -------------------------------------------------
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

if [ ! -f "$PY/.pins-verified" ]; then
  "$PY/bin/python" - <<'EOF'
import torch, transformers, safetensors, huggingface_hub
assert torch.__version__ == "2.7.1", torch.__version__
assert transformers.__version__ == "5.16.0", transformers.__version__
assert torch.cuda.is_available(), "pod must expose CUDA"
name = torch.cuda.get_device_name(0)
mem = torch.cuda.get_device_properties(0).total_memory / 2**30
print(f"cuda ok: {name}, {mem:.0f} GiB")
assert mem >= 75, f"expected ~80GB card, got {mem:.0f} GiB"
EOF
  touch "$PY/.pins-verified"
fi

clone_at() { # clone_at <dir> <url> <sha>
  local dir="$1" url="$2" sha="$3"
  if [ -d "$dir/.git" ]; then
    git -C "$dir" fetch --quiet origin || true
  else
    git clone --quiet "$url" "$dir"
  fi
  git -C "$dir" checkout --quiet --force "$sha"
}

clone_at "$MOEP"  "https://github.com/anik-jha/moep.git"     "fdc9a3fc025236bfbc48e050e23e46d0562a5956"
clone_at "$REAP"  "https://github.com/hqta1110/reap.git"     "711033277033b8111c3b9f89cd07f2dfc97a2aef"
# kalsallama main, read on the Mac 2026-09-29 (Qwen3_5Moe converter present)
clone_at "$LLAMA" "https://github.com/Aspis0/kalsallama.git" "e8065c7cfd0daed1b64a94353ff8d2e0edfbc4da"

# converter + gguf-py import check (no torch needed for these paths)
PYTHONPATH="$LLAMA" "$PY/bin/python" -c "
import sys; sys.path.insert(1, '$LLAMA')
import gguf  # noqa: F401  (vendored gguf-py in the fork)
"

# --- llama.cpp CPU tools (llama-cli for load-verify, llama-quantize) ------
if [ ! -x "$LLAMA/build/bin/llama-quantize" ]; then
  apt-get update -qq && apt-get install -y -qq build-essential cmake libcurl4-openssl-dev >/dev/null
  cmake -S "$LLAMA" -B "$LLAMA/build" -DGGML_CUDA=OFF -DLLAMA_CURL=ON -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build "$LLAMA/build" --target llama-cli llama-quantize -j"$(nproc)" >/dev/null
fi
"$LLAMA/build/bin/llama-cli" --version

echo "00_env: OK"
