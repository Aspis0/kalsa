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
OUT="$DST/logs/e4_dense.out"
ERR="$DST/logs/e4_dense.err"
{
  echo "=== K2 RUN tag=e4_dense ==="
  date
  echo "GGML_OPENCL_MOE_OPTS=${GGML_OPENCL_MOE_OPTS-<unset>}"
  echo "GGML_OPENCL_CVT_OPTS=${GGML_OPENCL_CVT_OPTS-<unset>}"
  echo "GGML_OPENCL_HOST_REPACK=${GGML_OPENCL_HOST_REPACK-<unset>}"
  echo "CMD=./test-backend-ops -o MUL_MAT -p type_a=q4_K.*m=131072"
  sha256sum libggml-opencl.so
} > "$OUT"
set +e
./test-backend-ops -o MUL_MAT -p 'type_a=q4_K.*m=131072' >> "$OUT" 2> "$ERR"
echo "=== rc=$? ===" >> "$OUT"
date >> "$OUT"
