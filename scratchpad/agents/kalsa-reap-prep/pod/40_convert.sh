#!/usr/bin/env bash
# 40_convert.sh — pruned HF dir -> BF16 GGUF -> imatrix -> Q4_0/Q4_K_M/Q8_0.
# Responsibility: produce the eval-gate quant set with a calibration imatrix
# (no requant-from-Q8_0 later), load-verify every artifact, .ok only after
# verification, delete intermediates and the re-derivable pruned HF dir.
#
# --no-mtp is mandatory for moep-pruned dirs: their configs carry
# mtp_num_hidden_layers=0 and no mtp.* tensors, and without the flag the
# converter asserts (kalsallama conversion/qwen.py:298-303:
#   n_mtp = self.hparams.get("mtp_num_hidden_layers", 0)
#   if n_mtp == 0: assert self.opt_num_mtp_layers != 0
# which fires when no MTP tensors were seen). With the flag, filter_tensors
# returns None for mtp.* names (conversion/qwen.py:324-326).
#
# Vision: moep surgery copies model.visual.* verbatim, but the GGUF is
# text-only unless --mmproj is passed (convert_hf_to_gguf.py:117-118) — we
# never pass it, so no mmproj is written and GGUF sizes exclude vision.
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
OUT="$ROOT/gguf"
LLAMA="$ROOT/kalsallama"
IMAT_TXT="$ROOT/calib/calib-imatrix.txt"
QUANTS="Q4_0 Q4_K_M Q8_0"
mkdir -p "$OUT"

test -f "$IMAT_TXT" || { echo "40: imatrix text missing ($IMAT_TXT; staged by stage_calib.sh)" >&2; exit 1; }

# $1 = pruned HF dir, $2 = tag (e.g. reap25)
convert_one() {
  local src="$1" tag="$2"
  local bf16="$OUT/kalsa-$tag-bf16.gguf"
  local imat="$OUT/kalsa-$tag-imatrix.gguf"
  local log="$OUT/kalsa-$tag-load.log"

  for q in $QUANTS; do
    if [ ! -f "$RUN/40_convert_${tag}_${q}.ok" ]; then
      rm -f "$OUT/kalsa-$tag-${q,,}.gguf"   # partial artifact is not a state
    fi
  done
  if [ -f "$RUN/40_convert_${tag}_Q4_0.ok" ] && [ -f "$RUN/40_convert_${tag}_Q4_K_M.ok" ] \
     && [ -f "$RUN/40_convert_${tag}_Q8_0.ok" ]; then
    echo "40_convert: $tag already verified OK"; return 0
  fi

  rm -f "$bf16" "$imat"
  PYTHONPATH="$LLAMA" "$ROOT/.venv-kalsa/bin/python" "$LLAMA/convert_hf_to_gguf.py" \
    "$src" --outfile "$bf16" --outtype bf16 --no-mtp 2>&1 | tail -5

  # imatrix from the Kalsa calibration text, on this ratio's own graph
  "$LLAMA/build/bin/llama-imatrix" -m "$bf16" -f "$IMAT_TXT" \
    -o "$imat" 2>&1 | tail -3
  test -s "$imat" || { echo "40: imatrix empty for $tag" >&2; rm -f "$bf16"; return 1; }

  for q in $QUANTS; do
    local gguf="$OUT/kalsa-$tag-${q,,}.gguf"
    local okf="$RUN/40_convert_${tag}_${q}.ok"
    [ -f "$okf" ] && continue
    "$LLAMA/build/bin/llama-quantize" --imatrix "$imat" "$bf16" "$gguf" "$q" 2>&1 | tail -3
    if ! "$LLAMA/build/bin/llama-cli" -m "$gguf" -p "ping" -n 8 --no-warmup \
         >"$log" 2>&1; then
      echo "40: $tag $q failed one-shot load (see $log)" >&2
      rm -f "$gguf"
      return 1
    fi
    grep -E "n_expert" "$log" | head -1 || true
    touch "$okf"
  done

  rm -f "$bf16" "$imat"
}

for R in 25 50 65 75; do
  convert_one "$ROOT/models/kalsa-reap$R" "reap$R"
done

# pruned HF dirs are byte-re-derivable from keep_reap_*.json + the base model
# (30_prune's surgery is deterministic); free the disk once quants verify
for R in 25 50 65 75; do
  if [ -f "$RUN/40_convert_reap${R}_Q4_0.ok" ] && [ -f "$RUN/40_convert_reap${R}_Q4_K_M.ok" ] \
     && [ -f "$RUN/40_convert_reap${R}_Q8_0.ok" ]; then
    rm -rf "$ROOT/models/kalsa-reap$R"
  fi
done

ls -la "$OUT"
echo "40_convert: OK"
