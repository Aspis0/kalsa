# step-4 session (FABLE-DESIGN Amendment E5): the GPU leg reading the one TILE32 copy (G) against today's
# two-copy OpenCL decode (O), ABBA O G G2 O2, decode only (-p 0, owner: no GPU prefill), one host thread.
# Per arm: tg128, graph splits, CPU seconds (toybox time -v user+sys) and KLD at -ub 1.
#   . /data/local/tmp/govhtp/step4-s23/run-step4.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step4-s23/env.sh
abort() { echo "SESSION ABORTED: $*" | tee -a $REPORT; exit 1; }

# proof_gpu: one verbose decode run of G; the leg must announce itself (gate, two imports for the two capped
# TILE32 buffers, self-check) and the HTP must run no op.
proof_gpu() {
  input keyevent 224; sleep 2
  $ARM_G_ENV $D/bin/llama-bench -m $M -p 0 -n 16 -r 1 -t 1 $ARM_G_BENCH_FLAGS -v > $D/proof_G.log 2>&1
  rc=$?
  L=$D/proof_G.log
  grep -E 'TILE32 leg|ggml-opencl-tile32|model buffer size|graph splits' $L | cut -c1-200 | sed 's/^/proof G: /' >> $REPORT
  enabled=$(grep -c 'TILE32 leg enabled' $L)
  imports=$(grep -c 'ggml-opencl-tile32: imported' $L)
  errs=$(grep -c -E "$ERRPAT|TILE32 leg disabled|self-check .*fail" $L)
  echo "proof G: exit=$rc enabled=$enabled imports=$imports errors=$errs [$(st)]" >> $REPORT
  [ $rc -eq 0 ] && [ "$enabled" -ge 1 ] && [ "$imports" -ge 2 ] && [ "$errs" -eq 0 ] || return 1
  echo "proof G: PASS" >> $REPORT
}

arm_gpu() {
  name=$1; env_fn="$2"; flags="$3"; kflags="$4"
  export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
  session_gates || return 1
  waitcool || return 1
  input keyevent 224; sleep 2
  echo "== $name bench start $(date +%s) [$(st)]" >> $REPORT
  $env_fn toybox time -v $D/bin/llama-bench $GPU_BENCH_ARGS $flags > $D/bench_$name.log 2>&1
  rc=$?
  tg=$(sed -nE 's/.*\| *tg128 *\| *([0-9]+\.[0-9]+) .*/\1/p' $D/bench_$name.log | head -1)
  ut=$(sed -nE 's/.*User time \(seconds\): *([0-9.]+).*/\1/p' $D/bench_$name.log | head -1)
  sy=$(sed -nE 's/.*System time \(seconds\): *([0-9.]+).*/\1/p' $D/bench_$name.log | head -1)
  el=$(sed -nE 's/.*Elapsed \(wall clock\) time.*: *(.*)/\1/p' $D/bench_$name.log | head -1)
  errs=$(grep -c -E "$ERRPAT" $D/bench_$name.log)
  echo "$name bench: exit=$rc tg128=${tg:-none} cpu_user=${ut:-?}s cpu_sys=${sy:-?}s wall=${el:-?} errors=$errs [$(st)]" >> $REPORT
  [ $rc -eq 0 ] && [ -n "$tg" ] && [ "$errs" -eq 0 ] || { echo "INVALID $name bench" | tee -a $REPORT; return 1; }
  sleep 90
  session_gates || return 1
  waitcool || return 1
  input keyevent 224; sleep 2
  echo "== $name kld start $(date +%s) [$(st)]" >> $REPORT
  $env_fn $D/bin/llama-perplexity -m $M $GPU_KLD_ARGS $kflags > $D/kld_$name.log 2>&1
  krc=$?
  kld=$(grep -m1 -E 'Mean +KLD' $D/kld_$name.log | sed -nE 's/[^0-9]*([0-9]+\.[0-9]+).*/\1/p')
  splits=$(grep -m1 'graph splits' $D/kld_$name.log | sed -nE 's/.*= *([0-9]+).*/\1/p')
  echo "$name kld: exit=$krc meanKLD=${kld:-none} splits=${splits:-?} $(grep -E 'Same top p' $D/kld_$name.log | tr -s ' ')" >> $REPORT
  [ $krc -eq 0 ] && [ -n "$kld" ] || { echo "INVALID $name kld" | tee -a $REPORT; return 1; }
  sleep 60
}

rm -f $REPORT
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
echo "== step-4 session start $(date) [$(st)]" >> $REPORT
echo "binaries: $(sha256sum $D/bin/llama-bench $OLD_BIN/llama-bench | awk '{print substr($1,1,12)}' | tr '\n' ' ')(new old)" >> $REPORT
[ -x $D/bin/llama-bench ] && [ -x $OLD_BIN/llama-bench ] || abort "missing binaries"
session_gates || abort "preflight gates"
proof_gpu || abort "G proof failed"
sleep 60
arm_gpu O  "$ARM_O_ENV" "$ARM_O_FLAGS" "$ARM_O_FLAGS" || abort "O failed"
arm_gpu G  "$ARM_G_ENV" "$ARM_G_BENCH_FLAGS" "$ARM_G_KLD_FLAGS" || abort "G failed"
arm_gpu G2 "$ARM_G_ENV" "$ARM_G_BENCH_FLAGS" "$ARM_G_KLD_FLAGS" || abort "G2 failed"
arm_gpu O2 "$ARM_O_ENV" "$ARM_O_FLAGS" "$ARM_O_FLAGS" || abort "O2 failed"
echo "== step-4 session end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
