#!/system/bin/sh
# Vulkan runner for kalsa26. Usage: sh run_vk.sh TAG [args...]
TAG="$1"
shift
DIR=/data/local/tmp/kalsa26/vk
OUT="$DIR/logs/${TAG}.out"
ERR="$DIR/logs/${TAG}.err"
cd "$DIR" || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/kalsa26/vk
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_LOG_KERNELS
{
  echo "=== VK tag=$TAG PLUGGED ==="
  date
  echo "PWD=$PWD"
  echo "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
  echo "CMD=$*"
} > "$OUT"
"$@" >> "$OUT" 2> "$ERR"
rc=$?
{
  echo "=== rc=$rc ==="
  date
} >> "$OUT"
echo "$rc" > "$DIR/logs/${TAG}.rc"
exit $rc
