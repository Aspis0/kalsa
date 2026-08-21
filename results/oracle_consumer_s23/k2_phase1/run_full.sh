#!/system/bin/sh
DST=/data/local/tmp/s3oracle
cd "$DST"
export LD_LIBRARY_PATH="$DST"
export GGML_OPENCL_LOG_KERNELS=1
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_VARIANT
OUT="$DST/logs/e5fix_full.out"
ERR="$DST/logs/e5fix_full.err"
{
  echo "=== K2 RUN tag=e5fix_full ==="
  date
  echo "CMD=./test-backend-ops"
  sha256sum libggml-opencl.so
} > "$OUT"
set +e
./test-backend-ops >> "$OUT" 2> "$ERR"
echo "=== rc=$? ===" >> "$OUT"
date >> "$OUT"
