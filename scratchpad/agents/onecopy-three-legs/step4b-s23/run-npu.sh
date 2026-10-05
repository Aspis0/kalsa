# NPU re-measure on the merged build with step 4b + Amendment I (24fb5b8d6): two-copy A vs shared S, ABBA with KLD,
# and the RAM of S. The release skel changed with the main merge (9455871f...), so steps 1-3's NPU numbers are
# re-taken here. S now keeps token_embd (and the tied output reused from it) in HTP0-HOST-W, so HOST is ~219 MiB by
# design; the step-3 placement diff is skipped (its reference binary predates the main merge).
#   . /data/local/tmp/govhtp/step4b-s23/run-npu.sh
[ -n "${D:-}" ] || . /data/local/tmp/govhtp/step4b-s23/env.sh
REPORT=$D/npu_report.txt
HOST_MAX_MIB=230
. "$D/proofs.sh"
. "$D/ram.sh"
abort() { echo "SESSION ABORTED: $*" | tee -a $REPORT; exit 1; }

rm -f $REPORT
export ADSP_LIBRARY_PATH="$D/dsp;$R/lib"
echo "== step-4b NPU session start $(date) [$(st)]" >> $REPORT
echo "binaries: $(sha256sum $D/bin/llama-bench $D/dsp-rel/libggml-htp-v73.so | awk '{print substr($1,1,12)}' | tr '\n' ' ')(bench rel-skel)" >> $REPORT
[ -x $D/bin/llama-bench ] || abort "missing binaries"
session_gates || abort "preflight gates"

proof A "$ARM_A_ENV" || abort "A proof failed"
sleep 60
proof S "$ARM_S_ENV" || abort "S proof failed"
L=$D/proof_decode_S.log
reuse=$(grep -m1 'shared weights: .* reused for ' $L | sed 's/^.*shared weights:/shared weights:/')
summ=$(grep -m1 'shared weights: TILE32 ' $L | sed 's/^.*shared weights:/shared weights:/')
echo "C1 S: reuse=[${reuse:-none}] summary=[${summ:-none}]" >> $REPORT
[ -n "$reuse" ] && [ -n "$summ" ] || abort "C1 log lines missing"
grep -q 'HTP0 model buffer size' $L && abort "S has an HTP0 device weight buffer"

export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
sleep 60
arm_npu A  "$ARM_A_ENV" "" || abort "A timed failed"
arm_npu S  "$ARM_S_ENV" "" || abort "S timed failed"
arm_npu S2 "$ARM_S_ENV" "" || abort "S2 timed failed"
arm_npu A2 "$ARM_A_ENV" "" || abort "A2 timed failed"
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
}
ram_arm S "$ARM_S_ENV" "-ngl 99 -dev HTP0" || abort "ram S failed"
echo "== step-4b NPU session end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
