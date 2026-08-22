#!/system/bin/sh
set -eu
cd /data/local/tmp/s3oracle
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
export GGML_OPENCL_HOST_REPACK=1
export GGML_OPENCL_ORACLE=1
# prove exact env values (no trailing space)
printf 'ENV HOST_REPACK=[%s] ORACLE=[%s] cpuset=' "$GGML_OPENCL_HOST_REPACK" "$GGML_OPENCL_ORACLE"
cat /proc/self/cpuset 2>/dev/null || true
printf '\n'
chmod +x ./test-backend-ops
# adb-shell cpuset is already /. Toybox taskset wants hex without 0x.
if command -v taskset >/dev/null 2>&1; then
  exec taskset ff ./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p type_a=q4_0
else
  exec ./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p type_a=q4_0
fi
