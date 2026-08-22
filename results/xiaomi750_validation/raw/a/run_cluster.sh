#!/system/bin/sh
cd /data/local/tmp/kalsa16 || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/kalsa16
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_CVT_VARIANT
mkdir -p logs
TAG=$1
if [ -z "$TAG" ]; then
  echo "usage: run_cluster.sh TAG" >&2
  exit 91
fi
OUT="logs/${TAG}.out"
ERR="logs/${TAG}.err"
RC="logs/${TAG}.rc"
rm -f "$RC"
# Isolate the 20-fail cluster: m=128 n=1 k=1056 k_v=2112
taskset ff ./test-backend-ops test -b GPUOpenCL -o MUL_MAT -p "m=128,n=1,k=1056" > "$OUT" 2> "$ERR"
echo $? > "$RC"