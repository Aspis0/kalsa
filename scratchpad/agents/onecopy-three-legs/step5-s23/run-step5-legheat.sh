# Step-5 owner session 2026-10-07 (S23, unplugged): decode heat per leg - each leg ALONE (forced --legs) for 2048
# tokens, to price decode_heat_per_token_{npu,gpu,cpu} for the hop rule's heat weight. Same harness as
# run-step5-heat.sh (the modes), the feeder runs only to log the per-leg headrooms. Each mode starts only once skin is back to COOL_SKIN (max 15 min wait, logged); skin,
# battery temp, wakefulness and the feeder's three headrooms are sampled every 10 s into legheat_<leg>.csv;
# the sampler also sends KEYCODE_WAKEUP every 10 s + wm dismiss-keyguard (the first 4096-token attempt fell to Dozing on the lock screen, sleep reason
# "timeout", despite screen_off_timeout at max) and a run with any non-Awake sample is reported INVALID. Skin watchdog
# kills the bench at SKIN_STOP (owner's 44 C).
#   . /data/local/tmp/govhtp/step5-s23/run-step5-legheat.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/legheat_report.txt; B=$D/bin/governor-bench-3a7
HR=$R/headroom.txt; HS=$R/headroom.stop; WS=$D/watchdog.stop
COOL_SKIN=31
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
rm -f $REPORT $WS
echo "== legheat start $(date) binary $(sha256sum $B | cut -c1-12) [$(st)]" >> $REPORT
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
for leg in npu gpu cpu; do
  CSV=$D/legheat_$leg.csv
  waited=0
  while :; do
    s=$(skin_now); s=${s%.*}
    [ -n "$s" ] && [ "$s" -le $COOL_SKIN ] && break
    [ $waited -ge 900 ] && { echo "cool wait gave up at skin $s" >> $REPORT; break; }
    sleep 30; waited=$((waited + 30))
  done
  input keyevent 224; wm dismiss-keyguard
  echo "## leg=$leg start after ${waited}s cool wait [$(st)] feed $(cat $HR)" >> $REPORT
  echo "t_s,skin_c,batt_dc,wake,cpu_hr,npu_hr,gpu_hr" > $CSV
  ( t=0; while [ ! -e $CSV.stop ]; do
      input keyevent 224; wm dismiss-keyguard
      w=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2)
      echo "$t,$(skin_now),$(batt_t),$w,$(tr ' ' ',' < $HR)" >> $CSV; sleep 10; t=$((t + 10))
    done ) &
  arm_env_legs $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 2049 --legs $leg > $D/legheat_$leg.log 2>&1
  rc=$?
  touch $CSV.stop; sleep 11; rm -f $CSV.stop
  awake=$(grep -vc ",Awake," $CSV); [ "$awake" -gt 1 ] && echo "INVALID: $((awake - 1)) non-Awake samples" >> $REPORT
  echo "## leg=$leg exit=$rc [$(st)]" >> $REPORT
  grep -E 'run_start|leg_summary|leg_pair|leg_total' $D/legheat_$leg.log | cut -c1-260 >> $REPORT
done
touch $HS $WS
echo "== legheat end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
