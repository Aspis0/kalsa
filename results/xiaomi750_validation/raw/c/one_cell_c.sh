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
MODEL=/data/local/tmp/gdn_750/Qwen3.5-2B-Q4_K_M.gguf
TAG=$1
shift
if [ -z "$TAG" ]; then
  echo "usage: one_cell_c.sh TAG [flags]" >&2
  exit 91
fi
mkdir -p logs
OUT="logs/${TAG}.out"
ERR="logs/${TAG}.err"
RC="logs/${TAG}.rc"
rm -f "$RC"
taskset ff ./llama-bench -m "$MODEL" -fa off -t 6 -o jsonl "$@" > "$OUT" 2> "$ERR"
echo $? > "$RC"