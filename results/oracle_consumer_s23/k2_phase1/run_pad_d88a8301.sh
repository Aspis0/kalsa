#!/system/bin/sh
cd /data/local/tmp/s3oracle || exit 90
sha256sum libggml-opencl.so > pad_d88a8301.sha
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
export GGML_OPENCL_LOG_KERNELS=1
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_MOE_OPTS
./test-backend-ops -o PAD >/dev/null 2>pad_d88a8301.err
echo $? > pad_d88a8301.rc
