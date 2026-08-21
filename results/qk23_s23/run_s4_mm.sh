#!/system/bin/sh
DST=/data/local/tmp/s3oracle
cd "$DST" || exit 90
export LD_LIBRARY_PATH="$DST"
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_VARIANT
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_LOG_KERNELS
mkdir -p "$DST/logs"
OUT="$DST/logs/s4_mm.out"
ERR="$DST/logs/s4_mm.err"
{
  echo "=== S4 MUL_MAT ==="
  date
  sha256sum libggml-opencl.so test-backend-ops
  echo "CMD=./test-backend-ops -o MUL_MAT"
} > "$OUT"
set +e
./test-backend-ops -o MUL_MAT >> "$OUT" 2> "$ERR"
RC=$?
echo "=== rc=$RC ===" >> "$OUT"
date >> "$OUT"
exit $RC
