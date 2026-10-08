# Xiaomi (plugged, correctness only): is the GPU-leg KL FAIL a one-copy defect or Adreno 750 OpenCL numerics?
# Arm A = plain context. A-gpu: ordinary upstream OpenCL load (-dev GPUOpenCL, own buffers, no TILE32/HOST-W);
# A-j1: the one-copy J(1) device list {HTP0, GPUOpenCL} as a control. Both vs the same two-copy reference.
R=/data/local/tmp/govhtp-xiaomi; M=$R/model/ship.gguf; B=$R/bin/governor-bench; REPORT=$R/plaingpu_report.txt
export ADSP_LIBRARY_PATH="$R/dsp-rel"
shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"
}
rm -f $REPORT; cd $R
input keyevent 224
$B --arm A --dev GPUOpenCL -m $M -t 5 -r 1 --gen 128 --logits-ref $R/twocopy.gbl --kld-max 0.01 -v > $R/plain_A-gpu.log 2>&1
echo "## A-gpu exit=$?" >> $REPORT; grep -E '^kld|splits =|^turn arm=A rep=0 turn=0' $R/plain_A-gpu.log | cut -c1-220 >> $REPORT
sleep 45; input keyevent 224
shared $B --arm A --dev HTP0,GPUOpenCL -m $M -t 5 -r 1 --gen 128 --logits-ref $R/twocopy.gbl --kld-max 0.01 -v > $R/plain_A-j1.log 2>&1
echo "## A-j1 exit=$?" >> $REPORT; grep -E '^kld|splits =|^turn arm=A rep=0 turn=0' $R/plain_A-j1.log | cut -c1-220 >> $REPORT
echo "== end" >> $REPORT
