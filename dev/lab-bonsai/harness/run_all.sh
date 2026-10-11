#!/bin/bash
# Runs the model batteries one after another (PQ2_0, Gemma 12B, Q1_0 LM Studio copy); each starts and stops its own server on port 8191.
set -u
H="$HOME/lab/bonsai/harness"

"$H/run_battery.sh" "$HOME/lab/bonsai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf" bonsai-pq2 bonsai
"$H/run_battery.sh" "$HOME/Library/Application Support/kalsa-brain/runtime/models/gemma-4-12B-it-Q4_K_M.gguf" gemma12b-q4km gemma
"$H/run_battery_q1.sh" "$HOME/lab/bonsai/models/lmstudio/Bonsai-27B-Q1_0.gguf" bonsai-q1-lmstudio bonsai
echo "ALL BATTERIES DONE" > "$HOME/lab/bonsai/logs/run-all.done"
