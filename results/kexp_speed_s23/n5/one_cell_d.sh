#!/system/bin/sh
# Optional arm D (after the bag, NEVER ship). STOCK extra_bufts. NO -nr.
# Runs from /data/local/tmp/s18stock — never writes into s3oracle.
# Usage: one_cell_d.sh TAG
cd /data/local/tmp/s18stock || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s18stock
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_CVT_VARIANT
MODEL=/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf
TAG="$1"
if [ -z "$TAG" ]; then
    echo "usage: one_cell_d.sh TAG" >&2
    exit 91
fi
mkdir -p logs
OUT="logs/${TAG}.out"
ERR="logs/${TAG}.err"
RC="logs/${TAG}.rc"
rm -f "$RC"
./llama-bench -m "$MODEL" -fa off -t 4 -o jsonl -p 0 -n 512 -r 1 -ngl 0 > "$OUT" 2> "$ERR"
echo $? > "$RC"
