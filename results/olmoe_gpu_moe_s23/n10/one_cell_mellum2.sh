#!/system/bin/sh
# EXPLORATORY Mellum2 cell. Same frozen noextra+opencl pins as the OLMoE N>=5 ship cell.
# Not part of the 1.30x median. LOG_ALLOC unset. FA off from host.
cd /data/local/tmp/s3oracle || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
MODEL=/data/local/tmp/s3oracle/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf
exec ./llama-bench -m "$MODEL" -fa off -t 4 -o jsonl "$@"
