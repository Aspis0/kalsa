#!/usr/bin/env bash
# 00_env.sh — pinned toolchain on the pod. Idempotent. Needs NO HF token.
# Responsibility: one venv + two git clones + one CUDA llama.cpp build
# (llama-cli / llama-quantize / llama-imatrix for 40_convert).
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
MOEP="$ROOT/moep"
REAP="$ROOT/reap-hqta1110"          # reference only: REAP metric cross-reading
LLAMA="$ROOT/kalsallama"
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
assert torch.cuda.is_available(), "pod must expose CUDA"
name = torch.cuda.get_device_name(0)
mem = torch.cuda.get_device_properties(0).total_memory / 2**30
print(f"cuda ok: {name}, {mem:.0f} GiB")
assert mem >= 75, f"expected ~80GB card, got {mem:.0f} GiB"
EOF

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
for d in "$MOEP" "$REAP" "$LLAMA"; do
  [ "$(git -C "$d" rev-parse HEAD)" != "" ] || { echo "clone HEAD empty: $d" >&2; exit 1; }
done

# converter + vendored gguf-py import check
PYTHONPATH="$LLAMA" "$PY/bin/python" -c "
import sys; sys.path.insert(1, '$LLAMA')
import gguf  # noqa: F401
"

# CUDA build: quantize + imatrix need CUDA; llama-cli doubles as load-verifier.
# ~10-15 min with $(nproc) jobs on the pod; cached by the build dir on resume.
if [ ! -x "$LLAMA/build/bin/llama-quantize" ] || [ ! -x "$LLAMA/build/bin/llama-imatrix" ]; then
  apt-get update -qq && apt-get install -y -qq build-essential cmake libcurl4-openssl-dev ninja-build >/dev/null
  rm -rf "$LLAMA/build"
  cmake -S "$LLAMA" -B "$LLAMA/build" -DGGML_CUDA=ON -DLLAMA_CURL=ON \
        -DCMAKE_BUILD_TYPE=Release -G Ninja >/dev/null
  cmake --build "$LLAMA/build" --target llama-cli llama-quantize llama-imatrix -j"$(nproc)" >/dev/null
fi
for bin in llama-cli llama-quantize llama-imatrix; do
  test -x "$LLAMA/build/bin/$bin" || { echo "missing $bin after build" >&2; exit 1; }
done
"$LLAMA/build/bin/llama-cli" --version

touch "$OK"
echo "00_env: OK"
