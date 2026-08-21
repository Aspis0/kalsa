#!/system/bin/sh
DST=/data/local/tmp/s3oracle
cd "$DST" || exit 90
export LD_LIBRARY_PATH="$DST"
export GGML_OPENCL_LOG_WEIGHT_PATH=1
export GGML_OPENCL_QK23_ORACLE=1
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_VARIANT
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_LOG_KERNELS
mkdir -p "$DST/logs"
OUT="$DST/logs/s4_rt_oracle.out"
ERR="$DST/logs/s4_rt_oracle.err"
{
  echo "=== S4 roundtrip + QK23 oracle ==="
  date
  echo "QK23_ORACLE=1 LOG_WEIGHT_PATH=1"
  echo "HOST_REPACK unset DUMP_Q unset"
  sha256sum libggml-opencl.so test-opencl-moe-roundtrip
} > "$OUT"
set +e
./test-opencl-moe-roundtrip >> "$OUT" 2> "$ERR"
RC=$?
echo "=== rc=$RC ===" >> "$OUT"
date >> "$OUT"
exit $RC
