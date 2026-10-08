# Step-5 NPU voltage-corner campaign (S23, unplugged): the NPU leg ALONE for 2048 tokens at a pinned HTP core corner
# (GGML_HEXAGON_VCORNER=<core>,MAX via the lab-only htp_iface_power, engine 6e06ce5a1, release skel 93f79f01...),
# bus corner kept at MAX. Smoke 2026-10-08: MAX 19.3, NOM 16.7, SVS 11.2 tok/s (128 tokens). Question (EnerInfer,
# arXiv 2606.23001): does a lower corner cut heat per token and the NSP loaded step more than it cuts speed?
# Order MAX TURBO NOM NOM TURBO MAX (ABC CBA); each from skin <= COOL_SKIN (max 25 min wait); stop at skin 43 or any
# leg < 10 C from its trip; 10 s CSV (skin, battery, wake, headrooms) + the 1 Hz zone logger alongside.
#   . /data/local/tmp/govhtp/step5-s23/run-step5-vcorner.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/vcorner_report.txt; V=$R/vcorner; B=$V/bin/governor-bench
HR=$R/headroom.txt; HS=$R/headroom.stop; WS=$D/watchdog.stop
COOL_SKIN=31; HR_STOP=10; STOP_AT=43; MIN_LEVEL=30
export ADSP_LIBRARY_PATH="$V/dsp-rel;$R/lib"
rm -f $REPORT $WS
echo "== vcorner start $(date) binary $(sha256sum $B | cut -c1-12) [$(st)]" >> $REPORT
session_gates || { echo "SESSION ABORTED: preflight gates" >> $REPORT; return 1 2>/dev/null || exit 1; }
cd $D

skin_now() { dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'; }
batt_t() { dumpsys battery | grep -m1 '  temperature:' | sed -nE 's/.*: ([0-9]+)/\1/p'; }
( while [ ! -e $WS ]; do
    s=$(skin_now); s=${s%.*}
    if [ -n "$s" ] && [ "$s" -ge $SKIN_STOP ]; then
      pkill -f governor-bench; echo "WATCHDOG: skin $s >= $SKIN_STOP, bench killed $(date)" >> $REPORT
    fi
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
for corner in MAX TURBO NOM NOM TURBO MAX; do
  n=$((n + 1))
  lv=$(dumpsys battery | grep -m1 '  level:' | grep -oE '[0-9]+'); [ -n "$lv" ] && [ "$lv" -lt $MIN_LEVEL ] && { echo "STOP: battery $lv" >> $REPORT; break; }
  CSV=$D/vcorner_${n}_$corner.csv
  waited=0
  while :; do
    s=$(skin_now); s=${s%.*}
    [ -n "$s" ] && [ "$s" -le $COOL_SKIN ] && break
    [ $waited -ge 1500 ] && { echo "cool wait gave up at skin $s" >> $REPORT; break; }
    sleep 30; waited=$((waited + 30))
  done
  input keyevent 224; wm dismiss-keyguard
  echo "## $n corner=$corner start $(date +%s) after ${waited}s cool wait [$(st)] feed $(cat $HR)" >> $REPORT
  echo "t_s,skin_c,batt_dc,wake,cpu_hr,npu_hr,gpu_hr" > $CSV
  ( t=0; while [ ! -e $CSV.stop ]; do
      input keyevent 224; wm dismiss-keyguard
      w=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2)
      echo "$t,$(skin_now),$(batt_t),$w,$(tr ' ' ',' < $HR)" >> $CSV; sleep 10; t=$((t + 10))
    done ) &
  arm_env_legs env GGML_HEXAGON_VCORNER=$corner,MAX $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 2049 --legs npu -v > $D/vcorner_${n}_$corner.log 2>&1
  rc=$?
  touch $CSV.stop; sleep 11; rm -f $CSV.stop
  awake=$(grep -vc ",Awake," $CSV); [ "$awake" -gt 1 ] && echo "INVALID: $((awake - 1)) non-Awake samples" >> $REPORT
  echo "## $n corner=$corner exit=$rc end $(date +%s) [$(st)]" >> $REPORT
  grep -E 'lab vcorner|run_start|leg_summary|leg_total' $D/vcorner_${n}_$corner.log | cut -c1-260 >> $REPORT
done
touch $HS $WS
echo "== vcorner end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
