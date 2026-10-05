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

abort() { touch $D/watchdog.stop; echo "SESSION ABORTED: $*" | tee -a $REPORT; exit 1; }

# Resume after session 1 aborted at the C-repack KLD (thermal status 1): the remaining CPU arms,
# appended to the same $REPORT. Same arm calls as run-step1.sh, nothing else.
# Resume 2 (after resume 1 hung 43 min in that KLD's first pass): watchdog.sh runs alongside.
export ADSP_LIBRARY_PATH="$DSP_REL;$R/lib"
echo "== step-1 resume start $(date) [$(st)]" >> $REPORT
(sh $D/watchdog.sh > /dev/null 2>&1 &)
session_gates || abort "resume preflight gates"
arm_cpu_kld c_repack "$ARM_A_ENV" "$CPU_C_REPACK_FLAGS" || abort "C-repack kld failed"
arm_cpu_kld c_tile   "$ARM_CT_ENV" "$CTILE_KLD_FLAGS" || abort "C-tile kld failed"
arm_cpu_bench c_native_t5  "$ARM_A_ENV" "$CPU_C_NATIVE_FLAGS" $CPU_T5 || abort "C-native bench t5 failed"
arm_cpu_bench c_tile_t5    "$ARM_CT_ENV" "$CTILE_BENCH_FLAGS" $CPU_T5 || abort "C-tile bench t5 failed"
arm_cpu_bench c_repack_t5  "$ARM_A_ENV" "$CPU_C_REPACK_FLAGS" $CPU_T5 || abort "C-repack bench t5 failed"
arm_cpu_bench c_repack2_t5 "$ARM_A_ENV" "$CPU_C_REPACK_FLAGS" $CPU_T5 || abort "C-repack2 bench t5 failed"
arm_cpu_bench c_tile2_t5   "$ARM_CT_ENV" "$CTILE_BENCH_FLAGS" $CPU_T5 || abort "C-tile2 bench t5 failed"
arm_cpu_bench c_native2_t5 "$ARM_A_ENV" "$CPU_C_NATIVE_FLAGS" $CPU_T5 || abort "C-native2 bench t5 failed"
touch $D/watchdog.stop
echo "== step-1 session end $(date) [$(st)]" >> $REPORT
echo "SESSION COMPLETE - read \$REPORT"
