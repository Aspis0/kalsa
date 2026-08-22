#!/system/bin/sh
# Vulkan test-backend-ops runner. Usage: sh run_vk_ops.sh TAG [args...]
TAG="$1"
shift
DIR=/data/local/tmp/s15vk
OUT="$DIR/logs/${TAG}.out"
ERR="$DIR/logs/${TAG}.err"
cd "$DIR" || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s15vk
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_LOG_KERNELS
{
  echo "=== VK SANITY tag=$TAG ==="
  date
  echo "PWD=$PWD"
  echo "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
  echo "CMD=$*"
  echo "=== sha256 before run ==="
  sha256sum libggml-vulkan.so libggml.so libggml-base.so libggml-cpu.so libllama.so libllama-common.so test-backend-ops llama-bench libllama-bench-impl.so libc++_shared.so libomp.so
} > "$OUT"
"$@" >> "$OUT" 2> "$ERR"
rc=$?
{
  echo "=== rc=$rc ==="
  date
} >> "$OUT"
echo "$rc" > "$DIR/logs/${TAG}.rc"
exit $rc
