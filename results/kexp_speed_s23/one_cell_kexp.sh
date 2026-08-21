#!/system/bin/sh
# EXPLORATORY KEXP-on-GPU speed cell. NOT ship. NOT part of OLMoE N>=5 median.
# OpenCL must be the q6k cherry pin b9d99fa8 (q2_K/q3_K MoE + q6_K dense fix).
# extra_bufts: noextra impl d2030f23 (stock forbidden). LOG_ALLOC unset. FA off from host.
cd /data/local/tmp/s3oracle || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
MODEL=/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf
exec ./llama-bench -m "$MODEL" -fa off -t 4 -o jsonl "$@"
