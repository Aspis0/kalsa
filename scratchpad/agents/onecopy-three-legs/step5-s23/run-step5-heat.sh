# Step-5 owner session 2026-10-07 (S23, unplugged): the decode-hop rule modes under SUSTAINED decode - 2048 tokens
# (64 windows of 32) per mode, free-running on the 1 Hz headroom feeder: gpu_burst tau 10 s, npu_first tau 10 s,
# npu_first raw (today). Each mode starts only once skin is back to COOL_SKIN (max 15 min wait, logged); skin,
# battery temp, wakefulness and the feeder's three headrooms are sampled every 10 s into heat_<mode>_<tau>.csv;
# the sampler also sends KEYCODE_WAKEUP every 10 s + wm dismiss-keyguard (the first 4096-token attempt fell to Dozing on the lock screen, sleep reason
# "timeout", despite screen_off_timeout at max) and a run with any non-Awake sample is reported INVALID. Skin watchdog
# kills the bench at SKIN_STOP (owner's 44 C).
#   . /data/local/tmp/govhtp/step5-s23/run-step5-heat.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/heat_report.txt; B=$D/bin/governor-bench-482
HR=$R/headroom.txt; HS=$R/headroom.stop; WS=$D/watchdog.stop
COOL_SKIN=31
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
rm -f $REPORT $WS
echo "== heat start $(date) binary $(sha256sum $B | cut -c1-12) [$(st)]" >> $REPORT
session_gates || { echo "SESSION ABORTED: preflight gates" >> $REPORT; return 1 2>/dev/null || exit 1; }
cd $D

skin_now() { dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'; }
batt_t() { dumpsys battery | grep -m1 '  temperature:' | sed -nE 's/.*: ([0-9]+)/\1/p'; }
( while [ ! -e $WS ]; do
    s=$(skin_now); s=${s%.*}
    if [ -n "$s" ] && [ "$s" -ge $SKIN_STOP ]; then
      pkill -f governor-bench; echo "WATCHDOG: skin $s >= $SKIN_STOP, bench killed $(date)" >> $REPORT
    fi
    sleep 5
  done ) &

sh $D/headroom-feeder.sh $HR $HS &
sleep 3
for mode in "gpu_burst 10" "npu_first 10" "npu_first 0"; do
  set -- $mode
  CSV=$D/heat_$1_$2.csv
  waited=0
  while :; do
    s=$(skin_now); s=${s%.*}
    [ -n "$s" ] && [ "$s" -le $COOL_SKIN ] && break
    [ $waited -ge 900 ] && { echo "cool wait gave up at skin $s" >> $REPORT; break; }
    sleep 30; waited=$((waited + 30))
  done
  input keyevent 224; wm dismiss-keyguard
  echo "## mode=$1 tau=$2 start after ${waited}s cool wait [$(st)] feed $(cat $HR)" >> $REPORT
  echo "t_s,skin_c,batt_dc,wake,cpu_hr,npu_hr,gpu_hr" > $CSV
  ( t=0; while [ ! -e $CSV.stop ]; do
      input keyevent 224; wm dismiss-keyguard
      w=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2)
      echo "$t,$(skin_now),$(batt_t),$w,$(tr ' ' ',' < $HR)" >> $CSV; sleep 10; t=$((t + 10))
    done ) &
  arm_env_legs $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 2049 --hop-mode $1 --headroom-tau $2 \
    --headroom-file $HR -v > $D/heat_$1_$2.log 2>&1
  rc=$?
  touch $CSV.stop; sleep 11; rm -f $CSV.stop
  awake=$(grep -vc ",Awake," $CSV); [ "$awake" -gt 1 ] && echo "INVALID: $((awake - 1)) non-Awake samples" >> $REPORT
  echo "## mode=$1 tau=$2 exit=$rc [$(st)]" >> $REPORT
  grep -E 'run_start|leg_summary|leg_pair|leg_total' $D/heat_$1_$2.log | cut -c1-260 >> $REPORT
  echo "hops: $(grep -c 'governor: decode hop' $D/heat_$1_$2.log); windows by rule: $(grep -oE 'rule=[a-z_]+' $D/heat_$1_$2.log | sort | uniq -c | tr '\n' ' ')" >> $REPORT
done
touch $HS $WS
echo "== heat end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
