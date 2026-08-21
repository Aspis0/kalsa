#!/system/bin/sh
# W1: Mellum2 ngl=2 experts FORCED CPU. stderr must flow to adb (no redirect).
cd /data/local/tmp/s3oracle || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
export GGML_OPENCL_LOG_ALLOC=1
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
mkdir -p logs
{
  echo W1_PRE
  date; uptime
  sha256sum libggml-opencl.so
  dumpsys battery 2>/dev/null | grep -E "USB powered|AC powered|^  status:|^  level:|^  temperature:" | head -6
  dumpsys power 2>/dev/null | grep mWakefulness=
  grep MemAvailable /proc/meminfo
} > logs/w1.pre
: > logs/w1.mem_poll
( while true; do grep MemAvailable /proc/meminfo; sleep 1; done ) >> logs/w1.mem_poll &
echo $! > logs/w1.mem_poll.pid
./llama-bench -m /data/local/tmp/s3oracle/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf \
  -ngl 2 -ncmoe 99 -p 0 -n 16 -r 1 -t 4
RC=$?
kill "$(cat logs/w1.mem_poll.pid)" 2>/dev/null
echo W1_RC=$RC
exit $RC
