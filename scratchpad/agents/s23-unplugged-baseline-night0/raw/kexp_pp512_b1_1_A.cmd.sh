cd /data/local/tmp/s3oracle
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
exec taskset ff ./llama-bench -m /data/local/tmp/Marco-Mini-Instruct-KEXP.gguf -p 512 -n 0 -r 1 --no-warmup -t 8 -o jsonl -ngl 99 -nr -fa off
