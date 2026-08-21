#!/system/bin/sh
# K2 phase1 runner. Args: TAG PARAMS_REGEX
# Env: set GGML_OPENCL_MOE_OPTS / GGML_OPENCL_CVT_OPTS in the adb shell before calling
# if the experiment needs them. This script never exports HOST_REPACK/DUMP_Q.
set -e
TAG="$1"
PAT="$2"
DST=/data/local/tmp/s3oracle
cd "$DST"
mkdir -p "$DST/logs"
export LD_LIBRARY_PATH="$DST"
export GGML_OPENCL_LOG_KERNELS=1
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_CVT_VARIANT
# CVT_OPTS / MOE_OPTS: leave whatever the caller exported; if caller did not
# export them, make sure they are unset (presence of empty is still a set).
if [ -z "${GGML_OPENCL_CVT_OPTS+x}" ]; then unset GGML_OPENCL_CVT_OPTS; fi
if [ -z "${GGML_OPENCL_MOE_OPTS+x}" ]; then unset GGML_OPENCL_MOE_OPTS; fi

OUT="$DST/logs/${TAG}.out"
ERR="$DST/logs/${TAG}.err"
{
  echo "=== K2 RUN tag=$TAG ==="
  date
  echo "PWD=$(pwd)"
  echo "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
  echo "GGML_OPENCL_LOG_KERNELS=$GGML_OPENCL_LOG_KERNELS"
  echo "GGML_OPENCL_MOE_OPTS=${GGML_OPENCL_MOE_OPTS-<unset>}"
  echo "GGML_OPENCL_CVT_OPTS=${GGML_OPENCL_CVT_OPTS-<unset>}"
  echo "GGML_OPENCL_HOST_REPACK=${GGML_OPENCL_HOST_REPACK-<unset>}"
  echo "GGML_OPENCL_DUMP_Q=${GGML_OPENCL_DUMP_Q-<unset>}"
  echo "GGML_OPENCL_ORACLE=${GGML_OPENCL_ORACLE-<unset>}"
  echo "CMD=./test-backend-ops -o MUL_MAT_ID -p $PAT"
  echo "=== sha libggml-opencl.so ==="
  sha256sum libggml-opencl.so
} > "$OUT"

set +e
if [ -n "$PAT" ]; then
  ./test-backend-ops -o MUL_MAT_ID -p "$PAT" >> "$OUT" 2> "$ERR"
  RC=$?
else
  ./test-backend-ops -o MUL_MAT_ID >> "$OUT" 2> "$ERR"
  RC=$?
fi
echo "=== rc=$RC ===" >> "$OUT"
date >> "$OUT"
exit 0
