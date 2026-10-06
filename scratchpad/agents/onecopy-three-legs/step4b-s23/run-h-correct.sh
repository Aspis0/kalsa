# Correctness-only check of the J(1) arm H (no timing, so no battery/charge gate): the HOST self-check passes, the
# lm_head is off the HTP, no error, and H's KLD. Used after a fix to the OpenCL HOST leg when a timed session cannot run.
#   . /data/local/tmp/govhtp/step4b-s23/run-h-correct.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step4b-s23/env.sh
. "$D/proofs.sh"
REPORT=$D/hcorrect_report.txt
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
rm -f $REPORT
echo "== H correctness start $(date) [$(st)]" >> $REPORT
echo "binaries: $(sha256sum $D/bin/llama-bench $D/bin/llama-perplexity $DSP_REL/libggml-htp-v73.so | awk '{print substr($1,1,12)}' | tr '\n' ' ')(bench ppl skel)" >> $REPORT
L=$D/hcorrect_proof.log
$ARM_S_ENV $D/bin/llama-bench -m $M -p 0 -n 16 -ub 512 -r 1 -t 1 -ngl 99 -dev HTP0/GPUOpenCL -ts 1/0 -v > $L 2>&1
echo "proof H: exit=$? splits=$(splits_of $L) lm_head_on_htp=$(grep -c 'profile-op MUL_MAT|token_embd.weight' $L) gpu_selfcheck_pass=$(grep -c 'HOST self-check token_embd.weight: PASS' $L) aos_fallback=$(grep -c 'AoS' $L) errors=$(grep -c -E "$ERRPAT|TILE32 leg disabled|self-check .*([Ff][Aa][Ii][Ll])" $L) [$(st)]" >> $REPORT
K=$D/hcorrect_kld.log
$ARM_S_ENV $D/bin/llama-perplexity -m $M $(printf '%s' "$KLD_ARGS" | sed 's#-dev HTP0#-dev HTP0,GPUOpenCL -ts 1,0#') > $K 2>&1
echo "H kld: exit=$? meanKLD=$(grep -m1 -E 'Mean +KLD' $K | sed -nE 's/[^0-9]*([0-9]+\.[0-9]+).*/\1/p') errors=$(grep -c -E "$ERRPAT" $K) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
