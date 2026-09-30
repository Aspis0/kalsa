#!/usr/bin/env bash
# 30_convert.sh — pruned HF dir -> BF16 GGUF -> calibration imatrix ->
# Q4_0 + Q4_K_M (Q8_0 arm dropped per the 2026-09-30 review; two quants is
# the gate's matched-quant pair). Runs on the MAC with our kalsallama build.
# Responsibility: produce the eval-gate artifacts, load-verify every one
# (single-turn, no tty), then delete the re-derivable intermediates.
#
# --no-mtp is mandatory for moep-pruned dirs: their configs carry
# mtp_num_hidden_layers=0 and no mtp.* tensors, and without the flag the
# converter asserts (kalsallama conversion/qwen.py:298-303). Proven both
# directions on this Mac (REPORT.md §2).
#
# Vision: the GGUF is text-only unless --mmproj is passed; we never pass it.
# Usage: mac/30_convert.sh <pruned-dir> <tag>   (env: KALSA_MODELS, LLAMA_BIN)
set -euo pipefail

KALSA_MODELS="${KALSA_MODELS:-$HOME/kalsa-models}"
LLAMA_DIR="${LLAMA_DIR:-$HOME/Projects/kalsallama}"
LLAMA_BIN="${LLAMA_BIN:-$LLAMA_DIR/build-metal/bin}"
PY="${PY:-$KALSA_MODELS/reap-calib/.venv/bin/python}"
IMAT_TXT="${IMAT_TXT:-$KALSA_MODELS/reap-calib/calib-imatrix.txt}"
RUNS="$KALSA_MODELS/reap-src/runs"
OUT="${OUT:-$KALSA_MODELS/reap-src/gguf}"
QUANTS="Q4_0 Q4_K_M"
# lowercase quant names for filenames, precomputed: ${q,,} is bash-4 syntax
# and this script must run under macOS's stock bash 3.2
declare -a QUANTS_LC=(q4_0 q4_k_m)

SRC="${1:?usage: 30_convert.sh <pruned-dir> <tag>}"
TAG="${2:?usage: 30_convert.sh <pruned-dir> <tag>}"
mkdir -p "$OUT" "$RUNS"

test -f "$IMAT_TXT" || { echo "30: imatrix text missing ($IMAT_TXT)" >&2; exit 1; }

bf16="$OUT/kalsa-$TAG-bf16.gguf"
imat="$OUT/kalsa-$TAG-imatrix.gguf"

i=0
for q in $QUANTS; do
  if [ ! -f "$RUNS/30_convert_${TAG}_${q}.ok" ]; then
    rm -f "$OUT/kalsa-$TAG-${QUANTS_LC[$i]}.gguf"   # partial artifact is not a state
  fi
  i=$((i + 1))
done
if [ -f "$RUNS/30_convert_${TAG}_Q4_0.ok" ] && [ -f "$RUNS/30_convert_${TAG}_Q4_K_M.ok" ]; then
  echo "30_convert: $TAG already verified OK"; exit 0
fi

rm -f "$bf16" "$imat"
PYTHONPATH="$LLAMA_DIR" "$PY" "$LLAMA_DIR/convert_hf_to_gguf.py" \
  "$SRC" --outfile "$bf16" --outtype bf16 --no-mtp 2>&1 | tail -5

# imatrix from the Kalsa calibration text, on this ratio's own graph
"$LLAMA_BIN/llama-imatrix" -m "$bf16" -f "$IMAT_TXT" -o "$imat" 2>&1 | tail -3
test -s "$imat" || { echo "30: imatrix empty for $TAG" >&2; rm -f "$bf16"; exit 1; }

i=0
for q in $QUANTS; do
  gguf="$OUT/kalsa-$TAG-${QUANTS_LC[$i]}.gguf"
  okf="$RUNS/30_convert_${TAG}_${q}.ok"
  [ -f "$okf" ] && { i=$((i + 1)); continue; }
  "$LLAMA_BIN/llama-quantize" --imatrix "$imat" "$bf16" "$gguf" "$q" 2>&1 | tail -3
  # load check: --single-turn + stdin closed so llama-cli can never fall into
  # its interactive loop (that hang cost 19 CPU-minutes once); --no-display-
  # prompt keeps the echoed prompt out of the log we grep
  if ! "$LLAMA_BIN/llama-cli" -m "$gguf" -p "ping" -n 8 --no-warmup \
       --single-turn --simple-io --no-display-prompt \
       </dev/null >"$OUT/kalsa-$TAG-load.log" 2>&1; then
    echo "30: $TAG $q failed one-shot load (see $OUT/kalsa-$TAG-load.log)" >&2
    rm -f "$gguf"
    exit 1
  fi
  grep -m1 -E "n_expert" "$OUT/kalsa-$TAG-load.log" || true
  touch "$okf"
  i=$((i + 1))
done

rm -f "$bf16" "$imat"
# the pruned HF dir is byte-re-derivable from the keep-set + base (deterministic
# surgery); drop it once both quants verify so the Mac disk survives
if [ -f "$RUNS/30_convert_${TAG}_Q4_0.ok" ] && [ -f "$RUNS/30_convert_${TAG}_Q4_K_M.ok" ]; then
  rm -rf "$SRC"
fi
ls -la "$OUT"
echo "30_convert: OK ($TAG: ${QUANTS})"
