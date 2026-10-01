#!/system/bin/sh
# KEXP N>=5 ship cell wrapper. Protocol v1.2. Lock 618323c.
# -nr/--repack 0 MANDATORY. LOG_ALLOC unset. Does not replace ship binaries.
# Usage: one_cell_n5.sh TAG [llama-bench arm flags...]
# Always: -nr/--repack 0 -fa off -t 4 -o jsonl -p 0 -n 512 -r 1
cd /data/local/tmp/s3oracle || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_CVT_VARIANT
MODEL=/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf
TAG="$1"
shift
if [ -z "$TAG" ]; then
    echo "usage: one_cell_n5.sh TAG [arm flags]" >&2
    exit 91
fi
mkdir -p logs
OUT="logs/${TAG}.out"
ERR="logs/${TAG}.err"
RC="logs/${TAG}.rc"
rm -f "$RC"
# Upstream b11304 renamed -nr to --repack <0|1>; the binary's help says which it speaks.
if ./llama-bench --help 2>&1 | grep -q -e '--repack'; then NR_FLAG='--repack 0'; else NR_FLAG='-nr'; fi
./llama-bench -m "$MODEL" $NR_FLAG -fa off -t 4 -o jsonl -p 0 -n 512 -r 1 "$@" > "$OUT" 2> "$ERR"
echo $? > "$RC"
