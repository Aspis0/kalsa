#!/system/bin/sh
# Gate #26b OpenCL runner. Usage: sh run_ocl2.sh TAG [args...]
# PLUGGED correctness + order-of-magnitude. GGML_OPENCL_ALLOW_UNKNOWN_GPU=1
TAG="$1"
shift
DIR=/data/local/tmp/kalsa26/ocl2
OUT="$DIR/logs/${TAG}.out"
ERR="$DIR/logs/${TAG}.err"
cd "$DIR" || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/kalsa26/ocl2
export GGML_OPENCL_ALLOW_UNKNOWN_GPU=1
{
  echo "=== OCL2 tag=$TAG PLUGGED GGML_OPENCL_ALLOW_UNKNOWN_GPU=$GGML_OPENCL_ALLOW_UNKNOWN_GPU ==="
  date
  echo "PWD=$PWD"
  echo "LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
  echo "CMD=$*"
} > "$OUT"
"$@" >> "$OUT" 2> "$ERR"
rc=$?
{
  echo "=== rc=$rc ==="
  date
} >> "$OUT"
echo "$rc" > "$DIR/logs/${TAG}.rc"
exit $rc
