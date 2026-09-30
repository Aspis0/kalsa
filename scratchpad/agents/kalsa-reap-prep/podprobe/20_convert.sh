#!/usr/bin/env bash
# 20_convert.sh — RAZOR HF dir -> BF16 GGUF (--no-mtp) -> Q4_K_M + Q4_0.
# Responsibility: produce the RAZOR gate artifacts and load-verify each.
# --no-mtp is mandatory for RAZOR dirs exactly as for moep-pruned ones:
# their configs carry mtp_num_hidden_layers=0 with no mtp.* tensors and the
# converter asserts without the flag (proven on the Mac, REPORT.md §2).
# Q4_K_M/Q4_0 without imatrix: this is a compare arm, not a ship artifact —
# every arm of the probe is quantised the same plain way, so quant
# differences cannot masquerade as model differences.
set -euo pipefail
# shellcheck source=env.sh
. "$(dirname "$0")/env.sh"

convert_one() { # hf_dir tag
  local src="$1" tag="$2"
  local bf16="$MODELS/kalsa-$tag-bf16.gguf"
  local qm="$MODELS/kalsa-$tag-q4_k_m.gguf"
  local q0="$MODELS/kalsa-$tag-q4_0.gguf"
  [ -f "$RUNS/20_convert_${tag}.ok" ] && { echo "20: $tag already OK"; return 0; }
  rm -f "$bf16"

  PYTHONPATH="$LLAMA" "$PY" "$LLAMA/convert_hf_to_gguf.py" "$src" \
    --outfile "$bf16" --outtype bf16 --no-mtp 2>&1 | tail -4

  for pair in "Q4_K_M:$qm" "Q4_0:$q0"; do
    local q="${pair%%:*}" out="${pair##*:}"
    "$LLAMA_BIN/llama-quantize" "$bf16" "$out" "$q" 2>&1 | tail -3
    if ! "$LLAMA_BIN/llama-cli" -m "$out" -p "ping" -n 8 --no-warmup -ngl 99 \
         --single-turn --simple-io --no-display-prompt \
         </dev/null >"$RUNS/${tag}-load.log" 2>&1; then
      echo "20: $tag $q failed one-shot load (see $RUNS/${tag}-load.log)" >&2
      rm -f "$out"
      exit 1
    fi
  done
  rm -f "$bf16"   # 19B BF16 is 38 GB; the two quants are the deliverables
  touch "$RUNS/20_convert_${tag}.ok"
  echo "20_convert: $tag OK"
}

convert_one "$MODELS/razor19" "razor19"
if [ "$PROBE_WITH_RAZOR28" = "1" ]; then
  convert_one "$MODELS/razor28" "razor28"
fi
echo "20_convert: OK"
