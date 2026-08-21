#!/system/bin/sh
DST=/data/local/tmp/s3oracle
cd "$DST"
export LD_LIBRARY_PATH="$DST"
export GGML_OPENCL_LOG_KERNELS=1
export GGML_OPENCL_LOG_WEIGHT_PATH=1
export GGML_OPENCL_CVT_VARIANT=bytewise
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_MOE_OPTS
OUT="$DST/logs/e5fix_roundtrip.out"
ERR="$DST/logs/e5fix_roundtrip.err"
{
  echo "=== K2 RUN tag=e5fix_roundtrip ==="
  date
  echo "CVT_VARIANT=$GGML_OPENCL_CVT_VARIANT"
  echo "HOST_REPACK=${GGML_OPENCL_HOST_REPACK-<unset>}"
  echo "CMD=./test-opencl-moe-roundtrip"
  sha256sum libggml-opencl.so test-opencl-moe-roundtrip
} > "$OUT"
set +e
./test-opencl-moe-roundtrip >> "$OUT" 2> "$ERR"
echo "=== rc=$? ===" >> "$OUT"
date >> "$OUT"
