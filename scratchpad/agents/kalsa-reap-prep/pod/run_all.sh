#!/usr/bin/env bash
# run_all.sh — pod orchestrator. Responsibility: sequencing + spend cap.
# Usage: run_all.sh <CAP_USD>            (FASE A: floor 40 / soft 120 / STOP 150)
# Hard-stops (exit 3) before starting a stage whose projected spend exceeds
# the cap. Projected = POD_RATE_USD_H x elapsed + per-stage reserve.
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
LAB="$ROOT/kalsa-reap-prep/pod"
RUN="$ROOT/runs"
STATE="$RUN/spend-state.env"
RATE="${POD_RATE_USD_H:-1.98}"   # RunPod A100 80GB on-demand, USD/h (assumption)
CAP="${1:?usage: run_all.sh <CAP_USD>}"

mkdir -p "$RUN"
if [ ! -f "$STATE" ]; then
  printf 'START_EPOCH=%s\n' "$(date +%s)" > "$STATE"
fi
# shellcheck source=/dev/null
source "$STATE"

reserve_hours() {
  case "$1" in
    00_env|10_fetch_model) echo 0.5 ;;   # 72GB from HF CDN, conservative
    20_observe)            echo 0.5 ;;   # load + ~0.7M tokens with all-expert hooks
    30_prune)              echo 0.3 ;;   # CPU-heavy, GPU idle but billed
    40_convert)            echo 0.8 ;;   # 4 x (convert + quantize + CPU load-verify)
    50_upload)             echo 0.4 ;;   # ~160GB at 100-200 MB/s
    *)                     echo 0.2 ;;
  esac
}

for stage in 00_env 10_fetch_model 20_observe 30_prune 40_convert 50_upload; do
  now=$(date +%s)
  spent=$(awk -v r="$RATE" -v s="$START_EPOCH" -v n="$now" 'BEGIN {print r*(n-s)/3600}')
  projected=$(awk -v s="$spent" -v r="$(reserve_hours "$stage")" 'BEGIN {printf "%.2f", s+r}')
  echo "== $stage: spent ~\$${spent}, projected with reserve ~\$${projected} (cap \$${CAP}) =="
  if awk -v p="$projected" -v c="$CAP" 'BEGIN {exit !(p > c)}'; then
    echo "run_all: STOP — $stage would exceed cap \$${CAP} (projected \$${projected})." >&2
    echo "run_all: completed stages and artifacts are intact; resume with a higher cap." >&2
    exit 3
  fi
  bash "$LAB/$stage.sh" 2>&1 | tee -a "$RUN/${stage}.log"
done
echo "run_all: ALL STAGES OK — spent ~\$${spent} of cap \$${CAP}"
