# Step-5 owner question 2026-10-07 ("prove the governor beats the NPU alone or the GPU alone"), S23 unplugged:
# SUSTAINED decode until skin reaches STOP_AT (43 C, the owner's pause point) or 8192 tokens, per arm:
#   npu = NPU leg forced alone, gpu = GPU leg forced alone, hw = the shipped one-copy governor (tau 10 s, heat
#   weight 7, per-token 2.8/3.2/4.7, free-running on the 1 Hz headroom feeder).
# Order npu hw gpu gpu hw npu (ABC CBA). Each arm starts only once skin is back to COOL_SKIN (max 25 min wait,
# logged). Skin, battery temp, wakefulness and the three headrooms every 10 s into vsleg_<n>_<arm>.csv; wake poke
# + wm dismiss-keyguard every 10 s; any non-Awake sample = INVALID. Read: tokens and seconds before STOP_AT, tok/s
# per window over time (leg_window lines), skin curve. The 44 C hard watchdog stays.
# Attempt 1 (2026-10-07 23:38) HARD-RESET the S23 140 s into the npu arm (PMIC PonReason HARD_RESET, skin 39.9, NPU
# headroom 5.0 C to its lowest passive trip, CPU 21, GPU 19): every arm now also stops when ANY leg's headroom in the
# feeder file drops below HR_STOP - a component limit counts like the skin limit.
#   . /data/local/tmp/govhtp/step5-s23/run-step5-vsleg.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/vsleg_report.txt; B=$D/bin/governor-bench-hw
HR=$R/headroom.txt; HS=$R/headroom.stop; WS=$D/watchdog.stop
COOL_SKIN=31; STOP_AT=43; HR_STOP=10; MIN_LEVEL=30
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
rm -f $REPORT $WS
echo "== vsleg start $(date) binary $(sha256sum $B | cut -c1-12) [$(st)]" >> $REPORT
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
for arm in npu hw gpu gpu hw npu; do
  n=$((n + 1))
  case $arm in
    npu|gpu) KNOBS="--legs $arm" ;;
    hw) KNOBS="--headroom-tau 10 --heat-weight 7 --heat-per-token 2.8,3.2,4.7 --headroom-file $HR" ;;
  esac
  lv=$(level); [ -n "$lv" ] && [ "$lv" -lt $MIN_LEVEL ] && { echo "STOP: battery $lv < $MIN_LEVEL" >> $REPORT; break; }
  CSV=$D/vsleg_${n}_$arm.csv
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
  arm_env_legs $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 8193 $KNOBS -v > $D/vsleg_${n}_$arm.log 2>&1
  rc=$?
  touch $CSV.stop; sleep 11; rm -f $CSV.stop
  awake=$(grep -vc ",Awake," $CSV); [ "$awake" -gt 1 ] && echo "INVALID: $((awake - 1)) non-Awake samples" >> $REPORT
  tok=$(grep '^leg_window' $D/vsleg_${n}_$arm.log | sed -nE 's/.*tokens=([0-9]+).*/\1/p' | awk '{s+=$1} END {print s+0}')
  us=$(grep '^leg_window' $D/vsleg_${n}_$arm.log | sed -nE 's/.* us=([0-9]+).*/\1/p' | awk '{s+=$1} END {print s+0}')
  echo "## $n arm=$arm exit=$rc end $(date +%s) [$(st)] windows_tokens=$tok windows_us=$us" >> $REPORT
  grep -E 'run_start|leg_summary|leg_pair|leg_total' $D/vsleg_${n}_$arm.log | cut -c1-260 >> $REPORT
  echo "hops: $(grep -c 'governor: decode hop' $D/vsleg_${n}_$arm.log); windows by engine: $(grep -oE '^leg_window.*engine=[a-z]+' $D/vsleg_${n}_$arm.log | grep -oE 'engine=[a-z]+' | sort | uniq -c | tr '\n' ' ')" >> $REPORT
done
touch $HS $WS
echo "== vsleg end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
