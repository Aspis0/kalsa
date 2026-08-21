#!/system/bin/sh
# GEMM m=96 n=4 padding discriminators. Never HOST_REPACK/DUMP_Q.
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
OUT="$DST/logs/s4_gemm96.out"
ERR="$DST/logs/s4_gemm96.err"
{
  echo "=== S4 GEMM m=96 n=4 MUL_MAT_ID ==="
  date
  echo "LOG_KERNELS=1 HOST_REPACK unset DUMP_Q unset"
  echo "CMD=./test-backend-ops -o MUL_MAT_ID"
  sha256sum libggml-opencl.so test-backend-ops
} > "$OUT"
set +e
./test-backend-ops -o MUL_MAT_ID >> "$OUT" 2> "$ERR"
RC=$?
echo "=== rc=$RC ===" >> "$OUT"
date >> "$OUT"
exit $RC
