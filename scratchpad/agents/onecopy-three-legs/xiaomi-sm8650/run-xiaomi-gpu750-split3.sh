# Xiaomi 14 (SM8650, Adreno 750): why the ONE-COPY GPU leg alone fails KL (0.05-0.14, nondeterministic) while plain
# OpenCL and the NPU leg's J(1) lm_head pass. Ladder from diagnose-gpu750-n2.md section 4, existing knobs only,
# several runs per arm (the defect is nondeterministic). CORRECTNESS ONLY (no speed claims). Engine dbdeb628e bench.
#   E0  kernel/alloc/verbose logs, gpu leg and npu leg (which kernels each leg dispatches; 750 alignment figures)
#   C   control: the failing config as it ran (5x)
#   E1b GGML_HEXAGON_HOSTBUF_UNCACHED=1: all shared blocks uncached -> clean = CPU/GPU coherence (H-B) (5x)
#   E1a GGML_HEXAGON_HOSTBUF_FLUSH=1: HOST-W lines written back at load -> clean = HOST-W coherence (5x)
#   E2  GGML_OPENCL_OPFILTER: ZZZ_NOMATCH (filter control), MUL (norm weights off OpenCL), MUL_MAT (both mat-vecs off)
# Owner's daily driver with a PIN: no keyguard command, no settings change; touches nothing outside $R.
#   (nohup sh -c ". /data/local/tmp/govhtp-xiaomi/run-xiaomi-gpu750-split3.sh" > /data/local/tmp/govhtp-xiaomi/split3.out 2>&1 < /dev/null &)
R=/data/local/tmp/govhtp-xiaomi; M=$R/model/ship.gguf; B=$R/bin/governor-bench; REPORT=$R/split3_report.txt
L=$R/split3; WS=$R/split3.stop; SKIN_STOP=43
export ADSP_LIBRARY_PATH="$R/dsp-rel"
shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"
}
# the HAL's CURRENT skin reading: the "Cached temperatures" block can hold a stale value (46.7 C for 20+ min after a
# reboot), and taking the max of both blocks then stalls every cool wait
skin() { dumpsys thermalservice | sed -n '/Current temperatures from HAL/,$p' | grep -m1 'mName=skin' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'; }
st() { echo "lvl=$(dumpsys battery | grep -m1 '  level:' | grep -oE '[0-9]+') skin=$(skin) wake=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2) keyguard=$(dumpsys window | grep -m1 -oE 'isKeyguardShowing=(true|false)' | cut -d= -f2)"; }
mkdir -p $L; rm -f $REPORT $WS
echo "== split3 start $(date) bench $(sha256sum $B | cut -c1-12) skel $(sha256sum $R/dsp-rel/libggml-htp-v75.so | cut -c1-12) [$(st)]" >> $REPORT
( while [ ! -e $WS ]; do
    s=$(skin); s=${s%.*}
    [ -n "$s" ] && [ "$s" -ge $SKIN_STOP ] && pgrep -f bin/governor-bench > /dev/null && {
      pkill -f bin/governor-bench; echo "WATCHDOG: skin $s >= $SKIN_STOP, bench killed $(date +%s)" >> $REPORT; }
    sleep 3
  done ) &
cd $R
run() {  # tag, legs, then extra env assignments
  tag=$1; legs=$2; shift 2
  while :; do s=$(skin); s=${s%.*}; [ -z "$s" ] || [ "$s" -lt 39 ] && break; sleep 20; done
  shared env "$@" $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs $legs \
      --logits-ref $R/twocopy.gbl --kld-max 0.01 -v > $L/$tag.log 2>&1
  rc=$?
  echo "## $tag legs=$legs env=[$*] exit=$rc [$(st)] $(grep -m1 -E '^kld' $L/$tag.log | cut -c1-200)" >> $REPORT
  sleep 15
}
run E0_gpu gpu GGML_OPENCL_LOG_KERNELS=1 GGML_OPENCL_LOG_ALLOC=1 GGML_HEXAGON_VERBOSE=1
run E0_npu npu GGML_OPENCL_LOG_KERNELS=1 GGML_OPENCL_LOG_ALLOC=1 GGML_HEXAGON_VERBOSE=1
for i in 1 2 3 4 5; do
  run C_$i   gpu GGML_SPLIT3_CONTROL=1
  run E1b_$i gpu GGML_HEXAGON_HOSTBUF_UNCACHED=1
  run E1a_$i gpu GGML_HEXAGON_HOSTBUF_FLUSH=1
done
for i in 1 2 3; do
  run E2ctr_$i gpu GGML_OPENCL_OPFILTER=ZZZ_NOMATCH
  run E2mul_$i gpu GGML_OPENCL_OPFILTER=MUL
  run E2mm_$i  gpu GGML_OPENCL_OPFILTER=MUL_MAT
done
touch $WS
echo "== split3 end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE"
