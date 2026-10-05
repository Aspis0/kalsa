# Amendment J (d): the tied lm_head on the GPU inside the NPU decode. Shared mode, devices HTP0 then GPUOpenCL with
# every layer on HTP0 (-ts 1/0), no OPFILTER, no -ot, KV on the HTP: the HTP keeps every TILE32 op by priority and
# OpenCL takes what the HTP refuses - the flat Q6_K token_embd in HTP0-HOST-W, read in place by 4b's plain kernel.
# ABBA A H H2 A2 on the 5e9b355fd build; H's splits, tg128 against A's and its KLD. KLDs are relative to this
# build's own A (the upstream merge moved the NPU baseline, bisect running).
#   . /data/local/tmp/govhtp/step4b-s23/run-npu-gpulm.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step4b-s23/env.sh
REPORT=$D/gpulm_report.txt
. "$D/proofs.sh"
abort() { echo "SESSION ABORTED: $*" | tee -a $REPORT; exit 1; }

A_BENCH_ARGS="$BENCH_ARGS"
A_KLD_ARGS="$KLD_ARGS"
H_BENCH_ARGS=$(printf '%s' "$BENCH_ARGS" | sed 's#-dev HTP0#-dev HTP0/GPUOpenCL -ts 1/0#')
H_KLD_ARGS=$(printf '%s' "$KLD_ARGS" | sed 's#-dev HTP0#-dev HTP0,GPUOpenCL -ts 1,0#')

proof_h() {
  input keyevent 224; sleep 2
  $ARM_S_ENV $PROF_ENV $D/bin/llama-bench -m $M -p 0 -n 16 -ub 512 -r 1 -t 1 -ngl 99 -dev HTP0/GPUOpenCL -ts 1/0 -v > $D/proof_H.log 2>&1
  rc=$?
  L=$D/proof_H.log
  sp=$(splits_of $L)
  lm_htp=$(grep -c 'profile-op MUL_MAT|token_embd.weight' $L)
  selfck=$(grep -c 'HOST self-check token_embd.weight: PASS' $L)
  errs=$(grep -c -E "$ERRPAT|TILE32 leg disabled|self-check .*([Ff][Aa][Ii][Ll])" $L)
  echo "proof H: exit=$rc splits=${sp:-?} lm_head_on_htp=$lm_htp gpu_selfcheck_pass=$selfck errors=$errs [$(st)]" >> $REPORT
  grep -h -E 'TILE32 leg|imported|shared weights:|model buffer size|compute buffer size' $L | cut -c1-160 | sed 's/^/proof H: /' >> $REPORT
  [ $rc -eq 0 ] && [ "$lm_htp" -eq 0 ] && [ "$selfck" -ge 1 ] && [ "$errs" -eq 0 ] || return 1
  echo "proof H: PASS" >> $REPORT
}

rm -f $REPORT
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
echo "== NPU+GPU-lm_head session start $(date) [$(st)]" >> $REPORT
echo "binaries: $(sha256sum $D/bin/llama-bench $D/bin/llama-perplexity $DSP_REL/libggml-htp-v73.so | awk '{print substr($1,1,12)}' | tr '\n' ' ')(bench ppl skel)" >> $REPORT
session_gates || abort "preflight gates"
proof_h || abort "H proof failed"
sleep 60
arm_npu A  "$ARM_A_ENV" "" || abort "A timed failed"
BENCH_ARGS="$H_BENCH_ARGS"; KLD_ARGS="$H_KLD_ARGS"
arm_npu H  "$ARM_S_ENV" "" || abort "H timed failed"
arm_npu H2 "$ARM_S_ENV" "" || abort "H2 timed failed"
BENCH_ARGS="$A_BENCH_ARGS"; KLD_ARGS="$A_KLD_ARGS"
arm_npu A2 "$ARM_A_ENV" "" || abort "A2 timed failed"
echo "== NPU+GPU-lm_head session end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
