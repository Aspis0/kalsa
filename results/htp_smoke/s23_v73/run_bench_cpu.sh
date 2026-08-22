#!/system/bin/sh
# CPU-only: keep libggml-hexagon.so (NEEDED by llama-bench) but do not
# pass -dev HTP0 and use -ngl 0 so layers stay on CPU.
cd /data/local/tmp/kalsahtp || exit 90
if [ -f libggml-hexagon.so.off ] && [ ! -f libggml-hexagon.so ]; then
  mv libggml-hexagon.so.off libggml-hexagon.so
fi
export LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64
# DSP libs present so the linked backend can init; ngl 0 should not offload.
export ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp
export CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp
export GGML_HEXAGON_NDEV=1
unset GGML_HEXAGON_VERBOSE
unset GGML_HEXAGON_HOSTBUF
TAG=$1
shift
mkdir -p logs
echo "tag=$TAG cpu_only=1 ngl=0 no_-dev_HTP0" > "logs/${TAG}.meta"
echo "env LD_LIBRARY_PATH=$LD_LIBRARY_PATH" >> "logs/${TAG}.meta"
echo "cmd=./llama-bench $*" >> "logs/${TAG}.meta"
./llama-bench "$@" > "logs/${TAG}.out" 2> "logs/${TAG}.err"
echo $? > "logs/${TAG}.rc"
