#!/system/bin/sh
# HTP pp512 nseq=1 (llama-bench has no --n-seq; default is 1 sequence.
# Hexagon quantized MUL_MAT requires src1->ne[2]==1 && ne[3]==1.)
cd /data/local/tmp/kalsahtp || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64
export ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp
export CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp
export GGML_HEXAGON_NDEV=1
# HOSTBUF=1 is for test-backend-ops only (q30). Quantized MUL_MAT inference
# requires REPACK buffers; HOSTBUF=1 forces host buffers and silently CPU-falls back.
unset GGML_HEXAGON_HOSTBUF
TAG=$1
VERBOSE=$2
shift 2
mkdir -p logs
if [ "$VERBOSE" = "1" ]; then
  export GGML_HEXAGON_VERBOSE=1
else
  unset GGML_HEXAGON_VERBOSE
fi
echo "tag=$TAG verbose=$VERBOSE" > "logs/${TAG}.meta"
echo "env LD_LIBRARY_PATH=$LD_LIBRARY_PATH" >> "logs/${TAG}.meta"
echo "env ADSP_LIBRARY_PATH=$ADSP_LIBRARY_PATH" >> "logs/${TAG}.meta"
echo "env GGML_HEXAGON_HOSTBUF=${GGML_HEXAGON_HOSTBUF:-unset}" >> "logs/${TAG}.meta"
echo "env GGML_HEXAGON_VERBOSE=${GGML_HEXAGON_VERBOSE:-}" >> "logs/${TAG}.meta"
echo "cmd=./llama-bench $*" >> "logs/${TAG}.meta"
./llama-bench "$@" > "logs/${TAG}.out" 2> "logs/${TAG}.err"
echo $? > "logs/${TAG}.rc"
