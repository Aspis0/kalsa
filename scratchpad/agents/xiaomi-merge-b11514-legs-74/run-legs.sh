# Device-side (Xiaomi 14 SM8650 v75 Adreno 750, UNPLUGGED, correctness of the merged engine incl. the GPU-750 l4_y8 fix; speeds indicative, never claims): one copy, three legs on an
# UNMEASURED Snapdragon with the lab bench (engine 23b2a44d7 = upstream b11514 merged into e01a61cee + audit fixes, GGML_OPENCL_TILE32_LAB build: the OpenCL leg's
# "740"/E031.41 gate is waived by GGML_OPENCL_TILE32_UNMEASURED=1, every self-check stays). Same arms as the
# Xiaomi 14 run (xiaomi-sm8650/run-xiaomi-correctness.sh + the GPU-leg splits + the plain controls):
#   G = two-copy governor reference (greedy logits, 256), L = forced npu/gpu/cpu hops every 32 over 256, KL vs G,
#   L-npu / L-gpu (x2) / L-cpu alone (128), A-gpu = plain upstream OpenCL load, A-j1 = plain {HTP0,GPUOpenCL},
#   V-gpu = L-gpu with the E5 in-vivo check of the first 4000 TILE32 v4 GEMV calls (one "verify call=" line each;
#   on the 750 every call matched the CPU reference within 2.9e-5 x RMS while KL still failed).
# Battery-temperature watchdog kills the bench at 43.0 C (owner skin line 43; the phone is the owner's daily driver, lent for 20 min). Screen woken before every arm (lock screen dozes runs).
#   sh /data/local/tmp/kalsa74/run-legs.sh
R=/data/local/tmp/kalsa74; M=$R/lfm26.gguf; B=$R/governor-bench; REPORT=$R/legs_report.txt; WS=$R/watchdog.stop
export ADSP_LIBRARY_PATH="$R"
shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"
}
bt() { dumpsys battery | grep -m1 '  temperature:' | grep -oE '[0-9]+'; }
rm -f $REPORT $WS
echo "== legs start $(date) soc=$(getprop ro.soc.model) model=$(getprop ro.product.model) bench $(sha256sum $B | cut -c1-12) batT=$(bt)" >> $REPORT
( while [ ! -e $WS ]; do
    t=$(bt); [ -n "$t" ] && [ "$t" -ge 430 ] && pgrep -f governor-bench > /dev/null && {
      pkill -f governor-bench; echo "WATCHDOG: battery $t >= 430, bench killed $(date)" >> $REPORT; }
    sleep 3
  done ) &
cd $R
run() {
  n=$1; shift; input keyevent 224
  "$@" > $R/$n.log 2>&1; rc=$?
  echo "## $n exit=$rc batT=$(bt)" >> $REPORT
  grep -E 'ggml_opencl: device:|OpenCL driver|TILE32 gate|TILE32 leg|Arch version|imported|shared weights|HOST self-check|self-check .*FAIL|^leg_window|^leg_summary|^leg_total|^kld|refus|GGML_ABORT|error' \
    $R/$n.log | sed -E 's/ us=[0-9]+//' | cut -c1-240 >> $REPORT
  echo "self-check PASS lines: $(grep -c 'self-check.*PASS' $R/$n.log)" >> $REPORT
  sleep 45
}
run G       $B --arm G -m $M -t 5 -r 1 --gen 256 --logits-out $R/twocopy.gbl -v
run L       shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 256 --logits-ref $R/twocopy.gbl --kld-max 0.01 -v
run L-npu   shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs npu --logits-ref $R/twocopy.gbl --kld-max 0.01 -v
run L-gpu   shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu --logits-ref $R/twocopy.gbl --kld-max 0.01 -v
run L-gpu2  shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu --logits-ref $R/twocopy.gbl --kld-max 0.01 -v
run L-cpu   shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs cpu --logits-ref $R/twocopy.gbl --kld-max 0.01 -v
run A-gpu   $B --arm A --dev GPUOpenCL -m $M -t 5 -r 1 --gen 128 --logits-ref $R/twocopy.gbl --kld-max 0.01 -v
run A-j1    shared $B --arm A --dev HTP0,GPUOpenCL -m $M -t 5 -r 1 --gen 128 --logits-ref $R/twocopy.gbl --kld-max 0.01 -v
run V-gpu   shared env GGML_OPENCL_TILE32_VERIFY=4000 $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu --logits-ref $R/twocopy.gbl --kld-max 0.01 -v
echo "V-gpu verify: lines=$(grep -c 'tile32: verify call=' $R/V-gpu.log) worst_rel=$(grep 'tile32: verify call=' $R/V-gpu.log | sed -nE 's/.*max\|diff\|=([0-9.e+-]+) rms=([0-9.e+-]+).*/\1 \2/p' | awk '$2>0{r=$1/$2; if(r>m)m=r} END{printf "%.3e", m}')" >> $REPORT
touch $WS
echo "== legs end $(date) batT=$(bt)" >> $REPORT
