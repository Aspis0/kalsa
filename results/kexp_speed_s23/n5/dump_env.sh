#!/system/bin/sh
# Session-start LOG_ALLOC evidence. RAW dump first (no unsets) — that is the prereg archive.
echo "=== RAW printenv | grep GGML_OPENCL (before any unset; empty/absent = PASS) ==="
printenv | grep GGML_OPENCL || echo "NO_GGML_OPENCL_ENV_VARS"
echo "=== RAW GGML_OPENCL_LOG_ALLOC ==="
printenv | grep '^GGML_OPENCL_LOG_ALLOC=' || echo "GGML_OPENCL_LOG_ALLOC is unset"
echo "=== RAW printenv | grep GGML (all) ==="
printenv | grep GGML || echo "NO_GGML_ENV_VARS"
echo "=== RAW printenv (full) ==="
printenv
echo "=== AFTER cell-matching unsets (informational, not the prereg evidence) ==="
cd /data/local/tmp/s3oracle || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_CVT_VARIANT
printenv | grep GGML_OPENCL || echo "NO_GGML_OPENCL_ENV_VARS_AFTER_UNSET"
