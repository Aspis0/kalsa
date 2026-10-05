# step-4 env (FABLE-DESIGN Amendment E5): step 3's env and gates re-pointed at this build. Source on the phone:
#   . /data/local/tmp/govhtp/step4-s23/env.sh
. /data/local/tmp/govhtp/step3-s23/env.sh

OLD_BIN=$D/bin                     # step-3 build 8ac5522d0
D=$R/step4-s23
REPORT=$D/step4_report.txt
FARF_FILE=$D/dsp/llama-bench.farf
DSP_REL=$D/dsp-rel

# G = the GPU leg on the one copy: shared mode (step-2 env) with every HTP op declined, so the TILE32 decode
# mat-vecs go to OpenCL (HTP0 is first in -dev and would otherwise win them, ggml-backend.cpp backend_from_buffer)
# and the rest (norms, conv, attention, the Q6_K lm_head) to the CPU. -ts 1,0 keeps every layer on HTP0's buffer
# lists, which is what makes the weights TILE32. O = today's two-copy OpenCL decode (-dev GPUOpenCL, no env).
# One host thread (E3: the 90 C of the isolation report came from five host threads).
arm_env_gpu() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 \
      GGML_OP_OFFLOAD_MIN_BATCH=1 GGML_HEXAGON_ADMIT_OPS=7 GGML_HEXAGON_OPFILTER='.*' "$@"
}
# OPFILTER also declines the placement probe (session 1, 04:10: the matrices fell to CPU_REPACK and the step-3
# audit refused the load by name), so G places the Q4_0 matrices with step 1's -ot (CTILE_OT), drops CPU_REPACK
# (-nr) and keeps the KV on the CPU (-nkvo) like step 1's C-tile; llama-bench takes -nkvo with a value, the common
# parser as a flag; llama-bench splits test combinations on ',' and devices / tensor-split values on '/'
# (llama-bench.cpp ~680, ~921), and its -nr takes no value (~912).
ARM_G_ENV="arm_env_gpu"
ARM_G_BENCH_FLAGS="-ngl 99 -dev HTP0/GPUOpenCL -ts 1/0 -nr -nkvo 1 $CTILE_OT"
ARM_G_KLD_FLAGS="-ngl 99 -dev HTP0,GPUOpenCL -ts 1,0 -nr -nkvo $CTILE_OT"
ARM_O_ENV="env"
ARM_O_FLAGS="-ngl 99 -dev GPUOpenCL"
GPU_BENCH_ARGS="-m $M -p 0 -n 128 -r 3 -t 1"
GPU_KLD_ARGS="-f $FIXT -c 512 -b 512 -ub 1 -t 1 --no-warmup --chunks 2 --kl-divergence-base $BASELOGITS --kl-divergence -lv 5"
