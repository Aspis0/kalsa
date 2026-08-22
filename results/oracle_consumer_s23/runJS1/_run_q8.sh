#!/system/bin/sh
cd /data/local/tmp/s3judge || exit 1
echo "CPSET=$(cat /proc/self/cpuset)"
export LD_LIBRARY_PATH=/data/local/tmp/s3judge
export GGML_OPENCL_HOST_REPACK=1
echo "HOST_REPACK_SET=[${GGML_OPENCL_HOST_REPACK}]"
chmod +x test-backend-ops
./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q8_0'
echo "EXIT=$?"
