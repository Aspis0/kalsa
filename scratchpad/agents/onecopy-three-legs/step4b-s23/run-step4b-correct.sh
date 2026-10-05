# step-4b correctness session (FABLE-DESIGN Amendment G): no timing, so it may run plugged. The GPU leg (G) must
# import the two TILE32 blocks and the HOST block, pass the TILE32 and HOST self-checks, and its KLD at -ub 1 must
# match the CPU base like step 4's G did; graph splits are recorded (Amendment G target: <= 2 once KV is on the GPU
# in step 5, so here they only have to drop from step 4's 197).
#   . /data/local/tmp/govhtp/step4b-s23/run-step4b-correct.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step4b-s23/env.sh
abort() { echo "SESSION ABORTED: $*" | tee -a $REPORT; exit 1; }

skin_ok() {
  sk=$(dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p')
  awk -v s="${sk:-99}" -v m="$SKIN_STOP" 'BEGIN { exit !(s < m) }' || { echo "SKIN STOP: ${sk:-unknown} C" | tee -a $REPORT; return 1; }
}

proof_gpu_host() {
  input keyevent 224; sleep 2
  $ARM_G_ENV $D/bin/llama-bench -m $M -p 0 -n 16 -r 1 -t 1 $ARM_G_BENCH_FLAGS -v > $D/proof_G.log 2>&1
  rc=$?
  L=$D/proof_G.log
  grep -E 'TILE32 leg|ggml-opencl-tile32|HOST self-check|HOST import|model buffer size|graph splits' $L | cut -c1-200 | sed 's/^/proof G: /' >> $REPORT
  enabled=$(grep -c 'TILE32 leg enabled' $L)
  imports=$(grep -c 'ggml-opencl-tile32: imported' $L)
  host_imp=$(grep -c 'ggml-opencl-tile32: imported .*HOST' $L)
  host_ok=$(grep -c 'HOST self-check .*: PASS' $L)
  errs=$(grep -c -E "$ERRPAT|TILE32 leg disabled|self-check .*([Ff][Aa][Ii][Ll])|HOST import:" $L)
  echo "proof G: exit=$rc enabled=$enabled imports=$imports host_imports=$host_imp host_selfcheck_pass=$host_ok errors=$errs [$(st)]" >> $REPORT
  [ $rc -eq 0 ] && [ "$enabled" -ge 1 ] && [ "$imports" -ge 3 ] && [ "$host_imp" -ge 1 ] && [ "$host_ok" -ge 1 ] && [ "$errs" -eq 0 ] || return 1
  echo "proof G: PASS" >> $REPORT
}

kld_gpu() {
  skin_ok || return 1
  input keyevent 224; sleep 2
  echo "== G kld start $(date +%s) [$(st)]" >> $REPORT
  $ARM_G_ENV $D/bin/llama-perplexity -m $M $GPU_KLD_ARGS $ARM_G_KLD_FLAGS > $D/kld_G.log 2>&1
  krc=$?
  kld=$(grep -m1 -E 'Mean +KLD' $D/kld_G.log | sed -nE 's/[^0-9]*([0-9]+\.[0-9]+).*/\1/p')
  splits=$(grep -m1 'graph splits' $D/kld_G.log | sed -nE 's/.*= *([0-9]+).*/\1/p')
  errs=$(grep -c -E "$ERRPAT|self-check .*([Ff][Aa][Ii][Ll])" $D/kld_G.log)
  echo "G kld: exit=$krc meanKLD=${kld:-none} splits=${splits:-?} errors=$errs $(grep -E 'Same top p' $D/kld_G.log | tr -s ' ') [$(st)]" >> $REPORT
  [ $krc -eq 0 ] && [ -n "$kld" ] && [ "$errs" -eq 0 ] || { echo "INVALID G kld" | tee -a $REPORT; return 1; }
}

rm -f $REPORT
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
echo "== step-4b correctness session start $(date) [$(st)]" >> $REPORT
echo "binaries: $(sha256sum $D/bin/llama-bench $D/bin/llama-perplexity | awk '{print substr($1,1,12)}' | tr '\n' ' ')" >> $REPORT
[ -x $D/bin/llama-bench ] && [ -x $D/bin/llama-perplexity ] || abort "missing binaries"
skin_ok || abort "skin"
proof_gpu_host || abort "G proof failed"
sleep 30
kld_gpu || abort "G kld failed"
echo "== step-4b correctness session end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
