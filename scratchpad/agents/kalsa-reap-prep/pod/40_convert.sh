#!/usr/bin/env bash
# 40_convert.sh — pruned HF dir -> BF16 GGUF -> Q8_0, serialized to cap disk.
# Responsibility: convert each ratio with the kalsallama converter + one-shot
# load-verify each artifact; delete intermediates before the next ratio.
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
OUT="$ROOT/gguf"
LLAMA="$ROOT/kalsallama"
mkdir -p "$OUT"

# $1 = pruned HF dir, $2 = tag (e.g. reap25)
convert_one() {
  local src="$1" tag="$2"
  local gguf="$OUT/kalsa-$tag-q8_0.gguf"
  local bf16="$OUT/kalsa-$tag-bf16.gguf"
  local log="$OUT/kalsa-$tag-load.log"
  if [ -f "$gguf" ]; then echo "40_convert: $tag already done"; return 0; fi
  rm -f "$bf16"
  PYTHONPATH="$LLAMA" "$ROOT/.venv-kalsa/bin/python" "$LLAMA/convert_hf_to_gguf.py" \
    "$src" --outfile "$bf16" --outtype bf16 2>&1 | tail -5
  "$LLAMA/build/bin/llama-quantize" "$bf16" "$gguf" Q8_0 2>&1 | tail -3
  rm -f "$bf16"
  # one-shot CPU load-verify: fails on converter/arch breakage; the log's
  # n_expert lines prove the pruned expert count per tensor group
  if ! "$LLAMA/build/bin/llama-cli" -m "$gguf" -p "ping" -n 8 --no-warmup \
       >"$log" 2>&1; then
    echo "40_convert: $tag failed one-shot load (see $log)" >&2
    exit 1
  fi
  grep -E "n_expert" "$log" | head -3 || true
}

convert_one "$ROOT/models/kalsa-reap25" reap25
convert_one "$ROOT/models/kalsa-reap50" reap50
convert_one "$ROOT/models/kalsa-reap65" reap65
convert_one "$ROOT/models/kalsa-reap75" reap75
ls -la "$OUT"
echo "40_convert: OK"
