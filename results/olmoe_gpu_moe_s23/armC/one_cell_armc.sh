#!/system/bin/sh
# OLMoE arm C decision cell wrapper. Exploratory-registered, full gate discipline.
# Head-build binaries in s3oracle. Does NOT replace ship binaries.
# Usage: one_cell_armc.sh TAG [llama-bench arm flags...]
# Always: -nr -fa off -t 4 -o jsonl -p 0 -n 512 -r 1
cd /data/local/tmp/s3oracle || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_CVT_VARIANT
MODEL=/data/local/tmp/s3oracle/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf
TAG="$1"
shift
if [ -z "$TAG" ]; then
    echo "usage: one_cell_armc.sh TAG [arm flags]" >&2
    exit 91
fi
mkdir -p logs
OUT="logs/${TAG}.out"
ERR="logs/${TAG}.err"
RC="logs/${TAG}.rc"
rm -f "$RC"
./llama-bench -m "$MODEL" -nr -fa off -t 4 -o jsonl -p 0 -n 512 -r 1 "$@" > "$OUT" 2> "$ERR"
echo $? > "$RC"
