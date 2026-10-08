# Step-5 owner question ("prove the governor beats the NPU alone or the GPU alone"), S23 unplugged, ROUND 3
# (2026-10-08), under MY endurance criterion (owner delegated it; PLAN "Owner decisions 2026-10-08 morning"):
# score = decode tokens produced in back-to-back 2048-token runs (n_ctx 2816, away from the reset config) until skin
# reaches STOP_AT 43 C, mean tok/s alongside. NO leg-headroom stop (the NSP zone is a load step and its trip binds
# nothing; round 2's headroom stop ended arms on NPU prefill spikes). Safety: skin 43 stop, battery < 30 %.
#   npu = NPU leg forced alone, gpu = GPU leg forced alone, hw = the governor WITH the load-step rule (engine
#   9c11ebcbf): tau 10 s, heat weight 7, per-token 2.8/3.2/4.7, load step NPU 11 / GPU 14 / CPU 0 C (round-2 zone
#   means; the CPU step is unmeasured, so 0 - its heat weight 4.7 x 7 already docks it hardest), free-running on the
#   1 Hz headroom feeder. Order npu gpu hw hw gpu npu (ABC CBA), each from skin <= COOL_SKIN (max 25 min wait).
# Bench r3/governor-bench 42667d95 + release skel r3/dsp v73 f89da3d8 (~/Projects/kalsa-artifacts-loadstep).
# CSVs every 10 s (skin, battery temp, wakefulness, three headrooms); 1 Hz zone logger; non-Awake = INVALID.
#   . /data/local/tmp/govhtp/step5-s23/run-step5-vsleg3.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/vsleg3_report.txt; B=$D/r3/governor-bench
HR=$R/headroom.txt; HS=$R/headroom.stop; WS=$D/watchdog.stop
COOL_SKIN=31; STOP_AT=43; MIN_LEVEL=30; RUNS=6
export ADSP_LIBRARY_PATH="$D/r3/dsp;$R/lib"
rm -f $REPORT $WS
echo "== vsleg3 start $(date) binary $(sha256sum $B | cut -c1-12) [$(st)]" >> $REPORT
session_gates || { echo "SESSION ABORTED: preflight gates" >> $REPORT; return 1 2>/dev/null || exit 1; }
cd $D

skin_now() { dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'; }
batt_t() { dumpsys battery | grep -m1 '  temperature:' | sed -nE 's/.*: ([0-9]+)/\1/p'; }
level() { dumpsys battery | grep -m1 '  level:' | sed -nE 's/.*: ([0-9]+)/\1/p'; }
( while [ ! -e $WS ]; do
    s=$(skin_now); s=${s%.*}
    if [ -n "$s" ] && [ "$s" -ge $STOP_AT ] && pgrep -f governor-bench > /dev/null; then
      pkill -f governor-bench; echo "ARM STOP: skin $s >= $STOP_AT $(date +%s)" >> $REPORT
    fi
    sleep 2
  done ) &

sh $D/headroom-feeder.sh $HR $HS &
ZS=$D/vsleg3_zones.stop; sh $D/zone-logger.sh $D/zones_vsleg3.csv $ZS &
sleep 3
n=0
for arm in npu gpu hw hw gpu npu; do
  n=$((n + 1))
  case $arm in
    npu|gpu) KNOBS="--legs $arm" ;;
    hw) KNOBS="--headroom-tau 10 --heat-weight 7 --heat-per-token 2.8,3.2,4.7 --load-step 11,14,0 --headroom-file $HR" ;;
  esac
  lv=$(level); [ -n "$lv" ] && [ "$lv" -lt $MIN_LEVEL ] && { echo "STOP: battery $lv < $MIN_LEVEL" >> $REPORT; break; }
  CSV=$D/vsleg3_${n}_$arm.csv
  waited=0
  while :; do
    s=$(skin_now); s=${s%.*}
    [ -n "$s" ] && [ "$s" -le $COOL_SKIN ] && break
    [ $waited -ge 1500 ] && { echo "cool wait gave up at skin $s" >> $REPORT; break; }
    input keyevent 224; wm dismiss-keyguard
    sleep 30; waited=$((waited + 30))
  done
  input keyevent 224; wm dismiss-keyguard
  echo "## $n arm=$arm ($KNOBS) start $(date +%s) after ${waited}s cool wait [$(st)] feed $(cat $HR)" >> $REPORT
  echo "t_s,skin_c,batt_dc,wake,cpu_hr,npu_hr,gpu_hr" > $CSV
  ( t=0; while [ ! -e $CSV.stop ]; do
      input keyevent 224; wm dismiss-keyguard
      w=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2)
      echo "$t,$(skin_now),$(batt_t),$w,$(tr ' ' ',' < $HR)" >> $CSV; sleep 10; t=$((t + 10))
    done ) &
  : > $D/vsleg3_${n}_$arm.log; k=0; rc=0
  while [ $k -lt $RUNS ]; do
    k=$((k + 1)); before=$(grep -c "ARM STOP" $REPORT)
    echo "### run $k start $(date +%s)" >> $D/vsleg3_${n}_$arm.log
    arm_env_legs $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 2049 $KNOBS -v >> $D/vsleg3_${n}_$arm.log 2>&1
    rc=$?
    [ "$(grep -c "ARM STOP" $REPORT)" -gt "$before" ] && break
    [ $rc -ne 0 ] && break
  done
  echo "runs=$k" >> $REPORT
  touch $CSV.stop; sleep 11; rm -f $CSV.stop
  awake=$(grep -vc ",Awake," $CSV); [ "$awake" -gt 1 ] && echo "INVALID: $((awake - 1)) non-Awake samples" >> $REPORT
  tok=$(grep '^leg_window' $D/vsleg3_${n}_$arm.log | sed -nE 's/.*tokens=([0-9]+).*/\1/p' | awk '{s+=$1} END {print s+0}')
  us=$(grep '^leg_window' $D/vsleg3_${n}_$arm.log | sed -nE 's/.* us=([0-9]+).*/\1/p' | awk '{s+=$1} END {print s+0}')
  echo "## $n arm=$arm exit=$rc end $(date +%s) [$(st)] windows_tokens=$tok windows_us=$us" >> $REPORT
  grep -E 'run_start|leg_summary|leg_pair|leg_total' $D/vsleg3_${n}_$arm.log | cut -c1-260 >> $REPORT
  echo "hops: $(grep -c 'governor: decode hop' $D/vsleg3_${n}_$arm.log); windows by engine: $(grep -oE '^leg_window.*engine=[a-z]+' $D/vsleg3_${n}_$arm.log | grep -oE 'engine=[a-z]+' | sort | uniq -c | tr '\n' ' ')" >> $REPORT
done
touch $HS $WS $ZS
echo "== vsleg3 end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
