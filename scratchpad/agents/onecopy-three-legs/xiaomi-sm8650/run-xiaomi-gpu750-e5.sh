# Xiaomi 14 (Adreno 750): E5 - in-vivo check of every TILE32 v4 GEMV of the one-copy GPU leg against the CPU reference
# (engine 29707db07 = fbf33176c + lab verify; GGML_OPENCL_TILE32_VERIFY=N checks the first N v4 GEMV calls, read-only
# after clFinish, one "ggml-opencl-tile32: verify ... status=PASS|FAIL" line each). Decides H-A (the v4 path's per-call
# activation image / dst sub-buffer): FAIL lines = the GEMV itself is wrong; all PASS with KL still failing = the
# defect is elsewhere (fused norms, GPU attention). The per-call clFinish may also hide a race: report KL of every arm.
#   V   gpu leg, verify the first VERIFY_N calls (x3)
#   C   gpu leg, no verify (x3, interleaved): KL control on the same binary
# CORRECTNESS ONLY. Owner's daily driver with a PIN: no keyguard command, no settings change; touches only $R.
#   (nohup sh -c ". /data/local/tmp/govhtp-xiaomi/run-xiaomi-gpu750-e5.sh" > /data/local/tmp/govhtp-xiaomi/e5.out 2>&1 < /dev/null &)
R=/data/local/tmp/govhtp-xiaomi; M=$R/model/ship.gguf; B=$R/e5/governor-bench; REPORT=$R/e5_report.txt
L=$R/e5/logs; WS=$R/e5.stop; SKIN_STOP=43; VERIFY_N=${VERIFY_N:-4000}
# start gate: correctness needs no cool start; 42 lets it run on the charger (skin climbs past 40 while charging)
COOL=${COOL:-42}
export ADSP_LIBRARY_PATH="$R/e5/dsp"
shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"
}
skin() { dumpsys thermalservice | sed -n '/Current temperatures from HAL/,$p' | grep -m1 'mName=skin' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'; }
st() { echo "lvl=$(dumpsys battery | grep -m1 '  level:' | grep -oE '[0-9]+') skin=$(skin) wake=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2) keyguard=$(dumpsys window | grep -m1 -oE 'isKeyguardShowing=(true|false)' | cut -d= -f2)"; }
mkdir -p $L; rm -f $REPORT $WS
echo "== e5 start $(date) bench $(sha256sum $B | cut -c1-12) skel $(sha256sum $R/e5/dsp/libggml-htp-v75.so | cut -c1-12) verify_n=$VERIFY_N [$(st)]" >> $REPORT
( while [ ! -e $WS ]; do
    s=$(skin); s=${s%.*}
    [ -n "$s" ] && [ "$s" -ge $SKIN_STOP ] && pgrep -f e5/governor-bench > /dev/null && {
      pkill -f e5/governor-bench; echo "WATCHDOG: skin $s >= $SKIN_STOP, bench killed $(date +%s)" >> $REPORT; }
    sleep 3
  done ) &
cd $R
run() {  # tag, then extra env assignments
  tag=$1; shift
  while :; do s=$(skin); s=${s%.*}; [ -z "$s" ] || [ "$s" -lt $COOL ] && break; sleep 20; done
  shared env "$@" $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu \
      --logits-ref $R/twocopy.gbl --kld-max 0.01 -v > $L/$tag.log 2>&1
  rc=$?
  echo "## $tag env=[$*] exit=$rc [$(st)] $(grep -m1 -E '^kld' $L/$tag.log | cut -c1-200)" >> $REPORT
  echo "verify: lines=$(grep -c 'tile32: verify call=' $L/$tag.log) pass=$(grep -c 'verify call=.*status=PASS' $L/$tag.log) fail=$(grep -c 'verify call=.*status=FAIL' $L/$tag.log) error=$(grep -c 'verify call=.*status=ERROR' $L/$tag.log)" >> $REPORT
  grep -m5 'verify call=.*status=FAIL' $L/$tag.log | cut -c1-300 >> $REPORT
  sleep 15
}
for i in 1 2 3; do
  run V_$i GGML_OPENCL_TILE32_VERIFY=$VERIFY_N
  run C_$i GGML_E5_CONTROL=1
done
touch $WS
echo "== e5 end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE"
