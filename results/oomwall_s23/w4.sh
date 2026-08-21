#!/system/bin/sh
# W4: Mellum2 CPU-only (-ngl 0), STOCK llama-bench (extra_bufts=true).
# stderr must flow to adb (no redirect). Crash-risk — owner at power button.
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
  echo W4_PRE
  date; uptime
  echo '--- sha ---'
  sha256sum llama-bench libllama-bench-impl.so libllama.so libggml-opencl.so
  echo '--- batt ---'
  dumpsys battery 2>/dev/null | grep -E "USB powered|AC powered|^  status:|^  level:|^  temperature:" | head -6
  dumpsys power 2>/dev/null | grep mWakefulness=
  grep MemAvailable /proc/meminfo
} > logs/w4.pre
: > logs/w4.mem_poll
( while true; do grep MemAvailable /proc/meminfo; sleep 1; done ) >> logs/w4.mem_poll &
echo $! > logs/w4.mem_poll.pid
: > logs/w4.logcat
logcat -b all -f logs/w4.logcat &
echo $! > logs/w4.logcat.pid
echo W4_START
./llama-bench -m /data/local/tmp/s3oracle/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf \
  -ngl 0 -p 0 -n 16 -r 1 -t 4
RC=$?
kill "$(cat logs/w4.mem_poll.pid)" 2>/dev/null
kill "$(cat logs/w4.logcat.pid)" 2>/dev/null
echo W4_RC=$RC
exit $RC
