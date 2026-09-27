#!/usr/bin/env bash
# Host calibration for the DSpark arms' PLAN predictions: prompt EOG check,
# the n_max=0 no-speculation control (arm A), acceptance priors for n_max 4
# and 8 on the frozen PROMPT.txt, and overshoot stability at two limits
# (the matched-N method's assumption). CPU only, engine f25f0c1c5, greedy,
# `-t 5` = S23 app preset (3-way decision after audit dd6bdb56); `-ngld 0`
# mirrors the device drafter flags. One run per case; one summary line each.
set -euo pipefail

CELL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT=/Users/marco/Projects/kalsallama-wt-oom
BIN="$WT/build/bin/llama-speculative-simple"
TARGET=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
DRAFT=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-DSpark-Q8_0.gguf
RAW="$CELL/raw"
PROMPT="$CELL/PROMPT.txt"
PROMPT_SHA=$(awk '{print $1}' "$CELL/PROMPT.meta")

[ -x "$BIN" ] || { echo "MISSING_BINARY $BIN"; exit 2; }
sha=$(/usr/bin/shasum -a 256 "$PROMPT" | awk '{print $1}')
[ "$sha" = "$PROMPT_SHA" ] || { echo "PROMPT_IDENTITY_FAIL got=$sha want=$PROMPT_SHA"; exit 2; }

# run <tag> <n_max> <limit>
run() {
  local tag=$1 n_max=$2 limit=$3 log="$RAW/calib_$1.log"
  local rc=0
  "$BIN" -m "$TARGET" -md "$DRAFT" --spec-type draft-dspark --spec-draft-n-max "$n_max" \
    -f "$PROMPT" -n "$limit" --temp 0 --top-k 1 -t 5 -ngl 0 -ngld 0 > "$log" 2>&1 || rc=$?
  local n_pred n_draft n_acc acc speed
  n_pred=$(awk '/n_predict = /{v=$NF} END{print v}' "$log")
  n_draft=$(awk '/n_drafted = /{v=$NF} END{print v}' "$log")
  n_acc=$(awk '/n_accept  = /{v=$NF} END{print v}' "$log")
  acc=$(awk '/accept    = /{v=$NF} END{print v}' "$log")
  speed=$(awk '/ decoded .* tokens in .* speed: /{for(i=1;i<=NF;i++) if ($i=="speed:") print $(i+1)}' "$log" | tail -1)
  if [ "$rc" -ne 0 ] || [ -z "$n_pred" ]; then
    printf 'CALIB tag=%s n_max=%s limit=%s exit=%s n_predict=%s (no-stats)\n' \
      "$tag" "$n_max" "$limit" "$rc" "${n_pred:-na}"
    return 0
  fi
  printf 'CALIB tag=%s n_max=%s limit=%s exit=%s n_predict=%s overshoot=%s n_drafted=%s n_accept=%s accept=%s speed_tps=%s\n' \
    "$tag" "$n_max" "$limit" "$rc" "$n_pred" "$((n_pred - limit))" "$n_draft" "$n_acc" "$acc" "$speed"
}

echo "PROMPT_SHA=$sha"
# B1: the prompt must reach the limit without an early EOG stop (N = limit+1).
run eog170 0 170
# B2: arm A control — n_max 0 decodes plainly (n_drafted = 0, one token per step).
run armA127 0 127
# B5/B1: acceptance priors + probe N at the declared limit.
run armB4_127 4 127
run armB8_127 8 127
# B1/B6: overshoot at a second limit (matched-N iteration assumes it is stable).
run armB4_63 4 63
run armB8_63 8 63
# B6: matched-N convergence on the host (PLAN: probes A=128, B4=132, B8=136
# -> A@135 and B4@131 both land on 136; B4@123 shows the downward shift).
run armA_135 0 135
run armB4_131 4 131
run armB4_123 4 123
