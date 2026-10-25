#!/bin/sh
# Lab-only: the crash-check matrix, one engine at a time, each with the app's
# vision argv. Output per run goes to /tmp/lab-screen/logs/crash/.
set -u
here=$(cd "$(dirname "$0")" && pwd)
rt="$HOME/Library/Application Support/kalsa-brain/runtime/models"
m=/tmp/lab-screen/models
for u in 512 256 1024; do
  sh "$here/crash-check.sh" gemma "$rt/gemma-4-E4B-it-Q4_K_M.gguf" "$m/mmproj-gemma-4-E4B-it-Q8_0.gguf" gemma-4-E4B-it-Q4_K_M $u e4b
done
for u in 512 256 1024; do
  sh "$here/crash-check.sh" gemma "$rt/gemma-4-12B-it-Q4_K_M.gguf" "$m/mmproj-gemma-4-12B-it-Q8_0.gguf" gemma-4-12B-it-Q4_K_M $u g12
done
for u in 512 256 1024; do
  sh "$here/crash-check.sh" gemma "$rt/gemma-4-26B_q4_0-it.gguf" "$m/mmproj-gemma-4-26B-it.gguf" gemma-4-26B_q4_0-it $u g26
done
for u in 512 256 1024; do
  sh "$here/crash-check.sh" qwen "$rt/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf" "$rt/unsloth__Qwen3.6-35B-A3B-GGUF__mmproj-F16.gguf" Qwen3.6-35B-A3B-UD-Q4_K_M $u qwen
done
echo "MATRIX_DONE"
