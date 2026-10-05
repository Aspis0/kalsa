# step-1 ABBA session (FABLE-DESIGN Amendment A item 6).
# NPU A = two-copy (no env, gate-G arm A verbatim); NPU T = one copy in the non-host TILE32 buft
# (GGML_HEXAGON_HOSTBUF_REPACK=1, placement by llama's probe, no -ot); CPU arms = C-native
# (-ngl 0 -nr), C-repack (-ngl 0) and C-tile (Q4_0 weights in HTP0-TILE32, GGML_HEXAGON_OPFILTER
# declining every HTP op, MUL_MAT computing on the CPU) at -t 1 and -t 5. The CPU arm functions
# live in cpu-arms.sh, sourced below.
# Run on the phone in ONE adb shell, unplugged, screen on, after push-and-check.sh (sourced, like
# the old sessions - the gate functions must live in the same shell):
#   . /data/local/tmp/govhtp/step1-s23/run-step1.sh
# Everything lands in $REPORT plus per-run logs $D/*.log.

[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step1-s23/env.sh
[ -f "$D/cpu-arms.sh" ] || { echo "missing $D/cpu-arms.sh - push-and-check.sh pushes it" >&2; exit 1; }
. "$D/cpu-arms.sh"

abort() { echo "SESSION ABORTED: $*" | tee -a $REPORT; exit 1; }

# proof_npu NAME ENV_FN LOAD: one decode pass (-p 0 -n 32) and one prefill pass (-p 512 -n 0)
# with the profile env; the prefill pass runs with the DSP FARF mask on and its kernel lines are
# taken from logcat -s adsprpc. Kernel family per MUL_MAT comes from the profile-op kparams column
# (hvx-tiled / hmx-tiled / hvx-flat). Enforces the arm's proof lines; a missing line = invalid arm.
proof_npu() {
  name=$1; env_fn="$2"; load="$3"
  input keyevent 224; sleep 2
  $env_fn $PROF_ENV $D/bin/llama-bench -m $M -p 0 -n 32 -ub 512 -r 1 -t 1 -ngl 99 -dev HTP0 $load -v > $D/proof_decode_$name.log 2>&1
  rc1=$?
  logcat -c
  printf '0x1F\n' > $FARF_FILE
  $env_fn $PROF_ENV $D/bin/llama-bench -m $M -p 512 -n 0 -ub 512 -r 1 -t 1 -ngl 99 -dev HTP0 $load -v > $D/proof_prefill_$name.log 2>&1
  rc2=$?
  rm -f $FARF_FILE
  logcat -d -s adsprpc > $D/adsprpc_$name.log 2>&1

  tile=$(grep -c 'HTP0-TILE32 model buffer size' $D/proof_decode_$name.log)
  tilemib=$(grep -m1 'HTP0-TILE32 model buffer size' $D/proof_decode_$name.log | sed -nE 's/.*= *([0-9.]+) MiB.*/\1/p')
  tileint=${tilemib%%.*}
  hostbuf=$(grep -c 'HTP0-HOST model buffer size' $D/proof_decode_$name.log)
  tiled=$(grep 'profile-op MUL_MAT' $D/proof_decode_$name.log | grep -c -E 'hvx-tiled|hmx-tiled')
  flat=$(grep 'profile-op MUL_MAT' $D/proof_decode_$name.log | grep -c 'hvx-flat')
  hmx=$(grep -c 'hmx-mm-2d:' $D/adsprpc_$name.log)
  hmxline=$(grep -m1 'hmx-mm-2d:' $D/adsprpc_$name.log | sed 's/^.*hmx-mm-2d:/hmx-mm-2d:/')
  splits=$(grep -m1 'graph splits' $D/proof_decode_$name.log | sed -nE 's/.*= *([0-9]+).*/\1/p')
  loadms=$(grep -m1 'load time =' $D/proof_decode_$name.log | sed -nE 's/.*= *([0-9.]+) ms.*/\1/p')
  errs=$(grep -c -E "$ERRPAT" $D/proof_decode_$name.log $D/proof_prefill_$name.log | grep -v ':0' | tr '\n' ' ')
  echo "proof $name: exit=$rc1/$rc2 TILE32-buf=$tile (${tilemib:-none} MiB) HTP0-HOST-buf=$hostbuf splits=${splits:-?} mm=kern-tiled:$tiled flat:$flat hmx-mm-2d=$hmx load=${loadms:-?}ms errors=[$errs] [$(st)]" >> $REPORT
  [ -n "$hmxline" ] && echo "proof $name: $hmxline" >> $REPORT

  bad=
  [ $rc1 -eq 0 ] && [ $rc2 -eq 0 ] || bad="$bad proof-exit=$rc1/$rc2"
  [ "$tiled" -gt 0 ] || bad="$bad no-tiled-MUL_MAT-tag"
  [ "$flat" -eq 0 ] || bad="$bad flat-MUL_MAT-tags=$flat"
  [ "${splits:-999}" -le $MAX_SPLITS ] || bad="$bad graph-splits=${splits:-none}"
  [ "$hmx" -gt 0 ] || bad="$bad no-hmx-mm-2d-line"
  [ "$errs" = "" ] || bad="$bad error-patterns"
  [ "$hostbuf" -eq 0 ] || bad="$bad unexpected-HTP0-HOST-buffer"
  if [ "$name" = T ]; then
    [ "$tile" -gt 0 ] || bad="$bad no-HTP0-TILE32-buffer-line"
    [ "${tileint:-0}" -ge $TILE_MIN_MIB ] || bad="$bad TILE32-buffer-too-small=${tilemib:-none}MiB"
  else
    [ "$tile" -eq 0 ] || bad="$bad unexpected-HTP0-TILE32-buffer"
  fi
  if [ -n "$bad" ]; then
    echo "INVALID proof $name:$bad" | tee -a $REPORT
    return 1
  fi
  echo "proof $name: PASS" >> $REPORT
  return 0
}

# arm_npu NAME ENV_FN LOAD: timed bench (-r 3 -t 5) + KLD, 90 s gap. Guard rails and proof lines
# are enforced here; an arm failing its gates returns 1 so the session aborts instead of passing
# bad data (gate-G discipline).
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

rm -f $REPORT
export ADSP_LIBRARY_PATH="$D/dsp;$R/lib"
echo "== step-1 session start $(date) [$(st)]" >> $REPORT
[ -x $D/bin/llama-bench ] && [ -x $D/bin/llama-perplexity ] || abort "missing binaries in $D/bin (run push-and-check.sh first)"
[ -f $D/dsp/libggml-htp-v73.so ] || abort "missing skel in $D/dsp"
[ -f $DSP_REL/libggml-htp-v73.so ] || abort "missing release skel in $DSP_REL"
[ -f $M ] || abort "missing model $M"
[ -f $FIXT ] || abort "missing fixture $FIXT"
[ -f $BASELOGITS ] || abort "missing base logits $BASELOGITS"
session_gates || abort "preflight gates"

proof_npu A "$ARM_A_ENV" "$ARM_A_LOAD" || abort "NPU A proof failed"
sleep 60
proof_npu T "$ARM_T_ENV" "$ARM_T_LOAD" || abort "NPU T proof failed"
proof_cpu c_native "$ARM_A_ENV" "$CPU_C_NATIVE_FLAGS" || abort "C-native proof failed"
proof_cpu c_repack "$ARM_A_ENV" "$CPU_C_REPACK_FLAGS" || abort "C-repack proof failed"
proof_ctile c_tile "$ARM_CT_ENV" "$CTILE_BENCH_FLAGS" || abort "C-tile proof failed"

# NPU ABBA at -t 5: bench + KLD per leg, release skel (gate-G reference 876 / 22.1)
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
sleep 60
arm_npu A  "$ARM_A_ENV" "$ARM_A_LOAD" || abort "NPU A timed failed"
arm_npu T  "$ARM_T_ENV" "$ARM_T_LOAD" || abort "NPU T timed failed"
arm_npu T2 "$ARM_T_ENV" "$ARM_T_LOAD" || abort "NPU T2 timed failed"
arm_npu A2 "$ARM_A_ENV" "$ARM_A_LOAD" || abort "NPU A2 timed failed"

# CPU ABBA at -t 1 (bench only, so the ABBA timing stays tight): N T R R2 T2 N2 is ABBA for every
# pair (N-T, N-R, T-R). Then the layout KLD trio.
arm_cpu_bench c_native  "$ARM_A_ENV" "$CPU_C_NATIVE_FLAGS" $CPU_T1 || abort "C-native bench t1 failed"
arm_cpu_bench c_tile    "$ARM_CT_ENV" "$CTILE_BENCH_FLAGS" $CPU_T1 || abort "C-tile bench t1 failed"
arm_cpu_bench c_repack  "$ARM_A_ENV" "$CPU_C_REPACK_FLAGS" $CPU_T1 || abort "C-repack bench t1 failed"
arm_cpu_bench c_repack2 "$ARM_A_ENV" "$CPU_C_REPACK_FLAGS" $CPU_T1 || abort "C-repack2 bench t1 failed"
arm_cpu_bench c_tile2   "$ARM_CT_ENV" "$CTILE_BENCH_FLAGS" $CPU_T1 || abort "C-tile2 bench t1 failed"
arm_cpu_bench c_native2 "$ARM_A_ENV" "$CPU_C_NATIVE_FLAGS" $CPU_T1 || abort "C-native2 bench t1 failed"
arm_cpu_kld c_native "$ARM_A_ENV" "$CPU_C_NATIVE_FLAGS" || abort "C-native kld failed"
arm_cpu_kld c_repack "$ARM_A_ENV" "$CPU_C_REPACK_FLAGS" || abort "C-repack kld failed"
arm_cpu_kld c_tile   "$ARM_CT_ENV" "$CTILE_KLD_FLAGS" || abort "C-tile kld failed"

# CPU ABBA at -t 5 (bench only)
arm_cpu_bench c_native_t5  "$ARM_A_ENV" "$CPU_C_NATIVE_FLAGS" $CPU_T5 || abort "C-native bench t5 failed"
arm_cpu_bench c_tile_t5    "$ARM_CT_ENV" "$CTILE_BENCH_FLAGS" $CPU_T5 || abort "C-tile bench t5 failed"
arm_cpu_bench c_repack_t5  "$ARM_A_ENV" "$CPU_C_REPACK_FLAGS" $CPU_T5 || abort "C-repack bench t5 failed"
arm_cpu_bench c_repack2_t5 "$ARM_A_ENV" "$CPU_C_REPACK_FLAGS" $CPU_T5 || abort "C-repack2 bench t5 failed"
arm_cpu_bench c_tile2_t5   "$ARM_CT_ENV" "$CTILE_BENCH_FLAGS" $CPU_T5 || abort "C-tile2 bench t5 failed"
arm_cpu_bench c_native2_t5 "$ARM_A_ENV" "$CPU_C_NATIVE_FLAGS" $CPU_T5 || abort "C-native2 bench t5 failed"

# every proof and arm line above already landed in $REPORT; the step-1 comparison is the
# coordinator's call on these lines.
echo "== step-1 session end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
