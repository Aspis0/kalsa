# step-2 session (FABLE-DESIGN Amendment B): two-copy placement unchanged (B1), shared-mode
# placement by the probe with norms in HOST (B2), the 832 MiB split (B3), the NPU ABBA re-run
# with the shipped placement and the RAM table (B4).
# A = two-copy NPU (no env, step-1 arm A); S = shared mode (env.sh arm_env_shared, no -ot).
# Run on the phone in ONE adb shell, unplugged, screen on, after push-and-check.sh:
#   . /data/local/tmp/govhtp/step2-s23/run-step2.sh
# Everything lands in $REPORT plus per-run logs $D/*.log.

[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step2-s23/env.sh
. "$D/proofs.sh"
. "$D/ram.sh"

abort() { echo "SESSION ABORTED: $*" | tee -a $REPORT; exit 1; }

# ram_arm NAME ENV_FN FLAGS: one untimed bench (-r 1) with the sampler alongside.
ram_arm() {
  name=$1; env_fn="$2"; flags="$3"
  session_gates || return 1
  waitcool || return 1
  input keyevent 224; sleep 2
  ram $name &
  $env_fn $D/bin/llama-bench -m $M -p 512 -n 128 -ub 512 -r 1 -t 5 $flags > $D/ram_$name.log 2>&1
  rc=$?
  wait
  echo "ram $name: bench exit=$rc [$(st)]" >> $REPORT
  [ $rc -eq 0 ] || { echo "INVALID ram $name: bench-exit=$rc" | tee -a $REPORT; return 1; }
  sleep 60
}

rm -f $REPORT
export ADSP_LIBRARY_PATH="$D/dsp;$R/lib"
echo "== step-2 session start $(date) [$(st)]" >> $REPORT
echo "binaries: $(sha256sum $D/bin/llama-bench $OLD_BIN/llama-bench | awk '{print substr($1,1,12)}' | tr '\n' ' ')(new old)" >> $REPORT
[ -x $D/bin/llama-bench ] && [ -x $D/bin/llama-perplexity ] || abort "missing binaries in $D/bin"
[ -x $OLD_BIN/llama-bench ] || abort "missing step-1 binary $OLD_BIN/llama-bench"
[ -f $D/dsp/libggml-htp-v73.so ] && [ -f $DSP_REL/libggml-htp-v73.so ] || abort "missing skel"
[ -f $M ] && [ -f $FIXT ] && [ -f $BASELOGITS ] || abort "missing model or KLD inputs"
session_gates || abort "preflight gates"

placement_diff npu "-ngl 99 -dev HTP0" || abort "two-copy NPU placement changed"
placement_diff cpu "-ngl 0 -nr" || abort "two-copy CPU placement changed"
proof A "$ARM_A_ENV" || abort "A proof failed"
sleep 60
proof S "$ARM_S_ENV" || abort "S proof failed"

export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
sleep 60
arm_npu A  "$ARM_A_ENV" "" || abort "A timed failed"
arm_npu S  "$ARM_S_ENV" "" || abort "S timed failed"
arm_npu S2 "$ARM_S_ENV" "" || abort "S2 timed failed"
arm_npu A2 "$ARM_A_ENV" "" || abort "A2 timed failed"

# RAM: today's app holds A's NPU model plus a CPU model (C); S is the one copy for both legs.
ram_arm A "$ARM_A_ENV" "-ngl 99 -dev HTP0" || abort "ram A failed"
ram_arm C "$ARM_A_ENV" "-ngl 0 -nr" || abort "ram C failed"
ram_arm S "$ARM_S_ENV" "-ngl 99 -dev HTP0" || abort "ram S failed"

echo "== step-2 session end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
