#!/bin/bash
set -o pipefail
cd /c/Users/gualt/llama-rn-pin
export LLAMA_RN_SKIP_EXAMPLE_INSTALL=1
bash ./scripts/bootstrap.sh 2>&1 | tee /c/Users/gualt/Desktop/Kalsa/moe-experiments/scratchpad/agents/q66-app-lifecycle-s23/phase3/llama-rn-bootstrap-final-stream.log
exit ${PIPESTATUS[0]}
