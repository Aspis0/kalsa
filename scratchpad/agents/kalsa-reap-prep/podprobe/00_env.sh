#!/usr/bin/env bash
# 00_env.sh — pinned toolchain for the GPU probe. Responsibility: one venv +
# one fork clone at the spike sha + one CUDA llama.cpp build. Needs NO HF
# token.
set -euo pipefail
# shellcheck source=env.sh
. "$(dirname "$0")/env.sh"
OK="$RUNS/00_env.ok"

if [ -f "$OK" ]; then echo "00_env: already OK"; exit 0; fi
mkdir -p "$RUNS" "$MODELS" "$RESULTS"

# --system-site-packages: the image's torch (matching its CUDA) is visible to
# the venv; transformers only pulls torch via extras, so an isolated venv
# would fail the CUDA assert below (Fable-3 §1.2). The hub pin satisfies
# transformers 5.16.0's `huggingface-hub>=1.5,<2.0` requirement.
if [ ! -x "$PY" ]; then
  # the image's torch lives in python3.12; the default python3 has none
  "${POD_PYBASE:-python3.12}" -m venv --system-site-packages "$ROOT/.venv-probe"
fi
"$ROOT/.venv-probe/bin/pip" install --quiet --disable-pip-version-check \
  "transformers==5.16.0" "huggingface_hub[cli]>=1.5,<2.0" "sentencepiece"
"$PY" -c "import torch; assert torch.cuda.is_available()" \
  || { echo "00: no CUDA visible — wrong image?" >&2; exit 1; }

# the fork is private: the coordinator rsyncs a clone (owned by the Mac uid)
git config --global --add safe.directory "$LLAMA"
if [ ! -d "$LLAMA/.git" ]; then
  git clone --quiet "$LLAMA_REPO" "$LLAMA"
fi
git -C "$LLAMA" fetch --quiet origin || true
# the spike branch carries the k2 patch (off unless overridden); if it was
# never pushed, fall back to fork main and let the k2 arm skip itself
if ! git -C "$LLAMA" cat-file -e "$LLAMA_SHA^{commit}" 2>/dev/null \
   && ! git -C "$LLAMA" fetch --quiet origin spike/topk-k2-renorm 2>/dev/null; then
  echo "00: spike sha unavailable — building fork main (k2 arm will skip)" >&2
  git -C "$LLAMA" checkout --quiet --force "$LLAMA_SHA_FALLBACK"
  echo "$LLAMA_SHA_FALLBACK" > "$RUNS/using-main"
else
  git -C "$LLAMA" checkout --quiet --force "$LLAMA_SHA"
fi

if [ ! -x "$LLAMA_BIN/llama-server" ] || [ ! -x "$LLAMA_BIN/llama-perplexity" ]; then
  apt-get update -qq && apt-get install -y -qq build-essential cmake ninja-build libcurl4-openssl-dev >/dev/null
  cmake -S "$LLAMA" -B "$LLAMA/build" -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES="${CUDAARCHS:-89}" \
        -DCMAKE_BUILD_TYPE=Release -G Ninja >/dev/null
  cmake --build "$LLAMA/build" \
    --target llama-cli llama-server llama-perplexity llama-quantize llama-bench \
    -j"$(nproc)" >/dev/null
fi
for bin in llama-cli llama-server llama-perplexity llama-quantize llama-bench; do
  test -x "$LLAMA_BIN/$bin" || { echo "00: missing $bin" >&2; exit 1; }
done
"$LLAMA_BIN/llama-server" --version

touch "$OK"
echo "00_env: OK"
