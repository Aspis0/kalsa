# Step-5 owner session 2026-10-07 (S23, unplugged): (1) the governor's per-token overhead in one harness - arm A
# (plain context, two-copy, --dev HTP0) vs arm L forced NPU leg (one-copy governor), ABBA, 128 tokens each;
# (2) the decode-hop rule modes free-running on the 1 Hz headroom feeder, -v so every "governor: decode hop" line
# prints the headroom the rule actually used: npu_first raw (today), npu_first tau 10 s, gpu_burst tau 10 s.
# 512 tokens per mode and no KL gate (the two-copy reference holds 256 rows; every leg already passed KL).
# Skin watchdog kills the bench at SKIN_STOP (owner's 44 C).
#   . /data/local/tmp/govhtp/step5-s23/run-step5-modes.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/modes_report.txt; B=$D/bin/governor-bench-e162
HR=$R/headroom.txt; HS=$R/headroom.stop; WS=$D/watchdog.stop
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
rm -f $REPORT $WS
echo "== modes start $(date) binary $(sha256sum $B | cut -c1-12) [$(st)]" >> $REPORT
session_gates || { echo "SESSION ABORTED: preflight gates" >> $REPORT; return 1 2>/dev/null || exit 1; }
cd $D

skin_now() { dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9]+).*/\1/p'; }
( while [ ! -e $WS ]; do
    s=$(skin_now)
    if [ -n "$s" ] && [ "$s" -ge $SKIN_STOP ]; then
      pkill -f governor-bench; echo "WATCHDOG: skin $s >= $SKIN_STOP, bench killed $(date)" >> $REPORT
    fi
    sleep 5
  done ) &

# (1) overhead ABBA
n=0
for arm in A L L A; do
  n=$((n + 1)); input keyevent 224
  case $arm in
    A) $B --arm A --dev HTP0 -m $M -t 5 -r 1 --gen 128 > $D/ovh_${n}_A.log 2>&1 ;;
    L) arm_env_legs $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs npu > $D/ovh_${n}_L.log 2>&1 ;;
  esac
  echo "## ovh $n arm=$arm exit=$? [$(st)]" >> $REPORT
  grep -E '^turn|^summary|leg_summary' $D/ovh_${n}_$arm.log | cut -c1-400 >> $REPORT
  sleep 60
done

# (2) rule modes, free-running on the feeder
sh $D/headroom-feeder.sh $HR $HS &
sleep 3
for mode in "npu_first 0" "npu_first 10" "gpu_burst 10"; do
  set -- $mode
  input keyevent 224
  echo "feed0: $(cat $HR) [$(st)]" >> $REPORT
  arm_env_legs $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 512 --hop-mode $1 --headroom-tau $2 \
    --headroom-file $HR -v > $D/mode_$1_$2.log 2>&1
  echo "## mode=$1 tau=$2 exit=$? [$(st)]" >> $REPORT
  grep -E 'run_start|governor: decode hop|leg_window|leg_summary|leg_pair|leg_total|^kld' $D/mode_$1_$2.log \
    | cut -c1-260 >> $REPORT
  sleep 90
done
touch $HS $WS
echo "== modes end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
