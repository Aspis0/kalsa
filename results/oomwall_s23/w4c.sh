#!/system/bin/sh
# W4c: Mellum2 W1 config (-ngl 2 -ncmoe 99) with NOEXTRA llama-bench
# (libllama-bench-impl.so sha d2030f23…, use_extra_bufts=false).
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
  echo W4C_PRE
  date; uptime
  echo '--- sha ---'
  sha256sum llama-bench libllama-bench-impl.so libllama.so libggml-opencl.so
  echo '--- batt ---'
  dumpsys battery 2>/dev/null | grep -E "USB powered|AC powered|^  status:|^  level:|^  temperature:" | head -6
  dumpsys power 2>/dev/null | grep mWakefulness=
  grep MemAvailable /proc/meminfo
} > logs/w4c.pre
: > logs/w4c.mem_poll
( while true; do grep MemAvailable /proc/meminfo; sleep 1; done ) >> logs/w4c.mem_poll &
echo $! > logs/w4c.mem_poll.pid
: > logs/w4c.logcat
logcat -b all -f logs/w4c.logcat &
echo $! > logs/w4c.logcat.pid
echo W4C_START
./llama-bench -m /data/local/tmp/s3oracle/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf \
  -ngl 2 -ncmoe 99 -p 0 -n 16 -r 1 -t 4
RC=$?
kill "$(cat logs/w4c.mem_poll.pid)" 2>/dev/null
kill "$(cat logs/w4c.logcat.pid)" 2>/dev/null
echo W4C_RC=$RC
exit $RC
