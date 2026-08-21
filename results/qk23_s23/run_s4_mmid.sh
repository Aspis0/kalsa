#!/system/bin/sh
# S4 MUL_MAT_ID full. Never export HOST_REPACK / DUMP_Q.
DST=/data/local/tmp/s3oracle
cd "$DST" || exit 90
export LD_LIBRARY_PATH="$DST"
export GGML_OPENCL_LOG_KERNELS=1
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_VARIANT
unset GGML_OPENCL_LOG_ALLOC
mkdir -p "$DST/logs"
OUT="$DST/logs/s4_mmid.out"
ERR="$DST/logs/s4_mmid.err"
{
  echo "=== S4 MUL_MAT_ID ==="
  date
  echo "PWD=$(pwd)"
  echo "LOG_KERNELS=$GGML_OPENCL_LOG_KERNELS"
  echo "HOST_REPACK=${GGML_OPENCL_HOST_REPACK-<unset>}"
  echo "DUMP_Q=${GGML_OPENCL_DUMP_Q-<unset>}"
  echo "CMD=./test-backend-ops -o MUL_MAT_ID"
  sha256sum libggml-opencl.so test-backend-ops
} > "$OUT"
set +e
./test-backend-ops -o MUL_MAT_ID >> "$OUT" 2> "$ERR"
RC=$?
echo "=== rc=$RC ===" >> "$OUT"
date >> "$OUT"
exit $RC
