#!/system/bin/sh
# Vulkan llama-bench cell. MODEL_PATH extra args from host.
# -nr / -ngl / -p / -n supplied by the caller.
cd /data/local/tmp/s15vk || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/s15vk
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_LOG_KERNELS
unset GGML_VK_VISIBLE_DEVICES
# Upstream b11304 renamed -nr to --repack <0|1>; the binary's help says which it speaks.
if ./llama-bench --help 2>&1 | grep -q -e '--repack'; then NR_FLAG='--repack 0'; else NR_FLAG='-nr'; fi
exec ./llama-bench -fa off -t 4 $NR_FLAG -o jsonl "$@"
