#!/system/bin/sh
cd /data/local/tmp/kalsa16 || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/kalsa16
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_CVT_VARIANT
MODEL=/data/local/tmp/gdn_750/taskb/Marco-Mini-Instruct-KEXP.gguf
TAG=$1
shift
if [ -z "$TAG" ]; then
  echo "usage: one_cell_d2.sh TAG [arm flags]" >&2
  exit 91
fi
mkdir -p logs
OUT="logs/${TAG}.out"
ERR="logs/${TAG}.err"
RC="logs/${TAG}.rc"
rm -f "$RC"
taskset ff ./llama-bench -m "$MODEL" -nr -fa off -t 4 -o jsonl -p 128 -n 128 -r 1 "$@" > "$OUT" 2> "$ERR"
echo $? > "$RC"