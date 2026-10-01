#!/usr/bin/env bash
# 00_env.sh — pinned toolchain for the GPU probe. Responsibility: one venv +
# one fork clone at the spike sha + one CUDA llama.cpp build. Needs NO HF
# token.
set -euo pipefail
# shellcheck source=env.sh
. "$(dirname "$0")/env.sh"
# nvcc lives outside the non-login PATH on the runpod/pytorch images, and
# this stage must also work standalone (run_probe.sh exports it too)
export PATH="/usr/local/cuda/bin:$PATH"
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
# fasttext builds from source (no wheels): needs a C++ compiler before pip.
# Runpod cuda images ship gcc, but the earlier probe apt-installed it only
# for cmake — install it here so the pip line cannot fail on a bare image.
# numpy<2: fasttext 0.9.3 predict() calls np.array(..., copy=False), removed
# in numpy 2.0 (observed on the Mac, 2026-10-01).
apt-get update -qq >/dev/null 2>&1 || true
apt-get install -y -qq build-essential >/dev/null 2>&1 || true
"$ROOT/.venv-probe/bin/pip" install --quiet --disable-pip-version-check \
  "transformers==5.16.0" "sentencepiece" "sacrebleu" "fasttext" "numpy<2"
# --ignore-installed: a system-site hub (e.g. the bundle fetch) satisfies pip
# but leaves no venv/bin/hf, and the container disk is wiped on every restart
"$ROOT/.venv-probe/bin/pip" install --quiet --disable-pip-version-check \
  --ignore-installed "huggingface_hub[cli]>=1.5,<2.0"
test -x "$ROOT/.venv-probe/bin/hf" || { echo "00: venv has no hf CLI" >&2; exit 1; }
"$PY" -c "import torch; assert torch.cuda.is_available()" \
  || { echo "00: no CUDA visible — wrong image?" >&2; exit 1; }

# language-ID model for the FLORES wrong-language metric (131 MB, kept out
# of git; fetch_lid176.sh pins the sha256 and skips itself when present)
bash "$EVAL/fetch_lid176.sh" "$HOME/kalsa-models"

# HumanEval+ holdout (audit H3): the file is gitignored (11 MB), so the
# rsync bundle can arrive without it. Verify the sha256 of the BUILT file
# (the builder is byte-deterministic: fixed source pin + fixed row order);
# rebuild from the pinned evalplus revision if absent or wrong — BEFORE any
# GPU hour is spent, and fail the stage otherwise.
HE_JSONL="$EVAL/humaneval-164.jsonl"
HE_SHA256="945a42273172b60a627cb2958ca1cefddfd398f41dfc9535781beb665c29e10f"
he_ok() { [ -f "$HE_JSONL" ] && [ "$(sha256sum "$HE_JSONL" | cut -d" " -f1)" = "$HE_SHA256" ]; }
if ! he_ok; then
  echo "00: humaneval-164.jsonl missing or sha256 mismatch — building from evalplus @ d32357cf"
  "$PY" "$EVAL/build_humaneval_holdout.py" "$EVAL" \
    || { echo "00: humaneval holdout build FAILED" >&2; exit 1; }
  he_ok || { echo "00: humaneval-164.jsonl sha256 mismatch after build" >&2; exit 1; }
fi
echo "00: humaneval-164.jsonl sha256 OK"

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
