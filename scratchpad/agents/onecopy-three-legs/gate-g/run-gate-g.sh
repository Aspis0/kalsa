# gate-G ABBA session: A = two-copy NPU (mmap as shipped), B = tiled HOST one-copy (-lm none).
# Run on the phone in ONE adb shell, unplugged, screen on, after push-and-check.sh (sourced,
# like the old sessions - the gate functions must live in the same shell):
#   . /data/local/tmp/govhtp/gate-g/run-gate-g.sh
# Everything lands in $D/gateg_report.txt plus per-run logs $D/*.log.

[ -n "${D:-}" ] || . /data/local/tmp/govhtp/gate-g/env.sh

abort() { echo "SESSION ABORTED: $*" | tee -a $D/gateg_report.txt; exit 1; }

sum_bytes() {  # sum of bytes= values on stdin
  s=0
  for b in $(sed -nE 's/.*bytes=([0-9]+).*/\1/p'); do s=$((s + b)); done
  echo $s
}

# proof NAME: one decode pass (-p 0 -n 32) and one prefill pass (-p 512 -n 0) with the profile
# env; the prefill pass runs with the DSP FARF mask on and its kernel lines are taken from
# logcat -s adsprpc. Kernel family per MUL_MAT comes from the profile-op kparams column
# (hvx-tiled / hmx-tiled / hvx-flat). Enforces the arm's proof lines; a missing line = invalid arm.
proof() {
  name=$1; arm_env="$2"; load="$3"
  input keyevent 224; sleep 2
  env $arm_env $PROF_ENV $D/bin/llama-bench -m $M -p 0 -n 32 -ub 512 -r 1 -t 1 -ngl 99 -dev HTP0 $load -v > $D/proof_decode_$name.log 2>&1
  rc1=$?
  logcat -c
  printf '0x1F\n' > $FARF_FILE
  env $arm_env $PROF_ENV $D/bin/llama-bench -m $M -p 512 -n 0 -ub 512 -r 1 -t 1 -ngl 99 -dev HTP0 $load -v > $D/proof_prefill_$name.log 2>&1
  rc2=$?
  rm -f $FARF_FILE
  logcat -d -s adsprpc > $D/adsprpc_$name.log 2>&1

  repack=$(grep -c 'HOST-REPACK tensor=' $D/proof_decode_$name.log)
  rbytes=$(grep 'HOST-REPACK tensor=' $D/proof_decode_$name.log | sum_bytes)
  hostbuf=$(grep -c 'HTP0-HOST model buffer size' $D/proof_decode_$name.log)
  tiled=$(grep 'profile-op MUL_MAT' $D/proof_decode_$name.log | grep -c -E 'hvx-tiled|hmx-tiled')
  flat=$(grep 'profile-op MUL_MAT' $D/proof_decode_$name.log | grep -c 'hvx-flat')
  hmx=$(grep -c 'hmx-mm-2d:' $D/adsprpc_$name.log)
  hmxline=$(grep -m1 'hmx-mm-2d:' $D/adsprpc_$name.log | sed 's/^.*hmx-mm-2d:/hmx-mm-2d:/')
  splits=$(grep -m1 'graph splits' $D/proof_decode_$name.log | sed -nE 's/.*= *([0-9]+).*/\1/p')
  loadms=$(grep -m1 'load time =' $D/proof_decode_$name.log | sed -nE 's/.*= *([0-9.]+) ms.*/\1/p')
  errs=$(grep -c -E "$ERRPAT" $D/proof_decode_$name.log $D/proof_prefill_$name.log | grep -v ':0' | tr '\n' ' ')
  echo "proof $name: exit=$rc1/$rc2 HOST-REPACK=$repack ($rbytes bytes) HTP0-HOST-buf=$hostbuf splits=${splits:-?} mm=kern-tiled:$tiled flat:$flat hmx-mm-2d=$hmx load=${loadms:-?}ms errors=[$errs] [$(st)]" >> $D/gateg_report.txt
  [ -n "$hmxline" ] && echo "proof $name: $hmxline" >> $D/gateg_report.txt

  bad=
  [ $rc1 -eq 0 ] && [ $rc2 -eq 0 ] || bad="$bad proof-exit=$rc1/$rc2"
  [ "$tiled" -gt 0 ] || bad="$bad no-tiled-MUL_MAT-tag"
  [ "${splits:-999}" -le $MAX_SPLITS ] || bad="$bad graph-splits=${splits:-none}"
  [ "$hmx" -gt 0 ] || bad="$bad no-hmx-mm-2d-line"
  [ "$errs" = "" ] || bad="$bad error-patterns"
  if [ $name = B ]; then
    [ "$repack" -gt 0 ] || bad="$bad no-HOST-REPACK-lines"
    [ "$rbytes" -gt 0 ] || bad="$bad no-packed-bytes"
    [ "$hostbuf" -gt 0 ] || bad="$bad no-HTP0-HOST-buffer-line"
  else
    [ "$repack" -eq 0 ] || bad="$bad unexpected-HOST-REPACK-lines"
    [ "$hostbuf" -eq 0 ] || bad="$bad unexpected-HTP0-HOST-buffer"
  fi
  if [ -n "$bad" ]; then
    echo "INVALID proof $name:$bad" | tee -a $D/gateg_report.txt
    return 1
  fi
  echo "proof $name: PASS" >> $D/gateg_report.txt
  return 0
}

# arm NAME: timed bench (-r 3 -t 1) + KLD, 90 s gap. Guard rails and proof lines enforced here;
# an arm failing its gates returns 1 so the session aborts instead of passing bad data.
arm() {
  name=$1; arm_env="$2"; load="$3"
  export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
  session_gates || return 1
  waitcool || return 1
  input keyevent 224; sleep 2
  echo "== $name bench start $(date +%s) [$(st)]" >> $D/gateg_report.txt
  env $arm_env toybox time -v $D/bin/llama-bench $BENCH_ARGS $load > $D/bench_$name.log 2>&1
  rc=$?
  pp=$(sed -nE 's/.*\| *pp512 *\| *([0-9]+\.[0-9]+) .*/\1/p' $D/bench_$name.log | head -1)
  tg=$(sed -nE 's/.*\| *tg128 *\| *([0-9]+\.[0-9]+) .*/\1/p' $D/bench_$name.log | head -1)
  rss=$(grep -E 'Max RSS|Maximum resident' $D/bench_$name.log | head -1 | sed -nE 's/.*: *([0-9]+).*/\1/p')
  errs=$(grep -c -E "$ERRPAT" $D/bench_$name.log)
  echo "$name bench: exit=$rc pp512=${pp:-none} tg128=${tg:-none} maxRSS=${rss:-none}kB errors=$errs" >> $D/gateg_report.txt

  bad=
  [ $rc -eq 0 ] || bad="$bad bench-exit=$rc"
  [ -n "$pp" ] || bad="$bad no-pp512"
  [ -n "$tg" ] || bad="$bad no-tg128"
  [ -n "$rss" ] || bad="$bad no-maxRSS"
  [ "$errs" -eq 0 ] || bad="$bad errors=$errs"
  # no HOST-REPACK check here: without -v llama-bench drops INFO lines; proof() ran the same arm args
  if [ -n "$bad" ]; then
    echo "INVALID $name bench:$bad" | tee -a $D/gateg_report.txt
    return 1
  fi
  sleep 90

  session_gates || return 1
  waitcool || return 1
  input keyevent 224; sleep 2
  echo "== $name kld start $(date +%s) [$(st)]" >> $D/gateg_report.txt
  env $arm_env $D/bin/llama-perplexity -m $M $KLD_ARGS $load > $D/kld_$name.log 2>&1
  krc=$?
  kld=$(grep -m1 -E 'Mean +KLD' $D/kld_$name.log | sed -nE 's/[^0-9]*([0-9]+\.[0-9]+).*/\1/p')
  sig=$(grep -E 'Mean +KLD|Maximum KLD|Same top p|Mean PPL' $D/kld_$name.log | tr '\n' ';')
  kerrs=$(grep -c -E "$ERRPAT" $D/kld_$name.log)
  echo "$name kld: exit=$krc meanKLD=${kld:-none} errors=$kerrs" >> $D/gateg_report.txt
  [ -n "$sig" ] && echo "$name kld sig: $sig" >> $D/gateg_report.txt
  bad=
  [ $krc -eq 0 ] || bad="$bad kld-exit=$krc"
  [ -n "$kld" ] || bad="$bad no-meanKLD"
  [ "$kerrs" -eq 0 ] || bad="$bad kld-errors=$kerrs"
  if [ -n "$bad" ]; then
    echo "INVALID $name kld:$bad" | tee -a $D/gateg_report.txt
    return 1
  fi
  sleep 60
  return 0
}

rm -f $D/gateg_report.txt
export ADSP_LIBRARY_PATH="$D/dsp;$R/lib"
echo "== gate-G session start $(date) [$(st)]" >> $D/gateg_report.txt
[ -x $D/bin/llama-bench ] && [ -x $D/bin/llama-perplexity ] || abort "missing binaries in $D/bin (run push-and-check.sh first)"
[ -f $D/dsp/libggml-htp-v73.so ] || abort "missing skel in $D/dsp"
[ -f $DSP_REL/libggml-htp-v73.so ] || abort "missing release skel in $DSP_REL"
[ -f $M ] || abort "missing model $M"
[ -f $FIXT ] || abort "missing fixture $FIXT"
[ -f $BASELOGITS ] || abort "missing base logits $BASELOGITS"
session_gates || abort "preflight gates"

proof A "$ARM_A_ENV" "" || abort "arm A proof failed"
sleep 60
proof B "$ARM_B_ENV" "$ARM_B_LOAD" || abort "arm B proof failed"
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
sleep 60
arm A "$ARM_A_ENV" "" || abort "arm A timed failed"
arm B "$ARM_B_ENV" "$ARM_B_LOAD" || abort "arm B timed failed"
arm B2 "$ARM_B_ENV" "$ARM_B_LOAD" || abort "arm B2 timed failed"
arm A2 "$ARM_A_ENV" "" || abort "arm A2 timed failed"

# every arm and proof line above already landed in the report; the ABBA comparison
# (pp512/tg128 >= 0.95 of two-copy, KLD A vs B) is the coordinator's call on these lines.
echo "== gate-G session end $(date) [$(st)]" >> $D/gateg_report.txt
echo "SESSION COMPLETE - read \$D/gateg_report.txt"
