# Step-5 owner question ("prove the governor beats the NPU alone or the GPU alone"), S23 unplugged, round 2:
# BACK-TO-BACK turns. Each arm = up to RUNS consecutive 2048-token runs with no pause between them (the user regime
# arXiv 2603.23640 measures), until skin reaches STOP_AT or any leg's headroom drops below HR_STOP.
#   npu = NPU leg forced alone, gpu = GPU leg forced alone, hw = the shipped one-copy governor (tau 10 s, heat
#   weight 7, per-token 2.8/3.2/4.7, free-running on the 1 Hz headroom feeder).
# Why 2048-token runs: round 1 (run-step5-vsleg.sh, --gen 8193 -> n_ctx 8960) HARD-RESET the S23 twice, both times
# exactly after decode window 46 (~1504 tokens, position ~2016), once on the npu arm and once on the gpu arm, at
# very different temperatures; --gen 2049 (n_ctx 2816) has run many sessions without a reset. Cause under study.
# Order gpu hw npu npu hw gpu (ABC CBA); each arm starts from skin <= COOL_SKIN (max 25 min wait, logged). Skin,
# battery temp, wakefulness and the three headrooms every 10 s into vsleg2_<n>_<arm>.csv; wake poke every 10 s;
# any non-Awake sample = INVALID. The 1 Hz zone logger (zone-logger.sh) runs alongside.
#   . /data/local/tmp/govhtp/step5-s23/run-step5-vsleg2.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/vsleg2_report.txt; B=$D/bin/governor-bench-hw
HR=$R/headroom.txt; HS=$R/headroom.stop; WS=$D/watchdog.stop
COOL_SKIN=31; STOP_AT=43; HR_STOP=10; MIN_LEVEL=30; RUNS=4
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
rm -f $REPORT $WS
echo "== vsleg2 start $(date) binary $(sha256sum $B | cut -c1-12) [$(st)]" >> $REPORT
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
    lo=$(tr ' ' '\n' < $HR | sort -n | head -1); lo=${lo%.*}
    if [ -n "$lo" ] && [ "$lo" -lt $HR_STOP ] && pgrep -f governor-bench > /dev/null; then
      pkill -f governor-bench; echo "ARM STOP: leg headroom $(cat $HR) < $HR_STOP $(date +%s)" >> $REPORT
    fi
    sleep 2
  done ) &

sh $D/headroom-feeder.sh $HR $HS &
sleep 3
n=0
for arm in gpu hw npu npu hw gpu; do
  n=$((n + 1))
  case $arm in
    npu|gpu) KNOBS="--legs $arm" ;;
    hw) KNOBS="--headroom-tau 10 --heat-weight 7 --heat-per-token 2.8,3.2,4.7 --headroom-file $HR" ;;
  esac
  lv=$(level); [ -n "$lv" ] && [ "$lv" -lt $MIN_LEVEL ] && { echo "STOP: battery $lv < $MIN_LEVEL" >> $REPORT; break; }
  CSV=$D/vsleg2_${n}_$arm.csv
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
  : > $D/vsleg2_${n}_$arm.log; k=0; rc=0
  while [ $k -lt $RUNS ]; do
    k=$((k + 1)); before=$(grep -c "ARM STOP" $REPORT)
    echo "### run $k start $(date +%s)" >> $D/vsleg2_${n}_$arm.log
    arm_env_legs $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 2049 $KNOBS -v >> $D/vsleg2_${n}_$arm.log 2>&1
    rc=$?
    [ "$(grep -c "ARM STOP" $REPORT)" -gt "$before" ] && break
    [ $rc -ne 0 ] && break
  done
  echo "runs=$k" >> $REPORT
  touch $CSV.stop; sleep 11; rm -f $CSV.stop
  awake=$(grep -vc ",Awake," $CSV); [ "$awake" -gt 1 ] && echo "INVALID: $((awake - 1)) non-Awake samples" >> $REPORT
  tok=$(grep '^leg_window' $D/vsleg2_${n}_$arm.log | sed -nE 's/.*tokens=([0-9]+).*/\1/p' | awk '{s+=$1} END {print s+0}')
  us=$(grep '^leg_window' $D/vsleg2_${n}_$arm.log | sed -nE 's/.* us=([0-9]+).*/\1/p' | awk '{s+=$1} END {print s+0}')
  echo "## $n arm=$arm exit=$rc end $(date +%s) [$(st)] windows_tokens=$tok windows_us=$us" >> $REPORT
  grep -E 'run_start|leg_summary|leg_pair|leg_total' $D/vsleg2_${n}_$arm.log | cut -c1-260 >> $REPORT
  echo "hops: $(grep -c 'governor: decode hop' $D/vsleg2_${n}_$arm.log); windows by engine: $(grep -oE '^leg_window.*engine=[a-z]+' $D/vsleg2_${n}_$arm.log | grep -oE 'engine=[a-z]+' | sort | uniq -c | tr '\n' ' ')" >> $REPORT
done
touch $HS $WS
echo "== vsleg2 end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
