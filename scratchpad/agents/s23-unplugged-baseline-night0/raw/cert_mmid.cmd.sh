cd /data/local/tmp/s3oracle
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
exec taskset ff ./test-backend-ops -o MUL_MAT_ID
