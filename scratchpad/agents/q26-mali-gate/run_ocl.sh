#!/system/bin/sh
# OpenCL one-shot runner for kalsa26. Usage: sh run_ocl.sh TAG [args...]
TAG="$1"
shift
DIR=/data/local/tmp/kalsa26/ocl
OUT="$DIR/logs/${TAG}.out"
ERR="$DIR/logs/${TAG}.err"
cd "$DIR" || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/kalsa26/ocl
{
  echo "=== OCL tag=$TAG PLUGGED ==="
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
