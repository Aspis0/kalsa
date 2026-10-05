# option-3 session (Amendment H3): in shared mode the tied lm_head (token_embd, flat Q6_K in HTP0-HOST-W) must run on
# the HTP from its raw rows (DMA 1680 B rows into VTCM, converted to tiles there). Proof: one verbose decode of S
# with op profiling shows a MUL_MAT on token_embd.weight with q6_K on HTP0, and S's graph splits drop to A's.
# Then NPU ABBA A/S on the same build: gates pp512 >= 0.98 and tg128 >= 0.95 of A, S KLD = A KLD (the raw path
# reads the same values the two-copy tiles hold). Release skel only (no FARF proof here; step 4b's proof covered HMX).
#   . /data/local/tmp/govhtp/opt3-s23/run-opt3.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/opt3-s23/env.sh
. /data/local/tmp/govhtp/step4b-s23/proofs.sh
abort() { echo "SESSION ABORTED: $*" | tee -a $REPORT; exit 1; }

proof_lmhead() {
  input keyevent 224; sleep 2
  $ARM_S_ENV $PROF_ENV $D/bin/llama-bench -m $M -p 0 -n 16 -ub 512 -r 1 -t 1 -ngl 99 -dev HTP0 -v > $D/proof_S.log 2>&1
  rc=$?
  L=$D/proof_S.log
  lm=$(grep 'profile-op MUL_MAT|token_embd.weight' $L | head -1 | cut -d'|' -f2-6)
  n_lm=$(grep -c 'profile-op MUL_MAT|token_embd.weight' $L)
  sp=$(splits_of $L)
  errs=$(grep -c -E "$ERRPAT|raw Q6_K" $L)
  echo "proof S lm_head: exit=$rc n=$n_lm splits=${sp:-?} errors=$errs line=[$lm] [$(st)]" >> $REPORT
  grep -h -E 'shared weights:|model buffer size' $L | sed 's/^/proof S: /' >> $REPORT
  [ $rc -eq 0 ] && [ "$n_lm" -ge 1 ] && [ "${sp:-99}" -le 2 ] && [ "$errs" -eq 0 ] || return 1
  echo "proof S lm_head: PASS" >> $REPORT
}

rm -f $REPORT
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
echo "== option-3 session start $(date) [$(st)]" >> $REPORT
echo "binaries: $(sha256sum $D/bin/llama-bench $D/bin/llama-perplexity $DSP_REL/libggml-htp-v73.so | awk '{print substr($1,1,12)}' | tr '\n' ' ')(bench ppl skel)" >> $REPORT
[ -x $D/bin/llama-bench ] || abort "missing binaries"
session_gates || abort "preflight gates"
proof_lmhead || abort "lm_head proof failed"
sleep 60
arm_npu A  "$ARM_A_ENV" "" || abort "A timed failed"
arm_npu S  "$ARM_S_ENV" "" || abort "S timed failed"
arm_npu S2 "$ARM_S_ENV" "" || abort "S2 timed failed"
arm_npu A2 "$ARM_A_ENV" "" || abort "A2 timed failed"
echo "== option-3 session end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
