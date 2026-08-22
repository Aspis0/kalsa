#!/system/bin/sh
cd /data/local/tmp/kalsahtp || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64
export ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp
export CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp
export GGML_HEXAGON_NDEV=1
export GGML_HEXAGON_VERBOSE=1
export GGML_HEXAGON_HOSTBUF=1
unset GGML_OPENCL_LOG_ALLOC
TAG=$1
shift
if [ -z "$TAG" ]; then
  echo "usage: run_htp.sh TAG [args]" >&2
  exit 91
fi
echo "env LD_LIBRARY_PATH=$LD_LIBRARY_PATH" > "logs/${TAG}.meta"
echo "env ADSP_LIBRARY_PATH=$ADSP_LIBRARY_PATH" >> "logs/${TAG}.meta"
echo "cmd=./test-backend-ops $*" >> "logs/${TAG}.meta"
mkdir -p logs
./test-backend-ops "$@" > "logs/${TAG}.out" 2> "logs/${TAG}.err"
echo $? > "logs/${TAG}.rc"