#!/system/bin/sh
# EXPLORATORY ngl=2 — one arm per invocation. Args: TAG extra-llama-bench-args...
# example: sh run_ngl2.sh A1
#          sh run_ngl2.sh B1 -ncmoe 99
TAG="$1"
shift
cd /data/local/tmp/s3oracle || exit 90
LOG=/data/local/tmp/s3oracle/logs
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
export GGML_OPENCL_LOG_KERNELS=1
mkdir -p "$LOG"
{
  echo "=== TAG=$TAG ==="
  echo "CMD=./llama-bench -m Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf -ngl 2 -p 0 -n 64 -r 1 -t 4 -o csv $*"
  date
  uptime
  sha256sum libggml-opencl.so
  dumpsys battery 2>/dev/null | grep -E "AC powered|USB powered|Wireless powered|^  status:|^  level:|^  temperature:" | head -8
  dumpsys power 2>/dev/null | grep mWakefulness=
  grep -E "MemFree|MemAvailable" /proc/meminfo
} > "$LOG/ngl2_${TAG}.pre"
: > "$LOG/ngl2_${TAG}.mem_poll"
( while true; do grep MemAvailable /proc/meminfo; sleep 1; done ) >> "$LOG/ngl2_${TAG}.mem_poll" &
MPID=$!
./llama-bench -m /data/local/tmp/s3oracle/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf \
  -ngl 2 -p 0 -n 64 -r 1 -t 4 -o csv "$@" \
  > "$LOG/ngl2_${TAG}.csv" 2> "$LOG/ngl2_${TAG}.err"
echo $? > "$LOG/ngl2_${TAG}.rc"
kill $MPID 2>/dev/null
wait $MPID 2>/dev/null
{
  echo "=== POST TAG=$TAG ==="
  date
  uptime
  dumpsys battery 2>/dev/null | grep -E "AC powered|USB powered|Wireless powered|^  status:|^  level:|^  temperature:" | head -8
  dumpsys power 2>/dev/null | grep mWakefulness=
  grep -E "MemFree|MemAvailable" /proc/meminfo
} > "$LOG/ngl2_${TAG}.post"
