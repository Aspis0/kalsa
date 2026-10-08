# Device-side (QDC QRD8650 = SM8650, v75, Adreno 750; plugged = CORRECTNESS ONLY). Lab bench engine e01a61cee
# (09a496d71 + Adreno A7X decode KQV kept off kernel_mul_mat_f16_f32_l4_y8, the GPU-750 defect named by cells #67/#70).
# The SM8650 row of the owner's matrix, same arms as the 8 Elite's cell #66, NO env overrides:
#   G = two-copy reference logits (256); L = one copy, legs hop every 32 tokens (256); L-npu / L-gpu x3 / L-cpu = each
#   leg alone (128); A-gpu = plain OpenCL two-copy load; A-j1 = HTP0 + GPU two-copy (J(1) reference).
# Battery-temperature watchdog kills the bench at 45.0 C. Touches nothing outside $R.
#   sh /data/local/tmp/kalsa71/run-legs.sh
R=/data/local/tmp/kalsa71; M=$R/lfm26.gguf; B=$R/governor-bench; REPORT=$R/legs_report.txt; WS=$R/watchdog.stop
export ADSP_LIBRARY_PATH="$R"
shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"
}
bt() { dumpsys battery | grep -m1 '  temperature:' | grep -oE '[0-9]+'; }
rm -f $REPORT $WS
echo "== legs start $(date) soc=$(getprop ro.soc.model) model=$(getprop ro.product.model) bench $(sha256sum $B | cut -c1-12) batT=$(bt)" >> $REPORT
( while [ ! -e $WS ]; do
    t=$(bt); [ -n "$t" ] && [ "$t" -ge 450 ] && pgrep -f governor-bench > /dev/null && {
      pkill -f governor-bench; echo "WATCHDOG: battery $t >= 450, bench killed $(date)" >> $REPORT; }
    sleep 3
  done ) &
cd $R
run() {
  n=$1; shift
  "$@" > $R/$n.log 2>&1; rc=$?
  echo "## $n exit=$rc batT=$(bt)" >> $REPORT
  grep -E 'ggml_opencl: device:|OpenCL driver|TILE32 gate|TILE32 leg|Arch version|self-check .*FAIL|^leg_summary|^leg_total|^kld|refus|GGML_ABORT|node dump|error' \
    $R/$n.log | sed -E 's/ us=[0-9]+//' | cut -c1-240 >> $REPORT
  [ -f $R/$n.dump ] && echo "dump lines: $(wc -l < $R/$n.dump)" >> $REPORT
  sleep 30
}
REF="--logits-ref $R/twocopy.gbl --kld-max 0.01"
run G       $B --arm G -m $M -t 5 -r 1 --gen 256 --logits-out $R/twocopy.gbl -v
run L       shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 256 $REF -v
run L-npu   shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs npu $REF -v
run L-gpu   shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF -v
run L-gpu2  shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF -v
run L-gpu3  shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF -v
run L-cpu   shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs cpu $REF -v
run A-gpu   $B --arm A --dev GPUOpenCL -m $M -t 5 -r 1 --gen 128 $REF -v
run A-j1    shared $B --arm A --dev HTP0,GPUOpenCL -m $M -t 5 -r 1 --gen 128 $REF -v
touch $WS
echo "== legs end $(date) batT=$(bt)" >> $REPORT
