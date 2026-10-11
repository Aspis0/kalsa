#!/bin/bash
# Waits for the driver to finish, then resumes restraint/calendar for every battery whose step exited 1.
L="$HOME/lab/bonsai/logs"
H="$HOME/lab/bonsai/harness"
until [ -f "$L/run-all.done" ]; do sleep 60; done
if grep -q "restraint EXIT=1\|calendar EXIT=1" "$L/bonsai-pq2/exit.txt"; then
  "$H/run_repair.sh" "$HOME/lab/bonsai/models/Ternary-Bonsai-2-27B-PQ2_0.gguf" bonsai-pq2 bonsai
fi
if grep -q "restraint EXIT=1\|calendar EXIT=1" "$L/gemma12b-q4km/exit.txt"; then
  "$H/run_repair.sh" "$HOME/Library/Application Support/kalsa-brain/runtime/models/gemma-4-12B-it-Q4_K_M.gguf" gemma12b-q4km gemma
fi
if grep -q "restraint EXIT=1\|calendar EXIT=1" "$L/bonsai-q1-lmstudio/exit.txt"; then
  "$H/run_repair.sh" "$HOME/lab/bonsai/models/lmstudio/Bonsai-27B-Q1_0.gguf" bonsai-q1-lmstudio bonsai
fi
echo "REPAIR QUEUE DONE" > "$L/repairs.done"
