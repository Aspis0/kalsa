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
OP=$1
BE=$2
if [ -z "$OP" ]; then
  echo "usage: run_ops.sh OP [BACKEND]" >&2
  exit 91
fi
if [ -z "$BE" ]; then
  BE=GPUOpenCL
fi
OUT="logs/${OP}.out"
ERR="logs/${OP}.err"
RC="logs/${OP}.rc"
rm -f "$RC"
echo "backend=$BE op=$OP" > "logs/${OP}.meta"
taskset ff ./test-backend-ops test -b "$BE" -o "$OP" > "$OUT" 2> "$ERR"
echo $? > "$RC"