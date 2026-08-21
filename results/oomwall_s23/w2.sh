#!/system/bin/sh
# W2: LFM2.5-KEXP ngl=99 — known-good size class. stderr flows to adb (no redirect).
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
  echo W2_PRE
  date; uptime
  sha256sum libggml-opencl.so
  dumpsys battery 2>/dev/null | grep -E "USB powered|AC powered|^  status:|^  level:|^  temperature:" | head -6
  dumpsys power 2>/dev/null | grep mWakefulness=
  grep MemAvailable /proc/meminfo
} > logs/w2.pre
: > logs/w2.mem_poll
( while true; do grep MemAvailable /proc/meminfo; sleep 1; done ) >> logs/w2.mem_poll &
echo $! > logs/w2.mem_poll.pid
./llama-bench -m /data/local/tmp/s3oracle/LFM2.5-8B-A1B-KEXP.gguf \
  -ngl 99 -p 0 -n 16 -r 1 -t 4
RC=$?
kill "$(cat logs/w2.mem_poll.pid)" 2>/dev/null
echo W2_RC=$RC
exit $RC
