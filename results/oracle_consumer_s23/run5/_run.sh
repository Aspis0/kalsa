#!/system/bin/sh
cd /data/local/tmp/s3oracle || exit 1
echo "CPSET=$(cat /proc/self/cpuset)"
echo "HOST_REPACK=[${GGML_OPENCL_HOST_REPACK-unset}]"
echo "GEMV_AUDIT=[${GGML_OPENCL_GEMV_AUDIT-unset}]"
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
export GGML_OPENCL_HOST_REPACK=1
export GGML_OPENCL_GEMV_AUDIT=1
echo "HOST_REPACK_SET=[${GGML_OPENCL_HOST_REPACK}]"
echo "GEMV_AUDIT_SET=[${GGML_OPENCL_GEMV_AUDIT}]"
chmod +x test-backend-ops
./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q4_0.*,n=1,k='
echo "EXIT=$?"
