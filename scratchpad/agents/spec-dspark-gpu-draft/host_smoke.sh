#!/usr/bin/env bash
# Host speculative smoke for the official LiquidAI DSpark drafter.
# Engine: kalsallama @ f25f0c1c5 (worktree /Users/marco/Projects/kalsallama-wt-oom,
# host build build/bin). Target LFM2.5-2.6B QAD-Q4_0 on CPU, draft DSpark Q8_0 on CPU,
# --spec-type draft-dspark, greedy, -n 64. Writes the engine output to stdout.
set -euo pipefail

WT=/Users/marco/Projects/kalsallama-wt-oom
BIN="$WT/build/bin/llama-speculative-simple"
TARGET=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
DRAFT=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-DSpark-Q8_0.gguf
PROMPT="The quick brown fox jumps over the lazy dog. On the side of the road, a fox"

[ -x "$BIN" ] || { echo "MISSING_BINARY $BIN"; exit 2; }
[ -f "$TARGET" ] || { echo "MISSING_TARGET $TARGET"; exit 2; }
[ -f "$DRAFT" ] || { echo "MISSING_DRAFT $DRAFT"; exit 2; }

"$BIN" \
  -m "$TARGET" \
  -md "$DRAFT" \
  --spec-type draft-dspark \
  -n 64 --temp 0 --top-k 1 -t 8 -ngl 0 \
  -p "$PROMPT"
