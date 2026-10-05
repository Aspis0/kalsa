# CPU arms of the step-1 session: the shipped CPU decode paths (native, repack) and C-tile
# (Q4_0 weights in HTP0-TILE32, MUL_MAT computing on the CPU). Sourced by run-step1.sh in the
# same shell, so the guard-rail functions, $D/$M/$REPORT and the arm definitions from env.sh are
# in scope. Each function returns 1 on a failed gate; the caller aborts the session.

# proof_cpu NAME ENV_FN FLAGS: verbose 32-token decode on the CPU. Placement is the proof:
# C-repack must show a CPU_REPACK buffer, C-native must not, and no layout buft of the NPU may
# appear. Without -v llama-bench drops the INFO lines the greps read.
proof_cpu() {
  name=$1; env_fn="$2"; flags="$3"
  input keyevent 224; sleep 2
  $env_fn $D/bin/llama-bench -m $M -p 0 -n 32 -ub 128 -r 1 -t 1 $flags -v > $D/proof_$name.log 2>&1
  rc=$?
  repack=$(grep -c 'CPU_REPACK model buffer size' $D/proof_$name.log)
  tile=$(grep -c 'HTP0-TILE32 model buffer size' $D/proof_$name.log)
  hostbuf=$(grep -c 'HTP0-HOST model buffer size' $D/proof_$name.log)
  htp=$(grep -c 'HTP0 model buffer size' $D/proof_$name.log)
  splits=$(grep -m1 'graph splits' $D/proof_$name.log | sed -nE 's/.*= *([0-9]+).*/\1/p')
  errs=$(grep -c -E "$ERRPAT" $D/proof_$name.log)
  echo "proof $name: exit=$rc CPU_REPACK-buf=$repack HTP0-buf=$htp TILE32-buf=$tile HOST-buf=$hostbuf splits=${splits:-?} errors=$errs [$(st)]" >> $REPORT

  bad=
  [ $rc -eq 0 ] || bad="$bad proof-exit=$rc"
  [ "$errs" -eq 0 ] || bad="$bad error-patterns"
  [ "$tile" -eq 0 ] || bad="$bad unexpected-HTP0-TILE32-buffer"
  [ "$hostbuf" -eq 0 ] || bad="$bad unexpected-HTP0-HOST-buffer"
  [ "$htp" -eq 0 ] || bad="$bad unexpected-HTP0-buffer"
  if [ "$name" = c_repack ]; then
    [ "$repack" -gt 0 ] || bad="$bad no-CPU_REPACK-buffer"
  else
    [ "$repack" -eq 0 ] || bad="$bad unexpected-CPU_REPACK-buffer"
  fi
  if [ -n "$bad" ]; then
    echo "INVALID proof $name:$bad" | tee -a $REPORT
    return 1
  fi
  echo "proof $name: PASS" >> $REPORT
  return 0
}

# proof_ctile NAME ENV_FN FLAGS: two verbose passes at -t 5, decode (-p 0 -n 32, every weight at
# ne11=1) and prefill (-p 128 -n 0 -ub 128, every weight at ne11=128). ENV_FN is the arm env
# (REPACK + GGML_HEXAGON_OPFILTER=.*); PROF_ENV is added so that an HTP op would print a
# profile-op line and be caught. The proof line is the tile32 dispatch in ggml-cpu/tile32.cpp:128.
proof_ctile() {
  name=$1; env_fn="$2"; flags="$3"
  input keyevent 224; sleep 2
  dec=$D/proof_${name}_decode.log
  pre=$D/proof_${name}_prefill.log
  $env_fn $PROF_ENV $D/bin/llama-bench -m $M -p 0 -n 32 -ub 128 -r 1 -t 5 $flags -v > $dec 2>&1
  rc1=$?
  $env_fn $PROF_ENV $D/bin/llama-bench -m $M -p 128 -n 0 -ub 128 -r 1 -t 5 $flags -v > $pre 2>&1
  rc2=$?

  tilemib=$(grep -m1 'HTP0-TILE32 model buffer size' $dec | sed -nE 's/.*= *([0-9.]+) MiB.*/\1/p')
  tileint=${tilemib%%.*}
  htp=$(grep -m1 'HTP0 model buffer size' $dec | sed -nE 's/.*= *([0-9.]+) MiB.*/\1/p')
  htpint=${htp%%.*}; htpint=${htpint:-0}
  tens=$(grep 'ggml-cpu: tile32 MUL_MAT tensor=' $dec | sed -nE 's/.*tensor=([^ ]+) .*/\1/p' | sort -u | wc -l | tr -d ' ')
  t1=$(grep -c 'ggml-cpu: tile32 MUL_MAT tensor=.* ne11=1$' $dec)
  tpre=$(( $(grep -c 'ggml-cpu: tile32 MUL_MAT tensor=' $pre) - $(grep -c 'ggml-cpu: tile32 MUL_MAT tensor=.* ne11=1$' $pre) ))
  profmm=$(( $(grep -c 'profile-op MUL_MAT' $dec) + $(grep -c 'profile-op MUL_MAT' $pre) ))
  profany=$(( $(grep -c 'profile-op ' $dec) + $(grep -c 'profile-op ' $pre) ))
  splits=$(grep -m1 'graph splits' $dec | sed -nE 's/.*= *([0-9]+).*/\1/p')
  loadms=$(grep -m1 'load time =' $dec | sed -nE 's/.*= *([0-9.]+) ms.*/\1/p')
  errs=$(( $(grep -c -E "$ERRPAT" $dec) + $(grep -c -E "$ERRPAT" $pre) ))
  echo "proof $name: exit=$rc1/$rc2 TILE32-buf=${tilemib:-none}MiB tensors=$tens/${TILE_REF_TENSORS} (decode ne11=1:$t1 prefill ne11>1:$tpre) HTP0-buf=${htp:-none}MiB profile-op=$profany profile-op-MUL_MAT=$profmm splits=${splits:-?} load=${loadms:-?}ms errors=$errs [$(st)]" >> $REPORT

  bad=
  [ $rc1 -eq 0 ] && [ $rc2 -eq 0 ] || bad="$bad proof-exit=$rc1/$rc2"
  [ -n "$tilemib" ] || bad="$bad no-HTP0-TILE32-buffer"
  [ "${tileint:-0}" -ge $TILE_MIN_MIB ] || bad="$bad TILE32-buffer-too-small=${tilemib:-none}MiB"
  [ "$t1" -gt 0 ] || bad="$bad no-tile32-line-at-ne11=1"
  [ "$tpre" -gt 0 ] || bad="$bad no-tile32-line-at-ne11>1"
  [ "$profmm" -eq 0 ] || bad="$bad htp-profile-op-MUL_MAT=$profmm"
  [ "$profany" -eq 0 ] || bad="$bad htp-profile-op=$profany"
  [ "$htpint" -eq 0 ] || bad="$bad unexpected-HTP0-buffer=${htp:-?}MiB"
  [ "$errs" -eq 0 ] || bad="$bad error-patterns=$errs"
  if [ -n "$bad" ]; then
    echo "INVALID proof $name:$bad" | tee -a $REPORT
    return 1
  fi
  echo "proof $name: PASS" >> $REPORT
  return 0
}

# arm_cpu_bench NAME ENV_FN FLAGS THREADS: -p 128 -n 128 -r 3 at -t THREADS, guard rails as the
# NPU arms. FLAGS carries the arm's device selection (-ngl 0 / the C-tile flags).
arm_cpu_bench() {
  name=$1; env_fn="$2"; flags="$3"; nth="$4"
  session_gates || return 1
  waitcool || return 1
  input keyevent 224; sleep 2
  echo "== $name bench start $(date +%s) [$(st)]" >> $REPORT
  $env_fn toybox time -v $D/bin/llama-bench $CPU_BENCH_ARGS -t $nth $flags > $D/bench_$name.log 2>&1
  rc=$?
  pp=$(sed -nE 's/.*\| *pp128 *\| *([0-9]+\.[0-9]+) .*/\1/p' $D/bench_$name.log | head -1)
  tg=$(sed -nE 's/.*\| *tg128 *\| *([0-9]+\.[0-9]+) .*/\1/p' $D/bench_$name.log | head -1)
  rss=$(grep -E 'Max RSS|Maximum resident' $D/bench_$name.log | head -1 | sed -nE 's/.*: *([0-9]+).*/\1/p')
  errs=$(grep -c -E "$ERRPAT" $D/bench_$name.log)
  echo "$name bench: exit=$rc pp128=${pp:-none} tg128=${tg:-none} threads=$nth maxRSS=${rss:-none}kB errors=$errs" >> $REPORT

  bad=
  [ $rc -eq 0 ] || bad="$bad bench-exit=$rc"
  [ -n "$pp" ] || bad="$bad no-pp128"
  [ -n "$tg" ] || bad="$bad no-tg128"
  [ -n "$rss" ] || bad="$bad no-maxRSS"
  [ "$errs" -eq 0 ] || bad="$bad errors=$errs"
  if [ -n "$bad" ]; then
    echo "INVALID $name bench:$bad" | tee -a $REPORT
    return 1
  fi
  sleep 90
  return 0
}

# arm_cpu_kld NAME ENV_FN FLAGS: llama-perplexity at -t 5, identical flags to gate G's KLD except
# the device. One KLD per layout; the layout is what the CPU must read identically.
arm_cpu_kld() {
  name=$1; env_fn="$2"; flags="$3"
  session_gates || return 1
  waitcool || return 1
  input keyevent 224; sleep 2
  echo "== $name kld start $(date +%s) [$(st)]" >> $REPORT
  $env_fn $D/bin/llama-perplexity -m $M $KLD_ARGS_CPU $flags > $D/kld_$name.log 2>&1
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
