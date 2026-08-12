#!/data/data/com.termux/files/usr/bin/bash
set -u
export HOME=/data/data/com.termux/files/home
BIN=$HOME/gdn_k2/bin_mld
LOG=$HOME/gdn_k2/mld_m1/logs
MODEL=$HOME/gdn_k2/models/Qwen3.5-2B-Q4_K_M.gguf
export LD_LIBRARY_PATH=$BIN:/vendor/lib64
mkdir -p "$LOG"
chmod +x $BIN/llama-cli $BIN/llama-bench $BIN/test-backend-ops
batt() { echo "=== battery $1 $(date -Iseconds) ==="; termux-battery-status; }

{
  echo "=== sha256 ==="
  sha256sum $BIN/llama-cli $BIN/llama-bench $BIN/test-backend-ops $BIN/libc++_shared.so
  batt start
} | tee $LOG/measure_setup.txt

# Correctness: MLD on (flat GEMV) for 2B FFN shapes + square + n=4
{
  batt before_corr
  for p in 'm=2048,n=1,k=2048' 'm=6144,n=1,k=2048' 'm=2048,n=1,k=6144' 'm=2048,n=4,k=2048'; do
    echo "=== CORR MLD=1 $p ==="
    GGML_OPENCL_MLD_GEMV=1 $BIN/test-backend-ops test -b GPUOpenCL -o MUL_MAT -p "$p"
    echo exit=$?
  done
  batt after_corr
} 2>&1 | tee $LOG/corr_mld_flat.txt

# Microbench: noshuffle (env off) vs MLD-flat (env on)
{
  batt before_perf_off
  echo "=== PERF env OFF (noshuffle) ==="
  $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=2048,n=1,k=2048'
  $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=6144,n=1,k=2048'
  $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=2048,n=1,k=6144'
  $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=4096,n=1,k=4096'
  $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=12288,n=1,k=4096'
  $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=4096,n=1,k=12288'
  batt after_perf_off
} 2>&1 | tee $LOG/perf_noshuffle.txt

{
  batt before_perf_on
  echo "=== PERF env ON (MLD SOA + flat GEMV) ==="
  GGML_OPENCL_MLD_GEMV=1 $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=2048,n=1,k=2048'
  GGML_OPENCL_MLD_GEMV=1 $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=6144,n=1,k=2048'
  GGML_OPENCL_MLD_GEMV=1 $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=2048,n=1,k=6144'
  GGML_OPENCL_MLD_GEMV=1 $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=4096,n=1,k=4096'
  GGML_OPENCL_MLD_GEMV=1 $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=12288,n=1,k=4096'
  GGML_OPENCL_MLD_GEMV=1 $BIN/test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p 'm=4096,n=1,k=12288'
  batt after_perf_on
} 2>&1 | tee $LOG/perf_mld_flat.txt

# Greedy A/B
{
  batt before_greedy_off
  echo "=== GREEDY env OFF ==="
  $BIN/llama-cli -m "$MODEL" -c 512 --temp 0 -s 42 -n 32 -no-cnv -st -ngl 99 -fa off -t 4 \
    -p "The capital of France is"
  batt after_greedy_off
} 2>&1 | tee $LOG/greedy_off.txt

{
  batt before_greedy_on
  echo "=== GREEDY env ON ==="
  GGML_OPENCL_MLD_GEMV=1 $BIN/llama-cli -m "$MODEL" -c 512 --temp 0 -s 42 -n 32 -no-cnv -st -ngl 99 -fa off -t 4 \
    -p "The capital of France is"
  batt after_greedy_on
} 2>&1 | tee $LOG/greedy_on.txt

# Short E2E tg snapshot (informative)
{
  batt before_bench_off
  echo "=== BENCH env OFF ==="
  $BIN/llama-bench -m "$MODEL" -ngl 99 -fa 0 -t 4 -p 128 -n 64 -r 2
  batt after_bench_off
} 2>&1 | tee $LOG/bench_off.txt

{
  batt before_bench_on
  echo "=== BENCH env ON ==="
  GGML_OPENCL_MLD_GEMV=1 $BIN/llama-bench -m "$MODEL" -ngl 99 -fa 0 -t 4 -p 128 -n 64 -r 2
  batt after_bench_on
} 2>&1 | tee $LOG/bench_on.txt

echo MEASURE_DONE
