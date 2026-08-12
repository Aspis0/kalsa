#!/data/data/com.termux/files/usr/bin/bash
set -u
export HOME=/data/data/com.termux/files/home
BIN=$HOME/gdn_k2/bin_mld
LOG=$HOME/gdn_k2/mld_m1/logs
MODEL=$HOME/gdn_k2/models/Qwen3.5-2B-Q4_K_M.gguf
export LD_LIBRARY_PATH=$BIN:/vendor/lib64:${LD_LIBRARY_PATH:-}
mkdir -p "$LOG"
chmod +x $BIN/llama-cli $BIN/llama-bench $BIN/test-backend-ops

batt() { echo "=== battery $1 $(date -Iseconds) ==="; termux-battery-status; }

{
  echo "=== sha256 ==="
  sha256sum $BIN/llama-cli $BIN/llama-bench $BIN/test-backend-ops $BIN/libc++_shared.so
  batt start
} | tee $LOG/setup.txt

# Tensor-type dump via verbose load (CPU, n=0).
{
  echo "=== tensor dump $MODEL ==="
  $BIN/llama-cli -m "$MODEL" -ngl 0 -n 0 -p x --no-conversation --verbose \
    -c 256 -st 2>&1
} | tee $LOG/tensor_dump_2b.txt

# Correctness: default path (env off)
{
  batt before_corr_off
  echo "=== test MUL_MAT q4_K env OFF ==="
  $BIN/test-backend-ops test -b GPUOpenCL -o MUL_MAT -p "type_a=q4_K,type_b=f32,n=1,k="
  echo exit=$?
  batt after_corr_off
} 2>&1 | tee $LOG/corr_q4k_off.txt

# Correctness: MLD on
{
  batt before_corr_on
  echo "=== test MUL_MAT q4_K env ON ==="
  GGML_OPENCL_MLD_GEMV=1 $BIN/test-backend-ops test -b GPUOpenCL -o MUL_MAT -p "type_a=q4_K,type_b=f32,n=1,k="
  echo exit=$?
  batt after_corr_on
} 2>&1 | tee $LOG/corr_q4k_on.txt

# n=4 MLD layout correctness
{
  echo "=== test MUL_MAT q4_K n=4 env ON ==="
  GGML_OPENCL_MLD_GEMV=1 $BIN/test-backend-ops test -b GPUOpenCL -o MUL_MAT -p "type_a=q4_K,type_b=f32,m=2048,n=4,k=2048"
  echo exit=$?
} 2>&1 | tee $LOG/corr_q4k_n4_on.txt

echo DONE
