#!/system/bin/sh
# One-shot HTP -n 0 capture (unique files). LF-only.
BASE=/data/local/tmp/kalsa_q48/n0
BINDIR=/data/local/tmp/kalsahtp
MODEL=/data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf
mkdir -p "$BASE"
cd "$BINDIR" || exit 90
export LD_LIBRARY_PATH="$BINDIR:/vendor/lib64:/system/vendor/lib64:/system/lib64"
export ADSP_LIBRARY_PATH="$BINDIR"
export CDSP_LIBRARY_PATH="$BINDIR"
export GGML_HEXAGON_NDEV=1
export GGML_HEXAGON_VERBOSE=1
unset GGML_HEXAGON_HOSTBUF
{
    echo ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    dumpsys battery | grep -E "powered|^  level:|^  temperature:|^  status:|Charge counter:|^  voltage:"
} > "$BASE/charge_pre.txt"
./llama-bench -m "$MODEL" -p 512 -n 0 -r 2 --no-warmup -ngl 99 -dev HTP0 -o jsonl -oe jsonl --progress --load-mode none -fa on --ubatch-size 1024 > "$BASE/stdout.jsonl" 2> "$BASE/stderr.txt"
echo $? > "$BASE/rc.txt"
{
    echo ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    dumpsys battery | grep -E "powered|^  level:|^  temperature:|^  status:|Charge counter:|^  voltage:"
} > "$BASE/charge_post.txt"
echo DONE rc=$(cat "$BASE/rc.txt") stdout=$(wc -c < "$BASE/stdout.jsonl") stderr=$(wc -c < "$BASE/stderr.txt")
