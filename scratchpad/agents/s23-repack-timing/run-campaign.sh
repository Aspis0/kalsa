#!/usr/bin/env bash
# run-campaign.sh — drives the S23 repack A/B schedule through run-arm.sh.
#
# Arms (model, levers):
#   LFM-N  lfm2.5-2.6b  kalsa.bench.norepack=1  -> no_extra_bufts=1 (repack OFF)
#   LFM-R  lfm2.5-2.6b  kalsa.bench.norepack=0  -> no_extra_bufts=0 (repack forced ON)
#   QWEN-N qwen3.5-4b   kalsa.bench.norepack=1  -> no_extra_bufts=1 (repack OFF, the shipped default)
#   QWEN-R qwen3.5-4b   kalsa.bench.norepack=0  -> repack priced in; expected fit refusal
#
# LFM 2.6B is the equal-fit model: it fits with and without the ~1.43 GB repack
# copy, so it is where the repack path's cost can actually be priced. QWEN-R
# exists to record the gate refusal on the same model the policy is about.
set -uo pipefail

APP_ROOT="${APP_ROOT:-/Users/marco/.paseo/worktrees/1vffp1wo/s23-repack-timing}"
OUT="${OUT:?OUT is required}"
SERIAL="${SERIAL:?SERIAL is required}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$OUT"

run() { # arm model_dir model_file norepack rep
  APP_ROOT="$APP_ROOT" SERIAL="$SERIAL" OUT="$OUT" \
  ARM="$1" MODEL_DIR="$2" MODEL_FILE="$3" NOREPACK="$4" REP="$5" \
  bash "$HERE/run-arm.sh"
}

LFM_DIR=lfm2.5-2.6b;  LFM_FILE=LFM2.5-2.6B-QAD-Q4_0.gguf
QWEN_DIR=qwen3.5-4b;  QWEN_FILE=Qwen3.5-4B-Q4_K_M.gguf

for rep in 1 2 3; do
  if [ $((rep % 2)) -eq 1 ]; then
    run LFM-N  "$LFM_DIR"  "$LFM_FILE"  1 "$rep"
    run LFM-R  "$LFM_DIR"  "$LFM_FILE"  0 "$rep"
    run QWEN-N "$QWEN_DIR" "$QWEN_FILE" 1 "$rep"
    run QWEN-R "$QWEN_DIR" "$QWEN_FILE" 0 "$rep"
  else
    run QWEN-R "$QWEN_DIR" "$QWEN_FILE" 0 "$rep"
    run QWEN-N "$QWEN_DIR" "$QWEN_FILE" 1 "$rep"
    run LFM-R  "$LFM_DIR"  "$LFM_FILE"  0 "$rep"
    run LFM-N  "$LFM_DIR"  "$LFM_FILE"  1 "$rep"
  fi
done

echo "=== campaign done ==="
column -t -s $'\t' "$OUT/results.tsv" 2>/dev/null || cat "$OUT/results.tsv"
