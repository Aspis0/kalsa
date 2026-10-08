# Device-side (QDC QRD8650 = SM8650, v75, Adreno 750; plugged = CORRECTNESS ONLY). Lab bench engine 09a496d71
# (TILE32_LAB build; node dump with in=/filter/strict compare). The Xiaomi 14 (same SoC) fails the one-copy GPU leg on
# every run (KL 0.04-0.2, value differs run to run) while the 8 Elite passes (QDC #66). Here:
#   G = two-copy reference logits (128); L-npu control; L-gpu x2 = does the defect reproduce on this board;
#   D-gpu1 / D-gpu2 = the SAME gpu-leg config with --dump-nodes over the first 8 decode tokens (the first node that
#   differs between the two is the nondeterministic one; their own KL says whether the dump's per-split sync hides
#   the defect); D-agpu = plain upstream OpenCL two-copy load with the dump (reference values).
# Battery-temperature watchdog kills the bench at 45.0 C. Touches nothing outside $R.
#   sh /data/local/tmp/kalsa67/run-legs.sh
R=/data/local/tmp/kalsa67; M=$R/lfm26.gguf; B=$R/governor-bench; REPORT=$R/legs_report.txt; WS=$R/watchdog.stop
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
run L-npu   shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs npu $REF -v
run L-gpu   shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF -v
run L-gpu2  shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF -v
run D-gpu1  shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF --dump-nodes $R/D-gpu1.dump --dump-nodes-tokens 8 -v
run D-gpu2  shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu $REF --dump-nodes $R/D-gpu2.dump --dump-nodes-tokens 8 -v
run D-agpu  $B --arm A --dev GPUOpenCL -m $M -t 5 -r 1 --gen 128 $REF --dump-nodes $R/D-agpu.dump --dump-nodes-tokens 8 -v
touch $WS
echo "== legs end $(date) batT=$(bt)" >> $REPORT
