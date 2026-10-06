# Step-5 KL localization (S23, unplugged): each leg alone over 256 tokens vs the same two-copy reference
# ($D/twocopy.gbl from run-step5-legs.sh; arm G prefills on the first enumerated accelerator = GPUOpenCL, decodes on
# the CPU), plus the NPU leg at 5 host threads. Per-window KL in every leg_window line.
#   . /data/local/tmp/govhtp/step5-s23/run-step5-localize.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/localize_report.txt
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
rm -f $REPORT
echo "== localize start $(date) binary $(sha256sum $D/bin/governor-bench | cut -c1-12) [$(st)]" >> $REPORT
session_gates || { echo "SESSION ABORTED: preflight gates" >> $REPORT; exit 1; }
grep -oE 'prefill_backend=[^ ]+' $D/armG.log | head -1 >> $REPORT
cd $D
for arm in cpu npu gpu npu5; do
  case $arm in npu5) LEGS="--legs npu --leg-threads 5,1,5";; *) LEGS="--legs $arm";; esac
  input keyevent 224
  arm_env_shared $D/bin/governor-bench --arm L -m $M -t 5 -r 1 --hop 32 --gen 256 $LEGS --logits-ref $D/twocopy.gbl --kld-max 0.01 > $D/loc_$arm.log 2>&1
  echo "## $arm ($LEGS): exit=$? [$(st)]" >> $REPORT
  grep -E 'leg_window|leg_summary|^kld' $D/loc_$arm.log | cut -c1-230 >> $REPORT
  sleep 45
done
echo "== localize end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
