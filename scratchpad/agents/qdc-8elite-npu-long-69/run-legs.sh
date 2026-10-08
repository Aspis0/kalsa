# Device-side (QDC 8 Elite QRD8750 = SM8750, v79; plugged; no skin limit on a board). Question for the governor's
# guard (rule v3): does the NPU, decoding non-stop, reach its zone trip and slow down? On the S23 the NSP plateaus at
# 82-86 C and tok/s drops only 3 % before skin 43 binds. Here: NPU leg alone (one-copy lab bench, engine 09a496d71),
# back-to-back 2048-token runs for LONG_S seconds, per-window tok/s in npu-long.log; every thermal zone whose type
# names nsp/cdsp/gpu/cpu/skin/batt/sys every 2 s in zones.csv (zone map + trip points in zones_map.txt), plus the
# cdsp/gpu cooling-device states. Battery-temperature watchdog kills the bench at 48.0 C (QDC boards report a fixed battery temp: 42.0 on the 8 Elite in #66, 45.0 on the SM8850 MRD in #68).
#   sh /data/local/tmp/kalsa69/run-legs.sh
R=/data/local/tmp/kalsa69; M=$R/lfm26.gguf; B=$R/governor-bench; REPORT=$R/legs_report.txt; WS=$R/watchdog.stop
LONG_S=${LONG_S:-1500}
export ADSP_LIBRARY_PATH="$R"
shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"
}
bt() { dumpsys battery | grep -m1 '  temperature:' | grep -oE '[0-9]+'; }
rm -f $REPORT $WS $R/zones.csv $R/npu-long.log
echo "== legs start $(date) soc=$(getprop ro.soc.model) model=$(getprop ro.product.model) bench $(sha256sum $B | cut -c1-12) batT=$(bt)" >> $REPORT
Z=""; : > $R/zones_map.txt
for z in /sys/class/thermal/thermal_zone*; do
  t=$(cat $z/type 2>/dev/null)
  case "$t" in *nsp*|*cdsp*|*gpu*|*cpu*|*skin*|*batt*|*sys*)
    Z="$Z $z"; echo "$(basename $z) $t trips: $(cat $z/trip_point_*_temp 2>/dev/null | tr '\n' ' ')" >> $R/zones_map.txt ;;
  esac
done
C=""; for c in /sys/class/thermal/cooling_device*; do t=$(cat $c/type); case "$t" in *cdsp*|*gpu*|*nsp*) C="$C $c";; esac; done
echo "cooling: $(for c in $C; do echo -n "$(basename $c)=$(cat $c/type) "; done)" >> $R/zones_map.txt
echo "epoch,$(for z in $Z; do echo -n "$(cat $z/type),"; done)$(for c in $C; do echo -n "$(cat $c/type),"; done)" > $R/zones.csv
( while [ ! -e $WS ]; do
    echo "$(date +%s),$(for z in $Z; do echo -n "$(cat $z/temp),"; done)$(for c in $C; do echo -n "$(cat $c/cur_state),"; done)" >> $R/zones.csv
    t=$(bt); [ -n "$t" ] && [ "$t" -ge 480 ] && pgrep -f governor-bench > /dev/null && {
      pkill -f governor-bench; echo "WATCHDOG: battery $t >= 480, bench killed $(date)" >> $REPORT; }
    sleep 2
  done ) &
cd $R
start=$(date +%s); k=0
while [ $(( $(date +%s) - start )) -lt $LONG_S ]; do
  k=$((k + 1)); echo "### run $k start $(date +%s)" >> $R/npu-long.log
  shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 2049 --legs npu -v >> $R/npu-long.log 2>&1; rc=$?
  echo "## run $k exit=$rc batT=$(bt) $(grep '^leg_summary' $R/npu-long.log | tail -1 | cut -c1-120)" >> $REPORT
  [ $rc -ne 0 ] && break
  grep -q WATCHDOG $REPORT && break
done
touch $WS
echo "== legs end $(date) runs=$k batT=$(bt)" >> $REPORT
