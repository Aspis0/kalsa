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
exec ./llama-bench -fa off -t 4 -nr -o jsonl "$@"
