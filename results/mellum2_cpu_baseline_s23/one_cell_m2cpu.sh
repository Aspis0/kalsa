#!/system/bin/sh
# Queue #23 — Mellum2 llama-bench mmap CPU baseline.
# Same n10 load-sanity shape (-fa off -t 4 -o jsonl -p 0 -n 16 -r 1) with -ngl 0 -nr.
# HEAD s3oracle binaries. Model lives in _gguf_keep (not copied into s3oracle).
cd /data/local/tmp/s3oracle || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_CVT_VARIANT
MODEL=/data/local/tmp/_gguf_keep/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf
TAG="$1"
shift
if [ -z "$TAG" ]; then
    echo "usage: one_cell_m2cpu.sh TAG" >&2
    exit 91
fi
mkdir -p logs
OUT="logs/${TAG}.out"
ERR="logs/${TAG}.err"
RC="logs/${TAG}.rc"
rm -f "$RC"
./llama-bench -m "$MODEL" -nr -fa off -t 4 -o jsonl -p 0 -n 16 -r 1 -ngl 0 "$@" > "$OUT" 2> "$ERR"
echo $? > "$RC"
