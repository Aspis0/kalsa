#!/usr/bin/env bash
# shellcheck disable=SC2034  # constants file: every variable is consumed by
# the stages that source this, not by this file itself
# env.sh — pinned constants for the one-shot GPU gate probe. Sourced by every
# podprobe stage. Responsibility: the pins and paths, nothing else.
# Owner cap: $10. L40 48GB community assumed at $0.69/h (README has the
# create command; adjust PROBE_RATE_USD_H if the GPU differs).

# --- engine: fork main + the k2 spike patch (k2 is OFF unless the
# expert_used_k2 override is passed, so one build serves every arm).
# Requires the coordinator to have pushed spike/topk-k2-renorm first; if not
# pushed, set LLAMA_SHA to main below and the k2 arm skips itself.
LLAMA_REPO="https://github.com/Aspis0/kalsallama.git"
LLAMA_SHA="a2f252fbdd6fe52e75e818b041d8174fccbe3a52"   # spike/topk-k2-renorm
LLAMA_SHA_FALLBACK="e8065c7cfd0daed1b64a94353ff8d2e0edfbc4da"  # fork main

# --- artifacts, all pinned ---
RAZOR19_REPO="Nickyang/Qwen3.6-35B-A3B-RAZOR-19B-A3B-E128of256"
RAZOR19_SHA="d897617a6431c5c8fca70fd646cb14f7632162e8"
# optional 25% arm: ~28B -> Q4_K_M ~16 GB — does NOT fit any 16 GB budget
RAZOR28_REPO="Nickyang/Qwen3.6-35B-A3B-RAZOR-28B-A3B-E192of256"
RAZOR28_SHA="298d343bb0c2de6be6785593b2be42581363c000"
PROBE_WITH_RAZOR28="${PROBE_WITH_RAZOR28:-0}"

QWEN36_GGUF_REPO="unsloth/Qwen3.6-35B-A3B-GGUF"       # unpruned, k=4 arm
QWEN36_GGUF_FILE="Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"
QWEN36_GGUF_SHA="a483e9e6cbd595906af30beda3187c2663a1118c"
QWEN35_4B_REPO="unsloth/Qwen3.5-4B-GGUF"
QWEN35_4B_SHA="e87f176479d0855a907a41277aca2f8ee7a09523"
QWEN35_2B_REPO="unsloth/Qwen3.5-2B-GGUF"
QWEN35_2B_SHA="f6d5376be1edb4d416d56da11e5397a961aca8ae"
# ship baseline lives only on the Mac: prerequisite upload to the private
# dataset repo at ship/LFM2.5-2.6B-QAD-Q4_0.gguf (README has the command)
LFM_SHIP_SHA256="a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03"

# tokenizer for bpb token counts (rsynced with the bundle)
QWEN36_TOK="qwen36-meta"     # from Qwen/Qwen3.6-35B-A3B @ 995ad96eac…
QWEN35_TOK="qwen35-tok"      # from Qwen/Qwen3.5-4B (same family as 2B)
LFM_TOK="lfm2.5-tokenizer"

# --- layout / budget ---
ROOT="${POD_ROOT:-/workspace}"
CELL="$ROOT/kalsa-reap-prep"
EVAL="$CELL/eval"
CORPUS="$CELL/corpus/postcutoff"
MODELS="$ROOT/models"
RUNS="$ROOT/runs"
RESULTS="$ROOT/results"
PY="$ROOT/.venv-probe/bin/python"
LLAMA="$ROOT/kalsallama"
LLAMA_BIN="$LLAMA/build/bin"
PORT=8765
HF_RESULTS_REPO="${HF_RESULTS_REPO:-Aspis0/kalsa-gate-probe-results}"
SECRETS="${POD_SECRETS_DIR:-/root/.secrets}"
PROBE_RATE_USD_H="${PROBE_RATE_USD_H:-0.69}"
PROBE_BUDGET_H="${PROBE_BUDGET_H:-12.5}"   # < terminate-after; the guard skips
                                            # arms that cannot fit, in order
START_EPOCH="$(date +%s)"
elapsed_h() { awk -v s="$START_EPOCH" -v n="$(date +%s)" 'BEGIN {print (n-s)/3600}'; }
