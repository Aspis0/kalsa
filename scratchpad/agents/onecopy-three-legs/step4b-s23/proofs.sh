# step-2 proofs (FABLE-DESIGN Amendment B): the two-copy placement diff (B1 gate) and the
# per-arm proof run (B2 gates). Sourced by run-step2.sh after env.sh.

PLACE_PAT='model buffer size|compute buffer size|KV buffer size|graph splits|offloaded [0-9]+/'

# placement_diff TAG FLAGS: the same two-copy load (no env) with the step-1 binary and this one;
# B1 requires the placement lines to be identical when shared mode is off.
placement_diff() {
  tag=$1; flags="$2"
  input keyevent 224; sleep 2
  $OLD_BIN/llama-bench -m $M -p 0 -n 1 -r 1 -t 5 $flags -v > $D/place_old_$tag.log 2>&1; o=$?
  $D/bin/llama-bench   -m $M -p 0 -n 1 -r 1 -t 5 $flags -v > $D/place_new_$tag.log 2>&1; n=$?
  grep -E "$PLACE_PAT" $D/place_old_$tag.log > $D/place_old_$tag.grep
  grep -E "$PLACE_PAT" $D/place_new_$tag.log > $D/place_new_$tag.grep
  lines=$(wc -l < $D/place_new_$tag.grep)
  if [ $o -eq 0 ] && [ $n -eq 0 ] && [ "$lines" -gt 0 ] && cmp -s $D/place_old_$tag.grep $D/place_new_$tag.grep; then
    echo "placement $tag: IDENTICAL ($lines lines, exit $o/$n)" >> $REPORT
    return 0
  fi
  echo "INVALID placement $tag: exit=$o/$n lines=$lines diff: $(diff $D/place_old_$tag.grep $D/place_new_$tag.grep | head -8 | tr '\n' ';')" | tee -a $REPORT
  return 1
}

# proof NAME ENV_FN: one decode pass (-p 0 -n 32) and one prefill pass (-p 512 -n 0, DSP FARF on),
# as in step 1. Arm A must show no TILE32/HOST buffer; arm S must show TILE32 >= TILE_MIN_MIB, a
# HOST buffer <= HOST_MAX_MIB, and the same set of HTP op names as arm A (norms and conv still on
# the NPU, now reading HOST). The op-name sets are written to $D/ops_NAME.txt for that compare.
splits_of() {
  grep -m1 -E 'graph splits|sched_reserve: graph' "$1" |
    sed -nE 's/.*splits = *([0-9]+)( *\/ *([0-9]+))?.*/\1 \3/p' | awk '{ m = $1; if ($2 > m) m = $2; print m }'
}

proof() {
  name=$1; env_fn="$2"
  input keyevent 224; sleep 2
  $env_fn $PROF_ENV $D/bin/llama-bench -m $M -p 0 -n 32 -ub 512 -r 1 -t 1 -ngl 99 -dev HTP0 -v > $D/proof_decode_$name.log 2>&1
  rc1=$?
  logcat -c
  printf '0x1F\n' > $FARF_FILE
  $env_fn $PROF_ENV $D/bin/llama-bench -m $M -p 512 -n 0 -ub 512 -r 1 -t 1 -ngl 99 -dev HTP0 -v > $D/proof_prefill_$name.log 2>&1
  rc2=$?
  rm -f $FARF_FILE
  logcat -d -s adsprpc > $D/adsprpc_$name.log 2>&1

  L=$D/proof_decode_$name.log
  tilemib=$(grep -m1 'HTP0-TILE32 model buffer size' $L | sed -nE 's/.*= *([0-9.]+) MiB.*/\1/p')
  hostmib=$(grep -m1 -E 'HTP0-HOST(-W)? model buffer size' $L | sed -nE 's/.*= *([0-9.]+) MiB.*/\1/p')
  bufs=$(grep 'model buffer size' $L | sed -nE 's/.*: *([A-Za-z0-9_-]+) model buffer size = *([0-9.]+) MiB.*/\1=\2/p' | tr '\n' ' ')
  tiled=$(grep 'profile-op MUL_MAT' $L | grep -c -E 'hvx-tiled|hmx-tiled')
  flat=$(grep 'profile-op MUL_MAT' $L | grep -c 'hvx-flat')
  grep -o 'profile-op [A-Z_0-9]*' $L | sort | uniq -c | awk '{print $3}' > $D/ops_$name.txt
  ops=$(grep -o 'profile-op [A-Z_0-9]*' $L | sort | uniq -c | awk '{printf "%s:%s ", $3, $1}')
  hmx=$(grep -c 'hmx-mm-2d:' $D/adsprpc_$name.log)
  # after the main merge the count is on sched_reserve's line, "splits = N" or "splits = PP / TG": the gate
  # takes the larger, so neither graph can hide a regression
  splits=$(splits_of $L)
  psplits=$(splits_of $D/proof_prefill_$name.log)
  errs=$(grep -c -E "$ERRPAT" $L $D/proof_prefill_$name.log | grep -v ':0' | tr '\n' ' ')
  echo "proof $name: exit=$rc1/$rc2 bufs=[$bufs] splits=${splits:-?}/${psplits:-?} mm=tiled:$tiled flat:$flat hmx-mm-2d=$hmx errors=[$errs] [$(st)]" >> $REPORT
  echo "proof $name ops: $ops" >> $REPORT

  bad=
  [ $rc1 -eq 0 ] && [ $rc2 -eq 0 ] || bad="$bad proof-exit=$rc1/$rc2"
  [ "$tiled" -gt 0 ] || bad="$bad no-tiled-MUL_MAT-tag"
  [ "$flat" -eq 0 ] || bad="$bad flat-MUL_MAT-tags=$flat"
  [ "${splits:-999}" -le $MAX_SPLITS ] || bad="$bad decode-splits=${splits:-none}"
  [ "${psplits:-999}" -le $MAX_SPLITS ] || bad="$bad prefill-splits=${psplits:-none}"
  [ "$hmx" -gt 0 ] || bad="$bad no-hmx-mm-2d-line"
  [ "$errs" = "" ] || bad="$bad error-patterns"
  if [ "$name" = S ]; then
    [ "${tilemib%%.*}" -ge $TILE_MIN_MIB ] 2>/dev/null || bad="$bad TILE32=${tilemib:-none}MiB"
    [ -n "$hostmib" ] && [ "${hostmib%%.*}" -le $HOST_MAX_MIB ] || bad="$bad HOST=${hostmib:-none}MiB"
    cmp -s $D/ops_A.txt $D/ops_S.txt || bad="$bad op-set-differs-from-A($(diff $D/ops_A.txt $D/ops_S.txt | grep '^[<>]' | tr '\n' ' '))"
  else
    [ -z "$tilemib" ] && [ -z "$hostmib" ] || bad="$bad unexpected-TILE32/HOST-buffer"
  fi
  if [ -n "$bad" ]; then
    echo "INVALID proof $name:$bad" | tee -a $REPORT
    return 1
  fi
  echo "proof $name: PASS" >> $REPORT
  return 0
}

# arm_npu: step-1's timed bench + KLD leg, unchanged (copied from step1-s23/run-step1.sh).
arm_npu() {
  name=$1; env_fn="$2"; load="$3"
  export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
  session_gates || return 1
  waitcool || return 1
  input keyevent 224; sleep 2
  echo "== $name bench start $(date +%s) [$(st)]" >> $REPORT
  $env_fn toybox time -v $D/bin/llama-bench $BENCH_ARGS $load > $D/bench_$name.log 2>&1
  rc=$?
  pp=$(sed -nE 's/.*\| *pp512 *\| *([0-9]+\.[0-9]+) .*/\1/p' $D/bench_$name.log | head -1)
  tg=$(sed -nE 's/.*\| *tg128 *\| *([0-9]+\.[0-9]+) .*/\1/p' $D/bench_$name.log | head -1)
  rss=$(grep -E 'Max RSS|Maximum resident' $D/bench_$name.log | head -1 | sed -nE 's/.*: *([0-9]+).*/\1/p')
  errs=$(grep -c -E "$ERRPAT" $D/bench_$name.log)
  echo "$name bench: exit=$rc pp512=${pp:-none} tg128=${tg:-none} maxRSS=${rss:-none}kB errors=$errs" >> $REPORT

  bad=
  [ $rc -eq 0 ] || bad="$bad bench-exit=$rc"
  [ -n "$pp" ] || bad="$bad no-pp512"
  [ -n "$tg" ] || bad="$bad no-tg128"
  [ -n "$rss" ] || bad="$bad no-maxRSS"
  [ "$errs" -eq 0 ] || bad="$bad errors=$errs"
  # no TILE32-buffer check here: without -v llama-bench drops INFO lines; proof_npu ran the same
  # arm args and gated them
  if [ -n "$bad" ]; then
    echo "INVALID $name bench:$bad" | tee -a $REPORT
    return 1
  fi
  sleep 90

  session_gates || return 1
  waitcool || return 1
  input keyevent 224; sleep 2
  echo "== $name kld start $(date +%s) [$(st)]" >> $REPORT
  $env_fn $D/bin/llama-perplexity -m $M $KLD_ARGS $load > $D/kld_$name.log 2>&1
  krc=$?
  kld=$(grep -m1 -E 'Mean +KLD' $D/kld_$name.log | sed -nE 's/[^0-9]*([0-9]+\.[0-9]+).*/\1/p')
  sig=$(grep -E 'Mean +KLD|Maximum KLD|Same top p|Mean PPL' $D/kld_$name.log | tr '\n' ';')
  kerrs=$(grep -c -E "$ERRPAT" $D/kld_$name.log)
  echo "$name kld: exit=$krc meanKLD=${kld:-none} errors=$kerrs" >> $REPORT
  [ -n "$sig" ] && echo "$name kld sig: $sig" >> $REPORT
  bad=
  [ $krc -eq 0 ] || bad="$bad kld-exit=$krc"
  [ -n "$kld" ] || bad="$bad no-meanKLD"
  [ "$kerrs" -eq 0 ] || bad="$bad kld-errors=$kerrs"
  if [ -n "$bad" ]; then
    echo "INVALID $name kld:$bad" | tee -a $REPORT
    return 1
  fi
  sleep 60
  return 0
}
