# One copy, three legs on an UNMEASURED SoC: Xiaomi 14 (SM8650, Hexagon v75, Adreno 750), owner's daily driver,
# PLUGGED overnight 2026-10-08 -> CORRECTNESS ONLY (no speed or heat claims). Engine dbdeb628e (lab-only
# GGML_OPENCL_TILE32_UNMEASURED=1 waives the OpenCL leg's "740" / E031.41 clauses; every self-check stays).
#   G   = two-copy governor reference, greedy logits (256 tokens)
#   L   = ONE model, forced npu/gpu/cpu hops every 32 tokens, KL vs G (gate 0.01, as the S23 F5 gate)
#   L-x = each leg alone (128 tokens), KL vs G, to localize a failure
# Skin watchdog kills the bench at SKIN_STOP. Touches nothing outside $R. Wake key only (the phone has a PIN and
# stays on while charging by its own setting).
#   sh /data/local/tmp/govhtp-xiaomi/run-xiaomi-correctness.sh
R=/data/local/tmp/govhtp-xiaomi; M=$R/model/ship.gguf; B=$R/bin/governor-bench; REPORT=$R/xiaomi_report.txt
SKIN_STOP=44; WS=$R/watchdog.stop
export ADSP_LIBRARY_PATH="$R/dsp-rel"
shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"
}
skin() { dumpsys thermalservice | grep 'mName=skin' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p' | sort -n | tail -1; }
st() { echo "lvl=$(dumpsys battery | grep -m1 '  level:' | grep -oE '[0-9]+') ac=$(dumpsys battery | grep -m1 'AC powered' | grep -oE 'true|false') batT=$(dumpsys battery | grep -m1 '  temperature:' | grep -oE '[0-9]+') skin=$(skin) wake=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2) thermal=$(dumpsys thermalservice | grep -m1 '^Thermal Status' | grep -oE '[0-9]+')"; }
rm -f $REPORT $WS
echo "== xiaomi start $(date) bench $(sha256sum $B | cut -c1-12) skel $(sha256sum $R/dsp-rel/libggml-htp-v75.so | cut -c1-12) model $(sha256sum $M | cut -c1-12) [$(st)]" >> $REPORT
echo "soc=$(getprop ro.soc.model) model=$(getprop ro.product.model) build=$(getprop ro.build.fingerprint)" >> $REPORT
( while [ ! -e $WS ]; do
    s=$(skin); s=${s%.*}
    [ -n "$s" ] && [ "$s" -ge $SKIN_STOP ] && pgrep -f governor-bench > /dev/null && {
      pkill -f governor-bench; echo "WATCHDOG: skin $s >= $SKIN_STOP, bench killed $(date)" >> $REPORT; }
    sleep 3
  done ) &
cd $R
run() {  # name, then the command
  n=$1; shift
  input keyevent 224
  "$@" > $R/$n.log 2>&1; rc=$?
  echo "## $n exit=$rc [$(st)]" >> $REPORT
  grep -E 'ggml_opencl: device|Adreno|driver|TILE32 gate|import|self-check|HOST self-check|fence|refus|supports_op|splits = |leg_summary|leg_total|^kld|KL|diverged|WARNING|error|abort|landed' \
    $R/$n.log | cut -c1-240 | sort | uniq -c | sort -rn | head -40 >> $REPORT
  sleep 60
}
run G   $B --arm G -m $M -t 5 -r 1 --gen 256 --logits-out $R/twocopy.gbl -v
run L   shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 256 --logits-ref $R/twocopy.gbl --kld-max 0.01 -v
for leg in npu gpu cpu; do
  run L-$leg shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs $leg --logits-ref $R/twocopy.gbl --kld-max 0.01 -v
done
touch $WS
echo "== xiaomi end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE"
