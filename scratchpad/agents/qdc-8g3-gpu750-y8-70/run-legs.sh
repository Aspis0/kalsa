# Device-side (QDC QRD8650 = SM8650, v75, Adreno 750; plugged = CORRECTNESS ONLY). Lab bench engine 09a496d71 (same
# kit binaries as cell #67). Cell #67 found the one-copy GPU leg's first nondeterministic node at token 0: kqv-2
# (MUL_MAT f16 V x f32 softmax, inputs bit-identical across runs). With kv size == n_kv (768) the V view is
# contiguous, so the op skips the Adreno kq/kqv path and lands on kernel_mul_mat_f16_f32_l4_y8; the plain two-copy
# load (kv 2048, V view non-contiguous) passes. GGML_OPENCL_MM_F16_FORCE_L4=1 routes that op to l4_dr instead.
#   G = two-copy reference logits (128); L-gpu x2 = baseline (expect FAIL); L-l4a/b/c = forced l4_dr (PASS x3 names
#   l4_y8 as the defect).
# Battery-temperature watchdog kills the bench at 45.0 C. Touches nothing outside $R.
#   sh /data/local/tmp/kalsa70/run-legs.sh
R=/data/local/tmp/kalsa70; M=$R/lfm26.gguf; B=$R/governor-bench; REPORT=$R/legs_report.txt; WS=$R/watchdog.stop
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
run G       $B --arm G -m $M -t 5 -r 1 --gen 128 --logits-out $R/twocopy.gbl -v
run L-gpu   shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF -v
run L-gpu2  shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF -v
run L-l4a   shared env GGML_OPENCL_MM_F16_FORCE_L4=1 $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF -v
run L-l4b   shared env GGML_OPENCL_MM_F16_FORCE_L4=1 $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF -v
run L-l4c   shared env GGML_OPENCL_MM_F16_FORCE_L4=1 $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF -v
touch $WS
echo "== legs end $(date) batT=$(bt)" >> $REPORT
