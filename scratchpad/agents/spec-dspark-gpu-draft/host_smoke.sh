#!/usr/bin/env bash
# Host speculative smoke for the official LiquidAI DSpark drafter.
# Engine: kalsallama @ f25f0c1c5 (worktree /Users/marco/Projects/kalsallama-wt-oom,
# host build build/bin). Target LFM2.5-2.6B QAD-Q4_0 on CPU, draft DSpark Q8_0 on CPU,
# --spec-type draft-dspark, greedy, -n 64, PROMPT = the cell's frozen PROMPT.txt
# (identical to PLAN.md and every device arm — audit B7). Writes output to stdout.
set -euo pipefail

CELL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT=/Users/marco/Projects/kalsallama-wt-oom
BIN="$WT/build/bin/llama-speculative-simple"
TARGET=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
DRAFT=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-DSpark-Q8_0.gguf
PROMPT="$CELL/PROMPT.txt"
PROMPT_SHA=$(awk '{print $1}' "$CELL/PROMPT.meta")

[ -x "$BIN" ] || { echo "MISSING_BINARY $BIN"; exit 2; }
[ -f "$TARGET" ] || { echo "MISSING_TARGET $TARGET"; exit 2; }
[ -f "$DRAFT" ] || { echo "MISSING_DRAFT $DRAFT"; exit 2; }
sha=$(/usr/bin/shasum -a 256 "$PROMPT" | awk '{print $1}')
[ "$sha" = "$PROMPT_SHA" ] || { echo "PROMPT_IDENTITY_FAIL got=$sha want=$PROMPT_SHA"; exit 2; }

"$BIN" \
  -m "$TARGET" \
  -md "$DRAFT" \
  --spec-type draft-dspark \
  -n 64 --temp 0 --top-k 1 -t 8 -ngl 0 \
  -f "$PROMPT"
