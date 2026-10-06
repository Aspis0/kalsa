# Step-5 F5 gate on the S23 (unplugged, battery >= 30 %): forced NPU->GPU->CPU->NPU every 32 tokens over 256
# generated tokens on ONE model (governor-bench arm L), KL vs the two-copy governor's greedy logits (arm G).
#   . /data/local/tmp/govhtp/step5-s23/run-step5-legs.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step5-s23/env.sh
D=$R/step5-s23; REPORT=$D/step5_report.txt
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
rm -f $REPORT
echo "== step-5 legs session start $(date) [$(st)]" >> $REPORT
echo "binary: $(sha256sum $D/bin/governor-bench | cut -c1-12) skel: $(sha256sum $DSP_REL/libggml-htp-v73.so | cut -c1-12)" >> $REPORT
session_gates || { echo "SESSION ABORTED: preflight gates" >> $REPORT; exit 1; }

cd $D
input keyevent 224
$D/bin/governor-bench --arm G -m $M -t 5 -r 1 --gen 256 --logits-out $D/twocopy.gbl -v > $D/armG.log 2>&1
echo "G ref: exit=$? $(grep -E '^run_end|tok_s|summary' $D/armG.log | tail -3 | tr '\n' ' ') [$(st)]" >> $REPORT
sleep 60
input keyevent 224
arm_env_shared $D/bin/governor-bench --arm L -m $M -t 5 -r 1 --hop 32 --gen 256 --logits-ref $D/twocopy.gbl --kld-max 0.01 -v > $D/armL.log 2>&1
echo "L: exit=$? [$(st)]" >> $REPORT
grep -E 'leg_summary|leg_hop|leg_window|^kld|KLD|WARNING|splits = |imported|self-check .*FAIL|error|landed' $D/armL.log | cut -c1-220 >> $REPORT
echo "== step-5 legs session end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
