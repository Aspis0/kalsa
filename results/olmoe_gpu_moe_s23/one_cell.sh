#!/system/bin/sh
# One llama-bench cell. Args: ARM ngl extra_args...
# extra_bufts is a property of libllama-bench-impl.so (must be noextra d2030f23).
# LOG_ALLOC must stay unset. FA off is passed by the host.
cd /data/local/tmp/s3oracle || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
MODEL=/data/local/tmp/s3oracle/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf
exec ./llama-bench -m "$MODEL" -fa off -t 4 -o jsonl "$@"
