# Amendment D option 1, measurement only (no decision): the ship GGUF with token_embd requantized Q6_K -> Q4_0
# (llama-quantize --allow-requantize --token-embedding-type q4_0; the other 265 tensors byte-identical).
# With a Q4_0 tied output the shared-mode probe can put the output in TILE32, so the lm_head returns to the HTP.
# The input role still takes the CPU list, so the output is still a duplicate here (147 MiB in TILE32); removing it
# needs a CPU tile32 GET_ROWS (engine work, not in this build). Questions: KLD of the requantized embedding (CPU and
# NPU, vs the same CPU base logits of the ship model) and NPU decode with the lm_head back on the HTP.
#   . /data/local/tmp/govhtp/step2-s23/exp-embdq4.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step2-s23/env.sh
. "$D/proofs.sh"
MQ=/data/local/tmp/heat3way/ship-embd-q4_0.gguf
BENCH_ARGS=$(printf '%s' "$BENCH_ARGS" | sed "s#$M#$MQ#")
KLD_ARGS=$(printf '%s' "$KLD_ARGS" | sed "s#$M#$MQ#")
M=$MQ
REPORT=$D/embdq4_report.txt
abort() { echo "SESSION ABORTED: $*" | tee -a $REPORT; exit 1; }

rm -f $REPORT
export ADSP_LIBRARY_PATH="$D/dsp;$R/lib"
echo "== embd-q4_0 session start $(date) model $(sha256sum $M | cut -c1-12) [$(st)]" >> $REPORT
[ -f $D/ops_A.txt ] || abort "missing ops_A.txt from the step-2 session"
session_gates || abort "preflight gates"
# proof S on the requantized model: same gates as step 2 (ops multiset vs the ship-model A run)
proof S "$ARM_S_ENV" || echo "proof S (embd-q4_0) failed - timed arms still run, read the bufs line" >> $REPORT

export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
sleep 60
arm_npu AQ  "$ARM_A_ENV" "" || abort "AQ timed failed"
arm_npu SQ  "$ARM_S_ENV" "" || abort "SQ timed failed"
arm_npu SQ2 "$ARM_S_ENV" "" || abort "SQ2 timed failed"
arm_npu AQ2 "$ARM_A_ENV" "" || abort "AQ2 timed failed"

# CPU KLD of the requantized embedding, same flags as step-1 C-native (ship model: 0.001295)
session_gates || abort "cpu kld gates"
waitcool || abort "cpu kld waitcool"
input keyevent 224; sleep 2
$D/bin/llama-perplexity -m $M $KLD_ARGS_CPU -ngl 0 -nr > $D/kld_cq.log 2>&1
echo "CQ kld: exit=$? meanKLD=$(grep -m1 -E 'Mean +KLD' $D/kld_cq.log | sed -nE 's/[^0-9]*([0-9]+\.[0-9]+).*/\1/p') $(grep -E 'Maximum KLD|Same top p' $D/kld_cq.log | tr -s ' ' | tr '\n' ';')" >> $REPORT
echo "== embd-q4_0 session end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
