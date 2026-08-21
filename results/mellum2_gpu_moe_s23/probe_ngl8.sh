#!/system/bin/sh
# EXPLORATORY probe: ngl=8 load+tiny bench
cd /data/local/tmp/s3oracle || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
export GGML_OPENCL_LOG_KERNELS=1
sha256sum libggml-opencl.so > /data/local/tmp/s3oracle/logs/probe_ngl8.sha
dumpsys battery 2>/dev/null | grep -E "USB powered|AC powered|Wireless powered|status:|level:|temperature:" | head -20 > /data/local/tmp/s3oracle/logs/probe_ngl8.batt_pre
dumpsys power 2>/dev/null | grep mWakefulness= > /data/local/tmp/s3oracle/logs/probe_ngl8.power_pre
grep -E "MemFree|MemAvailable" /proc/meminfo > /data/local/tmp/s3oracle/logs/probe_ngl8.mem_pre
: > /data/local/tmp/s3oracle/logs/probe_ngl8.mem_poll
( while true; do grep MemAvailable /proc/meminfo; sleep 1; done ) >> /data/local/tmp/s3oracle/logs/probe_ngl8.mem_poll &
MPID=$!
./llama-bench -m /data/local/tmp/s3oracle/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf \
  -ngl 8 -p 32 -n 16 -r 1 -t 4 -o csv \
  > /data/local/tmp/s3oracle/logs/probe_ngl8.csv 2> /data/local/tmp/s3oracle/logs/probe_ngl8.err
echo $? > /data/local/tmp/s3oracle/logs/probe_ngl8.rc
kill $MPID 2>/dev/null
dumpsys battery 2>/dev/null | grep -E "USB powered|AC powered|Wireless powered|status:|level:|temperature:" | head -20 > /data/local/tmp/s3oracle/logs/probe_ngl8.batt_post
dumpsys power 2>/dev/null | grep mWakefulness= > /data/local/tmp/s3oracle/logs/probe_ngl8.power_post
grep -E "MemFree|MemAvailable" /proc/meminfo > /data/local/tmp/s3oracle/logs/probe_ngl8.mem_post
