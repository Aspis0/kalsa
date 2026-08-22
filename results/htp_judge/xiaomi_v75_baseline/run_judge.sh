#!/system/bin/sh
cd /data/local/tmp/kalsahtp || exit 90
export LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64
export ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp
export CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp
export GGML_HEXAGON_NDEV=1
export GGML_HEXAGON_VERBOSE=1
export GGML_HEXAGON_HOSTBUF=1
mkdir -p logs
TAG=judge_quant_mulmat
echo "start=$(date)" > logs/${TAG}.meta
echo "cmd=./test-backend-ops test -b HTP0 -o MUL_MAT -p type_a=(q4_0|q4_1|q8_0|mxfp4|iq4_nl)" >> logs/${TAG}.meta
echo "env LD_LIBRARY_PATH=$LD_LIBRARY_PATH" >> logs/${TAG}.meta
echo "env ADSP_LIBRARY_PATH=$ADSP_LIBRARY_PATH" >> logs/${TAG}.meta
echo "GGML_HEXAGON_NDEV=$GGML_HEXAGON_NDEV VERBOSE=$GGML_HEXAGON_VERBOSE HOSTBUF=$GGML_HEXAGON_HOSTBUF" >> logs/${TAG}.meta
./test-backend-ops test -b HTP0 -o MUL_MAT -p 'type_a=(q4_0|q4_1|q8_0|mxfp4|iq4_nl)' > logs/${TAG}.out 2> logs/${TAG}.err
rc=$?
echo $rc > logs/${TAG}.rc
echo "end=$(date)" >> logs/${TAG}.meta
echo "rc=$rc" >> logs/${TAG}.meta
exit $rc