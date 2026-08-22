#!/system/bin/sh
cd /data/local/tmp/s3norepack || exit 1
echo "CPSET=$(cat /proc/self/cpuset)"
export LD_LIBRARY_PATH=/data/local/tmp/s3norepack
export GGML_OPENCL_HOST_REPACK=1
unset GGML_OPENCL_GEMV_AUDIT
echo "HOST_REPACK_SET=[${GGML_OPENCL_HOST_REPACK}]"
chmod +x test-backend-ops
echo "===== 12-case q4_0 n=1 ====="
./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q4_0.*,n=1,k='
echo "EXIT12=$?"
echo "===== q8_0 control ====="
./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q8_0'
echo "EXIT8=$?"
echo "===== q6_K control ====="
./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q6_K'
echo "EXIT6=$?"